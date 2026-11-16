/**
 * Minimal MSP v2 codec and raw-session helpers (independent of serial/msp.ts, which is v1 only).
 * Used inside raw sessions where the normal MSP client is suspended: SET_PASSTHROUGH, serial config.
 */
import { MspParser, encodeMspV1 } from '../serial/msp';
import { crc8D5 } from './crc';

export const MSP2_COMMON_SERIAL_CONFIG = 0x1009;
export const MSP_SET_PASSTHROUGH = 245;

/** `$X<` flag(0) code(u16) len(u16) payload crc8. */
export function encodeMspV2(code: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const body = new Uint8Array(5 + payload.length);
  body[0] = 0;
  body[1] = code & 0xff;
  body[2] = (code >> 8) & 0xff;
  body[3] = payload.length & 0xff;
  body[4] = (payload.length >> 8) & 0xff;
  body.set(payload, 5);
  const out = new Uint8Array(3 + body.length + 1);
  out.set([0x24, 0x58, 0x3c], 0);
  out.set(body, 3);
  out[out.length - 1] = crc8D5(body);
  return out;
}

export function encodeMspV2Response(code: number, payload: Uint8Array): Uint8Array {
  const f = encodeMspV2(code, payload);
  f[2] = 0x3e;
  return f;
}

export interface Msp2Frame {
  code: number;
  payload: Uint8Array;
  error: boolean;
}

/** Streaming parser for `$X>` / `$X!` frames (responses), or `$X<` frames when `requests` is true (simulators, tests). */
export class Msp2Parser {
  private buf: number[] = [];
  constructor(private requests = false) {}

  push(bytes: Uint8Array): Msp2Frame[] {
    for (const b of bytes) this.buf.push(b);
    const out: Msp2Frame[] = [];
    for (;;) {
      const s = this.buf.indexOf(0x24);
      if (s < 0) {
        this.buf = [];
        break;
      }
      if (s > 0) this.buf.splice(0, s);
      if (this.buf.length < 3) break;
      if (this.buf[1] !== 0x58 || (this.requests ? this.buf[2] !== 0x3c : this.buf[2] !== 0x3e && this.buf[2] !== 0x21)) {
        this.buf.shift();
        continue;
      }
      if (this.buf.length < 8) break;
      const len = this.buf[6] | (this.buf[7] << 8);
      const total = 8 + len + 1;
      if (this.buf.length < total) break;
      const crc = crc8D5(this.buf.slice(3, total - 1));
      if (crc === this.buf[total - 1]) {
        out.push({ code: this.buf[4] | (this.buf[5] << 8), payload: Uint8Array.from(this.buf.slice(8, 8 + len)), error: this.buf[2] === 0x21 });
        this.buf.splice(0, total);
      } else {
        this.buf.shift();
      }
    }
    return out;
  }
}

/** I/O used for MSP exchanges inside a raw session. */
export interface MspRawIo {
  write(data: Uint8Array): Promise<void>;
  readSome(timeoutMs: number): Promise<Uint8Array>;
  clear(): void;
}

/** One MSP v1 request/response over a raw session; throws on timeout or an error frame. */
export async function rawMspV1(io: MspRawIo, cmd: number, payload: Uint8Array = new Uint8Array(0), timeoutMs = 1000): Promise<Uint8Array> {
  io.clear();
  const parser = new MspParser();
  await io.write(encodeMspV1(cmd, payload));
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const f of parser.push(await io.readSome(Math.max(10, end - Date.now())))) {
      if (f.cmd !== cmd) continue;
      if (f.error) throw new Error(`MSP ${cmd} rejected`);
      return f.payload;
    }
  }
  throw new Error(`MSP ${cmd} timeout`);
}

/** One MSP v2 request/response over a raw session. */
export async function rawMspV2(io: MspRawIo, code: number, payload: Uint8Array = new Uint8Array(0), timeoutMs = 1000): Promise<Uint8Array> {
  io.clear();
  const parser = new Msp2Parser();
  await io.write(encodeMspV2(code, payload));
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const f of parser.push(await io.readSome(Math.max(10, end - Date.now())))) {
      if (f.code !== code) continue;
      if (f.error) throw new Error(`MSP2 0x${code.toString(16)} rejected`);
      return f.payload;
    }
  }
  throw new Error(`MSP2 0x${code.toString(16)} timeout`);
}

export interface SerialPortConfig {
  id: number;
  functionMask: number;
}

export const FUNCTION_RX_SERIAL = 1 << 6;

/** MSP2_COMMON_SERIAL_CONFIG: u8 count, then records of (remaining/count) bytes: u8 id, u32 function mask, 4x baud index. */
export function decodeSerialConfig(p: Uint8Array): SerialPortConfig[] {
  if (p.length < 1) return [];
  const count = p[0];
  if (count === 0) return [];
  const per = Math.floor((p.length - 1) / count);
  if (per < 5) return [];
  const out: SerialPortConfig[] = [];
  for (let i = 0; i < count; i++) {
    const o = 1 + i * per;
    out.push({ id: p[o], functionMask: (p[o + 1] | (p[o + 2] << 8) | (p[o + 3] << 16) | (p[o + 4] << 24)) >>> 0 });
  }
  return out;
}

export function encodeSerialConfig(ports: SerialPortConfig[]): Uint8Array {
  const out = new Uint8Array(1 + ports.length * 10);
  out[0] = ports.length;
  ports.forEach((p, i) => {
    const o = 1 + i * 10;
    out[o] = p.id;
    out[o + 1] = p.functionMask & 0xff;
    out[o + 2] = (p.functionMask >> 8) & 0xff;
    out[o + 3] = (p.functionMask >> 16) & 0xff;
    out[o + 4] = (p.functionMask >>> 24) & 0xff;
    out.set([5, 0, 0, 0], o + 5);
  });
  return out;
}
