/**
 * Autotune PID, pure decisions on top of the engine result (analysis/autotune.ts):
 * - verdicts(): traffic lights for Basic mode (flight feel, vibrations, propwash, log quality) with a reason code
 * - basicPlan(): the ONE change set Basic mode offers (sliders preferred, small when the data is thin, nothing on a
 *   poor log: then what to fly again)
 * - applyUnits() / mergeCommands(): the selectable change units of Expert mode and their merged CLI
 * - roundMetrics() / compareRounds(): "better / worse than last flight"
 * No DOM, no i18n: codes are translated by the screen (atFlow.basic.* / atFlow.expert.*).
 */
import { sliderCli, type Advice, type Severity } from '../analysis/advice';
import type { AutotuneResult } from '../analysis/autotune';
import { DTERM_NOISY_DB } from '../analysis/filters';
import type { AdviceCode } from '../analysis/quality';

export type EngineResult = Pick<AutotuneResult, 'quality' | 'steps' | 'filters' | 'propwash' | 'pids' | 'noise' | 'series' | 'needs'>;

/* ---------------- traffic lights ---------------- */

export type Light = 'good' | 'fair' | 'bad' | 'unknown';
export type AreaId = 'feel' | 'noise' | 'propwash' | 'log';
export const AREAS: AreaId[] = ['feel', 'noise', 'propwash', 'log'];

export interface AreaVerdict {
  id: AreaId;
  light: Light;
  /** Reason code: atFlow.basic.v.<id>.<code>. */
  code: string;
  params: Record<string, string | number>;
}

/** Overshoot that still counts as a clean response [%] (freestyle rule of thumb: 5-10 % ideal). */
export const FEEL_OS_FAIR = 12;
export const FEEL_OS_BAD = 25;
/** Rise time above this [ms] feels slow on a 5" quad (rule of thumb, same as pidrec.ts). */
export const FEEL_SLOW_MS = 80;

/** Worst roll/pitch response metrics (null when neither axis has any). */
export function worstFeel(r: Pick<EngineResult, 'steps'>): { os: number; rise: number | null; ring: number } | null {
  const ms = r.steps.filter((s) => s.axis !== 'yaw' && s.best && s.best.overshoot !== null).map((s) => s.best!);
  if (!ms.length) return null;
  const rises = ms.map((m) => m.rise ?? (m.latency50 !== null ? 999 : null)).filter((v): v is number => v !== null);
  return { os: Math.max(...ms.map((m) => m.overshoot!)), rise: rises.length ? Math.max(...rises) : null, ring: Math.max(...ms.map((m) => m.ringing)) };
}

