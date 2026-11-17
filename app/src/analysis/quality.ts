/**
 * Log quality: how much a blackbox log can be trusted for a PID proposal. Pure functions, no DOM, no i18n
 * (logStats runs in the analysis worker; the screen translates the advice codes).
 *
 * Components (points, sum 100): step windows 25, maneuvers per axis 25, sample rate 15, throttle coverage 15,
 * duration 10, motor saturation 10. A component without data (no throttle column, unknown motor range) is left out
 * and the score is scaled to the components that were measured.
 */
import type { AnalysisResult, LogData, LogStats } from './types';

/** Setpoint above this [deg/s] counts as a deliberate stick move. */
export const ACTIVE_DPS = 40;
/** Seconds of stick movement per axis for full points. */
export const ACTIVE_GOOD_SEC = 4;
/** Usable step-response windows per axis for full points. */
export const WINDOWS_GOOD = 12;
export const RATE_GOOD_HZ = 1600;
export const THROTTLE_BINS = 10;
/** A throttle bin counts as covered when it holds at least this share of the samples. */
const BIN_MIN_SHARE = 0.004;

/** Coverage statistics of a parsed log (activity per axis, throttle bins, motor saturation). */
export function logStats(log: LogData): LogStats {
  const n = log.rows;
  const activeSec = [0, 1, 2].map((a) => {
    const sp = log.setpoint[a];
    if (!sp) return 0;
    let c = 0;
    for (let i = 0; i < n; i++) if (Math.abs(sp[i]!) > ACTIVE_DPS) c++;
    return c / log.fs;
  }) as [number, number, number];

  let throttleCoverage: number | null = null;
  const th = log.throttle;
  if (th && th.length) {
    const bins = new Array<number>(THROTTLE_BINS).fill(0);
    for (let i = 0; i < th.length; i++) {
      const pct = (th[i]! - 1000) / 1000;
      const b = Math.min(THROTTLE_BINS - 1, Math.max(0, Math.floor(pct * THROTTLE_BINS)));
      bins[b]!++;
    }
    throttleCoverage = bins.filter((c) => c / th.length >= BIN_MIN_SHARE).length / THROTTLE_BINS;
  }

  let saturation: number | null = null;
  const range = log.motorRange;
  if (range && log.motor.length && range[1] > range[0]) {
    const top = range[1] - (range[1] - range[0]) * 0.02;
    let c = 0;
    for (let i = 0; i < n; i++) {
      for (const m of log.motor) {
        if (m[i]! >= top) {
          c++;
          break;
        }
      }
    }
    saturation = n ? c / n : 0;
  }
  return { activeSec, throttleCoverage, saturation };
}

export type QualityLabel = 'good' | 'ok' | 'poor';

/** What to fly or change next time (translated by the screen: atFlow.import.advice.<code>). */
export type AdviceCode = 'moreRoll' | 'morePitch' | 'moreYaw' | 'moreSteps' | 'throttleRange' | 'noThrottle' | 'sampleRate' | 'longer' | 'saturation' | 'rcFallback';

export interface QualityPart {
  id: 'windows' | 'maneuvers' | 'rate' | 'throttle' | 'duration' | 'saturation';
  /** 0..1, or null when the log has no data for it. */
  value: number | null;
  weight: number;
}

export interface LogQuality {
  score: number;
  label: QualityLabel;
  parts: QualityPart[];
  advice: AdviceCode[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Scores a finished analysis (needs `res.stats`; without it only windows, rate and duration count). */
export function scoreQuality(res: Pick<AnalysisResult, 'axes' | 'fs' | 'duration' | 'rcFallback' | 'stats'>): LogQuality {
  const advice: AdviceCode[] = [];
  const st = res.stats;
  const winScores = [0, 1, 2].map((a) => clamp01((res.axes[a]?.step ? res.axes[a]!.windows : 0) / WINDOWS_GOOD));
  const windows = winScores.reduce((s, v) => s + v, 0) / 3;
  const act = st ? st.activeSec.map((s) => clamp01(s / ACTIVE_GOOD_SEC)) : null;
  const maneuvers = act ? act.reduce((s, v) => s + v, 0) / 3 : null;
  const rate = clamp01((res.fs - 500) / (RATE_GOOD_HZ - 500));
  // 30-90 s of real maneuvers is the target; very short logs lose points, long ones do not
  const duration = clamp01((res.duration - 8) / (30 - 8));
  const throttle = st?.throttleCoverage ?? null;
  const saturation = st?.saturation == null ? null : clamp01(1 - st.saturation / 0.05);

  const parts: QualityPart[] = [
    { id: 'windows', value: windows, weight: 25 },
    { id: 'maneuvers', value: maneuvers, weight: 25 },
    { id: 'rate', value: rate, weight: 15 },
    { id: 'throttle', value: throttle === null ? null : clamp01(throttle / 0.7), weight: 15 },
    { id: 'duration', value: duration, weight: 10 },
    { id: 'saturation', value: saturation, weight: 10 },
  ];
  let got = 0;
  let max = 0;
  for (const p of parts) {
    if (p.value === null) continue;
    got += p.value * p.weight;
    max += p.weight;
  }
  const score = max ? Math.round((got / max) * 100) : 0;
  const label: QualityLabel = score >= 75 ? 'good' : score >= 50 ? 'ok' : 'poor';

  const axisAdvice: AdviceCode[] = ['moreRoll', 'morePitch', 'moreYaw'];
  for (let a = 0; a < 3; a++) {
    const weak = act ? act[a]! < 0.6 || winScores[a]! < 0.5 : winScores[a]! < 0.5;
    if (weak) advice.push(axisAdvice[a]!);
  }
  if (windows < 0.5 && !advice.length) advice.push('moreSteps');
  if (throttle === null) advice.push('noThrottle');
  else if (throttle < 0.5) advice.push('throttleRange');
  if (res.fs < RATE_GOOD_HZ) advice.push('sampleRate');
  if (res.duration < 25) advice.push('longer');
  if (st?.saturation != null && st.saturation > 0.03) advice.push('saturation');
  if (res.rcFallback) advice.push('rcFallback');
  return { score, label, parts, advice };
}
