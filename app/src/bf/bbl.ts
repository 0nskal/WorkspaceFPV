/**
 * Native decoder for Betaflight Blackbox logs (.bbl / .bfl, "Data version 2").
 * Written from the public format description (Blackbox Internals): ASCII "H name:value" header lines, then binary
 * frames I (intra), P (inter), S (slow), G/H (GPS) and E (event). The field layout is declared in the header, so
 * the decoder is table-driven: encodings + predictors per field. Only gyroADC, setpoint (or rcCommand) and motor
 * columns are kept; the other frames are decoded just to stay in sync.
 * Pure TypeScript (no DOM), runs in a Web Worker and in Node.
 */
import type { LogData } from '../analysis/types';
import { LogError } from '../analysis/parse';

export const BBL_MAGIC = 'H Product:Blackbox flight data recorder by Nicholas Sherlock';

/** Field encodings (blackbox_fielddefs.h). */
const ENC = { SIGNED_VB: 0, UNSIGNED_VB: 1, NEG_14BIT: 3, TAG8_8SVB: 6, TAG2_3S32: 7, TAG8_4S16: 8, NULL: 9 } as const;
/** Field predictors. */
const PRED = { ZERO: 0, PREVIOUS: 1, STRAIGHT_LINE: 2, AVERAGE_2: 3, MINTHROTTLE: 4, MOTOR_0: 5, INC: 6, ONE_500: 8, VBATREF: 9, MINMOTOR: 11 } as const;

export interface FieldDef {
  names: string[];
  predictor: number[];
  encoding: number[];
}
export interface BblHeader {
  /** Every "H key:value" line. */
  info: Record<string, string>;
  main: { I: FieldDef; P: { predictor: number[]; encoding: number[] } };
  slow: FieldDef | null;
  gps: FieldDef | null;
  gpsHome: FieldDef | null;
  /** Offset of the first frame byte. */
  dataStart: number;
}
export interface BblSummary {
  logs: number;
  firmware: string;
  firmwareDate: string;
  craft: string;
  looptimeUs: number;
  dataVersion: number;
  /** Duration of the longest log in seconds (0 when nothing decodable). */
  duration: number;
  frames: number;
}

const isMarker = (b: number) => b === 0x49 || b === 0x50 || b === 0x45 || b === 0x53 || b === 0x47 || b === 0x48;

/** Offsets of every log start (the "H Product:Blackbox ..." line; a log follows the previous log's end event directly). */
export function splitLogs(buf: Uint8Array): number[] {
  const m = BBL_MAGIC;
  const out: number[] = [];
  const first = m.charCodeAt(0);
  for (let i = 0; i + m.length < buf.length; i++) {
    if (buf[i] !== first) continue;
    let ok = true;
    for (let k = 1; k < m.length; k++) if (buf[i + k] !== m.charCodeAt(k)) { ok = false; break; }
    if (ok) {
      out.push(i);
      i += m.length;
    }
  }
  return out;
}

const splitList = (s: string) => s.split(',').map((x) => x.trim());

export function parseHeader(buf: Uint8Array, start: number, end: number): BblHeader {
  const info: Record<string, string> = {};
  const defs: Record<string, { names?: string[]; predictor?: number[]; encoding?: number[] }> = {};
  let pos = start;
  while (pos < end && buf[pos] === 0x48 && buf[pos + 1] === 0x20) {
    let nl = pos;
    while (nl < end && buf[nl] !== 0x0a && nl - pos < 4096) nl++;
    if (buf[nl] !== 0x0a) break;
    let line = '';
    for (let i = pos + 2; i < nl; i++) line += String.fromCharCode(buf[i]!);
    const colon = line.indexOf(':');
    if (colon < 0) break; // a GPS-home frame that happens to start with "H "
    const key = line.slice(0, colon);
    const val = line.slice(colon + 1).replace(/\r$/, '');
    info[key] = val;
    const fm = /^Field ([IPSGH]) (name|signed|predictor|encoding)$/.exec(key);
    if (fm) {
      const d = (defs[fm[1]!] ??= {});
      if (fm[2] === 'name') d.names = splitList(val);
      else if (fm[2] === 'predictor') d.predictor = splitList(val).map(Number);
      else if (fm[2] === 'encoding') d.encoding = splitList(val).map(Number);
    }
    pos = nl + 1;
  }
  const full = (k: string): FieldDef | null => {
    const d = defs[k];
    return d?.names && d.predictor && d.encoding ? { names: d.names, predictor: d.predictor, encoding: d.encoding } : null;
  };
  const I = full('I');
  const pd = defs['P'];
  if (!I || !pd?.predictor || !pd.encoding) throw new LogError('columns', 'bfBlackbox.err.noFields');
  return { info, main: { I, P: { predictor: pd.predictor, encoding: pd.encoding } }, slow: full('S'), gps: full('G'), gpsHome: full('H'), dataStart: pos };
}

