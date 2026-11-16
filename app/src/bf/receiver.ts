/**
 * Receiver area: MSP_RX_CONFIG, MSP_RX_MAP, MSP_RC_DEADBAND, MSP_RSSI_CONFIG, MSP_RC (spec 3.3, 3.5, 7.5).
 * Pure decoders/encoders; channel helpers for the live view.
 */
import { decodeTable, encodeTable, type Decoded, type FieldDef, type Values } from './fieldtable';

/** serialrx_provider enum (spec 3.3). */
export const RX_PROVIDERS: Record<number, string> = {
  0: 'None',
  1: 'Spektrum 2048',
  2: 'SBUS',
  3: 'SUMD',
  4: 'SUMH',
  5: 'XBUS B',
  6: 'XBUS B RJ01',
  7: 'IBUS',
  8: 'JETI EX BUS',
  9: 'CRSF',
  10: 'SRXL',
  11: 'Custom',
  12: 'FPORT',
  13: 'SRXL2',
  14: 'GHST',
  15: 'Spektrum 1024',
};
export const PROVIDER_CRSF = 9;

export const RX_CONFIG_FIELDS: FieldDef[] = [
  { key: 'provider', off: 0, type: 'u8' },
  { key: 'maxCheck', off: 1, type: 'u16' },
  { key: 'midRc', off: 3, type: 'u16' },
  { key: 'minCheck', off: 5, type: 'u16' },
  { key: 'rxMinUsec', off: 8, type: 'u16' },
  { key: 'rxMaxUsec', off: 10, type: 'u16' },
  { key: 'airModeThreshold', off: 14, type: 'u16' },
  { key: 'smoothSetpointCutoff', off: 25, type: 'u8' },
  { key: 'smoothFeedforwardCutoff', off: 26, type: 'u8', maxApi: 46 },
  { key: 'smoothThrottleCutoff', off: 26, type: 'u8', minApi: 47 },
  { key: 'smoothAutoFactorThrottle', off: 27, type: 'u8', minApi: 47 },
  { key: 'smoothAutoFactor', off: 30, type: 'u8' },
  { key: 'smoothMode', off: 31, type: 'u8', minApi: 44 },
];

export const decodeRxConfig = (p: Uint8Array, api: number): Decoded => decodeTable(RX_CONFIG_FIELDS, p, api);
export const encodeRxConfig = (raw: Uint8Array, v: Values, api: number): Uint8Array => encodeTable(RX_CONFIG_FIELDS, raw, v, api);

export const RC_DEADBAND_FIELDS: FieldDef[] = [
  { key: 'deadband', off: 0, type: 'u8' },
  { key: 'yawDeadband', off: 1, type: 'u8' },
  { key: 'altHoldDeadband', off: 2, type: 'u8' },
  { key: 'deadband3dThrottle', off: 3, type: 'u16' },
];

export const decodeRcDeadband = (p: Uint8Array, api: number): Decoded => decodeTable(RC_DEADBAND_FIELDS, p, api);
export const encodeRcDeadband = (raw: Uint8Array, v: Values, api: number): Uint8Array => encodeTable(RC_DEADBAND_FIELDS, raw, v, api);

/** MSP_RSSI_CONFIG (50): 0 = disabled, else AUX channel number (1-based among channels 5+; the Configurator shows it as channel N). */
export const decodeRssiChannel = (p: Uint8Array): number => p[0] ?? 0;
export const encodeRssiChannel = (ch: number): Uint8Array => Uint8Array.from([Math.max(0, Math.min(255, Math.round(ch)))]);

/* ---------------- channel map ---------------- */

/** rcmap[function] = input channel, functions ordered ROLL, PITCH, YAW, THROTTLE (+ AUX slots). */
export const decodeRxMap = (p: Uint8Array): number[] => Array.from(p.subarray(0, 8));

export function encodeRxMap(map: number[], base: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(8, base.length));
  out.set(base.subarray(0, out.length));
  map.slice(0, 8).forEach((v, i) => (out[i] = v));
  return out;
}

