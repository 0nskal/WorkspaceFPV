/**
 * CHIRP system identification (Betaflight 2026 / master with USE_CHIRP).
 *
 * In CHIRP flight mode the firmware adds an exponential sine sweep to the rate setpoint of one axis (roll, then pitch,
 * then yaw on each new activation). The logged setpoint already contains the sweep (pid.c stores previousPidSetpoint
 * after adding it), so the closed-loop tracking response is T(f) = gyro / setpoint on the excited axis.
 * With debug_mode = CHIRP: debug[0] phase, debug[1] axis (-1 = inactive), debug[2] frequency [0.1 Hz],
 * debug[3] excitation x1000.
 *
 * From T: sensitivity S = 1 - T (error / setpoint; disturbance sensitivity only when feedforward is off),
 * open loop L = T / (1 - T), phase and gain margin, bandwidth, peaks, coherence and a step response (inverse FFT of T).
 * Recommendations are for review only: they are never applied automatically. Pure; runs in the worker.
 */
import { advice, type Advice } from './advice';
import { fft, hann, nextPow2 } from './fft';
import { curveMetrics } from './step2';
import type { LogData } from './types';

export type ChirpAxisIndex = 0 | 1 | 2;

export interface ChirpRun {
  axis: ChirpAxisIndex;
  /** Row range [i0, i1) in the log. */
  i0: number;
  i1: number;
  seconds: number;
  /** Swept frequency range seen in debug[2] [Hz]. */
  fFrom: number;
  fTo: number;
  /** Reached at least 90 % of the configured (or default) end frequency. */
  complete: boolean;
}

export interface BodePoint {
  hz: number;
  /** Closed-loop tracking T = gyro / setpoint. */
  tDb: number;
  tDeg: number;
  /** Sensitivity S = 1 - T. */
  sDb: number;
  /** Open loop L = T / (1 - T). */
  lDb: number;
  lDeg: number;
  /** Magnitude-squared coherence 0..1. */
  coh: number;
}

export type ChirpRating = 'good' | 'fair' | 'bad';

export interface ChirpAxis {
  axis: ChirpAxisIndex;
  runs: number;
  seconds: number;
  bode: BodePoint[];
  /** -3 dB bandwidth of T [Hz]. */
  bandwidthHz: number | null;
  tPeakDb: number;
  tPeakHz: number;
  sMaxDb: number;
  sMaxHz: number;
  crossoverHz: number | null;
  phaseMarginDeg: number | null;
  gainMarginDb: number | null;
  /** Mean coherence over the trusted band. */
  coherence: number;
  /** Step response 0..500 ms every 1 ms (501 points) from T, or null. */
  step: number[] | null;
  overshoot: number | null;
  riseMs: number | null;
  rating: ChirpRating;
}

export interface ChirpConfig {
  ampRoll: number;
  ampPitch: number;
  ampYaw: number;
  fStartHz: number;
  fEndHz: number;
  seconds: number;
  repeat: number;
  /** True when at least one chirp_* key was in the header. */
  fromHeader: boolean;
}

export interface ChirpResult {
  runs: ChirpRun[];
  axes: [ChirpAxis | null, ChirpAxis | null, ChirpAxis | null];
  config: ChirpConfig;
  /** Feedforward was on during the test: S and the margins are then only approximate. */
  ffOn: boolean;
  advice: Advice[];
}

/** Betaflight defaults (pid.c, pidProfile). */
export const CHIRP_DEFAULTS: ChirpConfig = { ampRoll: 230, ampPitch: 230, ampYaw: 180, fStartHz: 0.2, fEndHz: 600, seconds: 20, repeat: 1, fromHeader: false };

/** Thresholds (see the expert tips): |S| above 6 dB amplifies disturbances, phase margin below 30 deg rings. */
export const S_MAX_FAIR_DB = 6;
export const S_MAX_BAD_DB = 8;
export const PM_GOOD_DEG = 45;
export const PM_BAD_DEG = 30;
export const T_PEAK_FAIR_DB = 2;
export const COH_MIN = 0.8;
/** Points below this coherence are not used for peaks and margins. */
const COH_TRUST = 0.6;