/** Byte reader over the binary part of a log. Throws RangeError past the end (caught as "truncated frame"). */
export class Reader {
  pos: number;
  constructor(readonly buf: Uint8Array, start: number, readonly end: number) {
    this.pos = start;
  }
  u8(): number {
    if (this.pos >= this.end) throw new RangeError('eof');
    return this.buf[this.pos++]!;
  }
  /** Unsigned variable byte (7 bits per byte, LSB first). Multiplication instead of shifts keeps 32-bit values positive. */
  uvb(): number {
    let v = 0;
    let mul = 1;
    for (let i = 0; i < 5; i++) {
      const b = this.u8();
      v += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return v;
      mul *= 128;
    }
    return v;
  }
  skip(n: number): void {
    if (this.pos + n > this.end) throw new RangeError('eof');
    this.pos += n;
  }
  /** Signed VB: zigzag over the unsigned value. */
  svb(): number {
    const u = this.uvb();
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  }
}

const sx = (v: number, bits: number) => (v & (1 << (bits - 1)) ? v - (1 << bits) : v);

function tag2_3s32(r: Reader, out: number[], at: number): void {
  const lead = r.u8();
  switch (lead >> 6) {
    case 0:
      out[at] = sx((lead >> 4) & 3, 2);
      out[at + 1] = sx((lead >> 2) & 3, 2);
      out[at + 2] = sx(lead & 3, 2);
      break;
    case 1: {
      out[at] = sx(lead & 0x0f, 4);
      const b = r.u8();
      out[at + 1] = sx(b >> 4, 4);
      out[at + 2] = sx(b & 0x0f, 4);
      break;
    }
    case 2:
      out[at] = sx(lead & 0x3f, 6);
      out[at + 1] = sx(r.u8() & 0x3f, 6);
      out[at + 2] = sx(r.u8() & 0x3f, 6);
      break;
    default: {
      let sel = lead;
      for (let i = 0; i < 3; i++, sel >>= 2) {
        switch (sel & 3) {
          case 0:
            out[at + i] = sx(r.u8(), 8);
            break;
          case 1: {
            const a = r.u8();
            out[at + i] = sx(a | (r.u8() << 8), 16);
            break;
          }
          case 2: {
            const a = r.u8();
            const b = r.u8();
            out[at + i] = sx(a | (b << 8) | (r.u8() << 16), 24);
            break;
          }
          default: {
            const a = r.u8();
            const b = r.u8();
            const c = r.u8();
            out[at + i] = a | (b << 8) | (c << 16) | (r.u8() << 24);
          }
        }
      }
    }
  }
}

/** Data version 2: selector per field (0 zero, 1 nibble, 2 byte, 3 big-endian 16 bit), nibbles are packed. */
function tag8_4s16(r: Reader, out: number[], at: number): void {
  const sel = r.u8();
  let buffer = 0;
  let nib = 0;
  for (let i = 0; i < 4; i++) {
    switch ((sel >> (i * 2)) & 3) {
      case 0:
        out[at + i] = 0;
        break;
      case 1:
        if (nib === 0) {
          buffer = r.u8();
          out[at + i] = sx(buffer >> 4, 4);
          nib = 1;
        } else {
          out[at + i] = sx(buffer & 0x0f, 4);
          nib = 0;
        }
        break;
      case 2:
        if (nib === 0) out[at + i] = sx(r.u8(), 8);
        else {
          let c1 = (buffer & 0x0f) << 4;
          buffer = r.u8();
          c1 |= buffer >> 4;
          out[at + i] = sx(c1, 8);
        }
        break;
      default:
        if (nib === 0) {
          const c1 = r.u8();
          out[at + i] = sx((c1 << 8) | r.u8(), 16);
        } else {
          const c1 = r.u8();
          const c2 = r.u8();
          out[at + i] = sx(((buffer & 0x0f) << 12) | (c1 << 4) | (c2 >> 4), 16);
          buffer = c2;
        }
    }
  }
}

