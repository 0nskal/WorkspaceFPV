/**
 * Step response v2: real stick steps detected in the setpoint (in addition to the Wiener deconvolution of step.ts),
 * per-step metrics on a 1 ms grid, buckets by step size and throttle band, exclusion of motor saturation, idle
 * throttle and crashes. Pure functions; runs in the analysis worker.
 */
import { BAD_GYRO_SAT, BAD_IDLE, BAD_MOTOR_SAT, bestLag, clamp01, decimate, median, smoothCentered } from './signals';
import { stepResponse } from './step';

export type AxisKey = 'roll' | 'pitch' | 'yaw';
export const AXIS_KEYS: AxisKey[] = ['roll', 'pitch', 'yaw'];

/** Metrics of a normalised response (1 = setpoint target), times in ms. */
export interface CurveMetrics {
  /** 10-90 % rise time. */
  rise: number | null;
  /** Tracking delay: gyro 50 % crossing minus setpoint 50 % crossing (Wiener curve: time to 50 %). */
  latency50: number | null;
  /** Time from the step onset to 5 % of the response. */
  latency5: number | null;
  /** Peak above the target [%], 0 when it never exceeds it. */
  overshoot: number | null;
  peak: number | null;
  peakTime: number | null;
  /** Last time outside +-2 % / +-5 % of the final value; null = not settled inside the window. */
  settle2: number | null;
  settle5: number | null;
  /** Crossings of the +-3 % band around the final value after the peak (2 crossings = 1 full ring cycle). */
  ringing: number;
  /** Final value minus target [%] (negative = never reaches the stick). */
  ssError: number | null;
  /** Dip below the final value after the first peak [%]. */
  undershoot: number | null;
  /** Return-to-centre steps only: late (after max(120 ms, 2 x peak time)) excursion past zero [%] (I-term bounce-back). */
  bounceBack: number | null;
}

export interface StepOptionsV2 {
  /** Setpoint acceleration that starts a step [deg/s^2]. */
  minAccel?: number;
  /** Minimum step size [deg/s]. */
  minSize?: number;
  /** Minimum hold after the edge [ms]. */
  minHoldMs?: number;
  /** Quiet time after a step before the next one may start [ms]. */
  cooldownMs?: number;
  /** Longest edge that still counts as a step (slower ramps are skipped) [ms]. */
  maxEdgeMs?: number;
  /** Analysis window after the onset [ms]. */
  horizonMs?: number;
}

const DEF: Required<StepOptionsV2> = { minAccel: 500, minSize: 150, minHoldMs: 50, cooldownMs: 100, maxEdgeMs: 80, horizonMs: 300 };

export type ExcludeReason = 'saturation' | 'crash' | 'idle';

/** A detected stick step (light record for the UI scatter / list). */
export interface DetectedStep {
  /** Onset time [s]. */
  t: number;
  /** Signed size [deg/s]. */
  size: number;
  from: number;
  to: number;
  holdMs: number;
  /** Mean throttle [%] in the window, null without throttle data. */
  throttle: number | null;
  excluded: ExcludeReason | null;
  overshoot: number | null;
  rise: number | null;
  latency50: number | null;
}

export interface StepBucket {
  id: 'small' | 'mid' | 'large' | 'low' | 'midThr' | 'high';
  /** Bounds of the bucket: |size| in deg/s or throttle in %. */
  lo: number;
  hi: number;
  n: number;
  /** Median metrics of the steps in the bucket (null when empty). */
  metrics: CurveMetrics | null;
  /** Mean normalised response of the bucket, 1 ms per point (null when empty). */
  curve: number[] | null;
}

export interface AxisSteps {
  axis: AxisKey;
  wiener: { curve: number[] | null; windows: number; metrics: CurveMetrics | null };
  detected: {
    /** Usable steps (not excluded). */
    n: number;
    excluded: Record<ExcludeReason, number>;
    /** Median metrics over usable steps. */
    metrics: CurveMetrics | null;
    /** Mean normalised response, 1 ms per point from the onset. */
    curve: number[] | null;
    /** Up to 200 step records (usable and excluded) for display. */
    list: DetectedStep[];
  };
  bySize: StepBucket[];
  byThrottle: StepBucket[];
  /** Preferred metrics: detected steps when there are >= 5, else the Wiener curve. */
  best: CurveMetrics | null;
  source: 'steps' | 'wiener' | null;
  /** 0..1 from the number of steps / windows. */
  confidence: number;
  /** Setpoint-to-gyro delay from cross-correlation [ms] and the correlation there (feedforward quality). */
  trackingDelayMs: number | null;
  trackingCorr: number | null;
}

const BAND_RING = 0.03;