const AXIS_NAMES = ['roll', 'pitch', 'yaw'] as const;

export function chirpConfig(raw: Record<string, string> | undefined): ChirpConfig {
  const c = { ...CHIRP_DEFAULTS };
  if (!raw) return c;
  const n = (k: string) => {
    const v = raw[k];
    if (v === undefined) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const set = (k: string, f: (v: number) => void) => {
    const v = n(k);
    if (v !== null) {
      f(v);
      c.fromHeader = true;
    }
  };
  set('chirp_amplitude_roll', (v) => (c.ampRoll = v));
  set('chirp_amplitude_pitch', (v) => (c.ampPitch = v));
  set('chirp_amplitude_yaw', (v) => (c.ampYaw = v));
  set('chirp_frequency_start_deci_hz', (v) => (c.fStartHz = v / 10));
  set('chirp_frequency_end_deci_hz', (v) => (c.fEndHz = v / 10));
  set('chirp_time_seconds', (v) => (c.seconds = v));
  set('chirp_repeat', (v) => (c.repeat = v));
  return c;
}

/** True when debug[1..2] look like CHIRP debug data (axis -1..2, frequency in 0.1 Hz) or the header says so. */
export function hasChirpDebug(log: LogData): boolean {
  const d = log.debug;
  if (!d || d.length < 3) return false;
  const ax = d[1]!;
  const fr = d[2]!;
  const n = ax.length;
  if (n < 100) return false;
  let odd = 0;
  let active = 0;
  let freqOk = 0;
  for (let i = 0; i < n; i++) {
    const a = ax[i]!;
    if (a !== -1 && a !== 0 && a !== 1 && a !== 2) odd++;
    else if (a >= 0) {
      active++;
      if (fr[i]! >= 1 && fr[i]! <= 10000) freqOk++;
    }
  }
  const named = log.settings?.debugModeName === 'CHIRP';
  if (odd > n * 0.005) return false;
  if (!active || freqOk < active * 0.6) return false;
  return named || active >= log.fs; // at least 1 s of chirp
}

/** Contiguous stretches with one active chirp axis (at least 2 s). */
export function findChirpRuns(log: LogData, cfg: ChirpConfig = CHIRP_DEFAULTS): ChirpRun[] {
  if (!hasChirpDebug(log)) return [];
  const ax = log.debug![1]!;
  const fr = log.debug![2]!;
  const out: ChirpRun[] = [];
  const n = ax.length;
  let i = 0;
  while (i < n) {
    const a = ax[i]!;
    if (a < 0 || a > 2) {
      i++;
      continue;
    }
    let j = i;
    let fLo = Infinity;
    let fHi = 0;
    while (j < n && ax[j] === a) {
      const f = fr[j]! / 10;
      if (f > 0) {
        if (f < fLo) fLo = f;
        if (f > fHi) fHi = f;
      }
      j++;
    }
    const seconds = (j - i) / log.fs;
    if (seconds >= 2 && fHi > 0) out.push({ axis: a as ChirpAxisIndex, i0: i, i1: j, seconds, fFrom: fLo, fTo: fHi, complete: fHi >= 0.9 * Math.min(cfg.fEndHz, log.fs / 2) });
    i = j;
  }
  return out;
}

interface Spectra {
  nfft: number;
  df: number;
  segs: number;
  sxx: Float64Array;
  syy: Float64Array;
  sxyRe: Float64Array;
  sxyIm: Float64Array;
}

function newSpectra(nfft: number, fs: number): Spectra {
  const h = nfft / 2 + 1;
  return { nfft, df: fs / nfft, segs: 0, sxx: new Float64Array(h), syy: new Float64Array(h), sxyRe: new Float64Array(h), sxyIm: new Float64Array(h) };
}

/** Accumulates Welch cross spectra (Hann, 50 % overlap, mean removed per segment) of x -> y over rows [i0, i1). */
function accumulate(sp: Spectra, x: ArrayLike<number>, y: ArrayLike<number>, i0: number, i1: number): void {
  const n = sp.nfft;
  const w = hann(n);
  const xr = new Float64Array(n);
  const xi = new Float64Array(n);
  const yr = new Float64Array(n);
  const yi = new Float64Array(n);
  for (let s = i0; s + n <= i1; s += n >> 1) {
    let mx = 0;
    let my = 0;
    for (let k = 0; k < n; k++) {
      mx += x[s + k]!;
      my += y[s + k]!;
    }
    mx /= n;
    my /= n;
    for (let k = 0; k < n; k++) {
      xr[k] = (x[s + k]! - mx) * w[k]!;
      yr[k] = (y[s + k]! - my) * w[k]!;
      xi[k] = 0;
      yi[k] = 0;
    }
    fft(xr, xi);
    fft(yr, yi);
    for (let k = 0; k <= n / 2; k++) {
      sp.sxx[k] += xr[k]! * xr[k]! + xi[k]! * xi[k]!;
      sp.syy[k] += yr[k]! * yr[k]! + yi[k]! * yi[k]!;
      // conj(X) * Y
      sp.sxyRe[k] += xr[k]! * yr[k]! + xi[k]! * yi[k]!;
      sp.sxyIm[k] += xr[k]! * yi[k]! - xi[k]! * yr[k]!;
    }
    sp.segs++;
  }
}

const db = (m: number) => 20 * Math.log10(Math.max(m, 1e-9));
const deg = (re: number, im: number) => (Math.atan2(im, re) * 180) / Math.PI;

/** Log-frequency grid of T / S / L from accumulated spectra over [fLo, fHi]. */
function bodeOf(sp: Spectra, fLo: number, fHi: number, perDecade = 24): BodePoint[] {
  const out: BodePoint[] = [];
  const decades = Math.log10(fHi / fLo);
  const nb = Math.max(8, Math.round(decades * perDecade));
  let prevT: number | null = null;
  let prevL: number | null = null;
  let tUnwrap = 0;
  let lUnwrap = 0;
  for (let b = 0; b < nb; b++) {
    const lo = fLo * 10 ** ((b * decades) / nb);
    const hi = fLo * 10 ** (((b + 1) * decades) / nb);
    let k0 = Math.ceil(lo / sp.df);
    let k1 = Math.floor(hi / sp.df);
    if (k1 < k0) k0 = k1 = Math.round(Math.sqrt(lo * hi) / sp.df);
    k1 = Math.min(k1, sp.sxx.length - 1);
    if (k0 < 1 || k0 > k1) continue;
    let sxx = 0;
    let syy = 0;
    let re = 0;
    let im = 0;
    for (let k = k0; k <= k1; k++) {
      sxx += sp.sxx[k]!;
      syy += sp.syy[k]!;
      re += sp.sxyRe[k]!;
      im += sp.sxyIm[k]!;
    }
    if (sxx <= 0 || syy <= 0) continue;
    const tRe = re / sxx;
    const tIm = im / sxx;
    const coh = Math.min(1, (re * re + im * im) / (sxx * syy));
    const sRe = 1 - tRe;
    const sIm = -tIm;
    const s2 = sRe * sRe + sIm * sIm;
    const lRe = (tRe * sRe + tIm * sIm) / Math.max(s2, 1e-12);
    const lIm = (tIm * sRe - tRe * sIm) / Math.max(s2, 1e-12);
    // unwrapped phases
    let tp = deg(tRe, tIm);
    if (prevT !== null) {
      while (tp + tUnwrap - prevT > 180) tUnwrap -= 360;
      while (tp + tUnwrap - prevT < -180) tUnwrap += 360;
    }
    tp += tUnwrap;
    prevT = tp;
    let lp = deg(lRe, lIm);
    if (prevL !== null) {
      while (lp + lUnwrap - prevL > 180) lUnwrap -= 360;
      while (lp + lUnwrap - prevL < -180) lUnwrap += 360;
    }
    lp += lUnwrap;
    prevL = lp;
    out.push({ hz: Math.sqrt(lo * hi), tDb: db(Math.hypot(tRe, tIm)), tDeg: tp, sDb: db(Math.sqrt(s2)), lDb: db(Math.hypot(lRe, lIm)), lDeg: lp, coh });
  }
  return out;
}

/** Step response (0..500 ms, 1 ms) from the fine-grid T, Wiener-weighted by coherence; T = 1 below fLo, 0 above fHi. */
function stepFromSpectra(sp: Spectra, fs: number, fLo: number, fHi: number): number[] | null {
  const n = sp.nfft;
  if (n * (1 / fs) < 0.6) return null;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  // ratio of sums over a ~1/6-octave window around each bin: smooths the estimate without biasing it
  const half = n / 2;
  const cum = (a: Float64Array) => {
    const c = new Float64Array(a.length + 1);
    for (let i = 0; i < a.length; i++) c[i + 1] = c[i]! + a[i]!;
    return c;
  };
  const cXX = cum(sp.sxx);
  const cYY = cum(sp.syy);
  const cRe = cum(sp.sxyRe);
  const cIm = cum(sp.sxyIm);
  for (let k = 0; k <= half; k++) {
    const f = k * sp.df;
    let hr = 1;
    let hi = 0;
    if (f >= fLo) {
      const w = Math.max(1, Math.round(0.06 * k));
      const a = Math.max(1, k - w);
      const b = Math.min(half, k + w) + 1;
      const sxx = cXX[b]! - cXX[a]!;
      const syy = cYY[b]! - cYY[a]!;
      const xr = cRe[b]! - cRe[a]!;
      const xi = cIm[b]! - cIm[a]!;
      if (sxx > 0 && syy > 0) {
        const c = Math.min(1, (xr * xr + xi * xi) / (sxx * syy));
        const wt = c / (c + 0.05);
        hr = (xr / sxx) * wt;
        hi = (xi / sxx) * wt;
      } else {
        hr = 0;
      }
    }
    // taper to zero above the trusted band
    const taper = f <= fHi ? 1 : f >= fHi * 1.5 ? 0 : 0.5 * (1 + Math.cos((Math.PI * (f - fHi)) / (0.5 * fHi)));
    re[k] = hr * taper;
    im[k] = hi * taper;
    if (k > 0 && k < half) {
      re[n - k] = re[k]!;
      im[n - k] = -im[k]!;
    }
  }
  fft(re, im, true);
  const step = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += re[i]!;
    step[i] = acc;
  }
  const out: number[] = [];
  for (let ms = 0; ms <= 500; ms++) {
    const t = (ms / 1000) * fs;
    const i = Math.floor(t);
    if (i + 1 >= n) return null;
    out.push(step[i]! + (step[i + 1]! - step[i]!) * (t - i));
  }
  return out;
}

