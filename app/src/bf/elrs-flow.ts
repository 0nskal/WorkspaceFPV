/**
 * Reads the ExpressLRS receiver version from the FC side (spec section 7, route A):
 *   MSP2_COMMON_SERIAL_CONFIG -> RX serial port id -> CLI `serialpassthrough <id> 420000 rxtx reset` -> CRSF DEVICE_PING ->
 *   parse DEVICE_INFO -> drop DTR (the FC resets, the app reconnects).
 * Runs inside a raw session (MSP suspended). Only a tiny allow-list of CLI lines is ever sent.
 */
import type { RawIo } from '../serial/types';
import { CRSF, CrsfParser, buildPing, parseDeviceInfo } from './crsf';
import { FUNCTION_RX_SERIAL, MSP2_COMMON_SERIAL_CONFIG, decodeSerialConfig, rawMspV2 } from './msp2';

export type ElrsStep = 'config' | 'cli' | 'passthrough' | 'ping' | 'reset';

export interface ElrsInfo {
  /** Device / target name reported by the receiver. */
  name: string;
  /** "3.4.3". */
  version: string;
  serial: string;
  fieldCount: number;
  /** Serial port identifier used for the passthrough. */
  portId: number;
  at: number;
}

export type ElrsResult =
  | { kind: 'ok'; info: ElrsInfo }
  /** No UART with the serial-RX function (SPI receiver, PWM/PPM or not configured). Nothing was changed. */
  | { kind: 'no-uart' }
  /** The passthrough worked but no DEVICE_INFO came back. `sawCrsf` = other CRSF frames were seen (old ELRS?). */
  | { kind: 'no-answer'; sawCrsf: boolean; sawBytes: boolean };

export type ElrsErrorCode = 'serialConfig' | 'cli' | 'passthrough';

export class ElrsFlowError extends Error {
  constructor(
    readonly code: ElrsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ElrsFlowError';
  }
}

/** CLI lines the ELRS flow may send. Everything else is refused in code. */
const ALLOWED_CLI = /^(#|exit|serialpassthrough \d{1,3} 420000 rxtx reset)$/;

export function assertAllowedCli(line: string): void {
  if (!ALLOWED_CLI.test(line.trim())) throw new Error(`CLI line not allowed: ${line}`);
}

export const passthroughCommand = (id: number): string => `serialpassthrough ${id} 420000 rxtx reset`;

export interface ElrsFlowOptions {
  sleep?: (ms: number) => Promise<void>;
  timeoutScale?: number;
  pingIntervalMs?: number;
  pingAttempts?: number;
  onProgress?: (step: ElrsStep) => void;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const dec = new TextDecoder();
const enc = new TextEncoder();

export async function readElrsInfo(io: RawIo, opts: ElrsFlowOptions = {}): Promise<ElrsResult> {
  const sleep = opts.sleep ?? realSleep;
  const scale = opts.timeoutScale ?? 1;
  const progress = (s: ElrsStep) => opts.onProgress?.(s);

  // 1. which UART carries the serial receiver?
  progress('config');
  let ports;
  try {
    ports = decodeSerialConfig(await rawMspV2(io, MSP2_COMMON_SERIAL_CONFIG, new Uint8Array(0), 1500 * scale));
  } catch (e) {
    throw new ElrsFlowError('serialConfig', e instanceof Error ? e.message : String(e));
  }
  const rx = ports.find((p) => (p.functionMask & FUNCTION_RX_SERIAL) !== 0);
  if (!rx) return { kind: 'no-uart' };

  // 2. enter the CLI. From here on the FC must end up rebooting (exit or DTR drop).
  progress('cli');
  let text = '';
  const send = async (line: string, raw = false) => {
    if (!raw) assertAllowedCli(line);
    await io.write(enc.encode(raw ? line : line + '\n'));
  };
  const waitText = async (re: RegExp, ms: number): Promise<boolean> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (re.test(text)) return true;
      text += dec.decode(await io.readSome(Math.max(10, Math.min(100, end - Date.now()))));
    }
    return re.test(text);
  };
  const leaveCli = async () => {
    io.expectReboot();
    await send('exit').catch(() => undefined);
  };

  io.clear();
  await io.write(enc.encode('#'));
  let inCli = await waitText(/# $/, 1500 * scale);
  if (!inCli) {
    text = '';
    await io.write(enc.encode('\r\n#'));
    inCli = await waitText(/# $/, 1500 * scale);
  }
  if (!inCli) throw new ElrsFlowError('cli', 'no CLI prompt');

  // 3. passthrough to the receiver UART; `reset` makes the FC reboot when DTR drops
  progress('passthrough');
  text = '';
  await send(passthroughCommand(rx.id));
  const fwd = await waitText(/Forwarding/i, 2000 * scale);
  if (!fwd) {
    await leaveCli();
    throw new ElrsFlowError('passthrough', text.trim().slice(-120) || 'no answer to serialpassthrough');
  }
  io.clear();

  // 4. ping the receiver until DEVICE_INFO arrives
  progress('ping');
  const parser = new CrsfParser();
  const ping = buildPing();
  let sawCrsf = false;
  let sawBytes = false;
  let info: ElrsResult = { kind: 'no-answer', sawCrsf: false, sawBytes: false };
  await sleep(150);
  const attempts = opts.pingAttempts ?? 8;
  for (let a = 0; a < attempts; a++) {
    await io.write(ping);
    const end = Date.now() + (opts.pingIntervalMs ?? 250) * scale;
    let done = false;
    while (Date.now() < end && !done) {
      const chunk = await io.readSome(Math.max(10, end - Date.now()));
      if (chunk.length) sawBytes = true;
      for (const f of parser.push(chunk)) {
        sawCrsf = true;
        if (f.type === CRSF.TYPE_DEVICE_INFO) {
          const d = parseDeviceInfo(f.body);
          if (d) {
            info = { kind: 'ok', info: { name: d.name, version: d.version, serial: d.serialText, fieldCount: d.fieldCount, portId: rx.id, at: Date.now() } };
            done = true;
            break;
          }
        }
      }
    }
    if (done) break;
  }
  if (info.kind !== 'ok') info = { kind: 'no-answer', sawCrsf, sawBytes };

  // 5. drop DTR: the FC resets. Wait for the reconnect is the caller's job.
  progress('reset');
  await io.dropDtrAndClose();
  return info;
}
