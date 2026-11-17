/** Syntetyczny log (tryb demo i testy): kroki setpointu + odpowiedz 2. rzedu + szum 120 Hz i 280 Hz. */
import { parseLogSettings } from './settings';
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

/* ------------------------------------------------------------------------------------------------------------------
 * Richer synthetic flight for the auto-tune engine (demo mode and tests). synthLog() above stays unchanged.
 * Gyro = 2nd-order response (optional dead time, different damping at high throttle) + propwash bursts after throttle
 * chops + motor noise whose frequency follows throttle (harmonics) + constant frame resonance + white noise; the
 * "filtered" gyro keeps only a residual of the motor/frame noise and passes a PT1 low-pass (filter delay).
 * ---------------------------------------------------------------------------------------------------------------- */

export interface SynthAxisV2 extends SynthAxis {
  /** Dead time [ms] between setpoint and response. */
  delayMs?: number;
  /** Response above 65 % throttle (TPA test). */
  highThrottle?: SynthAxis;
}

export interface SynthFlightOptions {
  seconds?: number;
  fs?: number;
  seed?: number;
  axes?: SynthAxisV2[];
  /** Largest stick step [deg/s]. */
  maxStep?: number;
  /** Stick transition time constant [ms]. */
  spTauMs?: number;
  /** Propwash burst amplitude [deg/s] after each throttle chop (0 = none). */
  propwash?: number;
  /** Seconds between throttle punches (each punch ends in a chop). */
  punchEvery?: number;
  /** Motor noise: idleHz at 0 % .. fullHz at 100 % throttle, amplitude, relative harmonic amplitudes, residual per harmonic in the filtered gyro. */
  motor?: { idleHz: number; fullHz: number; amp: number; harmonics: number[]; residual: number[] } | null;
  frame?: { hz: number; amp: number; residual: number } | null;
  whiteNoise?: number;
  /** PT1 cutoff of the filtered gyro [Hz] (0 = none); the delay is about 1 / (2 pi fc). */
  lpfHz?: number;
  /** Punches reach full throttle and saturate the motors. */
  saturatePunches?: boolean;
  /** Last 0.5 s: gyro saturated (crash). */
  crashAtEnd?: boolean;
  /** Header lines merged over SYNTH_HEADER. */
  header?: Record<string, string>;
  /** Unfiltered gyro in debug[0..2] (debug_mode GYRO_SCALED, default) instead of gyroUnfilt[] columns. */
  debugGyroScaled?: boolean;
  /** Keep the sticks still during punches and chops (default true; false = steps also at full throttle). */
  calmPunches?: boolean;
}

/** Betaflight 4.5-style header of the synthetic quad (key names as assumed in settings.ts). */
export const SYNTH_HEADER: Record<string, string> = {
  'Firmware type': 'Betaflight',
  'Firmware revision': 'Betaflight 4.5.1 (77d01ba3b) STM32F405',
  'Craft name': 'SYNTH',
  looptime: '125',
  pid_process_denom: '2',
  'I interval': '32',
  'P interval': '1',
  debug_mode: '6',
  rollPID: '45,80,40',
  pitchPID: '47,84,46',
  yawPID: '45,80,0',
  d_min: '30,34,0',
  ff_weight: '120,125,120',
  simplified_pids_mode: '2',
  simplified_master_multiplier: '100',
  simplified_pi_gain: '100',
  simplified_i_gain: '100',
  simplified_d_gain: '100',
  simplified_dmax_gain: '100',
  simplified_feedforward_gain: '100',
  simplified_pitch_d_gain: '100',
  simplified_pitch_pi_gain: '100',
  simplified_dterm_filter: '1',
  simplified_dterm_filter_multiplier: '100',
  simplified_gyro_filter: '1',
  simplified_gyro_filter_multiplier: '100',
  gyro_lpf1_type: '0',
  gyro_lpf1_static_hz: '250',
  gyro_lpf1_dyn_hz: '250,500',
  gyro_lpf2_static_hz: '500',
  dterm_lpf1_type: '0',
  dterm_lpf1_static_hz: '75',
  dterm_lpf1_dyn_hz: '75,150',
  dterm_lpf2_static_hz: '150',
  dyn_notch_count: '3',
  dyn_notch_q: '300',
  dyn_notch_min_hz: '100',
  dyn_notch_max_hz: '600',
  rpm_filter_harmonics: '2',
  rpm_filter_q: '500',
  rpm_filter_min_hz: '100',
  dshot_bidir: '1',
  motor_poles: '14',
  tpa_rate: '65',
  tpa_breakpoint: '1350',
  anti_gravity_gain: '80',
  iterm_relax: '1',
  iterm_relax_type: '1',
  iterm_relax_cutoff: '15',
  dyn_idle_min_rpm: '0',
  feedforward_transition: '0',
  feedforward_averaging: '0',
  feedforward_smooth_factor: '25',
  feedforward_jitter_factor: '7',
  feedforward_boost: '15',
  feedforward_max_rate_limit: '90',
  motorOutput: '158,2047',
};

