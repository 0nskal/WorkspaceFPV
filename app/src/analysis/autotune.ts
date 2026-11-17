/**
 * Auto-tune engine, single entry point: autotune(sessions, opts) -> AutotuneResult.
 * Pure and synchronous (progress through a callback), structured-clone safe result, runs in the analysis worker
 * (run-core.ts processAutotune / run.ts runAutotune).
 *
 * What each part needs in the log:
 * - step response: setpoint[0..2] (rcCommand fallback is weaker) and gyroADC[0..2]
 * - throttle bands, spectrogram, propwash: rcCommand[3] (or motor[] + motorOutput header)
 * - motor saturation exclusion: motor[] + motorOutput header
 * - unfiltered spectrum, filter delay, RPM / notch advice: gyroUnfilt[] or debug[0..2] with debug_mode = GYRO_SCALED
 * - D-term noise: axisD[0..1]
 * - slider / raw PID output and filter CLI: the header (rollPID..., simplified_*, filter keys)
 */
import { advice, type Advice } from './advice';
import { analyze } from './analyze';
import { filterDelay, recommendFilters, dtermNoiseDb, DTERM_NOISY_DB, type FilterDelay, type FilterRecommendation } from './filters';
import { analyzeNoise, type NoiseAnalysis } from './noise';
import { recommendPids, type PidRecommendation } from './pidrec';
import { detectPropwash, type PropwashResult } from './propwash';
import { scoreQuality, type LogQuality } from './quality';
import { compareSeries, nextProcedureStep, PROCEDURE, type ProcedureId, type ProcedureStep, type SeriesResult } from './series';
import type { LogSettings } from './settings';
import { badMask, throttlePct } from './signals';
import { analyzeAxisSteps, AXIS_KEYS, type AxisSteps } from './step2';
import type { AnalysisResult, LogData } from './types';

export const AUTOTUNE_VERSION = 2;

export interface AutotuneOptions {
  /** Frame size [inches] for the frequency bands and the D/P range. */
  frameInches?: number;
  /** Prop size [inches] for the dynamic idle table (defaults to frameInches). */
  propInches?: number;
  /** User says the motors come down hot: never raise D. */
  hotMotors?: boolean;
  /** Session to analyse in detail (index into the input array); default: the longest usable one. */
  session?: number;
  /** Compare the sessions as a candidate series (default: true when >= 2 usable sessions). */
  series?: boolean;
  /** Display name for the legacy AnalysisResult. */
  name?: string;
}

export interface SessionSummary {
  index: number;
  duration: number;
  fs: number;
  rows: number;
  usable: boolean;
  firmware: string | null;
  craft: string | null;
}

export interface LogNeeds {
  header: boolean;
  setpoint: boolean;
  throttle: boolean;
  motors: boolean;
  motorRange: boolean;
  unfiltered: boolean;
  dterm: boolean;
  /** Advice for a better next log (autotune2.needs.*). */
  advice: Advice[];
}

export interface AutotuneResult {
  version: typeof AUTOTUNE_VERSION;
  /** Index (into the input) of the analysed session. */
  session: number;
  sessions: SessionSummary[];
  settings: LogSettings | null;
  /** Legacy analysis of the analysed session (charts, old recommend()). */
  analysis: AnalysisResult;
  quality: LogQuality;
  needs: LogNeeds;
  steps: AxisSteps[];
  noise: NoiseAnalysis;
  propwash: PropwashResult;
  filterDelay: FilterDelay | null;
  filters: FilterRecommendation;
  pids: PidRecommendation;
  series: SeriesResult | null;
  procedure: ProcedureStep[];
  nextStep: ProcedureId | null;
  /** Wall time of the run [ms]. */
  ms: number;
}

const MIN_ROWS = 1000;