function tag8_8svb(r: Reader, out: number[], at: number, count: number): void {
  if (count === 1) {
    out[at] = r.svb();
    return;
  }
  // like the reference decoder, every set bit of the tag consumes a value (an encoder only sets bits of the group)
  let tag = r.u8();
  for (let i = 0; i < 8; i++, tag >>= 1) {
    const v = tag & 1 ? r.svb() : 0;
    if (i < count) out[at + i] = v;
  }
}

/** Reads the raw (pre-predictor) values of a frame according to its encodings. */
export function readFrame(r: Reader, encoding: number[], out: number[]): void {
  const n = encoding.length;
  for (let i = 0; i < n; i++) {
    switch (encoding[i]) {
      case ENC.SIGNED_VB:
        out[i] = r.svb();
        break;
      case ENC.UNSIGNED_VB:
        out[i] = r.uvb();
        break;
      case ENC.NEG_14BIT:
        out[i] = -sx(r.uvb() & 0x3fff, 14);
        break;
      case ENC.NULL:
        out[i] = 0;
        break;
      case ENC.TAG8_8SVB: {
        let j = i + 1;
        while (j < i + 8 && j < n && encoding[j] === ENC.TAG8_8SVB) j++;
        tag8_8svb(r, out, i, j - i);
        i = j - 1;
        break;
      }
      case ENC.TAG2_3S32:
        tag2_3s32(r, out, i);
        i += 2;
        break;
      case ENC.TAG8_4S16:
        tag8_4s16(r, out, i);
        i += 3;
        break;
      default:
        throw new LogError('columns', 'bfBlackbox.err.encoding', { enc: encoding[i] ?? -1 });
    }
  }
}

class Grow {
  buf: Float32Array;
  n = 0;
  constructor(cap = 1 << 15) {
    this.buf = new Float32Array(cap);
  }
  push(v: number): void {
    if (this.n === this.buf.length) {
      const nb = new Float32Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.n++] = v;
  }
}
class GrowD {
  buf = new Float64Array(1 << 15);
  n = 0;
  push(v: number): void {
    if (this.n === this.buf.length) {
      const nb = new Float64Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.n++] = v;
  }
}

export interface DecodedLog {
  rows: number;
  time: Float64Array;
  gyro: Float32Array[];
  setpoint: Float32Array[];
  motor: Float32Array[];
  rcFallback: boolean;
  /** Frames dropped while resynchronising after corrupt data. */
  corrupt: number;
}

function find(names: string[], n: string): number {
  return names.indexOf(n);
}

