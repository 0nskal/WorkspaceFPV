/**
 * Betaflight 4-way interface (FC <-> ESC bootloader), host side. Pure protocol: frames, CRC, commands.
 * Implemented from the description in design/BETAFLIGHT-PARITY.md section 6 (clean-room, MIT).
 *
 * SAFETY: WorkspaceFPV only reads. Every outgoing request goes through `encodeRequest`, which refuses any command that is
 * not in READ_ONLY_CMDS (no erase, no flash write, no EEPROM write, no mode change). The guard is in code, not in UI.
 */
import { crc16Xmodem } from './crc';

export const PC_START = 0x2f; // '/'
export const IF_START = 0x2e; // '.'

export const CMD = {
  TEST_ALIVE: 0x30,
  PROTOCOL_GET_VERSION: 0x31,
  INTERFACE_GET_NAME: 0x32,
  INTERFACE_GET_VERSION: 0x33,
  INTERFACE_EXIT: 0x34,
  DEVICE_RESET: 0x35,
  DEVICE_INIT_FLASH: 0x37,
  DEVICE_ERASE_ALL: 0x38,
  DEVICE_PAGE_ERASE: 0x39,
  DEVICE_READ: 0x3a,
  DEVICE_WRITE: 0x3b,
  DEVICE_C2CK_LOW: 0x3c,
  DEVICE_READ_EEPROM: 0x3d,
  DEVICE_WRITE_EEPROM: 0x3e,
  INTERFACE_SET_MODE: 0x3f,
  DEVICE_VERIFY: 0x40,
} as const;

export const ACK = {
  OK: 0x00,
  UNKNOWN_ERROR: 0x01,
  INVALID_CMD: 0x02,
  INVALID_CRC: 0x03,
  VERIFY_ERROR: 0x04,
  INVALID_CHANNEL: 0x08,
  INVALID_PARAM: 0x09,
  GENERAL_ERROR: 0x0f,
} as const;

/** The ONLY commands WorkspaceFPV may send. Anything else throws before a byte reaches the wire. */
export const READ_ONLY_CMDS: ReadonlySet<number> = new Set<number>([
  CMD.TEST_ALIVE,
  CMD.PROTOCOL_GET_VERSION,
  CMD.INTERFACE_GET_NAME,
  CMD.INTERFACE_GET_VERSION,
  CMD.INTERFACE_EXIT,
  CMD.DEVICE_RESET, // restarts the ESC application (leaves the bootloader); not a write
  CMD.DEVICE_INIT_FLASH, // connects to the bootloader, returns the signature
  CMD.DEVICE_READ,
]);

export class FourWayForbiddenError extends Error {
  constructor(readonly cmd: number) {
    super(`4-way command 0x${cmd.toString(16)} is not allowed (read-only policy)`);
    this.name = 'FourWayForbiddenError';
  }
}

/**
 * Builds a request frame: 0x2F cmd addrHi addrLo paramLen param... crcHi crcLo.
 * paramLen 0 would mean 256 bytes to the FC, so commands without data carry one dummy byte (the firmware reads the
 * parameter block with a do-while). `param` longer than 255 is rejected.
 */
export function encodeRequest(cmd: number, param: ArrayLike<number> = [0], addr = 0): Uint8Array {
  if (!READ_ONLY_CMDS.has(cmd)) throw new FourWayForbiddenError(cmd);
  const p = param.length === 0 ? [0] : Array.from(param as ArrayLike<number>);
  if (p.length > 255) throw new RangeError('4-way parameter block too long');
  const out = new Uint8Array(5 + p.length + 2);
  out[0] = PC_START;
  out[1] = cmd;
  out[2] = (addr >> 8) & 0xff;
  out[3] = addr & 0xff;
  out[4] = p.length;
  for (let i = 0; i < p.length; i++) out[5 + i] = p[i] & 0xff;
  const crc = crc16Xmodem(out.subarray(0, 5 + p.length));
  out[5 + p.length] = crc >> 8;
  out[6 + p.length] = crc & 0xff;
  return out;
}

export interface FourWayResponse {
  cmd: number;
  addr: number;
  data: Uint8Array;
  ack: number;
}

/** Builds a response frame (used by the demo/test simulators): 0x2E cmd addrHi addrLo outLen out... ack crcHi crcLo. */
export function encodeResponse(cmd: number, addr: number, data: ArrayLike<number>, ack: number): Uint8Array {
  const d = data.length === 0 ? [0] : Array.from(data as ArrayLike<number>);
  if (d.length > 256) throw new RangeError('4-way response too long');
  const out = new Uint8Array(5 + d.length + 1 + 2);
  out[0] = IF_START;
  out[1] = cmd;
  out[2] = (addr >> 8) & 0xff;
  out[3] = addr & 0xff;
  out[4] = d.length === 256 ? 0 : d.length;
  for (let i = 0; i < d.length; i++) out[5 + i] = d[i] & 0xff;
  out[5 + d.length] = ack;
  const crc = crc16Xmodem(out.subarray(0, 6 + d.length));
  out[6 + d.length] = crc >> 8;
  out[7 + d.length] = crc & 0xff;
  return out;
}

/** Streaming parser for FC -> host frames (marker 0x2E). Resynchronises on garbage; drops frames with a bad CRC. */
export class FourWayParser {
  private buf: number[] = [];

