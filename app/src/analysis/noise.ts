/**
 * Noise analysis: throttle spectrograms (frequency x throttle %) of the filtered gyro, the unfiltered gyro and the
 * D-term; noise floor (lower quartile), peaks over the floor, and ridge tracking across throttle bins to tell motor
 * noise (frequency rises with throttle) from frame resonance (constant frequency). Pure; runs in the worker.
 */
import { fft, hann, nextPow2 } from './fft';
import { BAD_GYRO_SAT, BAD_IDLE, median, quantile } from './signals';
import type { LogData } from './types';

export type NoiseSignal = 'gyro' | 'gyroUnfilt' | 'dterm';
export type RidgeKind = 'motor' | 'frame' | 'unknown';

export interface NoisePeak {
  hz: number;
  /** Level [dB re 1 unit^2/Hz]. */
  db: number;
  /** Height over the noise floor [dB]; >= 6 is a peak, >= 12 a resonance. */
  prom: number;
  resonance: boolean;
  kind: RidgeKind;
}

export interface RidgePoint {
  /** Throttle bin centre [%]. */
  thr: number;
  hz: number;
  prom: number;
}

export interface Ridge {
  kind: RidgeKind;
  meanHz: number;
  /** Fitted slope [Hz per throttle %]. */
  slopeHzPerPct: number;
  /** Fitted frequency at the lowest / highest throttle of the ridge. */
  hzAtLow: number;
  hzAtHigh: number;
  thrLow: number;
  thrHigh: number;
  maxProm: number;
  points: RidgePoint[];
}

export interface Spectrogram {
  signal: NoiseSignal;
  df: number;
  maxHz: number;
  /** Width of one throttle bin [%]. */
  binPct: number;
  /** FFT segments per throttle bin (0 = no data). */
  counts: number[];
  /** dB per throttle bin x frequency bin; an empty row when the bin has no data. */
  db: number[][];
  /** Throttle-averaged spectrum [dB] over all usable segments. */
  spectrum: number[];
  /** Lower quartile of `spectrum` over 30 Hz..maxHz [dB]. */
  floorDb: number;
  peaks: NoisePeak[];
  ridges: Ridge[];
  /** Band RMS [signal units]: 100 Hz..maxHz (noise) and 2..50 Hz (flight motion). */
  hfRms: number;
  lfRms: number;
}

export interface FrameBands {
  inches: number | null;
  /** Approximate bands by frame size (rule of thumb, scaled from 5"). */
  propwash: [number, number];
  frame: [number, number];
  motorHover: [number, number];
}

export interface NoiseAnalysis {
  gyro: Spectrogram | null;
  gyroUnfilt: Spectrogram | null;
  dterm: Spectrogram | null;
  /** Where the unfiltered gyro came from. */
  unfiltSource: 'gyroUnfilt' | 'debug' | null;
  bands: FrameBands;
}

export const PEAK_DB = 6;
export const RESONANCE_DB = 12;
const MIN_HZ = 30;

/** Approximate noise bands for a frame size (5" reference: propwash 20-90 Hz, frame 100-250 Hz, motor at hover 150-300 Hz). */
export function frameBands(inches?: number | null): FrameBands {
  const k = inches && inches > 0 ? Math.sqrt(5 / inches) : 1;
  const kf = inches && inches > 0 ? 5 / inches : 1;
  const r = (v: number) => Math.round(v);
  return {
    inches: inches && inches > 0 ? inches : null,
    propwash: [r(20 * k), r(90 * k)],
    frame: [r(100 * kf), r(250 * kf)],
    motorHover: [r(150 * kf), r(300 * kf)],
  };
}

export interface SpectrogramOptions {
  bins?: number;
  maxHz?: number;
  mask?: Uint8Array | null;
  /** Max throttle spread inside one FFT segment [%] for the segment to count in a throttle bin. */
  maxSpread?: number;
  maxSegments?: number;
}