/** Metrics of a response on a 1 ms grid. `final` defaults to the mean of the last 30 %; `spT50` = setpoint 50 % time. */
export function curveMetrics(y: ArrayLike<number>, opts: { final?: number; spT50?: number } = {}): CurveMetrics {
  const n = y.length;
  const empty: CurveMetrics = { rise: null, latency50: null, latency5: null, overshoot: null, peak: null, peakTime: null, settle2: null, settle5: null, ringing: 0, ssError: null, undershoot: null, bounceBack: null };
  if (n < 5) return empty;
  let final = opts.final;
  if (final === undefined) {
    const from = Math.min(n - 3, Math.floor(n * 0.7));
    let s = 0;
    for (let i = from; i < n; i++) s += y[i]!;
    final = s / (n - from);
  }
  const cross = (lvl: number): number | null => {
    if (y[0]! >= lvl) return 0;
    for (let i = 1; i < n; i++) if (y[i - 1]! < lvl && y[i]! >= lvl) return i - 1 + (lvl - y[i - 1]!) / (y[i]! - y[i - 1]!);
    return null;
  };
  const t5 = cross(0.05);
  const t10 = cross(0.1);
  const t50 = cross(0.5);
  const t90 = cross(0.9);
  let peak = -Infinity;
  let pt = 0;
  for (let i = 0; i < n; i++) {
    if (y[i]! > peak) {
      peak = y[i]!;
      pt = i;
    }
  }
  const settle = (band: number): number | null => {
    for (let i = n - 1; i >= 0; i--) if (Math.abs(y[i]! - final!) > band) return i === n - 1 ? null : i + 1;
    return 0;
  };
  // ringing: hysteresis crossings of the +-3 % band around the final value, after the peak
  let ringing = 0;
  let state = y[pt]! > final + BAND_RING ? 1 : y[pt]! < final - BAND_RING ? -1 : 0;
  for (let i = pt + 1; i < n; i++) {
    const d = y[i]! - final;
    if (state >= 0 && d < -BAND_RING) {
      if (state === 1) ringing++;
      state = -1;
    } else if (state <= 0 && d > BAND_RING) {
      if (state === -1) ringing++;
      state = 1;
    }
  }
  let undershoot: number | null = null;
  if (peak > final + BAND_RING) {
    let mn = Infinity;
    for (let i = pt; i < n; i++) mn = Math.min(mn, y[i]!);
    undershoot = Math.max(0, (final - mn) * 100);
  } else undershoot = 0;
  return {
    rise: t10 !== null && t90 !== null ? t90 - t10 : null,
    latency50: t50 === null ? null : opts.spT50 !== undefined ? t50 - opts.spT50 : t50,
    latency5: t5,
    overshoot: Math.max(0, (peak - 1) * 100),
    peak,
    peakTime: pt,
    settle2: settle(0.02),
    settle5: settle(0.05),
    ringing,
    ssError: (final - 1) * 100,
    undershoot,
    bounceBack: null,
  };
}

const METRIC_KEYS: (keyof CurveMetrics)[] = ['rise', 'latency50', 'latency5', 'overshoot', 'peak', 'peakTime', 'settle2', 'settle5', 'ringing', 'ssError', 'undershoot', 'bounceBack'];

/** Median of each metric over a set of steps; settle times count "not settled" as missing and need half of the steps. */
export function medianMetrics(list: CurveMetrics[]): CurveMetrics | null {
  if (!list.length) return null;
  const out = {} as Record<keyof CurveMetrics, number | null>;
  for (const k of METRIC_KEYS) {
    const vals = list.map((m) => m[k]).filter((v): v is number => v !== null && Number.isFinite(v));
    const need = k === 'bounceBack' ? 1 : Math.ceil(list.length / 2);
    out[k] = vals.length >= need ? median(vals) : null;
  }
  return { ...(out as unknown as CurveMetrics), ringing: out.ringing ?? 0 };
}

interface RawStep {
  onset: number;
  edgeEnd: number;
  holdEnd: number;
  base: number;
  target: number;
}

