/** Small signal helpers shared by the auto-tune engine (throttle, exclusion masks, smoothing, biquads, statistics). */
import type { LogData } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);

export function median(a: ArrayLike<number>): number | null {
  const b = Array.from(a).filter((v) => Number.isFinite(v));
  if (!b.length) return null;
  b.sort((p, q) => p - q);
  const m = b.length >> 1;
  return b.length % 2 ? b[m]! : (b[m - 1]! + b[m]!) / 2;
}

export function quantile(a: ArrayLike<number>, q: number): number | null {
  const b = Array.from(a).filter((v) => Number.isFinite(v));
  if (!b.length) return null;
  b.sort((p, r) => p - r);
  const pos = clamp(q, 0, 1) * (b.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(b.length - 1, lo + 1);
  return b[lo]! + (b[hi]! - b[lo]!) * (pos - lo);
}

/**
 * Throttle 0..100 % per sample: rcCommand[3] (1000..2000) when logged, else the motor average scaled by the motor
 * output range; null when neither is known.
 */
export function throttlePct(log: LogData): Float32Array | null {
  const n = log.rows;
  const th = log.throttle;
  if (th && th.length >= n) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = clamp((th[i]! - 1000) / 10, 0, 100);
    return out;
  }
  const range = log.motorRange ?? log.settings?.motorOutput;
  if (range && log.motor.length && range[1] > range[0]) {
    const out = new Float32Array(n);
    const span = range[1] - range[0];
    const m = log.motor;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < m.length; k++) s += m[k]![i]!;
      out[i] = clamp(((s / m.length - range[0]) / span) * 100, 0, 100);
    }
    return out;
  }
  return null;
}

/** Exclusion flags per sample. */
export const BAD_MOTOR_SAT = 1;
export const BAD_GYRO_SAT = 2;
export const BAD_IDLE = 4;

/** Gyro at or above this [deg/s] counts as saturated / crash (2000 deg/s full scale). */
export const GYRO_SAT_DPS = 1950;
/** Throttle below this [%] counts as idle / on the ground. */
export const IDLE_PCT = 8;

/**
 * Per-sample exclusion mask: motor saturation (any motor within 2 % of its maximum), gyro saturation / crash (dilated
 * +-200 ms), idle or on-ground throttle. Unknown inputs simply set no flag.
 */
export function badMask(log: LogData, thr: Float32Array | null): Uint8Array {
  const n = log.rows;
  const mask = new Uint8Array(n);
  const range = log.motorRange ?? log.settings?.motorOutput;
  if (range && log.motor.length && range[1] > range[0]) {
    const top = range[1] - (range[1] - range[0]) * 0.02;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < log.motor.length; k++) {
        if (log.motor[k]![i]! >= top) {
          mask[i] = mask[i]! | BAD_MOTOR_SAT;
          break;
        }
      }
    }
  }
  const dil = Math.round(0.2 * log.fs);
  let until = -1;
  for (let i = 0; i < n; i++) {
    let sat = false;
    for (let a = 0; a < 3; a++) if (Math.abs(log.gyro[a]![i]!) >= GYRO_SAT_DPS) sat = true;
    if (sat) {
      for (let j = Math.max(0, i - dil, until + 1); j < i; j++) mask[j] = mask[j]! | BAD_GYRO_SAT;
      until = i + dil;
    }
    if (i <= until) mask[i] = mask[i]! | BAD_GYRO_SAT;
  }
  if (thr) for (let i = 0; i < n; i++) if (thr[i]! < IDLE_PCT) mask[i] = mask[i]! | BAD_IDLE;
  return mask;
}

/** Centered moving average (no phase shift), window k samples (k <= 1 returns a copy). */
export function smoothCentered(x: ArrayLike<number>, k: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  if (k <= 1) {
    for (let i = 0; i < n; i++) out[i] = x[i]!;
    return out;
  }
  const h = Math.floor(k / 2);
  let s = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h);
    const b = Math.min(n - 1, i + h);
    while (hi < b) s += x[++hi]!;
    while (lo < a) s -= x[lo++]!;
    out[i] = s / (hi - lo + 1);
  }
  return out;
}

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** 2nd-order low-pass (RBJ cookbook form), q = 0.7071 for Butterworth. */
export function lowpass(fc: number, fs: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * fc) / fs;
  const al = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + al;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 };
}

/** 2nd-order high-pass (RBJ cookbook form). */
export function highpass(fc: number, fs: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * fc) / fs;
  const al = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  const a0 = 1 + al;
  return { b0: (1 + c) / 2 / a0, b1: -(1 + c) / a0, b2: (1 + c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 };
}

/** Runs a biquad over x (direct form I). */
export function filter(x: ArrayLike<number>, f: Biquad): Float64Array {
  const n = x.length;
  const y = new Float64Array(n);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const x0 = x[i]!;
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    y[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return y;
}

/** Block-average decimation by an integer factor (cheap anti-alias for the slow analyses). */
export function decimate(x: ArrayLike<number>, factor: number): Float32Array {
  if (factor <= 1) return Float32Array.from(x as ArrayLike<number>);
  const m = Math.floor(x.length / factor);
  const out = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += x[i * factor + k]!;
    out[i] = s / factor;
  }
  return out;
}

/** Pearson correlation of a and b shifted by `lag` samples (b delayed): corr(a[i], b[i + lag]) over [from, to). */
export function laggedCorr(a: ArrayLike<number>, b: ArrayLike<number>, lag: number, from: number, to: number): number {
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  let c = 0;
  const end = Math.min(to, a.length, b.length - lag);
  for (let i = Math.max(from, -lag); i < end; i++) {
    const x = a[i]!;
    const y = b[i + lag]!;
    sa += x;
    sb += y;
    saa += x * x;
    sbb += y * y;
    sab += x * y;
    c++;
  }
  if (c < 3) return 0;
  const cov = sab - (sa * sb) / c;
  const va = saa - (sa * sa) / c;
  const vb = sbb - (sb * sb) / c;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/**
 * Lag [samples, fractional] in 0..maxLag where b best matches a delayed (parabolic peak interpolation), with the
 * correlation at that lag. Null when the best correlation is below minCorr.
 */
export function bestLag(a: ArrayLike<number>, b: ArrayLike<number>, maxLag: number, from: number, to: number, minCorr = 0.5): { lag: number; corr: number } | null {
  const cs: number[] = [];
  for (let l = 0; l <= maxLag; l++) cs.push(laggedCorr(a, b, l, from, to));
  let bi = 0;
  for (let l = 1; l < cs.length; l++) if (cs[l]! > cs[bi]!) bi = l;
  const best = cs[bi]!;
  if (!(best >= minCorr)) return null;
  let frac = 0;
  if (bi > 0 && bi < cs.length - 1) {
    const y0 = cs[bi - 1]!;
    const y1 = cs[bi]!;
    const y2 = cs[bi + 1]!;
    const den = y0 - 2 * y1 + y2;
    if (den < 0) frac = clamp((0.5 * (y0 - y2)) / den, -0.5, 0.5);
  }
  return { lag: bi + frac, corr: best };
}