/** Decodes one log (header at `start`, binary data until `end`). */
export function decodeLog(buf: Uint8Array, start: number, end: number, onProgress?: (f: number) => void): DecodedLog {
  const h = parseHeader(buf, start, end);
  if (Number(h.info['Data version'] ?? 2) !== 2) throw new LogError('columns', 'bfBlackbox.err.version', { v: h.info['Data version'] ?? '?' });
  const names = h.main.I.names;
  const n = names.length;
  const iTime = find(names, 'time');
  if (iTime < 0) throw new LogError('columns', 'at.err.noTimeCol');
  const gi = [0, 1, 2].map((a) => find(names, `gyroADC[${a}]`));
  let si = [0, 1, 2].map((a) => find(names, `setpoint[${a}]`));
  let rcFallback = false;
  if (si.some((x) => x < 0)) {
    si = [0, 1, 2].map((a) => find(names, `rcCommand[${a}]`));
    rcFallback = true;
  }
  const missing: string[] = [];
  gi.forEach((x, a) => x < 0 && missing.push(`gyroADC[${a}]`));
  si.forEach((x, a) => x < 0 && missing.push(`setpoint[${a}]`));
  if (missing.length) throw new LogError('columns', 'at.err.missingCols', { cols: missing.join(', ') });
  const mi: number[] = [];
  for (let m = 0; m < 8; m++) {
    const k = find(names, `motor[${m}]`);
    if (k < 0) break;
    mi.push(k);
  }
  const motor0 = mi[0] ?? -1;
  const minThrottle = Number(h.info['minthrottle'] ?? 1000);
  const vbatRef = Number(h.info['vbatref'] ?? 0);
  const minMotor = Number((h.info['motorOutput'] ?? '0').split(',')[0]);

  const time = new GrowD();
  const gy = [new Grow(), new Grow(), new Grow()];
  const sp = [new Grow(), new Grow(), new Grow()];
  const mo = mi.map(() => new Grow());

  let prev: number[] | null = null;
  let prev2: number[] | null = null;
  let valid = false;
  let corrupt = 0;
  const raw = new Array<number>(n).fill(0);
  const iEnc = h.main.I.encoding;
  const iPred = h.main.I.predictor;
  const pEnc = h.main.P.encoding;
  const pPred = h.main.P.predictor;
  const r = new Reader(buf, h.dataStart, end);
  const total = Math.max(1, end - h.dataStart);
  let lastProg = 0;

  const emit = (f: number[]) => {
    time.push(f[iTime]!);
    for (let a = 0; a < 3; a++) {
      gy[a]!.push(f[gi[a]!]!);
      sp[a]!.push(f[si[a]!]!);
    }
    for (let m = 0; m < mi.length; m++) mo[m]!.push(f[mi[m]!]!);
  };

  const skipDef = (d: FieldDef | null): void => {
    if (!d) throw new RangeError('no def');
    readFrame(r, d.encoding, new Array<number>(d.encoding.length).fill(0));
  };

  while (r.pos < end) {
    const frameStart = r.pos;
    const marker = buf[r.pos]!;
    if (!isMarker(marker)) {
      r.pos++;
      valid = false;
      continue;
    }
    r.pos++;
    try {
      if (marker === 0x49) {
        readFrame(r, iEnc, raw);
        const f = new Array<number>(n);
        for (let i = 0; i < n; i++) {
          let v = raw[i]!;
          switch (iPred[i]) {
            case PRED.MINTHROTTLE: v += minThrottle; break;
            case PRED.MOTOR_0: if (motor0 >= 0) v += f[motor0]!; break;
            case PRED.ONE_500: v += 1500; break;
            case PRED.VBATREF: v += vbatRef; break;
            case PRED.MINMOTOR: v += minMotor; break;
            default: break; // intra frames have no history (PREVIOUS etc. add nothing)
          }
          f[i] = v;
        }
        if (r.pos < end && !isMarker(buf[r.pos]!)) throw new RangeError('bad next marker');
        prev = f;
        prev2 = f;
        valid = true;
        emit(f);
      } else if (marker === 0x50) {
        if (!valid || !prev || !prev2) {
          r.pos = frameStart + 1;
          valid = false;
          continue;
        }
        readFrame(r, pEnc, raw);
        const f = new Array<number>(n);
        for (let i = 0; i < n; i++) {
          let v = raw[i]!;
          switch (pPred[i]) {
            case PRED.PREVIOUS: v += prev[i]!; break;
            case PRED.STRAIGHT_LINE: v += 2 * prev[i]! - prev2[i]!; break;
            case PRED.AVERAGE_2: v += Math.trunc((prev[i]! + prev2[i]!) / 2); break;
            case PRED.INC: v += prev[i]! + 1; break;
            case PRED.MINTHROTTLE: v += minThrottle; break;
            case PRED.MOTOR_0: if (motor0 >= 0) v += f[motor0]!; break;
            case PRED.ONE_500: v += 1500; break;
            case PRED.VBATREF: v += vbatRef; break;
            case PRED.MINMOTOR: v += minMotor; break;
            default: break;
          }
          f[i] = v;
        }
        if (r.pos < end && !isMarker(buf[r.pos]!)) throw new RangeError('bad next marker');
        prev2 = prev;
        prev = f;
        emit(f);
      } else if (marker === 0x53) {
        skipDef(h.slow);
      } else if (marker === 0x47) {
        skipDef(h.gps);
      } else if (marker === 0x48) {
        skipDef(h.gpsHome);
      } else {
        // E: event frame (event ids as in the public format description)
        const ev = r.u8();
        if (ev === 0) r.uvb(); // sync beep
        else if (ev === 10) r.skip(5); // autotune cycle start
        else if (ev === 11) r.skip(4); // autotune cycle result
        else if (ev === 12) r.skip(8); // autotune targets
        else if (ev === 13) {
          const func = r.u8(); // in-flight adjustment
          if (func > 127) r.skip(4);
          else r.svb();
        } else if (ev === 14) {
          r.uvb(); // logging resume: iteration, time
          r.uvb();
        } else if (ev === 15) r.uvb(); // disarm reason
        else if (ev === 20) {
          r.u8(); // gtune cycle result
          r.svb();
          r.skip(2);
        } else if (ev === 30) {
          r.uvb(); // flight mode flags
          r.uvb();
        } else if (ev === 40) r.skip(5); // twitch test
        else if (ev === 255) {
          const msg = 'End of log\0';
          for (let i = 0; i < msg.length; i++) if (r.u8() !== msg.charCodeAt(i)) throw new RangeError('not end of log');
          break;
        } else throw new RangeError('unknown event');
        if (r.pos < end && !isMarker(buf[r.pos]!)) throw new RangeError('bad next marker');
      }
    } catch (e) {
      if (e instanceof LogError) throw e;
      corrupt++;
      valid = false;
      r.pos = frameStart + 1;
    }
    if (onProgress && (r.pos - h.dataStart) / total - lastProg > 0.05) {
      lastProg = (r.pos - h.dataStart) / total;
      onProgress(lastProg);
    }
  }

  // unwrap the 32-bit microsecond counter
  const t = time.buf.subarray(0, time.n);
  let off = 0;
  for (let i = 1; i < t.length; i++) {
    const cur = t[i]! + off;
    if (cur < t[i - 1]! - 2 ** 31) off += 2 ** 32;
    t[i] = t[i]! + off;
  }
  const cut = (g: Grow) => g.buf.subarray(0, g.n);
  return { rows: time.n, time: t, gyro: gy.map(cut), setpoint: sp.map(cut), motor: mo.map(cut), rcFallback, corrupt };
}