export function verdicts(r: EngineResult): AreaVerdict[] {
  const out: AreaVerdict[] = [];
  // flight feel: roll/pitch step response
  const w = worstFeel(r);
  if (!w) out.push({ id: 'feel', light: 'unknown', code: 'noData', params: {} });
  else {
    const params = { os: Math.round(w.os), rise: w.rise === null ? '?' : w.rise >= 999 ? '>300' : Math.round(w.rise) };
    if (w.os > FEEL_OS_BAD || w.ring >= 4) out.push({ id: 'feel', light: 'bad', code: 'bouncy', params });
    else if (w.os > FEEL_OS_FAIR || w.ring >= 3) out.push({ id: 'feel', light: 'fair', code: 'bouncy', params });
    else if (w.rise !== null && w.rise > FEEL_SLOW_MS) out.push({ id: 'feel', light: 'fair', code: 'slow', params });
    else out.push({ id: 'feel', light: 'good', code: 'good', params });
  }
  // vibrations: filtered gyro, D-term, RPM filter, resonances
  const g = r.filters.gyroNoise;
  const d = r.filters.dtermNoiseDb;
  const rpmOff = r.filters.advice.some((a) => a.id === 'filters.rpmEnable');
  const peak = r.noise.gyro?.peaks.find((p) => p.resonance);
  if (g === null && d === null) out.push({ id: 'noise', light: 'unknown', code: 'noData', params: {} });
  else if (rpmOff) out.push({ id: 'noise', light: 'bad', code: 'rpmOff', params: {} });
  else if (g === 'noisy') out.push({ id: 'noise', light: 'bad', code: 'noisy', params: {} });
  else if (d !== null && d > DTERM_NOISY_DB) out.push({ id: 'noise', light: 'fair', code: 'dterm', params: { db: d } });
  else if (peak) out.push({ id: 'noise', light: 'fair', code: peak.kind === 'low' ? 'lowPeak' : 'peak', params: { hz: Math.round(peak.hz) } });
  else out.push({ id: 'noise', light: 'good', code: 'clean', params: {} });
  // propwash
  const pw = r.propwash;
  const pp = { ratio: pw.ratio ?? 0, events: pw.events };
  if (pw.level === 'severe') out.push({ id: 'propwash', light: 'bad', code: 'bad', params: pp });
  else if (pw.level === 'moderate') out.push({ id: 'propwash', light: 'fair', code: 'fair', params: pp });
  else if (pw.level === 'none') out.push({ id: 'propwash', light: 'good', code: 'good', params: pp });
  else out.push({ id: 'propwash', light: 'unknown', code: pw.level === 'noThrottle' ? 'noThrottle' : 'few', params: pp });
  // log quality
  const q = r.quality;
  out.push({ id: 'log', light: q.label === 'good' ? 'good' : q.label === 'ok' ? 'fair' : 'bad', code: q.label === 'good' ? 'good' : q.label === 'ok' ? 'fair' : 'bad', params: { score: q.score } });
  return out;
}

/* ---------------- merged CLI ---------------- */

const APPLY = 'simplified_tuning apply';

/** Concatenates command lists without duplicates; `simplified_tuning apply` runs once, after every `set`. */
export function mergeCommands(lists: string[][]): string[] {
  const out: string[] = [];
  let apply = false;
  for (const l of lists)
    for (const c of l) {
      if (c.trim() === APPLY) apply = true;
      else if (!out.includes(c)) out.push(c);
    }
  return apply ? [...out, APPLY] : out;
}

/* ---------------- Basic mode: one change set ---------------- */

export interface PlanItem {
  /** atFlow.basic.what.<code> / atFlow.basic.note.<code>. */
  code: string;
  params?: Record<string, string | number>;
}

export interface BasicPlan {
  kind: 'change' | 'none';
  reason: 'change' | 'poorLog' | 'lowConfidence' | 'allGood' | 'noNumbers';
  commands: string[];
  form: 'sliders' | 'raw' | null;
  /** What the change does, in plain words. */
  items: PlanItem[];
  /** Small change on purpose (medium log or low confidence). */
  conservative: boolean;
  /** What to fly next time (quality advice) when the plan is empty for lack of data. */
  flyAgain: AdviceCode[];
  /** Things worth knowing that the plan does not do (hardware, ESC firmware). */
  notes: PlanItem[];
}

/** Below this change scale (log quality x confidence, pidrec.ts) the plan is called conservative. */
export const CONFIDENT_SCALE = 0.5;