/** Spectrogram of the summed power of the given channels (e.g. roll + pitch) against throttle. */
export function spectrogram(signal: NoiseSignal, xs: ArrayLike<number>[], thr: Float32Array | null, fs: number, o: SpectrogramOptions = {}): Spectrogram {
  const bins = o.bins ?? 20;
  const binPct = 100 / bins;
  const nfft = Math.max(128, nextPow2(fs / 8));
  const df = fs / nfft;
  const maxHz = Math.min(o.maxHz ?? 1000, fs / 2 - df);
  const nb = Math.floor(maxHz / df) + 1;
  const hop = nfft / 2;
  const n = Math.min(...xs.map((x) => x.length));
  const total = Math.max(0, Math.floor((n - nfft) / hop) + 1);
  const stride = Math.max(1, Math.ceil(total / (o.maxSegments ?? 4000)));
  const w = hann(nfft);
  let wp = 0;
  for (let i = 0; i < nfft; i++) wp += w[i]! * w[i]!;
  const scale = 2 / (fs * wp);
  const rows = Array.from({ length: bins }, () => new Float64Array(nb));
  const counts = new Array<number>(bins).fill(0);
  const all = new Float64Array(nb);
  let allCount = 0;
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const seg = new Float64Array(nb);
  const maxSpread = o.maxSpread ?? 8;
  const mask = o.mask ?? null;
  for (let s = 0; s < total; s += stride) {
    const off = s * hop;
    if (mask) {
      let bad = 0;
      for (let i = off; i < off + nfft; i += 8) bad |= mask[i]!;
      if (bad & (BAD_GYRO_SAT | BAD_IDLE)) continue;
    }
    seg.fill(0);
    for (const x of xs) {
      let mean = 0;
      for (let i = 0; i < nfft; i++) mean += x[off + i]!;
      mean /= nfft;
      for (let i = 0; i < nfft; i++) {
        re[i] = (x[off + i]! - mean) * w[i]!;
        im[i] = 0;
      }
      fft(re, im);
      for (let k = 0; k < nb; k++) seg[k] = seg[k]! + (re[k]! * re[k]! + im[k]! * im[k]!) * scale;
    }
    for (let k = 0; k < nb; k++) all[k] = all[k]! + seg[k]!;
    allCount++;
    if (thr) {
      let lo = Infinity;
      let hi = -Infinity;
      let sum = 0;
      for (let i = off; i < off + nfft; i++) {
        const v = thr[i]!;
        sum += v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo <= maxSpread) {
        const b = Math.min(bins - 1, Math.max(0, Math.floor(sum / nfft / binPct)));
        const row = rows[b]!;
        for (let k = 0; k < nb; k++) row[k] = row[k]! + seg[k]!;
        counts[b]!++;
      }
    }
  }
  const toDb = (v: number) => Math.round(10 * Math.log10(Math.max(v, 1e-12)) * 100) / 100;
  const spectrum = Array.from(all, (v) => toDb(allCount ? v / allCount : 0));
  const db = rows.map((r, b) => (counts[b]! ? Array.from(r, (v) => toDb(v / counts[b]!)) : []));
  const k0 = Math.ceil(MIN_HZ / df);
  const floorDb = quantile(spectrum.slice(k0), 0.25) ?? -120;
  const band = (lo: number, hi: number) => {
    let s = 0;
    for (let k = Math.max(1, Math.ceil(lo / df)); k <= Math.min(nb - 1, Math.floor(hi / df)); k++) s += allCount ? all[k]! / allCount : 0;
    return Math.sqrt(s * df);
  };
  const peaksRaw = peaksOverFloor(spectrum, df, floorDb, MIN_HZ, maxHz);
  const ridges = trackRidges(db, counts, df, binPct, maxHz);
  const peaks: NoisePeak[] = peaksRaw.map((p) => ({ ...p, resonance: p.prom >= RESONANCE_DB, kind: classifyPeak(p.hz, ridges) }));
  return { signal, df, maxHz, binPct, counts, db, spectrum, floorDb, peaks, ridges, hfRms: band(100, maxHz), lfRms: band(2, 50) };
}

/** Local maxima >= PEAK_DB over the floor that also stand >= 3 dB over their +-40 Hz neighbourhood; merged within 15 Hz. */
export function peaksOverFloor(db: ArrayLike<number>, df: number, floor: number, minHz: number, maxHz: number, max = 8): { hz: number; db: number; prom: number }[] {
  const n = db.length;
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) sm[i] = (db[Math.max(0, i - 1)]! + db[i]! + db[Math.min(n - 1, i + 1)]!) / 3;
  const near = Math.max(2, Math.round(40 / df));
  const out: { hz: number; db: number; prom: number }[] = [];
  for (let i = Math.max(1, Math.ceil(minHz / df)); i <= Math.min(n - 2, Math.floor(maxHz / df)); i++) {
    if (!(sm[i]! > sm[i - 1]! && sm[i]! >= sm[i + 1]!)) continue;
    const prom = sm[i]! - floor;
    if (prom < PEAK_DB) continue;
    const side: number[] = [];
    for (let j = Math.max(0, i - near); j <= Math.min(n - 1, i + near); j++) if (Math.abs(j - i) > 2) side.push(sm[j]!);
    const loc = sm[i]! - (median(side) ?? sm[i]!);
    if (loc < 3) continue;
    // parabolic interpolation of the peak frequency
    const den = sm[i - 1]! - 2 * sm[i]! + sm[i + 1]!;
    const frac = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (sm[i - 1]! - sm[i + 1]!)) / den)) : 0;
    out.push({ hz: (i + frac) * df, db: sm[i]!, prom });
  }
  out.sort((a, b) => b.prom - a.prom);
  const kept: typeof out = [];
  for (const p of out) if (!kept.some((k) => Math.abs(k.hz - p.hz) < 15)) kept.push(p);
  return kept.slice(0, max);
}

