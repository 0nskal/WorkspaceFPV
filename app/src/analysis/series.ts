/**
 * Candidate series ("slider sweep"): several flights where one slider (or raw gain) differs, read from each
 * session's header. Each flight gets a score (fast rise, overshoot near the target, no ringing, quick settle; for
 * feedforward: setpoint-to-gyro delay and correlation) and the best one is picked with a reason. Also the recommended
 * tuning procedure as data. Pure.
 */
import { advice, roundSlider, sliderCli, sliderCliName, type Advice, type SliderChange, type SliderKey } from './advice';
import type { LogSettings } from './settings';
import { median } from './signals';
import type { AxisSteps, CurveMetrics } from './step2';

export type SeriesParam = 'master' | 'pi' | 'i' | 'd' | 'dmax' | 'ff' | 'p' | 'dRaw' | 'fRaw';

export interface SeriesItem {
  /** Session index in the file. */
  index: number;
  settings?: LogSettings;
  /** Step analysis of at least roll and pitch. */
  steps: AxisSteps[];
}

export interface SeriesSession {
  index: number;
  value: number | null;
  /** 0..100, null when the flight has too little data. */
  score: number | null;
  overshoot: number | null;
  rise: number | null;
  ringing: number | null;
  settle: number | null;
  trackingDelayMs: number | null;
  trackingCorr: number | null;
  steps: number;
}

export interface SeriesResult {
  param: SeriesParam | null;
  /** Two parameters explain the flights equally well (the first one was used). */
  ambiguous: boolean;
  /** Compared flights. */
  sessions: SeriesSession[];
  /** Session indices left out because other settings differ too. */
  excluded: number[];
  /** Session index of the best flight. */
  best: number | null;
  bestValue: number | null;
  /** Best value sits at the end of the tested range. */
  edge: 'high' | 'low' | null;
  advice: Advice[];
  cli: string[];
}

export interface SeriesOptions {
  hotMotors?: boolean;
  dtermNoisy?: boolean;
  /** Overshoot target [%] (default 8). */
  targetOvershoot?: number;
}

const SLIDER_PARAMS: SeriesParam[] = ['master', 'pi', 'i', 'd', 'dmax', 'ff'];

export function seriesValue(s: LogSettings | undefined, p: SeriesParam): number | null {
  if (!s) return null;
  const sl = s.simplified;
  switch (p) {
    case 'master':
      return sl?.master ?? null;
    case 'pi':
      return sl?.pi ?? null;
    case 'i':
      return sl?.i ?? null;
    case 'd':
      return sl?.d ?? null;
    case 'dmax':
      return sl?.dmax ?? null;
    case 'ff':
      return sl?.ff ?? null;
    case 'p':
      return s.pid?.roll[0] ?? null;
    case 'dRaw':
      return s.pid?.roll[2] ?? null;
    case 'fRaw':
      return s.ff?.[0] ?? null;
  }
}

const RAW_PARAMS: SeriesParam[] = ['p', 'dRaw', 'fRaw'];
const key100 = (v: number | null) => (v === null ? 'x' : String(Math.round(v * 100)));

/**
 * Which parameter the flights differ in: for each candidate, the largest group of flights whose OTHER settings are
 * identical and that holds >= 2 different values of the candidate. Sliders first; raw gains only without sliders.
 * Flights outside the group (e.g. a normal flight between series flights) are left out of the comparison.
 */
export function detectSeriesParam(items: SeriesItem[]): { param: SeriesParam | null; ambiguous: boolean; members: number[] } {
  const search = (ps: SeriesParam[], others: SeriesParam[]) => {
    const found: { p: SeriesParam; members: number[]; distinct: number }[] = [];
    for (const p of ps) {
      const groups = new Map<string, SeriesItem[]>();
      for (const it of items) {
        if (seriesValue(it.settings, p) === null) continue;
        const rest = others.filter((q) => q !== p).map((q) => key100(seriesValue(it.settings, q)));
        // I and FF of the raw PIDs must match too when sweeping raw gains
        if (!SLIDER_PARAMS.includes(p)) rest.push(key100(it.settings?.pid?.roll[1] ?? null));
        const k = rest.join('|');
        groups.set(k, [...(groups.get(k) ?? []), it]);
      }
      for (const g of groups.values()) {
        const d = new Set(g.map((it) => key100(seriesValue(it.settings, p)))).size;
        if (g.length >= 2 && d >= 2) found.push({ p, members: g.map((it) => it.index), distinct: d });
      }
    }
    found.sort((a, b) => b.members.length - a.members.length || b.distinct - a.distinct);
    return found;
  };
  let f = search(SLIDER_PARAMS, SLIDER_PARAMS);
  if (!f.length) f = search(RAW_PARAMS, RAW_PARAMS);
  if (!f.length) return { param: null, ambiguous: false, members: [] };
  const top = f[0]!;
  const ambiguous = f.some((x) => x !== top && x.p !== top.p && x.members.length === top.members.length && x.distinct === top.distinct);
  return { param: top.p, ambiguous, members: top.members };
}

