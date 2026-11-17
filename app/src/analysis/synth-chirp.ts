/**
 * Synthetic CHIRP test flight (demo mode and tests): roll, pitch and yaw sweeps as Betaflight logs them with
 * debug_mode = CHIRP, flown by a simulated rate loop (PID + motor lag + gyro PT1 + dead time).
 */
import { parseLogSettings } from './settings';
import { SYNTH_HEADER } from './synth';
import type { LogData } from './types';

export interface SynthLoop {
  /** P and D gains of the simulated loop (plant gain folded in). */
  kp: number;
  ki: number;
  kd: number;
  /** Motor / prop time constant [ms]. */
  motorMs: number;
}

/** Roll: lively, small margin; pitch: well damped; yaw: slow and safe. */
export const SYNTH_LOOPS: [SynthLoop, SynthLoop, SynthLoop] = [
  { kp: 520, ki: 2600, kd: 3.6, motorMs: 22 },
  { kp: 430, ki: 2200, kd: 3.4, motorMs: 22 },
  { kp: 140, ki: 250, kd: 0.6, motorMs: 30 },
];

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

export function synthChirpLog(o: { fs?: number; seconds?: number; fEnd?: number; loops?: SynthLoop[]; seed?: number; axes?: number[]; ff?: boolean } = {}): LogData {
  const fs = o.fs ?? 2000;
  const T = o.seconds ?? 20;
  const f0 = 0.2;
  const f1 = o.fEnd ?? 600;
  const fMax = Math.min(f1, fs / 2);
  const loops = o.loops ?? SYNTH_LOOPS;
  const axes = o.axes ?? [0, 1, 2];
  const gap = 1.5;
  const total = gap + axes.length * (T + gap);
  const n = Math.round(total * fs);
  const sub = 8;
  const dt = 1 / fs / sub;
  const rand = rng(o.seed ?? 5);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const amps = [230, 230, 180];

  const setpoint = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const gyro = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const dbg = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  dbg[1]!.fill(-1);
  const k = Math.log(fMax / f0);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const seg = Math.floor((t - gap) / (T + gap));
    const tin = t - gap - seg * (T + gap);
    if (seg < 0 || seg >= axes.length || tin < 0 || tin >= T) continue;
    const a = axes[seg]!;
    const f = f0 * Math.exp((k * tin) / T);
    const sinarg = ((2 * Math.PI * f0 * T) / k) * (Math.exp((k * tin) / T) - 1);
    let c = Math.cos(sinarg);
    if (f < 1) c *= f;
    setpoint[a]![i] = amps[a]! * c;
    dbg[0]![i] = Math.round(5000 * (sinarg % (2 * Math.PI)));
    dbg[1]![i] = a;
    dbg[2]![i] = Math.round(f * 10);
    dbg[3]![i] = Math.round(1000 * c);
  }
  // pilot hover corrections (small, slow) on every axis
  for (let a = 0; a < 3; a++) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v += (gauss() * 4 - v) * 0.002;
      setpoint[a]![i] = setpoint[a]![i]! + v;
    }
  }
  // closed loop per axis
  const delaySamples = Math.round(0.001 * fs);
  for (let a = 0; a < 3; a++) {
    const L = loops[a]!;
    const tauM = L.motorMs / 1000;
    const lpf = 1 - Math.exp(-2 * Math.PI * 90 * dt);
    let w = 0; // body rate
    let um = 0; // motor torque state
    let yf = 0; // filtered gyro
    let integ = 0;
    let prevY = 0;
    let dFilt = 0;
    const dl = 1 - Math.exp(-2 * Math.PI * 100 * (1 / fs));
    const hist: number[] = [];
    let u = 0;
    for (let i = 0; i < n; i++) {
      const r = setpoint[a]![i]!;
      const yMeas = hist.length > delaySamples ? hist[hist.length - 1 - delaySamples]! : 0;
      const e = r - yMeas;
      integ += e / fs;
      const dRaw = (yMeas - prevY) * fs;
      prevY = yMeas;
      dFilt += (dRaw - dFilt) * dl;
      u = L.kp * e + L.ki * integ - L.kd * dFilt + (o.ff ? 0.3 * r : 0);
      for (let s = 0; s < sub; s++) {
        um += ((u - um) / tauM) * dt;
        w += (um + gauss() * 40) * dt;
        yf += (w - yf) * lpf;
      }
      hist.push(yf + gauss() * 0.4);
      if (hist.length > 64) hist.shift();
      gyro[a]![i] = hist[hist.length - 1]!;
    }
  }
  const header: Record<string, string> = {
    ...SYNTH_HEADER,
    'Firmware revision': 'Betaflight 2026.6.0 (synthetic) STM32F405',
    debug_mode: 'CHIRP',
    'P interval': '4',
    chirp_amplitude_roll: '230',
    chirp_amplitude_pitch: '230',
    chirp_amplitude_yaw: '180',
    chirp_frequency_start_deci_hz: '2',
    chirp_frequency_end_deci_hz: String(Math.round(f1 * 10)),
    chirp_time_seconds: String(T),
    chirp_repeat: '1',
    ...(o.ff ? {} : { ff_weight: '0,0,0', simplified_feedforward_gain: '0' }),
  };
  const settings = parseLogSettings(header);
  const range: [number, number] = settings.motorOutput ?? [158, 2047];
  const throttle = new Float32Array(n).fill(1450);
  const motor = [0, 1, 2, 3].map(() => new Float32Array(n).fill(range[0] + (range[1] - range[0]) * 0.42));
  const out: LogData = { fs, rows: n, duration: total, setpoint, gyro, motor, rcFallback: false, throttle, motorRange: range, settings, debug: dbg };
  if (settings.pid) out.headerPid = settings.pid;
  return out;
}