export function synthFlight(o: SynthFlightOptions = {}): LogData {
  const fs = o.fs ?? 4000;
  const seconds = o.seconds ?? 40;
  const n = Math.round(fs * seconds);
  const dt = 1 / fs;
  const rand = rng(o.seed ?? 21);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const axes: SynthAxisV2[] = o.axes ?? DEMO_AXES;
  const maxStep = o.maxStep ?? 700;
  const spTau = (o.spTauMs ?? 10) / 1000;
  const every = o.punchEvery ?? 6;
  const motorCfg = o.motor === undefined ? { idleHz: 120, fullHz: 520, amp: 6, harmonics: [1, 0.6, 0.45], residual: [0.01, 0.02, 0.6] } : o.motor;
  const frameCfg = o.frame === undefined ? { hz: 145, amp: 4, residual: 0.5 } : o.frame;
  const white = o.whiteNoise ?? 0.6;
  const lpf = o.lpfHz ?? 70;

  // throttle (0..1): slow sweeps + a punch every `every` s that ends in a chop
  const thr = new Float32Array(n);
  const punchLen = 0.7;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const sweep = 0.42 + 0.25 * Math.sin(t * 0.55) + 0.1 * Math.sin(t * 1.9);
    const ph = t % every;
    const punch = t > 1 && ph < punchLen ? (o.saturatePunches ? 0.7 : 0.3) : 0;
    // after the chop: 0.6 s at low throttle (where propwash lives)
    const chop = t > 1 && ph >= punchLen && ph < punchLen + 0.6 ? -0.22 : 0;
    thr[i] = Math.max(0.12, Math.min(1, sweep + punch + chop));
  }
  const calmP = o.calmPunches ?? true;
  const calm = (t: number) => calmP && t > 1 && t % every < punchLen + 0.7; // sticks held during punch + chop

  const setpoint = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const gyro = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const unf = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const axisD = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const mPhase = new Float64Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const fm = motorCfg ? motorCfg.idleHz + (motorCfg.fullHz - motorCfg.idleHz) * thr[i]! : 0;
    ph += 2 * Math.PI * fm * dt;
    mPhase[i] = ph;
  }
  const alpha = lpf > 0 ? dt / (dt + 1 / (2 * Math.PI * lpf)) : 1;
  const dAlpha = dt / (dt + 1 / (2 * Math.PI * 120));
  const mk = (sa: SynthAxis) => {
    const slow = sa.overshootPct < 1;
    const zeta = slow ? 1.05 : zetaFromOvershoot(sa.overshootPct);
    const wn = slow ? 3.5 / sa.peakTime : Math.PI / (sa.peakTime * Math.sqrt(1 - zeta * zeta));
    return { zeta, wn };
  };
  for (let a = 0; a < 3; a++) {
    const ax = axes[a]!;
    const lo = mk(ax);
    const hi = ax.highThrottle ? mk(ax.highThrottle) : lo;
    const delayN = Math.round(((ax.delayMs ?? 0) / 1000) * fs);
    const hist = new Float64Array(delayN + 1);
    let target = 0;
    let holdUntil = 0;
    let u = 0;
    let x = 0;
    let v = 0;
    let filt = 0;
    let prevFilt = 0;
    let dOut = 0;
    const phF = rand() * 6.28;
    const phH = [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28];
    const phP = rand() * 6.28;
    const sub = 4;
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      if (t >= holdUntil && !calm(t)) {
        const r = rand();
        target = r < 0.25 ? 0 : (r < 0.62 ? 1 : -1) * (80 + rand() * (maxStep - 80));
        if (a === 2) target *= 0.6;
        holdUntil = t + 0.3 + rand() * 0.6;
      }
      u += (target - u) * (spTau > 0 ? Math.min(1, dt / spTau) : 1);
      setpoint[a]![i] = u;
      hist[i % (delayN + 1)] = u;
      const ud = i >= delayN ? hist[(i - delayN) % (delayN + 1)]! : 0;
      const p = thr[i]! > 0.65 ? hi : lo;
      const h = dt / sub;
      for (let s = 0; s < sub; s++) {
        v += (p.wn * p.wn * (ud - x) - 2 * p.zeta * p.wn * v) * h;
        x += v * h;
      }
      // propwash: decaying ~55 Hz wobble after each chop, roll and pitch only
      let pw = 0;
      if (o.propwash && a < 2 && t > 1) {
        const tc = (t % every) - punchLen;
        if (tc >= 0 && tc < 0.45) pw = o.propwash * Math.exp(-tc / 0.15) * Math.sin(2 * Math.PI * 55 * tc + phP + a);
      }
      let mot = 0;
      let motRes = 0;
      if (motorCfg) {
        const ampT = motorCfg.amp * (0.4 + thr[i]!);
        for (let k = 0; k < motorCfg.harmonics.length; k++) {
          const val = ampT * motorCfg.harmonics[k]! * Math.sin((k + 1) * mPhase[i]! + phH[k % phH.length]!);
          mot += val;
          motRes += val * (motorCfg.residual[k] ?? 1);
        }
      }
      const fr = frameCfg ? frameCfg.amp * Math.sin(2 * Math.PI * frameCfg.hz * t + phF) : 0;
      const wn = white * gauss();
      unf[a]![i] = x + pw + mot + fr + wn;
      const pre = x + pw + motRes + fr * (frameCfg ? frameCfg.residual : 1) + wn;
      filt += (pre - filt) * alpha;
      gyro[a]![i] = filt;
      // D-term: derivative of the filtered gyro through a 120 Hz PT1 (arbitrary scale)
      const der = i ? (filt - prevFilt) * fs : 0;
      prevFilt = filt;
      dOut += (-0.02 * der - dOut) * dAlpha;
      axisD[a]![i] = dOut;
    }
  }
  if (o.crashAtEnd) {
    for (let i = Math.max(0, n - Math.round(0.5 * fs)); i < n; i++) {
      for (let a = 0; a < 3; a++) {
        const v = (i % 2 ? 1 : -1) * 2000;
        gyro[a]![i] = v;
        unf[a]![i] = v;
      }
    }
  }
  const header = { ...SYNTH_HEADER, ...(o.header ?? {}) };
  const settings = parseLogSettings(header);
  const range: [number, number] = settings.motorOutput ?? [158, 2047];
  const motor = [0, 1, 2, 3].map((m) => {
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const mix = (m % 2 ? 1 : -1) * 0.03 * Math.sin(i * dt * 2.1 + m);
      const val = range[0] + (range[1] - range[0]) * (thr[i]! * 0.97 + mix);
      arr[i] = Math.max(range[0], Math.min(range[1], val));
    }
    return arr;
  });
  const throttle = new Float32Array(n);
  for (let i = 0; i < n; i++) throttle[i] = 1000 + 1000 * thr[i]!;
  const out: LogData = { fs, rows: n, duration: seconds, setpoint, gyro, motor, rcFallback: false, throttle, motorRange: range, settings, axisD: [axisD[0]!, axisD[1]!] };
  if (settings.pid) out.headerPid = settings.pid;
  if (o.debugGyroScaled ?? true) {
    out.debug = [unf[0]!, unf[1]!, unf[2]!, new Float32Array(n)];
    out.gyroUnfilt = out.debug.slice(0, 3);
  } else out.gyroUnfilt = unf;
  return out;
}

