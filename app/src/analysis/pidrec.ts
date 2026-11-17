/**
 * PID recommendations v2 (pure). Works on the PIDs / sliders from the LOG HEADER (what the quad flew with), returns
 * every change twice: simplified-slider form (preferred when simplified_pids_mode is not OFF) and raw `set p_roll`
 * form. Change sizes are scaled by log quality x per-axis confidence; poor logs give small or no changes.
 *
 * The rule thresholds (overshoot 5-10 % ideal, rise > 80 ms slow, D/P 0.45-0.85 for 5", dynamic idle table) are
 * common tuning rules of thumb, not constants measured by this project.
 */
import { advice, roundSlider, sliderCli, sliderCliName, type Advice, type SliderChange, type SliderKey } from './advice';
import { dtermNoiseDb, DTERM_NOISY_DB, GYRO_NOISY_RMS } from './filters';
import type { NoiseAnalysis } from './noise';
import type { PropwashResult } from './propwash';
import type { LogSettings } from './settings';
import { clamp, clamp01 } from './signals';
import { AXIS_KEYS, type AxisKey, type AxisSteps, type CurveMetrics } from './step2';

export interface RawGains {
  p: number;
  i: number;
  /** The `d_<axis>` value (upper D before 2025.x, base D from 2025.x). */
  d: number;
  f: number | null;
  /** d_min (Betaflight <= 4.5) or d_max (2025.x); null when the header has none. */
  dLimit: number | null;
}

export interface GainFactors {
  p: number;
  i: number;
  /** All D values. */
  d: number;
  /** Only the lower D value (D-min before 2025.x, base D from 2025.x): propwash. */
  dLow: number;
  f: number;
}

export interface PidAxisChange {
  axis: AxisKey;
  /** Factors after confidence scaling and the +-25 % cap. */
  factors: GainFactors;
  current: RawGains | null;
  suggested: RawGains | null;
}

export interface PidRecommendation {
  advice: Advice[];
  axes: PidAxisChange[];
  /** Sliders when simplified_pids_mode is RP/RPY and the header has the slider values, else raw. */
  preferred: 'sliders' | 'raw';
  rawCli: string[];
  sliders: SliderChange[];
  sliderCli: string[];
  /** Extra CLI lines that are not PIDs (TPA, iterm_relax, dyn idle). */
  extraCli: string[];
  /** Applied change scale 0..1 (log quality); 0 = no numeric changes. */
  scale: number;
}

export interface PidRecOptions {
  hotMotors?: boolean;
  frameInches?: number;
  propInches?: number;
}

/** Approximate dyn_idle_min_rpm (x100 rpm) by prop size: a rule of thumb, not a measurement. */
export const DYN_IDLE_TABLE: [inches: number, lo: number, hi: number][] = [
  [3, 50, 60],
  [4, 40, 45],
  [5, 30, 35],
  [6, 25, 30],
  [7, 20, 25],
];

/** Approximate dyn_idle_min_rpm for a prop size (linear between table rows, clamped to 3"..7"). */
export function dynIdleFor(inches: number): number {
  const t = DYN_IDLE_TABLE;
  const x = clamp(inches, t[0]![0], t[t.length - 1]![0]);
  for (let k = 0; k < t.length - 1; k++) {
    const a = t[k]!;
    const b = t[k + 1]!;
    if (x >= a[0] && x <= b[0]) {
      const f = (x - a[0]) / (b[0] - a[0]);
      return Math.round(((a[1] + a[2]) / 2) * (1 - f) + ((b[1] + b[2]) / 2) * f);
    }
  }
  return 32;
}

/** Healthy D/P range by frame size (5": 0.45-0.85; rule of thumb). */
export function dpRange(inches?: number): [number, number] {
  if (!inches) return [0.45, 0.85];
  if (inches <= 3.5) return [0.4, 0.8];
  if (inches >= 6) return [0.55, 1.0];
  return [0.45, 0.85];
}

const MAX_CHANGE = 0.25;
const AXIS_NAME: Record<AxisKey, string> = { roll: 'Roll', pitch: 'Pitch', yaw: 'Yaw' };

