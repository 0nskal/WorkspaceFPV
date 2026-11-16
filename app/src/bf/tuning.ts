/**
 * PID tuning area: MSP_PID, MSP_PID_ADVANCED, MSP_RC_TUNING, MSP_FILTER_CONFIG decoders/encoders (spec 3.6)
 * plus pure math for the rate curves, the throttle curve and the filter response sketch.
 * Everything here is pure (bytes <-> typed objects); API-version differences are handled by the field tables.
 */
import { decodeTable, encodeTable, writeField, type Decoded, type FieldDef, type Values } from './fieldtable';

/* ---------------- PID (112 / 202) ---------------- */

export const PID_AXES = ['roll', 'pitch', 'yaw'] as const;
export type PidAxisName = (typeof PID_AXES)[number];

export interface PidTable {
  /** One [P, I, D] per item: ROLL, PITCH, YAW, LEVEL, MAG (more on wing builds). */
  items: [number, number, number][];
  raw: Uint8Array;
}

export function decodePid(payload: Uint8Array): PidTable {
  const items: [number, number, number][] = [];
  for (let o = 0; o + 3 <= payload.length; o += 3) items.push([payload[o]!, payload[o + 1]!, payload[o + 2]!]);
  return { items, raw: payload.slice() };
}

/** Writes the first `items.length` triples over the raw payload (extra items stay as read). */
export function encodePid(base: Uint8Array, items: [number, number, number][]): Uint8Array {
  const out = base.slice();
  items.forEach((it, i) => {
    for (let k = 0; k < 3; k++) if (i * 3 + k < out.length) out[i * 3 + k] = Math.max(0, Math.min(255, Math.round(it[k]!)));
  });
  return out;
}

/* ---------------- PID_ADVANCED (94 / 95) ---------------- */

export const PID_ADV_FIELDS: FieldDef[] = [
  { key: 'ffTransition', off: 8, type: 'u8' },
  { key: 'rateAccelLimit', off: 13, type: 'u16' },
  { key: 'yawRateAccelLimit', off: 15, type: 'u16' },
  { key: 'angleLimit', off: 17, type: 'u8' },
  { key: 'antiGravityGain', off: 21, type: 'u16' },
  { key: 'itermRotation', off: 25, type: 'u8' },
  { key: 'itermRelax', off: 27, type: 'u8' },
  { key: 'itermRelaxType', off: 28, type: 'u8' },
  { key: 'absControlGain', off: 29, type: 'u8', maxApi: 47 },
  { key: 'throttleBoost', off: 30, type: 'u8' },
  { key: 'acroTrainerAngle', off: 31, type: 'u8' },
  { key: 'ff0', off: 32, type: 'u16' },
  { key: 'ff1', off: 34, type: 'u16' },
  { key: 'ff2', off: 36, type: 'u16' },
  { key: 'dMax0', off: 39, type: 'u8' },
  { key: 'dMax1', off: 40, type: 'u8' },
  { key: 'dMax2', off: 41, type: 'u8' },
  { key: 'dMaxGain', off: 42, type: 'u8' },
  { key: 'dMaxAdvance', off: 43, type: 'u8' },
  { key: 'useIntegratedYaw', off: 44, type: 'u8' },
  { key: 'integratedYawRelax', off: 45, type: 'u8' },
  { key: 'itermRelaxCutoff', off: 46, type: 'u8', minApi: 42 },
  { key: 'motorOutputLimit', off: 47, type: 'u8', minApi: 43 },
  { key: 'autoProfileCellCount', off: 48, type: 's8', minApi: 43 },
  { key: 'dynIdleMinRpm', off: 49, type: 'u8' },
  { key: 'ffAveraging', off: 50, type: 'u8', minApi: 44 },
  { key: 'ffSmoothFactor', off: 51, type: 'u8', minApi: 44 },
  { key: 'ffBoost', off: 52, type: 'u8', minApi: 44 },
  { key: 'ffMaxRateLimit', off: 53, type: 'u8', minApi: 44 },
  { key: 'ffJitterFactor', off: 54, type: 'u8', minApi: 44 },
  { key: 'vbatSagCompensation', off: 55, type: 'u8', minApi: 44 },
  { key: 'thrustLinearization', off: 56, type: 'u8', minApi: 44 },
  { key: 'tpaMode', off: 57, type: 'u8', minApi: 45 },
  { key: 'tpaRate', off: 58, type: 'u8', minApi: 45 },
  { key: 'tpaBreakpoint', off: 59, type: 'u16', minApi: 45 },
];

