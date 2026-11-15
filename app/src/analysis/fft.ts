/** FFT radix-2, okno Hann, widmo Welcha, wykrywanie pikow. Bez zaleznosci. */
import type { Peak } from './types';

interface Plan {
  cos: Float64Array;
  sin: Float64Array;
  rev: Uint32Array;
}
const plans = new Map<number, Plan>();

function plan(n: number): Plan {
  let p = plans.get(n);
  if (p) return p;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('FFT: dlugosc musi byc potega 2');
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = Math.sin((2 * Math.PI * k) / n);
  }
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  p = { cos, sin, rev };
  plans.set(n, p);
  return p;
}

/** FFT w miejscu. inverse=true: odwrotna ze skalowaniem 1/n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { cos, sin, rev } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  const sgn = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const wr = cos[j * step]!;
        const wi = sgn * sin[j * step]!;
        const a = i + j;
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
  }
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Widmo mocy metoda Welcha (okno Hann, nakladanie 50%), biny 0..maxHz. psd w jednostkach x^2/Hz. */
export function welchPsd(x: ArrayLike<number>, fs: number, nfft: number, maxHz: number, maxSegments = 500): { df: number; psd: Float64Array } {
  const df = fs / nfft;
  const bins = Math.min(nfft / 2, Math.floor(maxHz / df)) + 1;
  const psd = new Float64Array(bins);
  const w = hann(nfft);
  let wp = 0;
  for (let i = 0; i < nfft; i++) wp += w[i]! * w[i]!;
  const hop = nfft / 2;
  const total = Math.max(0, Math.floor((x.length - nfft) / hop) + 1);
  if (total === 0) return { df, psd };
  const stride = Math.max(1, Math.ceil(total / maxSegments));
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  let count = 0;
  for (let s = 0; s < total; s += stride) {
    const off = s * hop;
    let mean = 0;
    for (let i = 0; i < nfft; i++) mean += x[off + i]!;
    mean /= nfft;
    for (let i = 0; i < nfft; i++) {
      re[i] = (x[off + i]! - mean) * w[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < bins; k++) psd[k] = psd[k]! + (re[k]! * re[k]! + im[k]! * im[k]!) * 2;
    count++;
  }
  const scale = 1 / (count * fs * wp);
  for (let k = 0; k < bins; k++) psd[k] = psd[k]! * scale;
  return { df, psd };
}

function median(a: number[]): number {
  if (!a.length) return 0;
  const b = [...a].sort((p, q) => p - q);
  return b[b.length >> 1]!;
}

/** Piki w widmie dB (po lekkim wygladzeniu); prom = wybicie ponad mediane tla w oknie +-60 Hz. Posortowane malejaco po prom. */
export function findPeaks(db: ArrayLike<number>, df: number, minHz: number, maxHz: number, minProm = 6): Peak[] {
  const n = db.length;
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) {
      s += db[j]!;
      c++;
    }
    sm[i] = s / c;
  }
  const near = Math.round(20 / df);
  const far = Math.round(60 / df);
  const out: Peak[] = [];
  for (let i = Math.max(1, Math.ceil(minHz / df)); i <= Math.min(n - 2, Math.floor(maxHz / df)); i++) {
    if (!(sm[i]! > sm[i - 1]! && sm[i]! >= sm[i + 1]!)) continue;
    const side: number[] = [];
    for (let j = Math.max(0, i - far); j <= Math.min(n - 1, i + far); j++) if (Math.abs(j - i) >= near) side.push(sm[j]!);
    const prom = sm[i]! - median(side);
    if (prom >= minProm) out.push({ hz: i * df, db: sm[i]!, prom });
  }
  out.sort((a, b) => b.prom - a.prom);
  const kept: Peak[] = [];
  for (const p of out) if (!kept.some((k) => Math.abs(k.hz - p.hz) < 15)) kept.push(p);
  return kept;
}