function currentGains(s: LogSettings | undefined, a: AxisKey, idx: number): RawGains | null {
  const pid = s?.pid?.[a];
  if (!pid) return null;
  const lim = s?.dScheme === 'dmax' ? s.dMax?.[idx] : s?.dMin?.[idx];
  return { p: pid[0], i: pid[1], d: pid[2], f: s?.ff?.[idx] ?? null, dLimit: lim ?? null };
}

function applyGains(c: RawGains, f: GainFactors, scheme: 'dmin' | 'dmax'): RawGains {
  const r = (v: number) => clamp(Math.round(v), 0, 250);
  const out: RawGains = { p: r(c.p * f.p), i: r(c.i * f.i), d: c.d, f: c.f === null ? null : clamp(Math.round(c.f * f.f), 0, 2000), dLimit: c.dLimit };
  const lim = c.dLimit ?? 0;
  if (scheme === 'dmin') {
    // d = upper, d_min = lower (0 = off: then the single D takes the low factor too)
    if (lim > 0) {
      out.d = r(c.d * f.d);
      out.dLimit = Math.min(out.d, r(lim * f.d * f.dLow));
    } else out.d = r(c.d * f.d * f.dLow);
  } else {
    // d = base (lower), d_max = upper (0 = off)
    out.d = r(c.d * f.d * f.dLow);
    if (lim > 0) out.dLimit = Math.max(out.d, r(lim * f.d));
  }
  return out;
}

function rawCliLines(a: AxisKey, c: RawGains, n: RawGains, scheme: 'dmin' | 'dmax'): string[] {
  const out: string[] = [];
  if (n.p !== c.p) out.push(`set p_${a} = ${n.p}`);
  if (n.i !== c.i) out.push(`set i_${a} = ${n.i}`);
  if (n.d !== c.d) out.push(`set d_${a} = ${n.d}`);
  if (n.dLimit !== null && n.dLimit !== c.dLimit) out.push(`set ${scheme === 'dmax' ? 'd_max' : 'd_min'}_${a} = ${n.dLimit}`);
  if (n.f !== null && n.f !== c.f) out.push(`set f_${a} = ${n.f}`);
  return out;
}

export interface PidRecInput {
  steps: AxisSteps[];
  noise: NoiseAnalysis;
  propwash: PropwashResult;
  settings: LogSettings | undefined;
  /** Log quality score 0..100 (quality.ts). */
  quality: number;
}