/** Links per-throttle-bin peaks into ridges and classifies them by the fitted slope. */
export function trackRidges(db: number[][], counts: number[], df: number, binPct: number, maxHz: number): Ridge[] {
  type Open = { points: RidgePoint[]; lastBin: number; lastHz: number };
  const open: Open[] = [];
  for (let b = 0; b < db.length; b++) {
    const row = db[b]!;
    if (!row.length || counts[b]! < 2) continue;
    const floor = quantile(row.slice(Math.ceil(MIN_HZ / df)), 0.25) ?? -120;
    const pk = peaksOverFloor(row, df, floor, MIN_HZ, maxHz, 6);
    const used = new Set<Open>();
    for (const p of pk) {
      let best: Open | null = null;
      let bestD = Infinity;
      for (const r of open) {
        if (used.has(r) || b - r.lastBin > 2) continue;
        const d = Math.abs(r.lastHz - p.hz);
        if (d <= Math.max(20, 0.2 * p.hz) && d < bestD) {
          best = r;
          bestD = d;
        }
      }
      const pt = { thr: (b + 0.5) * binPct, hz: p.hz, prom: p.prom };
      if (best) {
        best.points.push(pt);
        best.lastBin = b;
        best.lastHz = p.hz;
        used.add(best);
      } else {
        const r = { points: [pt], lastBin: b, lastHz: p.hz };
        open.push(r);
        used.add(r);
      }
    }
  }
  const out: Ridge[] = [];
  for (const r of open) {
    if (r.points.length < 3) continue;
    const pts = r.points;
    const mx = pts.reduce((s, p) => s + p.thr, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.hz, 0) / pts.length;
    let sxx = 0;
    let sxy = 0;
    for (const p of pts) {
      sxx += (p.thr - mx) ** 2;
      sxy += (p.thr - mx) * (p.hz - my);
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    const thrLow = pts[0]!.thr;
    const thrHigh = pts[pts.length - 1]!.thr;
    const span = thrHigh - thrLow;
    const rel = (slope * 100) / my;
    const kind: RidgeKind = span >= 15 && rel >= 0.4 ? 'motor' : span >= 20 && Math.abs(rel) <= 0.15 ? 'frame' : 'unknown';
    out.push({
      kind,
      meanHz: my,
      slopeHzPerPct: slope,
      hzAtLow: my + slope * (thrLow - mx),
      hzAtHigh: my + slope * (thrHigh - mx),
      thrLow,
      thrHigh,
      maxProm: Math.max(...pts.map((p) => p.prom)),
      points: pts,
    });
  }
  out.sort((a, b) => b.maxProm - a.maxProm);
  return out;
}

/** Kind of an averaged-spectrum peak: the ridge whose frequency range covers it (frame ridges win ties). */
export function classifyPeak(hz: number, ridges: Ridge[]): RidgeKind {
  let kind: RidgeKind = 'unknown';
  for (const r of ridges) {
    const lo = Math.min(r.hzAtLow, r.hzAtHigh) * 0.9;
    const hi = Math.max(r.hzAtLow, r.hzAtHigh) * 1.1;
    if (hz < lo || hz > hi) continue;
    if (r.kind === 'frame') return 'frame';
    if (r.kind === 'motor') kind = 'motor';
  }
  return kind;
}

/** Noise analysis of a log: filtered gyro, unfiltered gyro and D-term spectrograms (roll + pitch power). */
export function analyzeNoise(log: LogData, thr: Float32Array | null, mask: Uint8Array | null, frameInches?: number | null): NoiseAnalysis {
  const rp = (arr: Float32Array[] | undefined) => (arr && arr.length >= 2 ? [arr[0]!, arr[1]!] : null);
  const opts = { mask };
  const g = rp(log.gyro);
  const u = rp(log.gyroUnfilt);
  const d = rp(log.axisD);
  const unfiltSource: NoiseAnalysis['unfiltSource'] = !log.gyroUnfilt ? null : log.debug && log.gyroUnfilt[0] === log.debug[0] ? 'debug' : 'gyroUnfilt';
  return {
    gyro: g ? spectrogram('gyro', g, thr, log.fs, opts) : null,
    gyroUnfilt: u ? spectrogram('gyroUnfilt', u, thr, log.fs, opts) : null,
    dterm: d ? spectrogram('dterm', d, thr, log.fs, opts) : null,
    unfiltSource,
    bands: frameBands(frameInches),
  };
}

