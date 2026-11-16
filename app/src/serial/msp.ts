import type { SerialTransport } from './port';
import { t } from '../i18n';

/** MSP v1 command numbers used by the core app (the full Betaflight catalogue lives in bf/codes.ts). */
export const MSP = {
  API_VERSION: 1,
  FC_VARIANT: 2,
  FC_VERSION: 3,
  BOARD_INFO: 4,
  NAME: 10,
  RX_CONFIG: 44,
  ADVANCED_CONFIG: 90,
  STATUS: 101,
  RAW_IMU: 102,
  MOTOR: 104,
  ANALOG: 110,
  PID: 112,
  MOTOR_CONFIG: 131,
  SET_MOTOR: 214,
} as const;

export interface MspFrame {
  cmd: number;
  payload: Uint8Array;
  /** Error frame ($M! / $X!): the FC does not implement the command or refused it. */
  error: boolean;
  /** True for MSP v2 frames ($X). */
  v2: boolean;
}

/** Error thrown by MspClient. `rejected` = the FC answered with an error frame, `timeout` = no answer. */
export class MspError extends Error {
  constructor(
    message: string,
    readonly kind: 'rejected' | 'timeout' | 'closed',
    readonly cmd: number,
  ) {
    super(message);
  }
}

/** Codes above 254 do not fit a v1 frame and must be sent as MSP v2. */
export const needsV2 = (cmd: number): boolean => cmd > 254;

/** Builds a v1 request `$M<` [size][cmd][payload][xor]. */
export function encodeMspV1(cmd: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (payload.length > 254) throw new Error(t('serial.mspTooBig'));
  const out = new Uint8Array(6 + payload.length);
  out[0] = 0x24; // $
  out[1] = 0x4d; // M
  out[2] = 0x3c; // <
  out[3] = payload.length;
  out[4] = cmd;
  out.set(payload, 5);
  let crc = payload.length ^ cmd;
  for (const b of payload) crc ^= b;
  out[5 + payload.length] = crc;
  return out;
}

/** CRC-8 DVB-S2 (poly 0xD5, init 0) used by MSP v2. */
export function crc8DvbS2(bytes: ArrayLike<number>, crc = 0): number {
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] & 0xff;
    for (let k = 0; k < 8; k++) crc = crc & 0x80 ? ((crc << 1) ^ 0xd5) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** Builds a v2 request `$X<` [flag=0][code u16][len u16][payload][crc8]. */
export function encodeMspV2(cmd: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(9 + payload.length);
  out[0] = 0x24;
  out[1] = 0x58; // X
  out[2] = 0x3c;
  out[3] = 0; // flag
  out[4] = cmd & 0xff;
  out[5] = (cmd >> 8) & 0xff;
  out[6] = payload.length & 0xff;
  out[7] = (payload.length >> 8) & 0xff;
  out.set(payload, 8);
  out[8 + payload.length] = crc8DvbS2(out.subarray(3, 8 + payload.length));
  return out;
}

