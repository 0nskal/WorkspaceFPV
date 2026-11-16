/**
 * Read-only ESC info flow over the 4-way interface (spec section 6). Runs inside a raw session (MSP suspended):
 *   MSP_SET_PASSTHROUGH -> 4-way: init + read settings per ESC (+ reset that ESC) -> InterfaceExit -> verify MSP is back.
 * Nothing is ever written: see READ_ONLY_CMDS in fourway.ts. `finally` always tries to leave the interface.
 */
import type { RawIo } from '../serial/types';
import { ACK, CMD, FourWayClient, FourWayError, MODE, decodeInitFlash } from './fourway';
import { AM32_BOOT_PINS, decodeAm32, decodeSilabs, eepromLocation, mcuFromSignature, unknownSettings, type EscFirmware, type EscSettings } from './esc-eeprom';
import { hex } from './crc';
import { MSP_SET_PASSTHROUGH, rawMspV1 } from './msp2';

export type EscStep = 'passthrough' | 'wait' | 'esc' | 'exit' | 'verify';

export interface EscProgress {
  step: EscStep;
  /** 0-based ESC index while step = 'esc'. */
  index?: number;
  count?: number;
}

export type EscNote = 'blheli32' | 'atmel' | 'unsupportedMcu' | 'unknownLayout' | 'readFail';

export interface EscDevice {
  index: number;
  status: 'ok' | 'no-response';
  /** Last ack code from DEVICE_INIT_FLASH when the ESC did not answer. */
  ack?: number;
  mcuSignature?: number;
  mcuName?: string;
  bootByte?: number;
  mode?: number;
  firmware: EscFirmware;
  settings?: EscSettings;
  note?: EscNote;
  /** First bytes of the settings block (hex) when the layout was not recognised, for bug reports. */
  rawHead?: string;
}

export interface EscScan {
  /** Motor outputs reported by the FC (not the number of ESCs that answered). */
  count: number;
  escs: EscDevice[];
  interfaceName?: string;
  at: number;
}

export type EscErrorCode = 'passthrough' | 'protocol' | 'stuck';

export class EscFlowError extends Error {
  constructor(
    readonly code: EscErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EscFlowError';
  }
}