/** Response of the demo quad for a simplified_pi_gain value (lower = slower, higher = more overshoot / ringing). */
export function piResponse(pi: number): SynthAxisV2[] {
  const os = pi <= 0.6 ? 0.5 : pi <= 0.8 ? 3 : pi <= 1.0 ? 8 : pi <= 1.2 ? 22 : 35;
  const pt = pi <= 0.6 ? 0.14 : pi <= 0.8 ? 0.095 : pi <= 1.0 ? 0.075 : pi <= 1.2 ? 0.065 : 0.058;
  return [
    { overshootPct: os, peakTime: pt },
    { overshootPct: os, peakTime: pt * 1.05 },
    { overshootPct: 0.5, peakTime: 0.2 },
  ];
}

/**
 * Demo sessions: a simplified_pi_gain series 0.6 / 0.8 / 1.0 / 1.2 (one flight each, I = 0 and FF = 0 as the
 * procedure says) plus a longer full flight with propwash, motor/frame noise and a TPA difference (the session
 * analysed by default, because it is the longest).
 */
export function synthDemoSessions(o: { seconds?: number; fs?: number } = {}): LogData[] {
  const sec = o.seconds ?? 20;
  const fs = o.fs ?? 4000;
  const series = [0.6, 0.8, 1.0, 1.2].map((pi, k) =>
    synthFlight({
      seconds: sec,
      fs,
      seed: 100 + k,
      axes: piResponse(pi),
      header: {
        simplified_pi_gain: String(Math.round(pi * 100)),
        simplified_i_gain: '0',
        simplified_feedforward_gain: '0',
        rollPID: `${Math.round(45 * pi)},0,40`,
        pitchPID: `${Math.round(47 * pi)},0,46`,
        ff_weight: '0,0,0',
      },
    }),
  );
  const main = synthFlight({
    seconds: sec * 2,
    fs,
    seed: 7,
    axes: [
      { overshootPct: 18, peakTime: 0.08, highThrottle: { overshootPct: 32, peakTime: 0.07 } },
      { overshootPct: 8, peakTime: 0.075 },
      { overshootPct: 0.5, peakTime: 0.2 },
    ],
    propwash: 25,
  });
  return [...series, main];
}
