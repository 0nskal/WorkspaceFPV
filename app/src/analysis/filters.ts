/**
 * Filter recommendations (pure): RPM filter harmonics / min Hz, dynamic notch count and range, gyro and D-term
 * filter multipliers, filter delay. Inputs: the noise analysis, the header settings, optional frame size.
 * Thresholds marked "heuristic" are rules of thumb, not measured constants.
 */
import { advice, roundSlider, sliderCli, sliderCliName, type Advice, type SliderChange } from './advice';
import type { NoiseAnalysis, Ridge, Spectrogram } from './noise';
import { rpmFilterActive, type LogSettings } from './settings';
import { bestLag, clamp } from './signals';
import type { LogData } from './types';

/** Filtered gyro RMS 100 Hz..max below this [deg/s] = clean (heuristic). */
export const GYRO_CLEAN_RMS = 1.5;
/** Filtered gyro RMS above this [deg/s] = noisy (heuristic). */
export const GYRO_NOISY_RMS = 4;
/** Unfiltered gyro RMS 100 Hz..max below this [deg/s] = quiet airframe (heuristic). */
export const UNFILT_LOW_RMS = 15;
/** D-term HF/LF power ratio above this [dB] = noisy D-term (heuristic). */
export const DTERM_NOISY_DB = -3;
/** D-term HF/LF power ratio below this [dB] = clean D-term (heuristic). */
export const DTERM_CLEAN_DB = -20;
export const DELAY_WARN_MS = 2;

export interface FilterDelay {
  /** Mean delay filtered vs unfiltered gyro [ms]. */
  ms: number;
  corr: number;
  axes: number;
}

/** Delay of the gyro filtering: cross-correlation lag between the unfiltered and the filtered gyro (roll, pitch). */
export function filterDelay(log: LogData): FilterDelay | null {
  const u = log.gyroUnfilt;
  if (!u || u.length < 2) return null;
  const fs = log.fs;
  const n = log.rows;
  const len = Math.min(n, Math.round(30 * fs));
  const from = Math.max(0, Math.floor((n - len) / 2));
  const res: { ms: number; corr: number }[] = [];
  for (let a = 0; a < 2; a++) {
    const r = bestLag(u[a]!, log.gyro[a]!, Math.round(0.012 * fs), from, from + len, 0.6);
    if (r) res.push({ ms: (r.lag / fs) * 1000, corr: r.corr });
  }
  if (!res.length) return null;
  return { ms: Math.round((res.reduce((s, r) => s + r.ms, 0) / res.length) * 100) / 100, corr: Math.round((res.reduce((s, r) => s + r.corr, 0) / res.length) * 1000) / 1000, axes: res.length };
}

/** D-term noise as HF (100 Hz..) over LF (2-50 Hz) power [dB]; null without D-term data. */
export function dtermNoiseDb(s: Spectrogram | null): number | null {
  if (!s || !(s.lfRms > 0)) return null;
  return Math.round(20 * Math.log10(Math.max(s.hfRms, 1e-9) / s.lfRms) * 10) / 10;
}

export interface FilterRecommendation {
  advice: Advice[];
  /** Raw CLI lines of all filter advice (no save). */
  cli: string[];
  sliders: SliderChange[];
  sliderCli: string[];
  delay: FilterDelay | null;
  rpm: { active: boolean | null; harmonicsNeeded: number | null; minHz: number | null };
  dynNotch: { countNeeded: number | null; minHz: number | null; maxHz: number | null };
  gyroNoise: 'clean' | 'ok' | 'noisy' | null;
  dtermNoiseDb: number | null;
}

export interface FilterRecOptions {
  frameInches?: number;
  hotMotors?: boolean;
}

const r5 = (v: number) => Math.round(v / 5) * 5;

/** Ridge frequency at a throttle [%] (linear fit, clamped to the ridge's range). */
const ridgeAt = (r: Ridge, thr: number) => {
  const t = clamp(thr, r.thrLow, r.thrHigh);
  return r.hzAtLow + (r.hzAtHigh - r.hzAtLow) * ((t - r.thrLow) / Math.max(1e-6, r.thrHigh - r.thrLow));
};