/** Header-level summary without decoding frames (fast): firmware, craft, number of logs. */
export function summarizeBbl(buf: Uint8Array, withDuration = true): BblSummary {
  const starts = splitLogs(buf);
  const out: BblSummary = { logs: starts.length, firmware: '', firmwareDate: '', craft: '', looptimeUs: 0, dataVersion: 0, duration: 0, frames: 0 };
  if (!starts.length) return out;
  try {
    const h = parseHeader(buf, starts[0]!, starts.length > 1 ? starts[1]! : buf.length);
    out.firmware = h.info['Firmware revision'] ?? h.info['Firmware type'] ?? '';
    out.firmwareDate = h.info['Firmware date'] ?? '';
    out.craft = (h.info['Craft name'] ?? '').trim();
    out.looptimeUs = Number(h.info['looptime'] ?? 0);
    out.dataVersion = Number(h.info['Data version'] ?? 0);
  } catch {
    /* header unreadable: keep defaults */
  }
  if (withDuration) {
    for (let i = 0; i < starts.length; i++) {
      try {
        const d = decodeLog(buf, starts[i]!, i + 1 < starts.length ? starts[i + 1]! : buf.length);
        if (d.rows > 1) {
          out.frames += d.rows;
          out.duration = Math.max(out.duration, (d.time[d.rows - 1]! - d.time[0]!) / 1e6);
        }
      } catch {
        /* skip unreadable log */
      }
    }
  }
  return out;
}

/** True when the first bytes look like a Blackbox binary log. */
export function looksLikeBbl(head: Uint8Array): boolean {
  let s = '';
  for (let i = 0; i < Math.min(head.length, BBL_MAGIC.length); i++) s += String.fromCharCode(head[i]!);
  return s === BBL_MAGIC;
}

/** Decodes a whole .bbl blob into the analysis input (longest log wins; flash dumps hold one log per arming). */
export async function parseBbl(file: Blob, onProgress: (frac: number) => void): Promise<LogData> {
  const buf = new Uint8Array(await file.arrayBuffer());
  onProgress(0.05);
  const starts = splitLogs(buf);
  if (!starts.length) throw new LogError('binary', 'at.err.noHeader');
  let best: DecodedLog | null = null;
  let lastErr: unknown = null;
  for (let i = 0; i < starts.length; i++) {
    try {
      const d = decodeLog(buf, starts[i]!, i + 1 < starts.length ? starts[i + 1]! : buf.length, (f) => onProgress(0.05 + ((i + f) / starts.length) * 0.9));
      if (d.rows > 1 && (!best || d.rows > best.rows)) best = d;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!best) throw lastErr instanceof LogError ? lastErr : new LogError('short', 'at.err.tooShort', { n: 0 });
  const n = best.rows;
  if (n < 1000) throw new LogError('short', 'at.err.tooShort', { n });
  const dts: number[] = [];
  const step = Math.max(1, Math.floor(n / 20000));
  for (let i = step; i < n; i += step) {
    const d = (best.time[i]! - best.time[i - step]!) / step;
    if (d > 0) dts.push(d);
  }
  dts.sort((a, b) => a - b);
  const dt = dts[dts.length >> 1] ?? 0;
  if (!(dt > 0)) throw new LogError('short', 'at.err.noRate');
  onProgress(1);
  return { fs: 1e6 / dt, rows: n, duration: (best.time[n - 1]! - best.time[0]!) / 1e6, setpoint: best.setpoint, gyro: best.gyro, motor: best.motor, rcFallback: best.rcFallback };
}