export function recommendPids(inp: PidRecInput, o: PidRecOptions = {}): PidRecommendation {
  const { steps, noise, propwash: pw, settings: s } = inp;
  const out: Advice[] = [];
  const extraCli: string[] = [];
  const scheme = s?.dScheme ?? 'dmin';
  const qualityK = clamp01((inp.quality - 30) / 45);
  const dDb = dtermNoiseDb(noise.dterm);
  const dNoisy = (dDb !== null && dDb > DTERM_NOISY_DB) || (noise.gyro !== null && noise.gyro.hfRms > GYRO_NOISY_RMS);
  const guard = !!o.hotMotors || dNoisy;
  const inches = o.frameInches ?? o.propInches;
  const [dpLo, dpHi] = dpRange(inches);
  const fac: Record<AxisKey, GainFactors> = {
    roll: { p: 1, i: 1, d: 1, dLow: 1, f: 1 },
    pitch: { p: 1, i: 1, d: 1, dLow: 1, f: 1 },
    yaw: { p: 1, i: 1, d: 1, dLow: 1, f: 1 },
  };
  const conf: Record<AxisKey, number> = { roll: 0, pitch: 0, yaw: 0 };

  if (inp.quality < 50) out.push(advice('pid.poorLog', 'pid.poorLog', 'warn', 1, { params: { score: inp.quality } }));

  for (const st of steps) {
    const a = st.axis;
    const name = AXIS_NAME[a];
    const m: CurveMetrics | null = st.best;
    const c = st.confidence * qualityK;
    conf[a] = c;
    const f = fac[a];
    if (!m || m.overshoot === null) {
      out.push(advice(`pid.noSteps.${a}`, 'pid.noSteps', 'warn', 1, { params: { axis: name } }));
      continue;
    }
    const os = m.overshoot;
    // never reached 90 % inside the window but did reach 50 %: count as slow
    const rise = m.rise ?? (m.latency50 !== null ? 999 : null);
    const P = { axis: name, os: Math.round(os), rise: rise === null ? '?' : rise >= 999 ? '>300' : Math.round(rise), ring: m.ringing };
    if (a === 'yaw') {
      if (os > 25) {
        f.p *= 0.95;
        out.push(advice('pid.yawOvershoot', 'pid.yawOvershoot', 'suggest', c, { params: P }));
      } else if (rise !== null && rise > 150) out.push(advice('pid.yawSlow', 'pid.yawSlow', 'info', c, { params: P }));
      continue;
    }
    // overshoot
    let dUp = 1;
    if (os > 25) {
      dUp = 1.15;
      f.p *= 0.9;
      out.push(advice(`pid.overshoot.${a}`, 'pid.overshootSevere', 'warn', c, { params: P }));
    } else if (os > 15) {
      dUp = 1.1;
      f.p *= 0.95;
      out.push(advice(`pid.overshoot.${a}`, 'pid.overshootHigh', 'suggest', c, { params: P }));
    } else if (os > 10) {
      dUp = 1.05;
      out.push(advice(`pid.overshoot.${a}`, 'pid.overshootMild', 'suggest', c, { params: P }));
    } else if (rise === null || rise <= 80) out.push(advice(`pid.overshoot.${a}`, 'pid.overshootIdeal', 'ok', c, { params: P }));
    // ringing
    if (m.ringing >= 3) {
      dUp = Math.max(dUp, 1.08);
      out.push(advice(`pid.ringing.${a}`, 'pid.ringing', 'suggest', c, { params: P }));
    }
    if (dUp > 1) {
      if (guard) {
        f.p *= 1 / dUp;
        out.push(advice(`pid.heatGuard.${a}`, o.hotMotors ? 'pid.heatGuardHot' : 'pid.heatGuardNoise', 'warn', c, { params: P }));
      } else f.d *= dUp;
    }
    // slow rise
    if (rise !== null && rise > 80 && os < 10) {
      f.p *= 1.1;
      const hasFf = (s?.ff?.[AXIS_KEYS.indexOf(a)] ?? 0) > 0;
      if (hasFf) f.f *= 1.1;
      out.push(advice(`pid.slowRise.${a}`, hasFf ? 'pid.slowRiseFf' : 'pid.slowRise', 'suggest', c, { params: P }));
    }
    // D/P ratio sanity
    const cur = currentGains(s, a, AXIS_KEYS.indexOf(a));
    if (cur && cur.p > 0) {
      const ratio = cur.d / cur.p;
      const rp = { ...P, ratio: Math.round(ratio * 100) / 100, lo: dpLo, hi: dpHi };
      if (ratio < dpLo && os > 10) out.push(advice(`pid.ratioLow.${a}`, 'pid.ratioLow', 'info', c, { params: rp }));
      else if (ratio > dpHi && os < 3) {
        f.d *= 0.93;
        out.push(advice(`pid.ratioHigh.${a}`, 'pid.ratioHigh', 'suggest', c, { params: rp }));
      }
    }
    // I-term: steady-state error and bounce-back
    if (st.source === 'steps' && m.ssError !== null && m.ssError < -5) {
      f.i *= 1.1;
      out.push(advice(`pid.ssError.${a}`, 'pid.ssError', 'suggest', c, { params: { ...P, err: Math.round(-m.ssError) } }));
    }
    if (m.bounceBack !== null && m.bounceBack > 8) {
      const cli: string[] = [];
      if (s?.itermRelax === 0) cli.push('set iterm_relax = RP');
      else if (s?.itermRelaxCutoff !== undefined && s.itermRelaxCutoff > 10) cli.push(`set iterm_relax_cutoff = ${Math.max(10, s.itermRelaxCutoff - 5)}`);
      out.push(advice(`pid.bounceBack.${a}`, 'pid.bounceBack', 'suggest', c, { params: { ...P, bb: Math.round(m.bounceBack) }, cli }));
      extraCli.push(...cli);
    }
  }

  // propwash
  if (pw.level === 'severe' || pw.level === 'moderate') {
    const k = pw.level === 'severe' ? 1.15 : 1.08;
    const pc = clamp01(pw.events / 6) * qualityK;
    const params = { ratio: pw.ratio ?? 0, events: pw.events };
    if (guard) out.push(advice('pid.propwashGuard', 'pid.propwashGuard', 'warn', pc, { params }));
    else {
      fac.roll.dLow *= k;
      fac.pitch.dLow *= k;
      out.push(advice('pid.propwash', pw.level === 'severe' ? 'pid.propwashSevere' : 'pid.propwashModerate', pw.level === 'severe' ? 'warn' : 'suggest', pc, { params }));
    }
    if (s?.itermRelaxCutoff !== undefined && s.itermRelaxCutoff < 10) {
      const cli = ['set iterm_relax_cutoff = 15'];
      extraCli.push(...cli);
      out.push(advice('pid.itermRelaxLow', 'pid.itermRelaxLow', 'suggest', pc, { params: { v: s.itermRelaxCutoff }, cli }));
    }
  } else if (pw.level === 'none') out.push(advice('pid.propwashNone', 'pid.propwashNone', 'ok', clamp01(pw.events / 6), { params: { ratio: pw.ratio ?? 0, events: pw.events } }));
  else if (pw.level === 'insufficient') out.push(advice('pid.propwashFew', 'pid.propwashFew', 'info', 1, { params: { events: pw.events } }));

  // TPA: step response at high vs low throttle
  const band = (st: AxisSteps, id: 'low' | 'high') => st.byThrottle.find((b) => b.id === id);
  const rp = steps.filter((st) => st.axis !== 'yaw');
  const diffs = rp
    .map((st) => {
      const lo = band(st, 'low');
      const hi = band(st, 'high');
      if (!lo?.metrics || !hi?.metrics || lo.n < 3 || hi.n < 3) return null;
      return { os: (hi.metrics.overshoot ?? 0) - (lo.metrics.overshoot ?? 0), riseRatio: (hi.metrics.rise ?? 0) / Math.max(1, lo.metrics.rise ?? 1), n: Math.min(lo.n, hi.n) };
    })
    .filter((d): d is { os: number; riseRatio: number; n: number } => d !== null);
  if (diffs.length) {
    // the axis with the largest difference decides
    const worst = diffs.reduce((w, d) => (Math.abs(d.os) > Math.abs(w.os) ? d : w));
    const dOs = worst.os;
    const rr = worst.riseRatio;
    const tc = clamp01(Math.min(...diffs.map((d) => d.n)) / 8) * qualityK;
    const rate = s?.tpaRate;
    const bp = s?.tpaBreakpoint;
    if (dOs > 10) {
      const cli = [`set tpa_rate = ${Math.min(80, (rate ?? 65) + 10)}`];
      if (bp !== undefined && bp > 1600) cli.push('set tpa_breakpoint = 1500');
      extraCli.push(...cli);
      out.push(advice('pid.tpaMore', 'pid.tpaMore', 'suggest', tc, { params: { os: Math.round(dOs) }, cli }));
    } else if (dOs < -5 && rr > 1.3 && (rate ?? 0) > 0) {
      const cli = [`set tpa_rate = ${Math.max(0, (rate ?? 65) - 10)}`];
      extraCli.push(...cli);
      out.push(advice('pid.tpaLess', 'pid.tpaLess', 'suggest', tc, { params: { os: Math.round(-dOs) }, cli }));
    }
  }

  // dynamic idle (approximate table)
  const prop = o.propInches ?? o.frameInches;
  if (prop) {
    const rec = dynIdleFor(prop);
    if (s?.dshotBidir === false) out.push(advice('pid.dynIdleNeedsBidir', 'pid.dynIdleNeedsBidir', 'info', 1));
    else {
      const cur = s?.dynIdleMinRpm;
      if (cur === undefined || cur === 0 || Math.abs(cur - rec) > rec * 0.25) {
        const cli = [`set dyn_idle_min_rpm = ${rec}`];
        extraCli.push(...cli);
        out.push(advice('pid.dynIdle', 'pid.dynIdle', 'info', 0.5, { params: { inches: prop, rpm: rec, from: cur ?? '?' }, cli, approximate: true }));
      }
    }
  }

  // scale and cap the factors
  const wanted = AXIS_KEYS.some((a) => (['p', 'i', 'd', 'dLow', 'f'] as const).some((g) => Math.abs(fac[a][g] - 1) > 0.01));
  let applied = 0;
  for (const a of AXIS_KEYS) {
    const k = conf[a];
    const f = fac[a];
    for (const g of ['p', 'i', 'd', 'dLow', 'f'] as const) {
      const scaled = k < 0.2 ? 1 : 1 + (f[g] - 1) * k;
      f[g] = Math.round(clamp(scaled, 1 - MAX_CHANGE, 1 + MAX_CHANGE) * 1000) / 1000;
    }
    applied = Math.max(applied, k < 0.2 ? 0 : k);
  }
  if (wanted && applied === 0) out.push(advice('pid.lowConfidence', 'pid.lowConfidence', 'warn', 1, { params: { score: inp.quality } }));

  // raw form
  const axes: PidAxisChange[] = AXIS_KEYS.map((a, idx) => {
    const cur = currentGains(s, a, idx);
    return { axis: a, factors: fac[a], current: cur, suggested: cur ? applyGains(cur, fac[a], scheme) : null };
  });
  const rawLines = axes.flatMap((x) => (x.current && x.suggested ? rawCliLines(x.axis, x.current, x.suggested, scheme) : []));
  const simp = s?.simplified;
  const slidersOn = !!simp && (simp.mode === 'rp' || simp.mode === 'rpy');
  const rawCli = rawLines.length && slidersOn ? ['set simplified_pids_mode = OFF', ...rawLines] : rawLines;

  // slider form
  const sliders: SliderChange[] = [];
  if (slidersOn && simp) {
    const R = fac.roll;
    const Pt = fac.pitch;
    const add = (k: SliderKey, cur: number | undefined, factor: number) => {
      if (cur === undefined || Math.abs(factor - 1) < 0.02) return;
      sliders.push({ slider: k, cli: sliderCliName(k, simp), from: cur, to: roundSlider(cur * factor) });
    };
    add('pi', simp.pi, R.p);
    add('i', simp.i, R.i / R.p);
    add('d', simp.d, R.d * R.dLow);
    add('dmax', simp.dmax, 1 / R.dLow);
    add('ff', simp.ff, R.f);
    add('pitchPi', simp.pitchPi, Pt.p / R.p);
    add('pitchD', simp.pitchD, (Pt.d * Pt.dLow) / (R.d * R.dLow));
    const yaw = axes[2]!;
    if (yaw.current && yaw.suggested && rawCliLines('yaw', yaw.current, yaw.suggested, scheme).length && simp.mode === 'rpy') {
      out.push(advice('pid.yawSliders', 'pid.yawSliders', 'info', 1));
    }
  }
  let sCli = sliderCli(sliders);
  if (slidersOn && simp?.mode === 'rp') {
    const yaw = axes[2]!;
    const yl = yaw.current && yaw.suggested ? rawCliLines('yaw', yaw.current, yaw.suggested, scheme) : [];
    if (yl.length) sCli = [...sCli, ...yl];
  }
  return {
    advice: out,
    axes,
    preferred: slidersOn && simp?.pi !== undefined ? 'sliders' : 'raw',
    rawCli,
    sliders,
    sliderCli: sCli,
    extraCli: [...new Set(extraCli)],
    scale: Math.round(applied * 100) / 100,
  };
}