/** Finds step inputs in a setpoint trace (indices into the signal). */
export function findSteps(sp: ArrayLike<number>, fs: number, o: StepOptionsV2 = {}): RawStep[] {
  const opt = { ...DEF, ...o };
  const n = sp.length;
  const ms = fs / 1000;
  const sm = smoothCentered(sp, Math.max(1, Math.round(2 * ms)));
  const pre = Math.max(2, Math.round(10 * ms));
  const basePre = Math.max(pre, Math.round(30 * ms));
  const maxEdge = Math.round(opt.maxEdgeMs * ms);
  const minHold = Math.round(opt.minHoldMs * ms);
  const horizon = Math.round(opt.horizonMs * ms);
  const cool = Math.round(opt.cooldownMs * ms);
  const thr = opt.minAccel;
  const der = (i: number) => (sm[i + 1]! - sm[i - 1]!) * (fs / 2);
  const out: RawStep[] = [];
  let lastEdgeEnd = 0;
  let i = pre + 1;
  while (i < n - minHold - 2) {
    const d0 = der(i);
    if (Math.abs(d0) < thr) {
      i++;
      continue;
    }
    const sign = Math.sign(d0);
    // the scan may resume in the middle of an edge (right after the previous hold): walk back to its start
    let onset = i;
    while (onset > lastEdgeEnd + 1 && onset > pre + 1 && sign * der(onset - 1) >= thr) onset--;
    let j = i;
    while (j < n - 2 && sign * der(j) >= thr && j - onset <= maxEdge) j++;
    if (j - onset > maxEdge) {
      // slow ramp: skip to its end
      while (j < n - 2 && sign * der(j) >= thr) j++;
      i = j + 1;
      continue;
    }
    const edgeEnd = j;
    let base = 0;
    for (let k = onset - pre; k < onset; k++) base += sp[k]!;
    base /= pre;
    const level = sm[edgeEnd]!;
    if (Math.abs(level - base) < opt.minSize) {
      i = edgeEnd + 1;
      continue;
    }
    const tol = Math.max(0.12 * Math.abs(level - base), 15);
    // the level before the step must have been held too (>= 30 ms), else it is the end of a blip or of another edge
    let held = true;
    for (let k = Math.max(0, onset - basePre); k < onset; k++) if (Math.abs(sm[k]! - base) > tol) held = false;
    if (!held) {
      i = edgeEnd + 1;
      continue;
    }
    let h = edgeEnd;
    while (h < n && Math.abs(sm[h]! - level) <= tol && h - onset < horizon) h++;
    if (h - edgeEnd < minHold) {
      i = Math.max(h, edgeEnd + 1);
      continue;
    }
    let target = 0;
    for (let k = edgeEnd; k < h; k++) target += sp[k]!;
    target /= h - edgeEnd;
    if (Math.abs(target - base) >= opt.minSize) out.push({ onset, edgeEnd, holdEnd: h, base, target });
    lastEdgeEnd = edgeEnd;
    i = Math.max(h, onset + cool);
  }
  return out;
}

const SIZE_BUCKETS: [StepBucket['id'], number, number][] = [
  ['small', 0, 300],
  ['mid', 300, 600],
  ['large', 600, Infinity],
];
const THR_BUCKETS: [StepBucket['id'], number, number][] = [
  ['low', 0, 35],
  ['midThr', 35, 65],
  ['high', 65, 101],
];

