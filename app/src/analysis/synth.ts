/** Syntetyczny log (tryb demo i testy): kroki setpointu + odpowiedz 2. rzedu + szum 120 Hz i 280 Hz. */
import type { LogData } from './types';

export interface SynthAxis {
  /** Przeregulowanie [%] odpowiedzi 2. rzedu (<1 = tlumienie krytyczne/wolne). */
  overshootPct: number;
  /** Czas szczytu [s] (dla przeregulowania < 1: skala czasu). */
  peakTime: number;
}

export function zetaFromOvershoot(pct: number): number {
  const l = Math.log(pct / 100);
  return -l / Math.sqrt(Math.PI * Math.PI + l * l);
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_AXES: SynthAxis[] = [
  { overshootPct: 18, peakTime: 0.091 },
  { overshootPct: 8, peakTime: 0.075 },
  { overshootPct: 0.5, peakTime: 0.22 },
];

export function synthLog(opts: { seconds?: number; fs?: number; seed?: number; axes?: SynthAxis[]; noise?: boolean } = {}): LogData {
  const fs = opts.fs ?? 4000;
  const seconds = opts.seconds ?? 40;
  const axes = opts.axes ?? DEMO_AXES;
  const noise = opts.noise ?? true;
  const n = Math.round(fs * seconds);
  const rand = rng(opts.seed ?? 7);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const dt = 1 / fs;
  const sub = 4;
  const setpoint = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const gyro = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let a = 0; a < 3; a++) {
    const ax = axes[a]!;
    const slow = ax.overshootPct < 1;
    const zeta = slow ? 1.05 : zetaFromOvershoot(ax.overshootPct);
    const wn = slow ? 3.5 / ax.peakTime : Math.PI / (ax.peakTime * Math.sqrt(1 - zeta * zeta));
    let target = 0;
    let holdUntil = 0;
    let u = 0;
    let x = 0;
    let v = 0;
    const phi1 = rand() * 6.28;
    const phi2 = rand() * 6.28;
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      if (t >= holdUntil) {
        const r = rand();
        target = r < 0.2 ? 0 : (r < 0.6 ? 1 : -1) * (80 + rand() * 220);
        holdUntil = t + 0.3 + rand() * 0.6;
      }
      u += (target - u) * (dt / 0.01); // gladkie przejscie drazka
      setpoint[a]![i] = u;
      const h = dt / sub;
      for (let s = 0; s < sub; s++) {
        v += (wn * wn * (u - x) - 2 * zeta * wn * v) * h;
        x += v * h;
      }
      let g = x;
      if (noise) g += gauss() * 1.0 + 3 * Math.sin(2 * Math.PI * 120 * t + phi1) + 6 * Math.sin(2 * Math.PI * 280 * t + phi2);
      gyro[a]![i] = g;
    }
  }
  const motor = [0, 1, 2, 3].map((m) => {
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) arr[i] = 1300 + 80 * Math.sin(i * dt * 0.7 + m) + (noise ? gauss() * 8 : 0);
    return arr;
  });
  // throttle: slow sweeps through most of the range plus a few punches (feeds the log quality throttle coverage)
  const throttle = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const sweep = 0.45 + 0.3 * Math.sin(t * 0.55) + 0.12 * Math.sin(t * 1.9);
    const punch = t % 9 < 0.6 ? 0.35 : 0;
    throttle[i] = 1000 + 1000 * Math.max(0, Math.min(1, sweep + punch));
  }
  return { fs, rows: n, duration: seconds, setpoint, gyro, motor, rcFallback: false, throttle, motorRange: [1000, 2000] };
}
