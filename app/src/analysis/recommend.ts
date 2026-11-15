/** Rekomendacje regulowe z wynikow analizy (bez AI). */
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
      notes.push({ level: 'warn', text: `${a.name}: za mało ruchu drążka w logu, brak odpowiedzi skokowej.` });
    } else if (os > 10 && key !== 'yaw') {
      let f = os > 25 ? 1.2 : os > 15 ? 1.15 : 1.1;
      if (motorNoiseHigh && bidirOn !== true) f = Math.min(f, 1.1);
      dF = f;
      if (os > 20) pF = 0.95;
      notes.push({ level: 'hot', text: `${a.name}: przeregulowanie ${os.toFixed(0)}%. Podnoszę D o ${Math.round((dF - 1) * 100)}%${pF < 1 ? ' i obniżam P o 5%' : ''}.` });
      if (f < (os > 25 ? 1.2 : os > 15 ? 1.15 : 1.1)) notes.push({ level: 'warn', text: 'Szum silników jest wysoki, więc D podnoszę ostrożnie. Najpierw włącz filtr RPM.' });
    } else if (os > 10) {
      notes.push({ level: 'warn', text: `${a.name}: przeregulowanie ${os.toFixed(0)}% (yaw zwykle poprawia się przez filtry, nie D).` });
    } else if (os < 3 && a.rise !== null && a.rise > (key === 'yaw' ? 90 : 60)) {
      pF = 1.08;
      ffUp = true;
      notes.push({ level: 'warn', text: `${a.name}: wolne narastanie (${a.rise.toFixed(0)} ms). Sugeruję P +8% i mocniejszy FF.` });
    } else {
      notes.push({ level: 'ok', text: `${a.name}: przeregulowanie ${os.toFixed(0)}%${a.settle !== null ? `, ustala się w ${a.settle} ms` : ''}. Bez zmian.` });
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
      notes.push({ level: 'hot', text: `Szum silników przy ${m.hz.toFixed(0)} Hz (+${m.prom.toFixed(0)} dB). Włącz bidirectional DShot i filtr RPM (3 harmoniczne).` });
      commands.push('set dshot_bidir = ON', 'set rpm_filter_harmonics = 3');
    } else {
      notes.push({ level: 'warn', text: `Szum silników przy ${m.hz.toFixed(0)} Hz mimo filtra RPM. Sprawdź śmigła, łożyska i dokręcenie silników.` });
    }
  }
  if (frameNoiseHigh && res.peaks.frame) {
    notes.push({ level: 'warn', text: `Rezonans ramy przy ${res.peaks.frame.hz.toFixed(0)} Hz. Włącz dynamic notch (dyn_notch_count 2–3) i sprawdź dokręcenie ramy.` });
  }
  if (!motorNoiseHigh && !frameNoiseHigh) notes.push({ level: 'ok', text: 'Widmo gyro czyste, bez wyraźnych pików szumu.' });
  if (res.rcFallback) notes.push({ level: 'warn', text: 'Brak kolumn setpoint: użyto rcCommand, więc wyniki są przybliżone.' });

  return { axes, notes, commands, motorNoiseHigh, frameNoiseHigh };
}

/** Streszczenie metryk dla AI (bez surowych danych). */
export function summarize(res: AnalysisResult, rec: Recommendation): string {
  const f = (v: number | null, d = 0, u = '') => (v === null ? 'brak' : `${v.toFixed(d)}${u}`);
  const lines = [
    `Analiza logu blackbox "${res.name}": ${res.duration.toFixed(0)} s, ${Math.round(res.fs)} Hz próbkowania.`,
    ...res.axes.map((a) => `${a.name}: przeregulowanie ${f(a.overshoot, 0, '%')}, czas narastania ${f(a.rise, 0, ' ms')}, ustalanie ${a.settle === null ? '>500 ms' : a.settle + ' ms'}.`),
    `Szczyt silników: ${res.peaks.motor ? `${res.peaks.motor.hz.toFixed(0)} Hz (+${res.peaks.motor.prom.toFixed(0)} dB)` : 'brak'}; szczyt ramy: ${res.peaks.frame ? `${res.peaks.frame.hz.toFixed(0)} Hz (+${res.peaks.frame.prom.toFixed(0)} dB)` : 'brak'}.`,
    ...rec.axes.filter((a) => a.current && a.suggested).map((a) => `PID ${a.name} obecne P/I/D ${a.current!.join('/')} -> sugerowane ${a.suggested!.join('/')}.`),
    rec.commands.length ? `Moje reguły proponują: ${rec.commands.join('; ')}.` : 'Reguły nie proponują zmian.',
  ];
  return lines.join('\n') + '\n\nOceń te wyniki i powiedz, czy proponowane zmiany PID/filtrów są rozsądne dla tego drona. Podaj poprawki jako blok cli.';
}