const FN_LETTER = ['A', 'E', 'R', 'T']; // roll = aileron, pitch = elevator, yaw = rudder, throttle

/** Channel order string like "AETR1234": letter per input channel position. */
export function mapToString(map: number[]): string {
  const s: string[] = new Array<string>(8).fill('');
  for (let f = 0; f < 4; f++) {
    const idx = map[f];
    if (idx !== undefined && idx >= 0 && idx < 8) s[idx] = FN_LETTER[f]!;
  }
  let aux = 1;
  return s.map((c) => c || String(aux++)).join('');
}

/** Inverse of mapToString for the four primary functions; returns null for an invalid string. */
export function stringToMap(str: string): number[] | null {
  if (str.length !== 8) return null;
  const map = [-1, -1, -1, -1, 4, 5, 6, 7];
  const aux: number[] = [];
  for (let i = 0; i < 8; i++) {
    const f = FN_LETTER.indexOf(str[i]!);
    if (f >= 0) {
      if (map[f] !== -1) return null;
      map[f] = i;
    } else aux.push(i);
  }
  if (map.slice(0, 4).some((v) => v < 0)) return null;
  // aux slots 4..7 map to the remaining input positions in order
  aux.forEach((pos, k) => (map[4 + k] = pos));
  return map;
}

export const RX_MAP_PRESETS = ['AETR1234', 'TAER1234', 'AERT1234', 'ETAR1234'];

/** Display name of RC channel index i (0-based) for a map: A/E/R/T letters, else AUXn. */
export function channelName(i: number, map: number[]): string {
  const f = [0, 1, 2, 3].find((fn) => map[fn] === i);
  if (f !== undefined) return ['Roll', 'Pitch', 'Yaw', 'Throttle'][f]!;
  return `AUX${i >= 4 ? i - 3 : i + 1}`;
}

/* ---------------- live RC ---------------- */

/** MSP_RC (105): u16 us per channel. */
export function decodeRc(p: Uint8Array): number[] {
  const n = Math.floor(p.length / 2);
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return Array.from({ length: n }, (_, i) => dv.getUint16(i * 2, true));
}

export function encodeRc(ch: number[]): Uint8Array {
  const out = new Uint8Array(ch.length * 2);
  const dv = new DataView(out.buffer);
  ch.forEach((v, i) => dv.setUint16(i * 2, Math.max(0, Math.min(65535, Math.round(v))), true));
  return out;
}

export interface Sticks {
  roll: number;
  pitch: number;
  yaw: number;
  /** 0..1 */
  throttle: number;
}

/** Normalised stick positions (-1..1, throttle 0..1) from raw channels via the channel map. */
export function sticksFromRc(rc: number[], map: number[], mid = 1500): Sticks {
  const ax = (f: number) => {
    const v = rc[map[f] ?? f];
    return v === undefined ? 0 : Math.max(-1, Math.min(1, (v - mid) / 500));
  };
  const t = rc[map[3] ?? 3];
  return { roll: ax(0), pitch: ax(1), yaw: ax(2), throttle: t === undefined ? 0 : Math.max(0, Math.min(1, (t - 1000) / 1000)) };
}

export interface ElrsLink {
  /** 0..100 */
  lq: number;
  /** Approximate dBm assuming the -120..-50 dBm span (receiver sensitivity is not reported over MSP). */
  rssiDbm: number;
}

/**
 * ELRS appends link quality and RSSI as channels 15 and 16 (index 14, 15) when the receiver is not in
 * 16-channel mode (spec 7.5). Returns null unless the provider is CRSF and 16 channels are present.
 */
export function elrsLink(rc: number[], provider: number): ElrsLink | null {
  if (provider !== PROVIDER_CRSF || rc.length < 16) return null;
  const lq = Math.max(0, Math.min(100, (rc[14]! - 1000) / 10));
  const rssiDbm = -120 + Math.max(0, Math.min(1, (rc[15]! - 1000) / 1000)) * 70;
  return { lq, rssiDbm };
}
