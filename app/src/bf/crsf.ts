/**
 * CRSF framing, only what is needed to ask an ExpressLRS receiver who it is (spec section 7).
 * Frame: [sync][len][type][dest][orig][payload...][crc8]; len counts type..crc; CRC-8 poly 0xD5 over type..payload.
 */
import { crc8D5 } from './crc';

export const CRSF = {
  SYNC_FC: 0xc8,
  ADDR_RX: 0xec,
  TYPE_LINK_STATS: 0x14,
  TYPE_RC_CHANNELS: 0x16,
  TYPE_DEVICE_PING: 0x28,
  TYPE_DEVICE_INFO: 0x29,
  MIN_LEN: 2,
  MAX_LEN: 62,
} as const;

const SYNCS: ReadonlySet<number> = new Set([0xc8, 0xea, 0xec, 0xee]);

export function buildFrame(sync: number, type: number, body: ArrayLike<number>): Uint8Array {
  const b = Array.from(body as ArrayLike<number>);
  const out = new Uint8Array(3 + b.length + 1);
  out[0] = sync;
  out[1] = b.length + 2; // type + body + crc
  out[2] = type;
  for (let i = 0; i < b.length; i++) out[3 + i] = b[i];
  out[out.length - 1] = crc8D5(out.subarray(2, out.length - 1));
  return out;
}

/** DEVICE_PING addressed to the receiver (dest 0xEC), originator = flight controller (0xC8). Expected: C8 04 28 EC C8 5A. */
export function buildPing(): Uint8Array {
  return buildFrame(CRSF.SYNC_FC, CRSF.TYPE_DEVICE_PING, [CRSF.ADDR_RX, CRSF.SYNC_FC]);
}

export interface CrsfFrame {
  sync: number;
  type: number;
  /** Everything between type and crc (dest, orig, payload). */
  body: Uint8Array;
}

/** Streaming parser: resyncs on a plausible sync byte + length, verifies the CRC, drops garbage. */
export class CrsfParser {
  private buf: number[] = [];

  push(bytes: Uint8Array): CrsfFrame[] {
    for (const b of bytes) this.buf.push(b);
    const out: CrsfFrame[] = [];
    for (;;) {
      // Try every plausible start; wait for more bytes only when no later candidate is a valid frame.
      let pending = -1;
      let found = false;
      for (let s = 0; s < this.buf.length; s++) {
        if (!SYNCS.has(this.buf[s])) continue;
        if (this.buf.length - s < 2) {
          if (pending < 0) pending = s;
          continue;
        }
        const len = this.buf[s + 1];
        if (len < CRSF.MIN_LEN || len > CRSF.MAX_LEN) continue;
        if (this.buf.length - s < len + 2) {
          if (pending < 0) pending = s;
          continue;
        }
        const frame = this.buf.slice(s, s + len + 2);
        if (crc8D5(frame.slice(2, len + 1)) === frame[len + 1]) {
          out.push({ sync: frame[0], type: frame[2], body: Uint8Array.from(frame.slice(3, len + 1)) });
          this.buf.splice(0, s + len + 2);
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
}

export interface CrsfDeviceInfo {
  name: string;
  /** u32 serial number; ELRS sets it to ASCII "ELRS". */
  serial: number;
  serialText: string;
  hardwareVersion: number;
  softwareVersion: number;
  /** "3.4.3" parsed from 0x00MMmmpp. */
  version: string;
  fieldCount: number;
  paramVersion: number;
  isElrs: boolean;
}

const be32 = (d: Uint8Array, o: number): number => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

/**
 * Parses a DEVICE_INFO body: dest, orig, NAME\0, serial(u32 BE), hardware(u32 BE), software(u32 BE), fieldCount, paramVersion.
 * Addresses are not validated (ELRS 3.x and 4.x swap them); sync, type and CRC are checked by the parser.
 */
export function parseDeviceInfo(body: Uint8Array): CrsfDeviceInfo | null {
  if (body.length < 3) return null;
  let o = 2; // skip dest, orig
  let name = '';
  while (o < body.length && body[o] !== 0) name += String.fromCharCode(body[o++]);
  if (o >= body.length) return null; // no NUL terminator
  o++;
  if (body.length < o + 14) return null;
  const serial = be32(body, o);
  const hw = be32(body, o + 4);
  const sw = be32(body, o + 8);
  const serialText = String.fromCharCode(...body.subarray(o, o + 4)).replace(/[^\x20-\x7e]/g, '');
  return {
    name,
    serial,
    serialText,
    hardwareVersion: hw,
    softwareVersion: sw,
    version: `${(sw >> 16) & 0xff}.${(sw >> 8) & 0xff}.${sw & 0xff}`,
    fieldCount: body[o + 12],
    paramVersion: body[o + 13],
    isElrs: serial === 0x454c5253,
  };
}

/** Builds a DEVICE_INFO frame (for the demo / tests). ELRS 3.x style: dest 0xEC, orig 0xC8. */
export function buildDeviceInfo(name: string, version: [number, number, number], fieldCount = 20, dest = 0xec, orig = 0xc8): Uint8Array {
  const body: number[] = [dest, orig, ...[...name].map((c) => c.charCodeAt(0)), 0, 0x45, 0x4c, 0x52, 0x53, 0, 0, 0, 0, 0, version[0], version[1], version[2], fieldCount, 0];
  return buildFrame(CRSF.SYNC_FC, CRSF.TYPE_DEVICE_INFO, body);
}

/** LINK_STATISTICS frame with plausible numbers (demo). */
export function buildLinkStats(): Uint8Array {
  return buildFrame(CRSF.SYNC_FC, CRSF.TYPE_LINK_STATS, [60, 62, 100, 12, 0, 4, 3, 100, 12, 60, 11]);
}