/** Harmonic number of a motor ridge relative to the fundamental (compared at a throttle both cover). */
function harmonicOf(r: Ridge, fund: Ridge): number {
  const t = clamp((Math.max(r.thrLow, fund.thrLow) + Math.min(r.thrHigh, fund.thrHigh)) / 2, 0, 100);
  return Math.max(1, Math.round(ridgeAt(r, t) / Math.max(1, ridgeAt(fund, t))));
}

export function recommendFilters(noise: NoiseAnalysis, settings: LogSettings | undefined, delay: FilterDelay | null, o: FilterRecOptions = {}): FilterRecommendation {
  const out: Advice[] = [];
  const F = noise.gyro;
  const U = noise.gyroUnfilt;
  const D = noise.dterm;
  const s = settings;
  const rpmActive = rpmFilterActive(s);
  const sliders: SliderChange[] = [];
  const motorF = F ? F.ridges.filter((r) => r.kind === 'motor' && r.maxProm >= 6) : [];
  const motorU = U ? U.ridges.filter((r) => r.kind === 'motor' && r.maxProm >= 6) : [];
  const anyMotor = [...motorU, ...motorF];
  let harmonicsNeeded: number | null = null;
  let minHz: number | null = null;

  // --- RPM filter
  if (rpmActive === false) {
    const strong = motorF.some((r) => r.maxProm >= 10) || motorU.some((r) => r.maxProm >= 12);
    if (strong) out.push(advice('filters.rpmEnable', 'filters.rpmEnable', 'warn', 0.8, { cli: ['set dshot_bidir = ON', 'set rpm_filter_harmonics = 3'] }));
  } else if (anyMotor.length) {
    const ref = (motorU.length ? motorU : motorF).slice().sort((a, b) => a.meanHz - b.meanHz);
    const fund = ref[0]!;
    const cur = s?.rpmHarmonics ?? 3;
    let need = cur;
    let residualInside = false;
    for (const r of motorF) {
      const k = harmonicOf(r, fund);
      if (k > cur) need = Math.max(need, Math.min(3, k));
      else if (r.maxProm >= 12) residualInside = true;
    }
    harmonicsNeeded = need;
    if (need > cur) out.push(advice('filters.rpmHarmonics', 'filters.rpmHarmonics', 'suggest', 0.7, { params: { from: cur, to: need }, cli: [`set rpm_filter_harmonics = ${need}`] }));
    if (residualInside && rpmActive === true) {
      const q = s?.rpmQ;
      out.push(advice('filters.rpmResidual', 'filters.rpmResidual', 'suggest', 0.5, { params: { poles: s?.motorPoles ?? 14 }, cli: q && q > 300 ? [`set rpm_filter_q = ${Math.max(300, q - 100)}`] : [] }));
    }
    // lowest frequency the motors reach (fundamental at the lowest throttle seen)
    const lowest = Math.min(...ref.filter((r) => harmonicOf(r, fund) === 1).map((r) => Math.min(r.hzAtLow, r.hzAtHigh)));
    if (Number.isFinite(lowest)) {
      minHz = clamp(r5(lowest * 0.85), 50, 200);
      const curMin = s?.rpmMinHz;
      if (rpmActive === true && (curMin === undefined || Math.abs(curMin - minHz) >= 15)) {
        out.push(advice('filters.rpmMinHz', 'filters.rpmMinHz', 'suggest', 0.6, { params: { hz: Math.round(lowest), to: minHz, from: curMin ?? '?' }, cli: [`set rpm_filter_min_hz = ${minHz}`] }));
      }
    }
    // unfiltered gyro shows no 3rd harmonic and the filtered one is clean: 2 harmonics are enough (less delay)
    if (rpmActive === true && U && !motorF.length && cur === 3 && !motorU.some((r) => harmonicOf(r, fund) >= 3)) {
      harmonicsNeeded = 2;
      out.push(advice('filters.rpmFewer', 'filters.rpmFewer', 'info', 0.5, { cli: ['set rpm_filter_harmonics = 2'] }));
    }
  }

  // --- dynamic notch: constant-frequency peaks (unfiltered gyro preferred: the notch already hides them in the filtered one)
  let countNeeded: number | null = null;
  let notchMin: number | null = null;
  let notchMax: number | null = null;
  const src = U ?? F;
  if (src && rpmActive !== false) {
    // with throttle data only ridge-confirmed frame peaks count; without it every non-motor peak does
    const isConst = (sp: Spectrogram) => (p: Spectrogram['peaks'][number]) => p.hz >= 60 && p.prom >= 6 && (p.kind === 'frame' || (!sp.ridges.length && p.kind === 'unknown'));
    const constant = src.peaks.filter(isConst(src));
    const residual = F && F !== src ? F.peaks.filter(isConst(F)) : [];
    const all = [...constant, ...residual].sort((a, b) => a.hz - b.hz);
    const merged: number[] = [];
    for (const p of all) if (!merged.some((h) => Math.abs(h - p.hz) < 25)) merged.push(p.hz);
    countNeeded = Math.min(5, merged.length);
    const curCount = s?.dynNotchCount;
    if (countNeeded === 0) {
      if (rpmActive === true && (curCount ?? 1) > 0) out.push(advice('filters.dynNotchOff', 'filters.dynNotchOff', 'suggest', 0.5, { cli: ['set dyn_notch_count = 0'] }));
    } else {
      const lo = Math.min(...merged);
      const hi = Math.max(...merged);
      notchMin = Math.max(60, r5(lo - 25));
      notchMax = Math.min(1000, Math.max(s?.dynNotchMaxHz ?? 0, Math.ceil((hi + 50) / 50) * 50));
      const cli: string[] = [];
      if (curCount !== countNeeded) cli.push(`set dyn_notch_count = ${countNeeded}`);
      if (s?.dynNotchMinHz === undefined || Math.abs(s.dynNotchMinHz - notchMin) >= 10) cli.push(`set dyn_notch_min_hz = ${notchMin}`);
      if (s?.dynNotchMaxHz !== undefined && hi + 50 > s.dynNotchMaxHz) cli.push(`set dyn_notch_max_hz = ${notchMax}`);
      const sev = all.some((p) => p.resonance) ? 'warn' : 'suggest';
      out.push(advice('filters.dynNotch', 'filters.dynNotch', cli.length ? sev : 'ok', 0.6, { params: { n: countNeeded, hz: Math.round(lo), min: notchMin }, cli }));
    }
  }

  // --- gyro filter multiplier
  let gyroNoise: FilterRecommendation['gyroNoise'] = null;
  const curG = s?.simplified?.gyroMultiplier ?? null;
  const gyroSliderOn = s?.simplified?.gyroFilter !== false;
  const gyroChange = (to: number, key: string, sev: 'suggest' | 'info', conf: number, extraCli: string[] = []) => {
    const from = curG ?? 1;
    const tgt = roundSlider(to, 0.1, 2);
    const ch: SliderChange = { slider: 'gyroMultiplier', cli: sliderCliName('gyroMultiplier'), from: curG, to: tgt };
    const f = tgt / from;
    const cli = [...extraCli];
    if (s?.gyroLpf1DynMinHz) cli.push(`set gyro_lpf1_dyn_min_hz = ${Math.round(s.gyroLpf1DynMinHz * f)}`);
    if (s?.gyroLpf1DynMaxHz) cli.push(`set gyro_lpf1_dyn_max_hz = ${Math.round(s.gyroLpf1DynMaxHz * f)}`);
    if (s?.gyroLpf2StaticHz) cli.push(`set gyro_lpf2_static_hz = ${Math.round(s.gyroLpf2StaticHz * f)}`);
    if (gyroSliderOn) sliders.push(ch);
    out.push(advice(key, key, sev, conf, { params: { from: Math.round(from * 100) / 100, to: tgt }, cli, sliders: gyroSliderOn ? [ch] : [] }));
  };
  if (F) {
    const peaky = F.peaks.some((p) => p.resonance);
    gyroNoise = F.hfRms < GYRO_CLEAN_RMS && !peaky ? 'clean' : F.hfRms > GYRO_NOISY_RMS ? 'noisy' : 'ok';
    const quietFrame = U ? U.hfRms < UNFILT_LOW_RMS : true;
    if (gyroNoise === 'clean' && rpmActive === true && quietFrame) {
      gyroChange((curG ?? 1) + 0.2, 'filters.gyroRaise', 'suggest', U ? 0.6 : 0.4);
      const pidDenom = s?.pidDenom;
      if (pidDenom === 1 && U && U.hfRms < UNFILT_LOW_RMS / 2 && (s?.gyroLpf1StaticHz ?? 1) > 0) {
        out.push(advice('filters.gyroLpf1Off', 'filters.gyroLpf1Off', 'info', 0.4, { cli: ['set gyro_lpf1_static_hz = 0', 'set gyro_lpf1_dyn_min_hz = 0'] }));
      }
    } else if (gyroNoise === 'noisy' && !out.some((a) => a.id === 'filters.rpmEnable' || a.id === 'filters.rpmHarmonics')) {
      gyroChange((curG ?? 1) - 0.2, 'filters.gyroLower', 'suggest', 0.6);
    } else out.push(advice('filters.gyroOk', 'filters.gyroOk', 'ok', 0.6, { params: { rms: Math.round(F.hfRms * 10) / 10 } }));
  }

  // --- D-term filter multiplier
  const dDb = dtermNoiseDb(D);
  const curD = s?.simplified?.dtermMultiplier ?? null;
  const dSliderOn = s?.simplified?.dtermFilter !== false;
  const dChange = (to: number, key: string, sev: 'suggest' | 'warn', conf: number) => {
    const from = curD ?? 1;
    const tgt = roundSlider(to, 0.1, 2);
    const f = tgt / from;
    const ch: SliderChange = { slider: 'dtermMultiplier', cli: sliderCliName('dtermMultiplier'), from: curD, to: tgt };
    const cli: string[] = [];
    if (s?.dtermLpf1DynMinHz) cli.push(`set dterm_lpf1_dyn_min_hz = ${Math.round(s.dtermLpf1DynMinHz * f)}`);
    if (s?.dtermLpf1DynMaxHz) cli.push(`set dterm_lpf1_dyn_max_hz = ${Math.round(s.dtermLpf1DynMaxHz * f)}`);
    if (s?.dtermLpf2StaticHz) cli.push(`set dterm_lpf2_static_hz = ${Math.round(s.dtermLpf2StaticHz * f)}`);
    if (dSliderOn) sliders.push(ch);
    out.push(advice(key, key, sev, conf, { params: { from: Math.round(from * 100) / 100, to: tgt, db: dDb ?? 0 }, cli, sliders: dSliderOn ? [ch] : [] }));
  };
  if (dDb === null) out.push(advice('filters.noDterm', 'filters.noDterm', 'info', 1));
  else if (dDb > DTERM_NOISY_DB) dChange((curD ?? 1) - (dDb > DTERM_NOISY_DB + 6 ? 0.2 : 0.1), 'filters.dtermLower', o.hotMotors ? 'warn' : 'suggest', 0.5);
  else if (dDb < DTERM_CLEAN_DB && !o.hotMotors && gyroNoise === 'clean') dChange((curD ?? 1) + 0.1, 'filters.dtermRaise', 'suggest', 0.4);

  // --- delay
  if (delay) {
    if (delay.ms > DELAY_WARN_MS) out.push(advice('filters.delayHigh', 'filters.delayHigh', 'warn', Math.min(1, delay.corr), { params: { ms: delay.ms } }));
    else out.push(advice('filters.delayOk', 'filters.delayOk', 'ok', Math.min(1, delay.corr), { params: { ms: delay.ms } }));
  }
  if (!U) out.push(advice('filters.noUnfilt', 'filters.noUnfilt', 'info', 1, { cli: ['set debug_mode = GYRO_SCALED'] }));

  const cli = out.flatMap((a) => a.cli);
  return {
    advice: out,
    cli: [...new Set(cli)],
    sliders,
    sliderCli: sliderCli(sliders),
    delay,
    rpm: { active: rpmActive, harmonicsNeeded, minHz },
    dynNotch: { countNeeded, minHz: notchMin, maxHz: notchMax },
    gyroNoise,
    dtermNoiseDb: dDb,
  };
}