/** Request frame in the right version for the code (v1 up to 254, v2 above). */
export const encodeMsp = (cmd: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array => (needsV2(cmd) ? encodeMspV2(cmd, payload) : encodeMspV1(cmd, payload));

/** Builds a v1 response `$M>` (used by the demo and tests). */
export function encodeMspResponse(cmd: number, payload: Uint8Array): Uint8Array {
  const f = encodeMspV1(cmd, payload);
  f[2] = 0x3e;
  return f;
}

/** Builds a v2 response `$X>` (or error `$X!`); used by tests. */
export function encodeMspV2Response(cmd: number, payload: Uint8Array, error = false): Uint8Array {
  const f = encodeMspV2(cmd, payload);
  f[2] = error ? 0x21 : 0x3e;
  return f;
}

/** Builds a v1 jumbo response (size byte 255, then cmd and a u16 length); used by tests. */
export function encodeMspJumboResponse(cmd: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  out.set([0x24, 0x4d, 0x3e, 0xff, cmd, payload.length & 0xff, (payload.length >> 8) & 0xff], 0);
  out.set(payload, 7);
  let crc = 0xff ^ cmd ^ (payload.length & 0xff) ^ ((payload.length >> 8) & 0xff);
  for (const b of payload) crc ^= b;
  out[7 + payload.length] = crc;
  return out;
}

type ParserState = 'idle' | 'm' | 'dir' | 'hdr' | 'payload' | 'crc';

/** Streaming parser for MSP responses: v1 (`$M>` / `$M!`, incl. jumbo frames) and v2 (`$X>` / `$X!`). */
export class MspParser {
  private s: ParserState = 'idle';
  private v2 = false;
  private error = false;
  private hdr: number[] = [];
  private hdrNeed = 2;
  private size = 0;
  private cmd = 0;
  private buf = new Uint8Array(256);
  private pos = 0;
  private crc = 0;

  push(bytes: Uint8Array): MspFrame[] {
    const frames: MspFrame[] = [];
    for (const b of bytes) {
      switch (this.s) {
        case 'idle':
          if (b === 0x24) this.s = 'm';
          break;
        case 'm':
          if (b === 0x4d || b === 0x58) {
            this.v2 = b === 0x58;
            this.s = 'dir';
          } else this.s = 'idle';
          break;
        case 'dir':
          if (b === 0x3e || b === 0x21) {
            this.error = b === 0x21;
            this.hdr = [];
            this.hdrNeed = this.v2 ? 5 : 2;
            this.s = 'hdr';
          } else this.s = b === 0x24 ? 'm' : 'idle';
          break;
        case 'hdr':
          this.hdr.push(b);
          // v1 jumbo: size 255 is followed (after cmd) by a u16 length
          if (!this.v2 && this.hdr.length === 2 && this.hdr[0] === 0xff) this.hdrNeed = 4;
          if (this.hdr.length >= this.hdrNeed) this.endHeader();
          break;
        case 'payload':
          this.buf[this.pos++] = b;
          if (!this.v2) this.crc ^= b;
          if (this.pos >= this.size) this.s = 'crc';
          break;
        case 'crc': {
          const expect = this.v2 ? crc8DvbS2(this.buf.subarray(0, this.size), crc8DvbS2(this.hdr)) : this.crc;
          if (b === expect) frames.push({ cmd: this.cmd, payload: this.buf.slice(0, this.size), error: this.error, v2: this.v2 });
          this.s = 'idle';
          break;
        }
      }
    }
    return frames;
  }

  private endHeader(): void {
    const h = this.hdr;
    if (this.v2) {
      this.cmd = h[1] | (h[2] << 8);
      this.size = h[3] | (h[4] << 8);
    } else if (h[0] === 0xff) {
      this.cmd = h[1];
      this.size = h[2] | (h[3] << 8);
      this.crc = h[0] ^ h[1] ^ h[2] ^ h[3];
    } else {
      this.size = h[0];
      this.cmd = h[1];
      this.crc = h[0] ^ h[1];
    }
    if (this.size > this.buf.length) this.buf = new Uint8Array(this.size);
    this.pos = 0;
    this.s = this.size === 0 ? 'crc' : 'payload';
  }

  reset(): void {
    this.s = 'idle';
  }
}

interface Pending {
  cmd: number;
  payload: Uint8Array;
  timeoutMs: number;
  attempts: number;
  tried: number;
  resolve: (p: Uint8Array) => void;
  reject: (e: Error) => void;
}

/**
 * MSP client: request queue (one in flight), default timeout 1 s, optional retries (`attempts`),
 * can be suspended for a CLI session. Codes above 254 are sent as MSP v2 automatically.
 */
export class MspClient {
  private parser = new MspParser();
  private queue: Pending[] = [];
  private current: Pending | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private suspended = false;
  private off: () => void;

  constructor(private transport: SerialTransport) {
    this.off = transport.onData((d) => this.onData(d));
  }

  request(cmd: number, payload: Uint8Array = new Uint8Array(0), timeoutMs = 1000, attempts = 1): Promise<Uint8Array> {
    if (this.suspended) return Promise.reject(new MspError(t('serial.mspSuspended'), 'closed', cmd));
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, payload, timeoutMs, attempts: Math.max(1, attempts), tried: 0, resolve, reject });
      this.pump();
    });
  }

  /** Pauses MSP (drops the queue) for the duration of a CLI session. */
  suspend(): void {
    this.suspended = true;
    this.failAll(new MspError(t('serial.mspPaused'), 'closed', 0));
    this.parser.reset();
  }

  resume(): void {
    this.suspended = false;
    this.parser.reset();
  }

  dispose(): void {
    this.off();
    this.failAll(new MspError(t('serial.closed'), 'closed', 0));
  }

  private failAll(err: Error): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const cur = this.current;
    this.current = null;
    cur?.reject(err);
    for (const q of this.queue.splice(0)) q.reject(err);
  }

  private pump(): void {
    if (this.current || this.suspended) return;
    const next = this.queue.shift();
    if (!next) return;
    this.current = next;
    this.send(next);
  }

  private send(next: Pending): void {
    next.tried++;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.current !== next) return;
      if (next.tried < next.attempts) {
        this.send(next); // retry the same request
        return;
      }
      this.current = null;
      next.reject(new MspError(t('serial.mspTimeout', { cmd: next.cmd }), 'timeout', next.cmd));
      this.pump();
    }, next.timeoutMs);
    this.transport.write(encodeMsp(next.cmd, next.payload)).catch((e: unknown) => {
      if (this.current === next) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.current = null;
        next.reject(e instanceof Error ? e : new Error(String(e)));
        this.pump();
      }
    });
  }

  private onData(d: Uint8Array): void {
    if (this.suspended) return;
    for (const f of this.parser.push(d)) {
      const cur = this.current;
      if (!cur || f.cmd !== cur.cmd) continue; // late or foreign reply
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.current = null;
      if (f.error) cur.reject(new MspError(t('serial.mspRejected', { cmd: cur.cmd }), 'rejected', cur.cmd));
      else cur.resolve(f.payload);
      this.pump();
    }
  }
}

/* ---- decoding helpers ---- */
export const u16 = (dv: DataView, o: number) => dv.getUint16(o, true);
export const s16 = (dv: DataView, o: number) => dv.getInt16(o, true);
export const u32 = (dv: DataView, o: number) => dv.getUint32(o, true);
export const view = (p: Uint8Array) => new DataView(p.buffer, p.byteOffset, p.byteLength);
export const ascii = (p: Uint8Array, from = 0, to = p.length) =>
  String.fromCharCode(...p.subarray(from, to)).replace(/\0+$/, '');