export const decodePidAdvanced = (p: Uint8Array, api: number): Decoded => decodeTable(PID_ADV_FIELDS, p, api);
export const encodePidAdvanced = (raw: Uint8Array, v: Values, api: number): Uint8Array => encodeTable(PID_ADV_FIELDS, raw, v, api);

/* ---------------- RC_TUNING (111 / 204) ---------------- */

export const RATES_TYPES = ['betaflight', 'raceflight', 'kiss', 'actual', 'quick'] as const;
export type RatesType = (typeof RATES_TYPES)[number];

export const RC_TUNING_FIELDS: FieldDef[] = [
  { key: 'rcRate0', off: 0, type: 'u8' },
  { key: 'rcExpo0', off: 1, type: 'u8' },
  { key: 'superRate0', off: 2, type: 'u8' },
  { key: 'superRate1', off: 3, type: 'u8' },
  { key: 'superRate2', off: 4, type: 'u8' },
  { key: 'throttleMid', off: 6, type: 'u8' },
  { key: 'throttleExpo', off: 7, type: 'u8' },
  { key: 'rcExpo2', off: 10, type: 'u8' },
  { key: 'rcRate2', off: 11, type: 'u8' },
  { key: 'rcRate1', off: 12, type: 'u8' },
  { key: 'rcExpo1', off: 13, type: 'u8' },
  { key: 'throttleLimitType', off: 14, type: 'u8' },
  { key: 'throttleLimitPercent', off: 15, type: 'u8' },
  { key: 'rateLimit0', off: 16, type: 'u16' },
  { key: 'rateLimit1', off: 18, type: 'u16' },
  { key: 'rateLimit2', off: 20, type: 'u16' },
  { key: 'ratesType', off: 22, type: 'u8' },
  { key: 'throttleHover', off: 23, type: 'u8', minApi: 47 },
];

export const decodeRcTuning = (p: Uint8Array, api: number): Decoded => decodeTable(RC_TUNING_FIELDS, p, api);
export const encodeRcTuning = (raw: Uint8Array, v: Values, api: number): Uint8Array => encodeTable(RC_TUNING_FIELDS, raw, v, api);

/* ---------------- FILTER_CONFIG (92 / 93) ---------------- */

export const FILTER_FIELDS: FieldDef[] = [
  { key: 'dtermLpf1Hz', off: 1, type: 'u16' },
  { key: 'yawLpfHz', off: 3, type: 'u16' },
  { key: 'gyroNotch1Hz', off: 5, type: 'u16' },
  { key: 'gyroNotch1Cutoff', off: 7, type: 'u16' },
  { key: 'dtermNotchHz', off: 9, type: 'u16' },
  { key: 'dtermNotchCutoff', off: 11, type: 'u16' },
  { key: 'gyroNotch2Hz', off: 13, type: 'u16' },
  { key: 'gyroNotch2Cutoff', off: 15, type: 'u16' },
  { key: 'dtermLpf1Type', off: 17, type: 'u8' },
  { key: 'gyroLpf1Hz', off: 20, type: 'u16' },
  { key: 'gyroLpf2Hz', off: 22, type: 'u16' },
  { key: 'gyroLpf1Type', off: 24, type: 'u8' },
  { key: 'gyroLpf2Type', off: 25, type: 'u8' },
  { key: 'dtermLpf2Hz', off: 26, type: 'u16' },
  { key: 'dtermLpf2Type', off: 28, type: 'u8' },
  { key: 'gyroLpf1DynMin', off: 29, type: 'u16' },
  { key: 'gyroLpf1DynMax', off: 31, type: 'u16' },
  { key: 'dtermLpf1DynMin', off: 33, type: 'u16' },
  { key: 'dtermLpf1DynMax', off: 35, type: 'u16' },
  { key: 'dynNotchQ', off: 39, type: 'u16' },
  { key: 'dynNotchMin', off: 41, type: 'u16' },
  { key: 'rpmHarmonics', off: 43, type: 'u8' },
  { key: 'rpmMinHz', off: 44, type: 'u8' },
  { key: 'dynNotchMax', off: 45, type: 'u16', minApi: 43 },
  { key: 'dynLpfCurveExpo', off: 47, type: 'u8', minApi: 44 },
  { key: 'dynNotchCount', off: 48, type: 'u8', minApi: 44 },
];

export const decodeFilterConfig = (p: Uint8Array, api: number): Decoded => decodeTable(FILTER_FIELDS, p, api);

