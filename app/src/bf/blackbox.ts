/**
 * Blackbox / dataflash: pure MSP decoders/encoders (design/BETAFLIGHT-PARITY.md 3.8). No DOM, no I/O.
 */

export const MSPB = {
  DATAFLASH_SUMMARY: 70,
  DATAFLASH_READ: 71,
  DATAFLASH_ERASE: 72,
  SDCARD_SUMMARY: 79,
  BLACKBOX_CONFIG: 80,
  SET_BLACKBOX_CONFIG: 81,
  REBOOT: 68,
} as const;

const dvOf = (p: Uint8Array) => new DataView(p.buffer, p.byteOffset, p.byteLength);

/* ---------------- MSP_DATAFLASH_SUMMARY (70) ---------------- */
export interface FlashSummary {
  /** Chip detected and ready for access. */
  ready: boolean;
  supported: boolean;
  sectors: number;
  totalSize: number;
  usedSize: number;
}
/** 13 bytes; a shorter reply means the FC has no dataflash support. */
export function decodeFlashSummary(p: Uint8Array): FlashSummary {
  if (p.length < 13) return { ready: false, supported: false, sectors: 0, totalSize: 0, usedSize: 0 };
  const dv = dvOf(p);
  return { ready: (p[0]! & 1) !== 0, supported: (p[0]! & 2) !== 0, sectors: dv.getUint32(1, true), totalSize: dv.getUint32(5, true), usedSize: dv.getUint32(9, true) };
}
export function encodeFlashSummary(s: FlashSummary): Uint8Array {
  const o = new Uint8Array(13);
  const dv = dvOf(o);
  o[0] = (s.ready ? 1 : 0) | (s.supported ? 2 : 0);
  dv.setUint32(1, s.sectors, true);
  dv.setUint32(5, s.totalSize, true);
  dv.setUint32(9, s.usedSize, true);
  return o;
}

/* ---------------- MSP_SDCARD_SUMMARY (79) ---------------- */
export interface SdSummary {
  supported: boolean;
  /** 0 not present, 1 fatal, 2 card init, 3 FS init, 4 ready. */
  state: number;
  lastError: number;
  freeKb: number;
  totalKb: number;
}
export function decodeSdSummary(p: Uint8Array): SdSummary {
  if (p.length < 11) return { supported: false, state: 0, lastError: 0, freeKb: 0, totalKb: 0 };
  const dv = dvOf(p);
  return { supported: (p[0]! & 1) !== 0, state: p[1]!, lastError: p[2]!, freeKb: dv.getUint32(3, true), totalKb: dv.getUint32(7, true) };
}

/* ---------------- MSP_BLACKBOX_CONFIG (80) / SET (81) ---------------- */
export const BB_DEVICES = [
  { id: 0, key: 'none' },
  { id: 1, key: 'flash' },
  { id: 2, key: 'sd' },
  { id: 3, key: 'serial' },
] as const;

export interface BlackboxConfig {
  raw: Uint8Array;
  supported: boolean;
  device: number;
  rateNum: number;
  rateDenom: number;
  /** Effective logging divider (p_ratio). */
  pRatio: number;
  /** blackbox_sample_rate index: logged rate = PID loop / 2^index (API >= 1.44). */
  sampleRate: number;
  /** blackbox_disable_* field mask (API >= 1.45). */
  disabledMask: number;
}

export function decodeBlackboxConfig(p: Uint8Array, apiMinor: number): BlackboxConfig {
  const dv = dvOf(p);
  return {
    raw: p,
    supported: (p[0] ?? 0) === 1,
    device: p[1] ?? 0,
    rateNum: p[2] ?? 1,
    rateDenom: p[3] ?? 1,
    pRatio: p.length >= 6 ? dv.getUint16(4, true) : 1,
    sampleRate: apiMinor >= 44 && p.length >= 7 ? p[6]! : 0,
    disabledMask: apiMinor >= 45 && p.length >= 11 ? dv.getUint32(7, true) : 0,
  };
}

export interface BlackboxPatch {
  device?: number;
  sampleRate?: number;
}

/**
 * SET payload: u8 device, u8 num, u8 denom, u16 pRatio, (API>=1.44) u8 sampleRate, (API>=1.45) u32 mask.
 * Changing the sample rate scales p_ratio by the same power of two so both fields stay consistent (UNVERIFIED on hardware).
 */