export interface EscFlowOptions {
  sleep?: (ms: number) => Promise<void>;
  /** Wait after entering 4-way (ESCs may be playing their startup tune). Spec: about 1.2 s. */
  settleMs?: number;
  /** Multiplier for per-call timeouts (tests use a small value). */
  timeoutScale?: number;
  onProgress?: (p: EscProgress) => void;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_ESC = 8;

export async function readEscInfo(io: RawIo, opts: EscFlowOptions = {}): Promise<EscScan> {
  const sleep = opts.sleep ?? realSleep;
  const scale = opts.timeoutScale ?? 1;
  const progress = (p: EscProgress) => opts.onProgress?.(p);
  const client = new FourWayClient(io, { timeoutMs: 500 * scale, attempts: 2 });

  let count = 0;
  try {
    progress({ step: 'passthrough' });
    const reply = await rawMspV1(io, MSP_SET_PASSTHROUGH, new Uint8Array(0), 1500 * scale).catch((e: unknown) => {
      throw new EscFlowError('passthrough', e instanceof Error ? e.message : String(e));
    });
    count = Math.min(MAX_ESC, reply[0] ?? 0);
  } catch (e) {
    // The FC did not accept 4-way: nothing changed, MSP is still alive.
    throw e instanceof EscFlowError ? e : new EscFlowError('passthrough', String(e));
  }

  const initialised = new Set<number>();
  const escs: EscDevice[] = [];
  let interfaceName: string | undefined;
  let failure: unknown = null;

  try {
    progress({ step: 'wait', count });
    await sleep(opts.settleMs ?? 1200);
    await client.call(CMD.TEST_ALIVE, [0], 0, { timeoutMs: 800 * scale });
    try {
      const n = await client.call(CMD.INTERFACE_GET_NAME);
      interfaceName = String.fromCharCode(...n.data).replace(/\0+$/, '');
    } catch {
      /* the name is cosmetic */
    }

    for (let i = 0; i < count; i++) {
      progress({ step: 'esc', index: i, count });
      escs.push(await readOne(client, i, initialised, sleep, scale));
      // Restart this ESC right away so it leaves the bootloader (the interface keeps the line idle high).
      if (initialised.has(i)) {
        await resetEsc(client, i);
        initialised.delete(i);
      }
      await client.call(CMD.TEST_ALIVE, [0], 0, { timeoutMs: 400 * scale, attempts: 1 }).catch(() => undefined);
    }
  } catch (e) {
    failure = e;
  } finally {
    progress({ step: 'exit', count });
    for (const i of [...initialised]) await resetEsc(client, i);
    // Always try to leave 4-way. The ack may be lost; the verify step below decides whether MSP is back.
    for (let a = 0; a < 3; a++) {
      try {
        await client.call(CMD.INTERFACE_EXIT, [0], 0, { timeoutMs: 600 * scale, attempts: 1 });
        break;
      } catch {
        await sleep(100);
      }
    }
  }

  progress({ step: 'verify', count });
  let back = false;
  for (let a = 0; a < 3 && !back; a++) {
    try {
      await rawMspV1(io, 1, new Uint8Array(0), 1000 * scale);
      back = true;
    } catch {
      await sleep(200);
    }
  }
  if (!back) throw new EscFlowError('stuck', 'FC did not return to MSP after leaving the 4-way interface');
  if (failure) {
    if (failure instanceof FourWayError) throw new EscFlowError('protocol', failure.message);
    throw failure;
  }
  return { count, escs, interfaceName, at: Date.now() };
}

async function resetEsc(client: FourWayClient, i: number): Promise<void> {
  try {
    await client.call(CMD.DEVICE_RESET, [i], 0, { timeoutMs: 600, attempts: 1 });
  } catch {
    /* best effort */
  }
}

async function readOne(client: FourWayClient, i: number, initialised: Set<number>, sleep: (ms: number) => Promise<void>, scale: number): Promise<EscDevice> {
  // 1. connect to the ESC bootloader (retry up to 5 times; failure here means no power / no bootloader / wiring)
  let init: ReturnType<typeof decodeInitFlash> = null;
  let lastAck: number | undefined;
  for (let a = 0; a < 5 && !init; a++) {
    try {
      const r = await client.call(CMD.DEVICE_INIT_FLASH, [i], 0, { timeoutMs: 1500 * scale, attempts: 1 });
      if (r.ack === ACK.OK) {
        init = decodeInitFlash(r.data);
        if (!init) lastAck = ACK.GENERAL_ERROR;
      } else {
        lastAck = r.ack;
        if (r.ack === ACK.INVALID_CHANNEL) break;
      }
    } catch (e) {
      if (!(e instanceof FourWayError)) throw e;
      lastAck = undefined;
    }
    if (!init) await sleep(100);
  }
  if (!init) return { index: i, status: 'no-response', ack: lastAck, firmware: 'unknown' };
  initialised.add(i);

  const mcu = mcuFromSignature(init.signature, init.mode);
  const base: EscDevice = { index: i, status: 'ok', mcuSignature: init.signature, mcuName: mcu.name, bootByte: init.bootByte, mode: init.mode, firmware: 'unknown' };

  // 2. classify by interface mode, then read the settings block (read-only DEVICE_READ)
  if (init.mode === MODE.ATM_BLB || init.mode === MODE.ATM_SK) return { ...base, firmware: 'blheli_atmel', note: 'atmel' };

  if (init.mode === MODE.ARM_BLB) {
    if (!AM32_BOOT_PINS.has(init.bootByte)) return { ...base, firmware: 'blheli_32', note: 'blheli32' };
    const loc = eepromLocation('arm', init.signature, 'am32');
    if (!loc) return { ...base, firmware: 'am32', note: 'unsupportedMcu', settings: { ...unknownSettings(), firmware: 'am32', firmwareName: 'AM32' } };
    const block = await readBlock(client, loc.addr, loc.len, scale);
    if (!block) return { ...base, firmware: 'am32', note: 'readFail' };
    const nameBlock = loc.nameBefore ? await readBlock(client, loc.addr - loc.nameBefore, 16, scale) : null;
    const s = decodeAm32(block, nameBlock ?? undefined);
    if (s.firmware === 'unknown') return { ...base, firmware: 'am32', note: 'unknownLayout', rawHead: hex(block.subarray(0, 16)) };
    return { ...base, firmware: s.firmware, settings: s };
  }

  // SiLabs C2 / bootloader
  const loc = eepromLocation(mcu.family === 'silabs' ? 'silabs' : mcu.family, init.signature, 'silabs');
  if (!loc) return { ...base, note: 'unsupportedMcu' };
  const block = await readBlock(client, loc.addr, loc.len, scale);
  if (!block) return { ...base, note: 'readFail' };
  const s = decodeSilabs(block);
  if (s.firmware === 'unknown') return { ...base, firmware: 'unknown', note: 'unknownLayout', rawHead: hex(block.subarray(0, 16)), settings: s.target ? s : undefined };
  return { ...base, firmware: s.firmware, settings: s };
}

/** DEVICE_READ of `len` bytes (1..255) at a 16-bit address; null when the ESC refuses or answers short. */
async function readBlock(client: FourWayClient, addr: number, len: number, scale: number): Promise<Uint8Array | null> {
  try {
    const r = await client.call(CMD.DEVICE_READ, [len & 0xff], addr, { timeoutMs: 1000 * scale, attempts: 2 });
    if (r.ack !== ACK.OK || r.data.length < len) return null;
    return r.data.subarray(0, len);
  } catch (e) {
    if (e instanceof FourWayError) return null;
    throw e;
  }
}
