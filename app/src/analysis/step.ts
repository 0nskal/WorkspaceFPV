/** Odpowiedz skokowa: dekonwolucja Wienera setpoint -> gyro w oknach, usredniona. */
import { fft, hann, nextPow2 } from './fft';
import type { AxisResult } from './types';

export const STEP_MS = 500;

export interface StepOptions {
  /** Minimalny ruch drazka w oknie [deg/s]. */
  activeThreshold?: number;
  /** Regularyzacja Wienera jako ulamek sredniej mocy wejscia. */
  reg?: number;
  maxWindows?: number;
}

/**
 * Estymata H = sum(G*conj(S)) / (sum(|S|^2) + eps) po oknach ~2 s (Hann, nakladanie 50%), odpowiedz impulsowa -> skokowa (suma narastajaca),
 * normalizacja do wartosci ustalonej (srednia z 400-500 ms). Zwraca 501 punktow co 1 ms albo null.
 */
export function stepResponse(sp: ArrayLike<number>, gy: ArrayLike<number>, fs: number, opts: StepOptions = {}): { step: number[] | null; windows: number } {
  const thr = opts.activeThreshold ?? 20;
  const reg = opts.reg ?? 0.003;
  const L = nextPow2(Math.ceil(2 * fs));
  const hop = L / 2;
  const n = Math.min(sp.length, gy.length);
  const total = Math.max(0, Math.floor((n - L) / hop) + 1);
  const w = hann(L);
  const sxx = new Float64Array(L);
  const gxr = new Float64Array(L);
  const gxi = new Float64Array(L);
  const sr = new Float64Array(L);
  const si = new Float64Array(L);
  const gr = new Float64Array(L);
  const gi = new Float64Array(L);
  const active: number[] = [];
  for (let s = 0; s < total; s++) {
    const off = s * hop;
    let mx = 0;
    for (let i = 0; i < L; i += 4) mx = Math.max(mx, Math.abs(sp[off + i]!));
    if (mx > thr) active.push(off);
  }
  const maxW = opts.maxWindows ?? 400;
  const stride = Math.max(1, Math.ceil(active.length / maxW));
  let used = 0;
  for (let a = 0; a < active.length; a += stride) {
    const off = active[a]!;
    for (let i = 0; i < L; i++) {
      sr[i] = sp[off + i]! * w[i]!;
      si[i] = 0;
      gr[i] = gy[off + i]! * w[i]!;
      gi[i] = 0;
    }
    fft(sr, si);
    fft(gr, gi);
    for (let k = 0; k < L; k++) {
      sxx[k] = sxx[k]! + sr[k]! * sr[k]! + si[k]! * si[k]!;
      // G * conj(S)
      gxr[k] = gxr[k]! + gr[k]! * sr[k]! + gi[k]! * si[k]!;
      gxi[k] = gxi[k]! + gi[k]! * sr[k]! - gr[k]! * si[k]!;
    }
    used++;
  }
  if (used < 2) return { step: null, windows: used };
  let mean = 0;
  for (let k = 0; k < L; k++) mean += sxx[k]!;
  mean /= L;
  const eps = reg * mean;
  const hr = new Float64Array(L);
  const hi = new Float64Array(L);
  for (let k = 0; k < L; k++) {
    const d = sxx[k]! + eps;
    hr[k] = gxr[k]! / d;
    hi[k] = gxi[k]! / d;
  }
  fft(hr, hi, true);
  const M = Math.round((STEP_MS / 1000) * fs) + 1;
  const cum = new Float64Array(M);
  let acc = 0;
  for (let i = 0; i < M; i++) {
    acc += hr[i]!;
    cum[i] = acc;
  }
  // wartosc ustalona = srednia z ostatnich 20% (400-500 ms)
  let ss = 0;
  let sc = 0;
  for (let i = Math.floor(M * 0.8); i < M; i++) {
    ss += cum[i]!;
    sc++;
  }
  ss /= sc;
  if (!(Math.abs(ss) > 1e-6)) return { step: null, windows: used };
  const out: number[] = [];
  for (let ms = 0; ms <= STEP_MS; ms++) {
    const pos = (ms / 1000) * fs;
    const i0 = Math.min(M - 1, Math.floor(pos));
    const i1 = Math.min(M - 1, i0 + 1);
    const f = pos - i0;
    out.push((cum[i0]! * (1 - f) + cum[i1]! * f) / ss);
  }
  return { step: out, windows: used };
}

/** Metryki z odpowiedzi skokowej (1 ms / punkt). */
export function stepMetrics(step: number[]): Pick<AxisResult, 'overshoot' | 'peakValue' | 'peakTime' | 'rise' | 'settle'> {
  let pk = -Infinity;
  let pt = 0;
  for (let i = 0; i < step.length; i++) {
    if (step[i]! > pk) {
      pk = step[i]!;
      pt = i;
    }
  }
  const cross = (lvl: number): number | null => {
    for (let i = 1; i < step.length; i++) {
      if (step[i - 1]! < lvl && step[i]! >= lvl) return i - 1 + (lvl - step[i - 1]!) / (step[i]! - step[i - 1]!);
    }
    return null;
  };
  const t10 = cross(0.1);
  const t90 = cross(0.9);
  let settle: number | null = 0;
  for (let i = step.length - 1; i >= 0; i--) {
    if (Math.abs(step[i]! - 1) > 0.05) {
      settle = i === step.length - 1 ? null : i + 1;
      break;
    }
  }
  return {
    overshoot: Math.max(0, (pk - 1) * 100),
    peakValue: pk,
    peakTime: pt,
    rise: t10 !== null && t90 !== null ? t90 - t10 : null,
    settle,
  };
}