function needsOf(log: LogData): LogNeeds {
  const out: LogNeeds = {
    header: !!log.settings,
    setpoint: !log.rcFallback,
    throttle: !!log.throttle,
    motors: log.motor.length > 0,
    motorRange: !!(log.motorRange ?? log.settings?.motorOutput),
    unfiltered: !!log.gyroUnfilt,
    dterm: !!log.axisD,
    advice: [],
  };
  const add = (k: string, cli: string[] = []) => out.advice.push(advice(`needs.${k}`, `needs.${k}`, 'info', 1, { cli }));
  if (!out.header) add('header');
  if (!out.setpoint) add('setpoint');
  if (!out.throttle) add('throttle');
  if (!out.unfiltered) add('unfiltered', ['set debug_mode = GYRO_SCALED']);
  if (!out.dterm) add('dterm');
  if (log.fs < 1000) add('rate', ['set blackbox_sample_rate = 1/2']);
  return out;
}

/** Steps of roll + pitch (+ yaw) for one session. */
function stepsOf(log: LogData, thr: Float32Array | null, mask: Uint8Array, axes = 3): AxisSteps[] {
  return AXIS_KEYS.slice(0, axes).map((a, i) => analyzeAxisSteps(a, log.setpoint[i]!, log.gyro[i]!, log.fs, thr, mask));
}

export function autotune(input: LogData | LogData[], opts: AutotuneOptions = {}, onProgress?: (frac: number) => void): AutotuneResult {
  const t0 = Date.now();
  const logs = Array.isArray(input) ? input : [input];
  const prog = (f: number) => onProgress?.(Math.max(0, Math.min(1, f)));
  const sessions: SessionSummary[] = logs.map((l, index) => ({
    index,
    duration: l.duration,
    fs: l.fs,
    rows: l.rows,
    usable: l.rows >= MIN_ROWS,
    firmware: l.settings?.firmwareRevision ?? null,
    craft: l.settings?.craft ?? null,
  }));
  let idx = opts.session ?? -1;
  if (!(idx >= 0 && idx < logs.length && sessions[idx]!.usable)) {
    idx = -1;
    for (const s of sessions) if (s.usable && (idx < 0 || s.duration > sessions[idx]!.duration)) idx = s.index;
  }
  if (idx < 0) throw Object.assign(new Error('at.err.tooShort'), { code: 'short', key: 'at.err.tooShort', params: { n: Math.max(0, ...logs.map((l) => l.rows)) } });
  const log = logs[idx]!;
  const settings = log.settings ?? null;
  const frame = opts.frameInches;

  prog(0.02);
  const analysis = analyze(log, opts.name ?? '');
  const quality = scoreQuality(analysis);
  prog(0.2);
  const thr = throttlePct(log);
  const mask = badMask(log, thr);
  const steps = stepsOf(log, thr, mask);
  prog(0.45);
  const noise = analyzeNoise(log, thr, mask, frame);
  prog(0.65);
  const propwash = detectPropwash(log, thr, mask, noise.bands.propwash);
  const delay = filterDelay(log);
  const filters = recommendFilters(noise, settings ?? undefined, delay, { ...(frame ? { frameInches: frame } : {}), ...(opts.hotMotors ? { hotMotors: true } : {}) });
  const pids = recommendPids({ steps, noise, propwash, settings: settings ?? undefined, quality: quality.score }, opts);
  prog(0.75);

  let series: SeriesResult | null = null;
  const usable = sessions.filter((s) => s.usable);
  if (usable.length >= 2 && opts.series !== false) {
    const items = usable.map((s, k) => {
      const l = logs[s.index]!;
      const st = s.index === idx ? steps.slice(0, 2) : (() => {
        const th = throttlePct(l);
        return stepsOf(l, th, badMask(l, th), 2);
      })();
      prog(0.75 + (0.23 * (k + 1)) / usable.length);
      return { index: s.index, ...(l.settings ? { settings: l.settings } : {}), steps: st };
    });
    const dDb = dtermNoiseDb(noise.dterm);
    series = compareSeries(items, { ...(opts.hotMotors ? { hotMotors: true } : {}), dtermNoisy: dDb !== null && dDb > DTERM_NOISY_DB });
  }
  prog(1);
  return {
    version: AUTOTUNE_VERSION,
    session: idx,
    sessions,
    settings,
    analysis,
    quality,
    needs: needsOf(log),
    steps,
    noise,
    propwash,
    filterDelay: delay,
    filters,
    pids,
    series,
    procedure: PROCEDURE,
    nextStep: series ? nextProcedureStep(series.param) : null,
    ms: Date.now() - t0,
  };
}