/** Full step analysis of one axis. `thr` (0..100 %) and `mask` (signals.badMask) are optional. */
export function analyzeAxisSteps(axis: AxisKey, sp: ArrayLike<number>, gy: ArrayLike<number>, fs: number, thr: Float32Array | null, mask: Uint8Array | null, o: StepOptionsV2 = {}): AxisSteps {
  const opt = { ...DEF, ...o };
  const ms = fs / 1000;
  // Wiener deconvolution (existing method), metrics on its normalised curve
  const w = stepResponse(sp, gy, fs);
  const wMetrics = w.step ? curveMetrics(w.step, { final: 1 }) : null;
  const wCurve = w.step ? w.step.slice(0, opt.horizonMs + 1) : null;

  const raw = findSteps(sp, fs, opt);
  const gs = smoothCentered(gy, Math.max(1, Math.round(2.5 * ms)));
  const list: DetectedStep[] = [];
  const good: { m: CurveMetrics; y: Float64Array; size: number; thr: number | null }[] = [];
  const excluded: Record<ExcludeReason, number> = { saturation: 0, crash: 0, idle: 0 };
  const pre = Math.max(2, Math.round(10 * ms));
  for (const s of raw) {
    const end = Math.min(s.holdEnd, s.onset + Math.round(opt.horizonMs * ms));
    let flags = 0;
    let tsum = 0;
    if (mask) for (let k = s.onset; k < end; k++) flags |= mask[k]!;
    if (thr) for (let k = s.onset; k < end; k++) tsum += thr[k]!;
    const tMean = thr ? tsum / (end - s.onset) : null;
    const reason: ExcludeReason | null = flags & BAD_GYRO_SAT ? 'crash' : flags & BAD_MOTOR_SAT ? 'saturation' : flags & BAD_IDLE ? 'idle' : null;
    let gb = 0;
    for (let k = s.onset - pre; k < s.onset; k++) gb += gs[k]!;
    gb /= pre;
    const span = s.target - gb;
    const rec: DetectedStep = { t: s.onset / fs, size: s.target - s.base, from: s.base, to: s.target, holdMs: (s.holdEnd - s.edgeEnd) / ms, throttle: tMean, excluded: reason, overshoot: null, rise: null, latency50: null };
    // previous move not settled (gyro far from the old setpoint): ambiguous step, skip silently
    if (Math.abs(gb - s.base) > 0.25 * Math.abs(s.target - s.base) || Math.abs(span) < 1) continue;
    if (reason) {
      excluded[reason]++;
      if (list.length < 200) list.push(rec);
      continue;
    }
    // resample to 1 ms from the onset
    const L = Math.floor((end - s.onset) / ms);
    const y = new Float64Array(L);
    let spT50: number | undefined;
    for (let k = 0; k < L; k++) {
      const pos = s.onset + k * ms;
      const i0 = Math.floor(pos);
      const f = pos - i0;
      const g = gs[i0]! * (1 - f) + gs[Math.min(i0 + 1, gs.length - 1)]! * f;
      y[k] = (g - gb) / span;
      if (spT50 === undefined) {
        const v = (sp[i0]! - s.base) / (s.target - s.base);
        if (v >= 0.5) spT50 = k;
      }
    }
    const m = curveMetrics(y, spT50 !== undefined ? { spT50 } : {});
    // return-to-centre step: late excursion past zero (after the fast overshoot has rung out) = I-term bounce-back
    if (Math.abs(s.target) < 0.15 * Math.abs(s.base)) {
      const from = Math.max(120, 2 * (m.peakTime ?? 0));
      let mx = 1;
      for (let k = from; k < L; k++) mx = Math.max(mx, y[k]!);
      m.bounceBack = from < L ? (mx - 1) * 100 : null;
    }
    rec.overshoot = m.overshoot;
    rec.rise = m.rise;
    rec.latency50 = m.latency50;
    if (list.length < 200) list.push(rec);
    good.push({ m, y, size: Math.abs(s.target - s.base), thr: tMean });
  }

  const curve = meanCurve(good.map((g) => g.y));
  const bucket = (defs: typeof SIZE_BUCKETS, val: (g: (typeof good)[number]) => number | null): StepBucket[] =>
    defs.map(([id, lo, hi]) => {
      const sel = good.filter((g) => {
        const v = val(g);
        return v !== null && v >= lo && v < hi;
      });
      return { id, lo, hi: Number.isFinite(hi) ? hi : 9999, n: sel.length, metrics: medianMetrics(sel.map((g) => g.m)), curve: meanCurve(sel.map((g) => g.y)) };
    });
  const bySize = bucket(SIZE_BUCKETS, (g) => g.size);
  const byThrottle = thr ? bucket(THR_BUCKETS, (g) => g.thr) : [];
  const dMetrics = medianMetrics(good.map((g) => g.m));

  let best: CurveMetrics | null = null;
  let source: AxisSteps['source'] = null;
  let confidence = 0;
  if (good.length >= 5 && dMetrics) {
    best = dMetrics;
    source = 'steps';
    confidence = clamp01(good.length / 15);
  } else if (wMetrics) {
    best = wMetrics;
    source = 'wiener';
    confidence = clamp01(w.windows / 30) * 0.8;
  }
  const tr = trackingDelay(sp, gy, fs);
  return {
    axis,
    wiener: { curve: wCurve, windows: w.windows, metrics: wMetrics },
    detected: { n: good.length, excluded, metrics: dMetrics, curve, list },
    bySize,
    byThrottle,
    best,
    source,
    confidence,
    trackingDelayMs: tr ? tr.ms : null,
    trackingCorr: tr ? tr.corr : null,
  };
}

/** Mean of 1 ms response curves, rounded to 4 decimals; only points covered by at least half of them. Null when empty. */
export function meanCurve(list: ArrayLike<number>[]): number[] | null {
  if (!list.length) return null;
  const maxL = Math.max(...list.map((y) => y.length));
  const sum = new Float64Array(maxL);
  const cnt = new Uint32Array(maxL);
  for (const y of list) for (let k = 0; k < y.length; k++) {
    sum[k] = sum[k]! + y[k]!;
    cnt[k] = cnt[k]! + 1;
  }
  const out: number[] = [];
  const need = Math.max(1, Math.ceil(list.length / 2));
  for (let k = 0; k < maxL && cnt[k]! >= need; k++) out.push(Math.round((sum[k]! / cnt[k]!) * 1e4) / 1e4);
  return out;
}

/** Setpoint-to-gyro delay [ms] by cross-correlation on a ~1 kHz copy (0..60 ms lags); null when there is no stick activity. */
export function trackingDelay(sp: ArrayLike<number>, gy: ArrayLike<number>, fs: number): { ms: number; corr: number } | null {
  const f = Math.max(1, Math.round(fs / 1000));
  const a = decimate(sp, f);
  const b = decimate(gy, f);
  const rate = fs / f;
  let act = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]!) > 40) act++;
  if (act < rate * 1) return null;
  const r = bestLag(a, b, Math.round(0.06 * rate), 0, a.length, 0.3);
  return r ? { ms: (r.lag / rate) * 1000, corr: r.corr } : null;
}