  push(bytes: Uint8Array): FourWayResponse[] {
    for (const b of bytes) this.buf.push(b);
    const out: FourWayResponse[] = [];
    for (;;) {
      // A stray 0x2E byte must not hide a real frame behind it: look at every candidate start, keep waiting only
      // when no later candidate is a complete, CRC-valid frame.
      let pending = -1;
      let found = false;
      for (let s = 0; s < this.buf.length; s++) {
        if (this.buf[s] !== IF_START) continue;
        if (this.buf.length - s < 5) {
          if (pending < 0) pending = s;
          continue;
        }
        const len = this.buf[s + 4] === 0 ? 256 : this.buf[s + 4];
        const total = 5 + len + 1 + 2;
        if (this.buf.length - s < total) {
          if (pending < 0) pending = s;
          continue;
        }
        const frame = this.buf.slice(s, s + total);
        if (crc16Xmodem(frame.slice(0, total - 2)) === ((frame[total - 2] << 8) | frame[total - 1])) {
          out.push({ cmd: frame[1], addr: (frame[2] << 8) | frame[3], data: Uint8Array.from(frame.slice(5, 5 + len)), ack: frame[5 + len] });
          this.buf.splice(0, s + total);
          found = true;
          break;
        }
      }
      if (found) continue;
      if (pending > 0) this.buf.splice(0, pending);
      else if (pending < 0) this.buf = [];
      break;
    }
    return out;
  }

  reset(): void {
    this.buf = [];
  }
}

export interface FourWayRequest {
  cmd: number;
  addr: number;
  param: Uint8Array;
  crcOk: boolean;
}

/** Streaming parser for host -> FC frames (marker 0x2F); for simulators and tests. */
export class FourWayRequestParser {
  private buf: number[] = [];

  push(bytes: Uint8Array): FourWayRequest[] {
    for (const b of bytes) this.buf.push(b);
    const out: FourWayRequest[] = [];
    for (;;) {
      const s = this.buf.indexOf(PC_START);
      if (s < 0) {
        this.buf = [];
        break;
      }
      if (s > 0) this.buf.splice(0, s);
      if (this.buf.length < 5) break;
      const len = this.buf[4] === 0 ? 256 : this.buf[4];
      const total = 5 + len + 2;
      if (this.buf.length < total) break;
      const frame = this.buf.slice(0, total);
      const crc = crc16Xmodem(frame.slice(0, total - 2));
      out.push({
        cmd: frame[1],
        addr: (frame[2] << 8) | frame[3],
        param: Uint8Array.from(frame.slice(5, 5 + len)),
        crcOk: crc === ((frame[total - 2] << 8) | frame[total - 1]),
      });
      this.buf.splice(0, total);
    }
    return out;
  }
}

/** Minimal I/O the client needs (a RawIo satisfies it). */
export interface FourWayIo {
  write(data: Uint8Array): Promise<void>;
  readSome(timeoutMs: number): Promise<Uint8Array>;
  clear(): void;
}

export class FourWayError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'ack',
    readonly ack?: number,
  ) {
    super(message);
    this.name = 'FourWayError';
  }
}

export interface FourWayClientOptions {
  /** Default per-attempt timeout in ms. */
  timeoutMs?: number;
  /** Attempts per call on timeout / CRC error. */
  attempts?: number;
}

/** Request/response client. One request in flight; retries on timeout and on ack INVALID_CRC. Returns the frame whatever the ack. */
export class FourWayClient {
  private parser = new FourWayParser();
  constructor(
    private io: FourWayIo,
    private opts: FourWayClientOptions = {},
  ) {}

  async call(cmd: number, param: ArrayLike<number> = [0], addr = 0, o: { timeoutMs?: number; attempts?: number } = {}): Promise<FourWayResponse> {
    const frame = encodeRequest(cmd, param, addr); // throws for forbidden commands, before anything is sent
    const timeoutMs = o.timeoutMs ?? this.opts.timeoutMs ?? 400;
    const attempts = o.attempts ?? this.opts.attempts ?? 3;
    let lastAck: number | undefined;
    for (let a = 0; a < attempts; a++) {
      this.io.clear();
      this.parser.reset();
      await this.io.write(frame);
      const end = Date.now() + timeoutMs;
      let crcFail = false;
      while (Date.now() < end && !crcFail) {
        const chunk = await this.io.readSome(Math.max(10, end - Date.now()));
        for (const f of this.parser.push(chunk)) {
          if (f.cmd !== cmd) continue; // stale frame from an earlier call
          if (f.ack === ACK.INVALID_CRC) {
            lastAck = f.ack;
            crcFail = true;
            break;
          }
          return f;
        }
      }
    }
    if (lastAck !== undefined) throw new FourWayError(`4-way ack 0x${lastAck.toString(16)} for cmd 0x${cmd.toString(16)}`, 'ack', lastAck);
    throw new FourWayError(`4-way timeout for cmd 0x${cmd.toString(16)}`, 'timeout');
  }
}

/** Result of DEVICE_INIT_FLASH: b0,b1 = MCU signature (low, high), b2 = bootloader byte, b3 = interface mode. */
export interface InitInfo {
  signature: number;
  bootByte: number;
  mode: number;
}

export function decodeInitFlash(d: Uint8Array): InitInfo | null {
  if (d.length < 4) return null;
  return { signature: d[0] | (d[1] << 8), bootByte: d[2], mode: d[3] };
}

/** Interface modes from DEVICE_INIT_FLASH b3. */
export const MODE = { SIL_C2: 0, SIL_BLB: 1, ATM_BLB: 2, ATM_SK: 3, ARM_BLB: 4 } as const;