/** As the Configurator does: gyro LPF1 is also written into the legacy u8 slot at offset 0 (clamped to 255). */
export function encodeFilterConfig(raw: Uint8Array, v: Values, api: number): Uint8Array {
  const out = encodeTable(FILTER_FIELDS, raw, v, api);
  if (v.gyroLpf1Hz !== undefined) writeField(out, 0, 'u8', Math.min(255, v.gyroLpf1Hz));
  return out;
}

export const FILTER_TYPES = ['PT1', 'BIQUAD', 'PT2', 'PT3'] as const;

/* ---------------- rate curves ---------------- */

export interface AxisRates {
  rcRate: number;
  expo: number;
  superRate: number;
  /** Rate limit in deg/s (clamp), 0/undefined = none. */
  limit?: number;
}

const p3 = (x: number) => x * x * x;
const p5 = (x: number) => x * x * x * x * x;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Setpoint in deg/s for a stick position x in -1..1, per rates type. Raw values are the bytes in MSP_RC_TUNING
 * (rcRate, expo and superRate as stored). Ported from the firmware (src/main/fc/rc.c, apply*Rates, checked against
 * 4.5-maintenance and master); the result is clamped to the profile rate limit (firmware: rate_limit, max 1998).
 * Quick rates: the firmware's default `quick_rates_rc_expo = 0` branch (the setting is CLI-only, not in MSP).
 */
export function rateAt(type: RatesType, r: AxisRates, x: number): number {
  const a = Math.abs(x);
  let rate: number;
  switch (type) {
    case 'betaflight': {
      const e = r.expo / 100;
      const c = x * p3(a) * e + x * (1 - e);
      let rc = r.rcRate / 100;
      if (rc > 2) rc += 14.54 * (rc - 2);
      rate = 200 * rc * c;
      if (r.superRate) rate *= 1 / clamp(1 - a * (r.superRate / 100), 0.01, 1);
      break;
    }
    case 'raceflight': {
      const c = (1 + 0.01 * r.expo * (x * x - 1)) * x;
      rate = 10 * r.rcRate * c * (1 + a * r.superRate * 0.01);
      break;
    }
    case 'kiss': {
      // kissRcCommandf = (x^3*e + x*(1-e)) * rcRate/1000; angle = 2000 * superFactor * kissRcCommandf
      const e = r.expo / 100;
      const c = (p3(x) * e + x * (1 - e)) * (r.rcRate / 1000);
      rate = 2000 * c * (1 / clamp(1 - a * (r.superRate / 100), 0.01, 1));
      break;
    }
    case 'actual': {
      // expof = |x| * (x^5*e + x*(1-e)); angle = x*center + max(0, max - center)*expof (odd in x, no abs)
      const e = r.expo / 100;
      const curve = a * (p5(x) * e + x * (1 - e));
      const center = r.rcRate * 10;
      const move = Math.max(0, r.superRate * 10 - center);
      rate = x * center + move * curve;
      break;
    }
    case 'quick': {
      // quick_rates_rc_expo = 0: curve = |x|^3*e + |x|*(1-e); angle = x * rcRate * 1/clamp(1 - curve*sfc)
      const rc = r.rcRate * 2;
      const maxDps = Math.max(r.superRate * 10, rc);
      const e = r.expo / 100;
      const sfc = maxDps > 0 ? (maxDps - rc) / maxDps : 0;
      const curve = p3(a) * e + a * (1 - e);
      rate = x * rc * (1 / clamp(1 - curve * sfc, 0.01, 1));
      break;
    }
  }
  const lim = r.limit && r.limit > 0 ? r.limit : 1998;
  return clamp(rate, -lim, lim);
}

/** Maximum deg/s (stick fully deflected). */
export const maxRate = (type: RatesType, r: AxisRates): number => Math.abs(rateAt(type, r, 1));

const THR_LOOKUP = 12; // THROTTLE_LOOKUP_LENGTH

/** Firmware <= 4.5 (API <= 1.46): integer mid/expo table (rc.c generateThrottleCurve), PWM 1000..2000 per 10 % step. */
function throttleTable45(mid: number, expo: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < THR_LOOKUP; i++) {
    const tmp = 10 * i - mid;
    const y = tmp > 0 ? 100 - mid : tmp < 0 ? mid : 1;
    const v = 10 * mid + Math.trunc((tmp * (100 - expo + Math.trunc((expo * tmp * tmp) / (y * y || 1)))) / 10);
    out.push(1000 + v);
  }
  return out;
}

