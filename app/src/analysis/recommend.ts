/** Rekomendacje regulowe z wynikow analizy (bez AI). */
import { fmtNum, t } from '../i18n';
import type { AnalysisResult, PidTriple } from './types';

export type Pid3 = { roll: PidTriple; pitch: PidTriple; yaw: PidTriple };

export interface Note {
  level: 'ok' | 'warn' | 'hot';
  text: string;
}

export interface AxisRec {
  axis: 'roll' | 'pitch' | 'yaw';
  name: string;
  /** Mnozniki P i D (1 = bez zmian). */
  pF: number;
  dF: number;
  /** Czy wolne narastanie sugeruje podniesienie FF. */
  ffUp: boolean;
  current: PidTriple | null;
  suggested: PidTriple | null;
}

export interface Recommendation {
  axes: AxisRec[];
  notes: Note[];
  commands: string[];
  motorNoiseHigh: boolean;
  frameNoiseHigh: boolean;
}

export const NOISE_PROM_DB = 12;
const clamp = (v: number) => Math.max(0, Math.min(250, Math.round(v)));

export function recommend(res: AnalysisResult, cur: Pid3 | null, bidirOn: boolean | null): Recommendation {
  const notes: Note[] = [];
  const commands: string[] = [];
  const motorNoiseHigh = !!res.peaks.motor && res.peaks.motor.prom >= NOISE_PROM_DB;
  const frameNoiseHigh = !!res.peaks.frame && res.peaks.frame.prom >= NOISE_PROM_DB;
  const keys = ['roll', 'pitch', 'yaw'] as const;

  const axes: AxisRec[] = res.axes.map((a, idx) => {
    const key = keys[idx]!;
    let pF = 1;
    let dF = 1;
    let ffUp = false;
    const os = a.overshoot;
    if (os === null || !a.step) {
      notes.push({ level: 'warn', text: t('at.rec.noStick', { axis: a.name }) });
    } else if (os > 10 && key !== 'yaw') {
      let f = os > 25 ? 1.2 : os > 15 ? 1.15 : 1.1;
      if (motorNoiseHigh && bidirOn !== true) f = Math.min(f, 1.1);
      dF = f;
      if (os > 20) pF = 0.95;
      notes.push({ level: 'hot', text: t('at.rec.overshoot', { axis: a.name, os: os.toFixed(0), d: Math.round((dF - 1) * 100), p: pF < 1 ? t('at.rec.overshootP') : '' }) });
      if (f < (os > 25 ? 1.2 : os > 15 ? 1.15 : 1.1)) notes.push({ level: 'warn', text: t('at.rec.noisyD') });
    } else if (os > 10) {
      notes.push({ level: 'warn', text: t('at.rec.overshootYaw', { axis: a.name, os: os.toFixed(0) }) });
    } else if (os < 3 && a.rise !== null && a.rise > (key === 'yaw' ? 90 : 60)) {
      pF = 1.08;
      ffUp = true;
      notes.push({ level: 'warn', text: t('at.rec.slowRise', { axis: a.name, ms: a.rise.toFixed(0) }) });
    } else {
      notes.push({ level: 'ok', text: t('at.rec.fine', { axis: a.name, os: os.toFixed(0), settle: a.settle !== null ? t('at.rec.fineSettle', { ms: a.settle }) : '' }) });
    }
    const c = cur?.[key] ?? null;
    const s: PidTriple | null = c ? [clamp(c[0] * pF), c[1], key === 'yaw' ? c[2] : clamp(c[2] * dF)] : null;
    if (c && s) {
      if (s[0] !== c[0]) commands.push(`set p_${key} = ${s[0]}`);
      if (s[2] !== c[2]) commands.push(`set d_${key} = ${s[2]}`);
    }
    return { axis: key, name: a.name, pF, dF, ffUp, current: c, suggested: s };
  });

  if (motorNoiseHigh && res.peaks.motor) {
    const m = res.peaks.motor;
    if (bidirOn !== true) {
      notes.push({ level: 'hot', text: t('at.rec.motorNoiseNoBidir', { hz: m.hz.toFixed(0), db: m.prom.toFixed(0) }) });
      commands.push('set dshot_bidir = ON', 'set rpm_filter_harmonics = 3');
    } else {
      notes.push({ level: 'warn', text: t('at.rec.motorNoiseBidir', { hz: m.hz.toFixed(0) }) });
    }
  }
  if (frameNoiseHigh && res.peaks.frame) {
    notes.push({ level: 'warn', text: t('at.rec.frameResonance', { hz: res.peaks.frame.hz.toFixed(0) }) });
  }
  if (!motorNoiseHigh && !frameNoiseHigh) notes.push({ level: 'ok', text: t('at.rec.clean') });
  if (res.rcFallback) notes.push({ level: 'warn', text: t('at.rec.rcFallback') });

  return { axes, notes, commands, motorNoiseHigh, frameNoiseHigh };
}

/** Streszczenie metryk dla AI (bez surowych danych). */
export function summarize(res: AnalysisResult, rec: Recommendation): string {
  const none = t('at.sum.none');
  const f = (v: number | null, d = 0, u = '') => (v === null ? none : `${fmtNum(v, d)}${u}`);
  const pk = (p: { hz: number; prom: number } | null) => (p ? `${p.hz.toFixed(0)} Hz (+${p.prom.toFixed(0)} dB)` : none);
  const name = res.name || t('at.sampleName');
  const lines = [
    t('at.sum.head', { name, s: res.duration.toFixed(0), fs: Math.round(res.fs) }),
    ...res.axes.map((a) => t('at.sum.axis', { axis: a.name, os: f(a.overshoot, 0, '%'), rise: f(a.rise, 0, ' ms'), settle: a.settle === null ? '>500 ms' : a.settle + ' ms' })),
    t('at.sum.peaks', { m: pk(res.peaks.motor), f: pk(res.peaks.frame) }),
    ...rec.axes.filter((a) => a.current && a.suggested).map((a) => t('at.sum.pid', { axis: a.name, cur: a.current!.join('/'), sug: a.suggested!.join('/') })),
    rec.commands.length ? t('at.sum.rules', { cmds: rec.commands.join('; ') }) : t('at.sum.rulesNone'),
  ];
  return lines.join('\n') + '\n\n' + t('at.sum.ask');
}