export function basicPlan(r: EngineResult): BasicPlan {
  const notes: PlanItem[] = [];
  if (r.filters.advice.some((a) => a.id === 'filters.rpmEnable')) notes.push({ code: 'rpmOff' });
  const plan = (p: Partial<BasicPlan> & Pick<BasicPlan, 'kind' | 'reason'>): BasicPlan => ({ commands: [], form: null, items: [], conservative: false, flyAgain: [], notes, ...p });
  const q = r.quality;
  if (q.label === 'poor') return plan({ kind: 'none', reason: 'poorLog', flyAgain: q.advice.filter((a) => a !== 'noThrottle') });

  const conservative = r.pids.scale < CONFIDENT_SCALE || q.label === 'ok';
  // PIDs: the sliders when the quad uses them (a tiny slider change is skipped rather than switching the sliders off)
  let pidCmds: string[] = [];
  let form: BasicPlan['form'] = null;
  if (r.pids.scale > 0) {
    if (r.pids.preferred === 'sliders') {
      pidCmds = r.pids.sliderCli;
      form = 'sliders';
    } else {
      pidCmds = r.pids.rawCli;
      form = 'raw';
    }
  }
  const items: PlanItem[] = [];
  if (pidCmds.length) {
    const rp = r.pids.axes.filter((a) => a.axis !== 'yaw');
    const avg = (g: 'p' | 'i' | 'd' | 'dLow' | 'f') => rp.reduce((s, a) => s + a.factors[g], 0) / Math.max(1, rp.length);
    if (avg('d') > 1.01) items.push({ code: 'moreDamping' });
    if (avg('dLow') > 1.01) items.push({ code: 'propwash' });
    if (avg('p') < 0.99) items.push({ code: 'calmer' });
    if (avg('p') > 1.01) items.push({ code: 'sharper' });
    if (avg('i') > 1.01) items.push({ code: 'holdBetter' });
    if (avg('f') > 1.01) items.push({ code: 'quickerSticks' });
    if (avg('d') < 0.99) items.push({ code: 'lessDamping' });
    const yaw = r.pids.axes.find((a) => a.axis === 'yaw');
    if (yaw && yaw.factors.p < 0.99) items.push({ code: 'yawCalmer' });
    if (!items.length) items.push({ code: 'fineTune' });
  }
  // filters: only the two filter sliders, only from a good log
  let filterCmds: string[] = [];
  if (!conservative && r.filters.sliders.length) {
    filterCmds = sliderCli(r.filters.sliders);
    for (const s of r.filters.sliders) {
      if (s.from !== null && Math.round(s.from * 100) === Math.round(s.to * 100)) continue;
      const up = s.to > (s.from ?? 1);
      if (s.slider === 'gyroMultiplier') items.push({ code: up ? 'lessFilterDelay' : 'moreFiltering' });
      else if (s.slider === 'dtermMultiplier') items.push({ code: up ? 'lessFilterDelay' : 'coolerD' });
    }
  }
  const commands = mergeCommands([pidCmds, filterCmds]);
  if (!commands.length) {
    const wanted = r.pids.advice.some((a) => a.id === 'pid.lowConfidence');
    if (wanted) return plan({ kind: 'none', reason: 'lowConfidence', flyAgain: q.advice.filter((a) => a !== 'noThrottle') });
    const changeWanted = r.pids.axes.some((a) => (['p', 'i', 'd', 'dLow', 'f'] as const).some((g) => Math.abs(a.factors[g] - 1) > 0.01));
    if (changeWanted && r.pids.axes.every((a) => !a.current)) return plan({ kind: 'none', reason: 'noNumbers' });
    return plan({ kind: 'none', reason: 'allGood' });
  }
  const uniq = items.filter((it, i) => items.findIndex((x) => x.code === it.code) === i);
  return plan({ kind: 'change', reason: 'change', commands, form: pidCmds.length ? form : 'sliders', items: uniq, conservative });
}

/* ---------------- Expert mode: selectable units ---------------- */

export type UnitGroup = 'pid' | 'filters' | 'extra' | 'series' | 'needs';

export interface ApplyUnit {
  /** 'pid' for the PID change set, otherwise the advice id. */
  id: string;
  group: UnitGroup;
  commands: string[];
  severity: Severity;
  confidence: number;
  /** Ticked by default. */
  on: boolean;
}

const ACTIVE: Severity[] = ['suggest', 'warn', 'critical'];