/** Quadratic Bezier y for a given x (rc.c quadraticBezier). */
function bezierY(x: number, p0x: number, p1x: number, p2x: number, p0y: number, p1y: number, p2y: number): number {
  const a = p0x - 2 * p1x + p2x;
  const b = 2 * p1x - 2 * p0x;
  const c = p0x - x;
  let t = 0;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) > 1e-6) t = -c / b;
  } else {
    const d = b * b - 4 * a * c;
    if (d >= 0) {
      const s = Math.sqrt(d);
      const t1 = (-b + s) / (2 * a);
      const t2 = (-b - s) / (2 * a);
      t = t1 >= 0 && t1 <= 1 ? t1 : t2;
    }
  }
  t = clamp(t, 0, 1);
  return (1 - t) * (1 - t) * p0y + 2 * (1 - t) * t * p1y + t * t * p2y;
}

/** Firmware 2025.12+ (API >= 1.47): two quadratic Bezier segments through (mid, hover), rounded into the PWM table. */
function throttleTableBezier(mid: number, expo: number, hover: number): number[] {
  const m = mid / 100;
  const e = expo / 100;
  const h = hover / 100;
  const cp1x = m * 0.5;
  const cp1y = h * 0.5 * (1 + e);
  const cp2x = (1 + m) * 0.5;
  const cp2y = 1 + (h - 1) * 0.5 * (1 + e);
  const out: number[] = [];
  for (let i = 0; i < THR_LOOKUP; i++) {
    const x = i / (THR_LOOKUP - 1);
    const y = x <= m ? bezierY(x, 0, cp1x, m, 0, cp1y, h) : bezierY(x, m, cp2x, 1, h, cp2y, 1);
    out.push(Math.round(1000 + 1000 * y));
  }
  return out;
}

export interface ThrottleOpts {
  /** thr_hover (MSP_RC_TUNING byte 23, API >= 1.47); 50 when unknown. */
  hover?: number;
  /** MSP API minor; selects the 4.5 table (<= 46) or the 2025.12 Bezier curve (>= 47). Default 46. */
  api?: number;
}

/**
 * Throttle output for a stick position, exactly as the firmware computes it (lookup table + interpolation in PWM
 * microseconds). x and result in 0..1 (= (PWM - 1000) / 1000). mid/expo/hover are the raw 0..100 bytes.
 */
export function throttleCurve(mid: number, expo: number, x: number, opts: ThrottleOpts = {}): number {
  const api = opts.api ?? 46;
  const stick = Math.round(clamp(x, 0, 1) * 1000); // rcData[THROTTLE] - PWM_RANGE_MIN
  let pwm: number;
  if (api >= 47) {
    const lk = throttleTableBezier(mid, expo, opts.hover ?? 50);
    const steps = THR_LOOKUP - 1;
    const scaled = stick * steps;
    const idx = Math.trunc(scaled / 1000);
    const rem = scaled % 1000;
    pwm = idx >= steps ? lk[steps]! : Math.round(lk[idx]! + (rem * (lk[idx + 1]! - lk[idx]!)) / 1000);
  } else {
    const lk = throttleTable45(mid, expo);
    const i = Math.trunc(stick / 100);
    pwm = lk[i]! + Math.trunc(((stick - i * 100) * (lk[i + 1]! - lk[i]!)) / 100);
  }
  return clamp((pwm - 1000) / 1000, 0, 1);
}

export function axisRatesFromValues(v: Values, axis: 0 | 1 | 2): AxisRates {
  return { rcRate: v[`rcRate${axis}`] ?? 0, expo: v[`rcExpo${axis}`] ?? 0, superRate: v[`superRate${axis}`] ?? 0, limit: v[`rateLimit${axis}`] };
}

/* ---------------- filter response (sketch only) ---------------- */

/** |H(f)| of a lowpass of the given type with -3 dB at fc (PTn cutoff correction applied, biquad = 2nd-order Butterworth). 0 Hz = filter off. */
export function lowpassGain(type: number, fc: number, f: number): number {
  if (!fc) return 1;
  const order = type === 0 ? 1 : type === 2 ? 2 : type === 3 ? 3 : 0;
  if (order === 0) return 1 / Math.sqrt(1 + (f / fc) ** 4); // BIQUAD
  const k = 1 / Math.sqrt(2 ** (1 / order) - 1);
  return (1 + (f / (k * fc)) ** 2) ** (-order / 2);
}

/** |H(f)| of a notch centred at fc with quality q. */
export function notchGain(fc: number, q: number, f: number): number {
  if (!fc || !q) return 1;
  const d = f * f - fc * fc;
  const w = (f * fc) / q;
  return Math.abs(d) / Math.sqrt(d * d + w * w);
}

export const toDb = (g: number): number => 20 * Math.log10(Math.max(g, 1e-6));

