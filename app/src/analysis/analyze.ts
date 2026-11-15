import { findPeaks, nextPow2, welchPsd } from './fft';
import { stepMetrics, stepResponse } from './step';
import type { AnalysisResult, AxisResult, LogData } from './types';

const AXES = ['Roll', 'Pitch', 'Yaw'] as const;
export const DB_FLOOR = -70;

export function analyze(log: LogData, name = ''): AnalysisResult {
  const fs = log.fs;
  const maxHz = Math.min(500, Math.floor(fs / 2));
  const nfft = Math.max(256, nextPow2(Math.round(fs / 2)));

  // widmo gyro
  let df = fs / nfft;
  const psds: Float64Array[] = [];
  for (let a = 0; a < 3; a++) {
    const r = welchPsd(log.gyro[a]!, fs, nfft, maxHz);
    df = r.df;
    psds.push(r.psd);
  }
  let ref = 0;
  const lo = Math.ceil(20 / df);
  for (const p of psds) for (let k = lo; k < p.length; k++) ref = Math.max(ref, p[k]!);
  if (!(ref > 0)) ref = 1;
  const db = psds.map((p) => Array.from(p, (v) => Math.max(DB_FLOOR, 10 * Math.log10(Math.max(v, 1e-30) / ref))));

  // piki z usrednionego Roll+Pitch
  const avg = db[0]!.map((v, k) => (v + db[1]![k]!) / 2);
  const peaks = findPeaks(avg, df, 40, maxHz, 6);
  const motor = peaks.filter((p) => p.hz > 150).sort((a, b) => b.prom - a.prom)[0] ?? null;
  const frame = peaks.filter((p) => p.hz >= 80 && p.hz <= 180 && p !== motor).sort((a, b) => b.prom - a.prom)[0] ?? null;

  // odpowiedz skokowa
  const axes: AxisResult[] = AXES.map((nm, a) => {
    const { step, windows } = stepResponse(log.setpoint[a]!, log.gyro[a]!, fs);
    const m = step ? stepMetrics(step) : { overshoot: null, peakValue: null, peakTime: null, rise: null, settle: null };
    return { name: nm, step, windows, ...m };
  });

  return { name, fs, duration: log.duration, rows: log.rows, rcFallback: log.rcFallback, axes, spectrum: { df, maxHz, db }, peaks: { motor, frame } };
}