export function encodeBlackboxConfig(cur: BlackboxConfig, patch: BlackboxPatch, apiMinor: number): Uint8Array {
  const sample = patch.sampleRate ?? cur.sampleRate;
  let pRatio = cur.pRatio;
  if (apiMinor >= 44 && sample !== cur.sampleRate && pRatio > 0) {
    pRatio = sample > cur.sampleRate ? pRatio * 2 ** (sample - cur.sampleRate) : Math.max(1, Math.round(pRatio / 2 ** (cur.sampleRate - sample)));
  }
  const len = 6 + (apiMinor >= 44 ? 1 : 0) + (apiMinor >= 45 ? 4 : 0);
  const o = new Uint8Array(len);
  const dv = dvOf(o);
  o[0] = (patch.device ?? cur.device) & 0xff;
  o[1] = cur.rateNum;
  o[2] = cur.rateDenom;
  dv.setUint16(3, Math.min(0xffff, pRatio), true);
  let at = 5;
  if (apiMinor >= 44) o[at++] = sample & 0xff;
  if (apiMinor >= 45) dv.setUint32(at, cur.disabledMask, true);
  return o.slice(0, at + (apiMinor >= 45 ? 4 : 0));
}

export function encodeBlackboxConfigRead(c: { device: number; rateNum: number; rateDenom: number; pRatio: number; sampleRate: number; disabledMask: number }, apiMinor: number): Uint8Array {
  const o = new Uint8Array(11);
  const dv = dvOf(o);
  o[0] = 1;
  o[1] = c.device;
  o[2] = c.rateNum;
  o[3] = c.rateDenom;
  dv.setUint16(4, c.pRatio, true);
  o[6] = c.sampleRate;
  dv.setUint32(7, c.disabledMask, true);
  return o.slice(0, apiMinor >= 45 ? 11 : apiMinor >= 44 ? 7 : 6);
}

/** Logging rate in Hz for a PID loop time (us) and a sample-rate index. */
export const loggingRateHz = (pidLoopUs: number, sampleRate: number): number => (pidLoopUs > 0 ? 1e6 / pidLoopUs / 2 ** sampleRate : 0);

/** Sample-rate indexes offered in the UI (1/1 .. 1/16 of the PID loop). */
export const SAMPLE_RATES = [0, 1, 2, 3, 4] as const;

/* ---------------- MSP_DATAFLASH_READ (71) ---------------- */
/** Request: u32 address, u16 length, u8 allowCompression (we always send 0: Huffman is not supported). */
export function encodeFlashRead(address: number, length: number): Uint8Array {
  const o = new Uint8Array(7);
  const dv = dvOf(o);
  dv.setUint32(0, address, true);
  dv.setUint16(4, length, true);
  o[6] = 0;
  return o;
}

export type FlashChunk = { ok: true; address: number; data: Uint8Array } | { ok: false; reason: 'short' | 'address' | 'compressed' };

/** Response: u32 address, u16 length, u8 compression type, data. A zero length marks the end of flash. */
export function decodeFlashRead(p: Uint8Array, expectAddress: number): FlashChunk {
  if (p.length < 7) return { ok: false, reason: 'short' };
  const dv = dvOf(p);
  const address = dv.getUint32(0, true);
  const len = dv.getUint16(4, true);
  const compression = p[6]!;
  if (address !== expectAddress) return { ok: false, reason: 'address' };
  if (compression !== 0) return { ok: false, reason: 'compressed' };
  return { ok: true, address, data: p.subarray(7, 7 + Math.min(len, p.length - 7)) };
}

export function encodeFlashReadResponse(address: number, data: Uint8Array): Uint8Array {
  const o = new Uint8Array(7 + data.length);
  const dv = dvOf(o);
  dv.setUint32(0, address, true);
  dv.setUint16(4, data.length, true);
  o[6] = 0;
  o.set(data, 7);
  return o;
}

/** MSP_REBOOT reply for MSC: u8 mode, u8 mscReady (0 = no storage, the FC does not reboot). */
export const decodeMscReply = (p: Uint8Array): { mode: number; ready: boolean } => ({ mode: p[0] ?? 0, ready: (p[1] ?? 0) !== 0 });

/** Default file name for a downloaded log: LOG_<yyyymmdd-hhmmss>.bbl */
export function logFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `LOG_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.bbl`;
}

export const fmtBytes = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 1 : 2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} kB` : `${n} B`);