/** Linear interpolation of the frequency where `f(i)` crosses `level` between points i-1 and i (log frequency). */
function crossHz(a: BodePoint, b: BodePoint, va: number, vb: number, level: number): number {
  const t = va === vb ? 0 : (level - va) / (vb - va);
  return 10 ** (Math.log10(a.hz) + t * (Math.log10(b.hz) - Math.log10(a.hz)));
}

export function analyzeChirpAxis(log: LogData, runs: ChirpRun[], cfg: ChirpConfig = CHIRP_DEFAULTS): ChirpAxis | null {
  if (!runs.length) return null;
  const axis = runs[0]!.axis;
  const x = log.setpoint[axis];
  const y = log.gyro[axis];
  if (!x || !y) return null;
  const fs = log.fs;
  const longest = Math.max(...runs.map((r) => r.i1 - r.i0));
  // ~0.5 Hz resolution, at least 4 segments in the longest run
  let nfft = nextPow2(Math.round(fs * 2));
  while (nfft > 256 && nfft * 2.5 > longest) nfft >>= 1;
  if (nfft < 256) return null;
  const sp = newSpectra(nfft, fs);
  for (const r of runs) accumulate(sp, x, y, r.i0, r.i1);
  if (sp.segs < 2) return null;
  const fFrom = Math.min(...runs.map((r) => r.fFrom));
  const fTo = Math.max(...runs.map((r) => r.fTo));
  const fLo = Math.max(1, fFrom, 2 * sp.df);
  const fHi = Math.min(fTo, 0.4 * fs, 500);
  if (fHi <= fLo * 2) return null;
  const bode = bodeOf(sp, fLo, fHi);
  if (bode.length < 6) return null;
  const trusted = bode.filter((p) => p.coh >= COH_TRUST);
  const pool = trusted.length >= 4 ? trusted : bode;
  // peaks
  let tPeak = pool[0]!;
  let sMax = pool[0]!;
  for (const p of pool) {
    if (p.tDb > tPeak.tDb) tPeak = p;
    if (p.sDb > sMax.sDb) sMax = p;
  }
  // -3 dB bandwidth of T
  let bandwidthHz: number | null = null;
  for (let i = 1; i < bode.length; i++) {
    const a = bode[i - 1]!;
    const b = bode[i]!;
    if (a.tDb >= -3 && b.tDb < -3) {
      bandwidthHz = crossHz(a, b, a.tDb, b.tDb, -3);
      break;
    }
  }
  // gain crossover (|L| = 0 dB, falling) and phase margin
  let crossoverHz: number | null = null;
  let phaseMarginDeg: number | null = null;
  for (let i = 1; i < bode.length; i++) {
    const a = bode[i - 1]!;
    const b = bode[i]!;
    if (a.lDb >= 0 && b.lDb < 0) {
      crossoverHz = crossHz(a, b, a.lDb, b.lDb, 0);
      const t = (Math.log10(crossoverHz) - Math.log10(a.hz)) / (Math.log10(b.hz) - Math.log10(a.hz));
      const ph = a.lDeg + t * (b.lDeg - a.lDeg);
      const principal = ((((ph + 180) % 360) + 360) % 360) - 180;
      phaseMarginDeg = 180 - Math.abs(principal);
      break;
    }
  }
  // gain margin: |L| where the principal phase of L passes +-180 (trusted points only)
  let gainMarginDb: number | null = null;
  const pr = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
  for (let i = 1; i < bode.length; i++) {
    const a = bode[i - 1]!;
    const b = bode[i]!;
    if (a.coh < COH_TRUST || b.coh < COH_TRUST) continue;
    if (crossoverHz !== null && b.hz < crossoverHz) continue;
    const pa = pr(a.lDeg);
    const pb = pr(b.lDeg);
    if (Math.abs(pa) > 90 && Math.abs(pb) > 90 && Math.sign(pa) !== Math.sign(pb)) {
      gainMarginDb = -(a.lDb + b.lDb) / 2;
      break;
    }
  }
  const bandStart = Math.max(fLo, 3);
  const bandEnd = Math.min(fHi, bandwidthHz ? bandwidthHz * 1.5 : 100);
  const inBand = bode.filter((p) => p.hz >= bandStart && p.hz <= bandEnd);
  const coherence = inBand.length ? inBand.reduce((s, p) => s + p.coh, 0) / inBand.length : 0;
  const step = stepFromSpectra(sp, fs, fLo, fHi);
  const m = step ? curveMetrics(step, { final: 1 }) : null;
  const sBad = sMax.sDb > S_MAX_BAD_DB || (phaseMarginDeg !== null && phaseMarginDeg < PM_BAD_DEG);
  const sFair = sMax.sDb > S_MAX_FAIR_DB || (phaseMarginDeg !== null && phaseMarginDeg < PM_GOOD_DEG) || tPeak.tDb > T_PEAK_FAIR_DB;
  void cfg;
  return {
    axis,
    runs: runs.length,
    seconds: runs.reduce((s, r) => s + r.seconds, 0),
    bode,
    bandwidthHz,
    tPeakDb: tPeak.tDb,
    tPeakHz: tPeak.hz,
    sMaxDb: sMax.sDb,
    sMaxHz: sMax.hz,
    crossoverHz,
    phaseMarginDeg,
    gainMarginDb,
    coherence,
    step,
    overshoot: m?.overshoot ?? null,
    riseMs: m?.rise ?? null,
    rating: sBad ? 'bad' : sFair ? 'fair' : 'good',
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Full CHIRP analysis of a log, or null when it has no chirp data. */
export function analyzeChirp(log: LogData): ChirpResult | null {
  const cfg = chirpConfig(log.settings?.raw);
  const runs = findChirpRuns(log, cfg);
  if (!runs.length) return null;
  const axes: ChirpResult['axes'] = [null, null, null];
  for (const a of [0, 1, 2] as const) axes[a] = analyzeChirpAxis(log, runs.filter((r) => r.axis === a), cfg);
  const ff = log.settings?.ff;
  const ffOn = !!ff && (ff[0] > 0 || ff[1] > 0);
  const out: Advice[] = [];
  const conf = (ax: ChirpAxis) => Math.max(0.2, Math.min(1, ax.coherence));
  for (const ax of axes) {
    if (!ax) continue;
    const p = { axis: AXIS_NAMES[ax.axis], fc: ax.crossoverHz === null ? '?' : Math.round(ax.crossoverHz), s: r1(ax.sMaxDb), sHz: Math.round(ax.sMaxHz), pm: ax.phaseMarginDeg === null ? '?' : Math.round(ax.phaseMarginDeg), bw: ax.bandwidthHz === null ? '?' : Math.round(ax.bandwidthHz), t: r1(ax.tPeakDb), tHz: Math.round(ax.tPeakHz), coh: Math.round(ax.coherence * 100) };
    if (ax.coherence < COH_MIN) out.push(advice(`chirp.lowCoh.${p.axis}`, 'chirp.lowCoh', 'info', 0.9, { params: p }));
    if (ax.sMaxDb > S_MAX_FAIR_DB) {
      // hump above the crossover: D / filter delay; at or below it: P against D or I wind-up
      out.push(advice(`chirp.sens.${p.axis}`, ax.sMaxHz >= 1.2 * (ax.crossoverHz ?? 40) ? 'chirp.sensHigh' : 'chirp.sensLow', ax.sMaxDb > S_MAX_BAD_DB ? 'warn' : 'suggest', conf(ax), { params: p, approximate: ffOn }));
    }
    if (ax.phaseMarginDeg !== null && ax.phaseMarginDeg < PM_GOOD_DEG) out.push(advice(`chirp.pm.${p.axis}`, 'chirp.lowPm', ax.phaseMarginDeg < PM_BAD_DEG ? 'warn' : 'suggest', conf(ax), { params: p, approximate: ffOn }));
    if (ax.tPeakDb > T_PEAK_FAIR_DB && ax.sMaxDb <= S_MAX_FAIR_DB) out.push(advice(`chirp.tpeak.${p.axis}`, 'chirp.tPeak', 'suggest', conf(ax), { params: p }));
    if (ax.rating === 'good' && ax.phaseMarginDeg !== null && ax.phaseMarginDeg >= 60 && ax.sMaxDb < 4) out.push(advice(`chirp.room.${p.axis}`, 'chirp.room', 'info', conf(ax), { params: p }));
    if (ax.rating === 'good' && !out.some((a) => a.id.endsWith(`.${p.axis}`) && a.severity !== 'info')) out.push(advice(`chirp.ok.${p.axis}`, 'chirp.ok', 'ok', conf(ax), { params: p }));
  }
  for (const r of runs) if (!r.complete) out.push(advice(`chirp.incomplete.${r.axis}.${r.i0}`, 'chirp.incomplete', 'info', 1, { params: { axis: AXIS_NAMES[r.axis], hz: Math.round(r.fTo), s: r1(r.seconds) } }));
  const missing = ([0, 1, 2] as const).filter((a) => !runs.some((r) => r.axis === a));
  if (missing.length) out.push(advice('chirp.missingAxes', 'chirp.missingAxes', 'info', 1, { params: { axes: missing.map((a) => AXIS_NAMES[a]).join(', ') } }));
  if (ffOn) out.push(advice('chirp.ffOn', 'chirp.ffOn', 'info', 1, { cli: ['set simplified_feedforward_gain = 0', 'simplified_tuning apply'] }));
  return { runs, axes, config: cfg, ffOn, advice: out };
}

/** CLI that prepares a CHIRP test flight (debug mode + 2 kHz logging); the CHIRP mode switch is set on the Modes tab. */
export function chirpSetupCli(opts: { bbPDenom?: number | null } = {}): string[] {
  const cli = ['set debug_mode = CHIRP'];
  if (opts.bbPDenom !== undefined && opts.bbPDenom !== null && opts.bbPDenom > 4) cli.push('set blackbox_sample_rate = 1/4');
  return cli;
}