/** PID score of one flight from roll + pitch metrics: 100 minus penalties (rule of thumb weights). */
export function scorePid(m: CurveMetrics, target = 8): number {
  const os = m.overshoot ?? 0;
  const rise = m.rise ?? 120;
  const pen = Math.max(0, Math.abs(os - target) - 3) * 1.5 + Math.max(0, rise - 25) * 0.6 + m.ringing * 6 + (m.settle5 === null ? 15 : Math.max(0, m.settle5 - 80) * 0.15);
  return Math.max(0, 100 - pen);
}

/** Feedforward score: tracking delay and correlation, with an overshoot guard. */
export function scoreFf(delayMs: number, corr: number, os: number): number {
  return Math.max(0, 100 - Math.max(0, delayMs - 2) * 4 - (1 - corr) * 150 - Math.max(0, os - 15) * 1.5);
}

const SLIDER_OF: Partial<Record<SeriesParam, SliderKey>> = { master: 'master', pi: 'pi', i: 'i', d: 'd', dmax: 'dmax', ff: 'ff' };

export function compareSeries(items: SeriesItem[], o: SeriesOptions = {}): SeriesResult {
  const adv: Advice[] = [];
  const { param, ambiguous, members } = detectSeriesParam(items);
  const res: SeriesResult = { param, ambiguous, sessions: [], excluded: [], best: null, bestValue: null, edge: null, advice: adv, cli: [] };
  if (items.length < 2) {
    adv.push(advice('series.tooFew', 'series.tooFew', 'info', 1, { params: { n: items.length } }));
    return res;
  }
  if (!param) {
    adv.push(advice('series.noParam', 'series.noParam', 'info', 1));
    return res;
  }
  if (ambiguous) adv.push(advice('series.ambiguous', 'series.ambiguous', 'warn', 0.5, { params: { param } }));
  res.excluded = items.filter((it) => !members.includes(it.index)).map((it) => it.index);
  if (res.excluded.length) adv.push(advice('series.excluded', 'series.excluded', 'info', 1, { params: { n: res.excluded.length, list: res.excluded.map((i) => `#${i + 1}`).join(', ') } }));
  const isFf = param === 'ff' || param === 'fRaw';
  for (const it of items.filter((x) => members.includes(x.index))) {
    const rp = it.steps.filter((s) => s.axis !== 'yaw');
    const ms = rp.map((s) => s.best).filter((m): m is CurveMetrics => !!m);
    const nSteps = rp.reduce((acc, s) => acc + (s.source === 'steps' ? s.detected.n : 0), 0);
    const avg = (f: (m: CurveMetrics) => number | null) => {
      const v = ms.map(f).filter((x): x is number => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const delay = median(rp.map((s) => s.trackingDelayMs).filter((x): x is number => x !== null));
    const corr = median(rp.map((s) => s.trackingCorr).filter((x): x is number => x !== null));
    let score: number | null = null;
    if (ms.length === rp.length && ms.length > 0) {
      if (isFf) score = delay !== null && corr !== null ? scoreFf(delay, corr, avg((m) => m.overshoot) ?? 0) : null;
      else score = ms.reduce((acc, m) => acc + scorePid(m, o.targetOvershoot), 0) / ms.length;
    }
    res.sessions.push({
      index: it.index,
      value: seriesValue(it.settings, param),
      score: score === null ? null : Math.round(score * 10) / 10,
      overshoot: avg((m) => m.overshoot),
      rise: avg((m) => m.rise),
      ringing: avg((m) => m.ringing),
      settle: avg((m) => m.settle5),
      trackingDelayMs: delay,
      trackingCorr: corr,
      steps: nSteps,
    });
  }
  const scored = res.sessions.filter((s) => s.score !== null && s.value !== null);
  if (scored.length < 2) {
    adv.push(advice('series.noData', 'series.noData', 'warn', 1));
    return res;
  }
  // best score; near-ties (< 2 points) go to the lower value (less motor heat, more margin)
  const top = Math.max(...scored.map((s) => s.score!));
  const best = scored.filter((s) => s.score! >= top - 2).sort((a, b) => a.value! - b.value!)[0]!;
  const values = [...new Set(scored.map((s) => s.value!))].sort((a, b) => a - b);
  res.best = best.index;
  res.bestValue = best.value;
  const scores = scored.map((s) => s.score!);
  const flat = Math.max(...scores) - Math.min(...scores) < 3;
  const fmt = (v: number) => (SLIDER_OF[param] ? Math.round(v * 100) / 100 : v);
  const conf = Math.min(1, scored.length / 4);
  if (flat) adv.push(advice('series.flat', 'series.flat', 'info', conf, { params: { value: fmt(best.value!) } }));
  const sl = SLIDER_OF[param];
  const s0 = items.find((it) => it.index === best.index)?.settings;
  const ch: SliderChange[] = sl ? [{ slider: sl, cli: sliderCliName(sl, s0?.simplified), from: null, to: roundSlider(best.value!) }] : [];
  const rawName = param === 'p' ? 'p' : param === 'dRaw' ? 'd' : param === 'fRaw' ? 'f' : null;
  const cli = sl ? sliderCli(ch) : rawName ? ['roll', 'pitch'].map((a) => `set ${rawName}_${a} = ${best.value}`) : [];
  adv.push(advice('series.best', isFf ? 'series.bestFf' : 'series.best', 'suggest', conf, { params: { param, value: fmt(best.value!), session: best.index + 1, score: best.score! }, cli, sliders: ch }));
  res.cli.push(...cli);
  if (values.length >= 3) {
    if (best.value === values[values.length - 1]) res.edge = 'high';
    else if (best.value === values[0]) res.edge = 'low';
  }
  if (res.edge === 'high') {
    adv.push(advice('series.edgeHigh', 'series.edgeHigh', 'info', conf, { params: { value: fmt(best.value!) } }));
    const simp = s0?.simplified;
    if (param === 'master' && !o.hotMotors && !o.dtermNoisy && simp?.d !== undefined && simp.pi !== undefined && best.value! > 1) {
      const m = best.value!;
      const trick: SliderChange[] = [
        { slider: 'master', cli: sliderCliName('master'), from: m, to: 1 },
        { slider: 'd', cli: sliderCliName('d'), from: simp.d, to: roundSlider(simp.d * m) },
        { slider: 'pi', cli: sliderCliName('pi'), from: simp.pi, to: roundSlider(simp.pi * m) },
      ];
      const tcli = sliderCli(trick);
      adv.push(advice('series.doubleTrick', 'series.doubleTrick', 'info', conf * 0.8, { params: { value: fmt(m) }, cli: tcli, sliders: trick }));
    } else if (param === 'master' && (o.hotMotors || o.dtermNoisy)) adv.push(advice('series.edgeHot', 'series.edgeHot', 'warn', conf));
  } else if (res.edge === 'low') adv.push(advice('series.edgeLow', 'series.edgeLow', 'info', conf, { params: { value: fmt(best.value!) } }));

  // P&I series should be flown with I = 0 and FF = 0
  if (param === 'pi' || param === 'p') {
    const busy = items.filter((it) => members.includes(it.index)).some((it) => (it.settings?.pid && (it.settings.pid.roll[1] > 0 || it.settings.pid.pitch[1] > 0)) || (it.settings?.ff && (it.settings.ff[0] > 0 || it.settings.ff[1] > 0)));
    if (busy) adv.push(advice('series.iffNotZero', 'series.iffNotZero', 'info', 1));
  }
  return res;
}

export type ProcedureId = 'filters' | 'piSeries' | 'masterSeries' | 'restoreI' | 'ffSeries' | 'dynIdle';

export interface ProcedureStep {
  id: ProcedureId;
  /** i18n key (autotune2.proc.<id>). */
  key: string;
  /** Slider swept in this step and suggested values to fly (one flight per value). */
  slider?: SliderKey;
  values?: number[];
  /** CLI to prepare the step (e.g. I = 0 and FF = 0 for the P&I series). */
  prepare?: string[];
  acroOnly?: boolean;
}

/** Recommended order: filters -> P&I series (I = 0, FF = 0) -> master series -> restore I -> FF series (acro) -> dynamic idle. */
export const PROCEDURE: ProcedureStep[] = [
  { id: 'filters', key: 'autotune2.proc.filters' },
  { id: 'piSeries', key: 'autotune2.proc.piSeries', slider: 'pi', values: [0.6, 0.8, 1.0, 1.2, 1.4], prepare: ['set simplified_i_gain = 0', 'set simplified_feedforward_gain = 0', 'simplified_tuning apply'] },
  { id: 'masterSeries', key: 'autotune2.proc.masterSeries', slider: 'master', values: [1.0, 1.25, 1.5, 1.75, 2.0] },
  { id: 'restoreI', key: 'autotune2.proc.restoreI', slider: 'i', values: [1.0] },
  { id: 'ffSeries', key: 'autotune2.proc.ffSeries', slider: 'ff', values: [0.5, 1.0, 1.5, 2.0], acroOnly: true },
  { id: 'dynIdle', key: 'autotune2.proc.dynIdle' },
];

/** Procedure step after the series that was just flown (null when unknown). */
export function nextProcedureStep(param: SeriesParam | null): ProcedureId | null {
  switch (param) {
    case 'pi':
    case 'p':
      return 'masterSeries';
    case 'master':
      return 'restoreI';
    case 'i':
      return 'ffSeries';
    case 'ff':
    case 'fRaw':
      return 'dynIdle';
    default:
      return null;
  }
}