/** Every change the expert can tick, in the chosen form (simplified sliders or raw CLI). */
export function applyUnits(r: EngineResult, form: 'sliders' | 'raw'): ApplyUnit[] {
  const out: ApplyUnit[] = [];
  const p = r.pids;
  const pidCmds = form === 'sliders' && p.sliderCli.length ? p.sliderCli : p.rawCli.length ? p.rawCli : p.sliderCli;
  if (pidCmds.length) out.push({ id: 'pid', group: 'pid', commands: pidCmds, severity: 'suggest', confidence: p.scale, on: p.scale >= 0.2 });
  const add = (a: Advice, group: UnitGroup, on: boolean) => {
    const cmds = form === 'sliders' && a.sliders.length ? sliderCli(a.sliders) : a.cli.length ? a.cli : sliderCli(a.sliders);
    if (!cmds.length || out.some((u) => u.id === a.id)) return;
    out.push({ id: a.id, group, commands: cmds, severity: a.severity, confidence: a.confidence, on });
  };
  for (const a of r.filters.advice) add(a, 'filters', ACTIVE.includes(a.severity) && a.confidence >= 0.5 && a.id !== 'filters.rpmEnable');
  for (const a of p.advice) add(a, 'extra', ACTIVE.includes(a.severity) && !a.approximate && a.confidence >= 0.4);
  for (const a of r.series?.advice ?? []) add(a, 'series', false);
  for (const a of r.needs.advice) add(a, 'needs', false);
  return out;
}

export function selectedCommands(units: ApplyUnit[], selected: ReadonlySet<string>): string[] {
  return mergeCommands(units.filter((u) => selected.has(u.id)).map((u) => u.commands));
}

/* ---------------- rounds ---------------- */

export interface RoundMetrics {
  /** Worst roll/pitch overshoot [%]. */
  overshoot: number | null;
  rise: number | null;
  ringing: number | null;
  /** Filtered gyro RMS above 100 Hz [deg/s]. */
  noise: number | null;
  /** Propwash energy ratio. */
  propwash: number | null;
  quality: number;
}

export function roundMetrics(r: EngineResult): RoundMetrics {
  const w = worstFeel(r);
  return {
    overshoot: w ? Math.round(w.os * 10) / 10 : null,
    rise: w && w.rise !== null && w.rise < 999 ? Math.round(w.rise * 10) / 10 : null,
    ringing: w ? w.ring : null,
    noise: r.noise.gyro ? Math.round(r.noise.gyro.hfRms * 100) / 100 : null,
    propwash: r.propwash.ratio,
    quality: r.quality.score,
  };
}

export type Trend = 'better' | 'worse' | 'same' | null;
export type CompareItem = 'feel' | 'speed' | 'noise' | 'propwash';

/** Overshoot the comparison aims for [%] (middle of the 5-10 % freestyle target). */
export const TARGET_OS = 8;

const tr = (prev: number | null, cur: number | null, tol: number): Trend => {
  if (prev === null || cur === null) return null;
  if (Math.abs(cur - prev) <= tol) return 'same';
  return cur < prev ? 'better' : 'worse';
};

export function compareRounds(prev: RoundMetrics, cur: RoundMetrics): { items: Record<CompareItem, Trend>; overall: 'better' | 'worse' | 'same' | 'mixed' | 'unknown' } {
  const items: Record<CompareItem, Trend> = {
    feel: tr(prev.overshoot === null ? null : Math.abs(prev.overshoot - TARGET_OS), cur.overshoot === null ? null : Math.abs(cur.overshoot - TARGET_OS), 2),
    speed: tr(prev.rise, cur.rise, 3),
    noise: prev.noise !== null && cur.noise !== null ? tr(prev.noise, cur.noise, Math.max(0.2, prev.noise * 0.1)) : null,
    propwash: tr(prev.propwash, cur.propwash, 0.3),
  };
  const v = Object.values(items).filter((x): x is Exclude<Trend, null> => x !== null);
  const better = v.filter((x) => x === 'better').length;
  const worse = v.filter((x) => x === 'worse').length;
  const overall = !v.length ? 'unknown' : better && worse ? 'mixed' : better ? 'better' : worse ? 'worse' : 'same';
  return { items, overall };
}
