/**
 * Table-driven MSP payload codec shared by the tuning / receiver / modes decoders.
 * A decoder never throws on short or long payloads: fields that do not fit are simply absent,
 * and an encoder patches only the fields that exist in the raw payload it was given
 * (read-modify-write), so legacy / reserved bytes round-trip untouched.
 */
export type FType = 'u8' | 's8' | 'u16' | 's16' | 'u32';

export interface FieldDef {
  key: string;
  off: number;
  type: FType;
  /** Present only when MSP API minor >= minApi. */
  minApi?: number;
  /** Present only when MSP API minor <= maxApi. */
  maxApi?: number;
}

export type Values = Record<string, number>;

export interface Decoded {
  values: Values;
  /** Copy of the payload as read; the base for encode(). */
  raw: Uint8Array;
}

export const SIZE: Record<FType, number> = { u8: 1, s8: 1, u16: 2, s16: 2, u32: 4 };

const dv = (p: Uint8Array) => new DataView(p.buffer, p.byteOffset, p.byteLength);

function applies(d: FieldDef, api: number): boolean {
  return (d.minApi === undefined || api >= d.minApi) && (d.maxApi === undefined || api <= d.maxApi);
}

export function readField(p: Uint8Array, off: number, type: FType): number | undefined {
  if (off + SIZE[type] > p.length) return undefined;
  const v = dv(p);
  switch (type) {
    case 'u8':
      return v.getUint8(off);
    case 's8':
      return v.getInt8(off);
    case 'u16':
      return v.getUint16(off, true);
    case 's16':
      return v.getInt16(off, true);
    case 'u32':
      return v.getUint32(off, true);
  }
}

export function writeField(p: Uint8Array, off: number, type: FType, value: number): boolean {
  if (off + SIZE[type] > p.length) return false;
  const v = dv(p);
  const n = Math.round(value);
  switch (type) {
    case 'u8':
      v.setUint8(off, Math.max(0, Math.min(255, n)));
      break;
    case 's8':
      v.setInt8(off, Math.max(-128, Math.min(127, n)));
      break;
    case 'u16':
      v.setUint16(off, Math.max(0, Math.min(65535, n)), true);
      break;
    case 's16':
      v.setInt16(off, Math.max(-32768, Math.min(32767, n)), true);
      break;
    case 'u32':
      v.setUint32(off, Math.max(0, Math.min(0xffffffff, n)) >>> 0, true);
      break;
  }
  return true;
}

export function decodeTable(defs: FieldDef[], payload: Uint8Array, api: number): Decoded {
  const raw = payload.slice();
  const values: Values = {};
  for (const d of defs) {
    if (!applies(d, api)) continue;
    const v = readField(raw, d.off, d.type);
    if (v !== undefined) values[d.key] = v;
  }
  return { values, raw };
}

/** Returns a new payload: `raw` with every known field patched from `values` (fields missing in `raw` are skipped). */
export function encodeTable(defs: FieldDef[], raw: Uint8Array, values: Values, api: number): Uint8Array {
  const out = raw.slice();
  for (const d of defs) {
    if (!applies(d, api)) continue;
    const v = values[d.key];
    if (v !== undefined) writeField(out, d.off, d.type, v);
  }
  return out;
}

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function valuesEqual(a: Values, b: Values): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}
