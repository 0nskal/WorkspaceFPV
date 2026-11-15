/** Wykresy SVG ekranu Autotune (styl Rentgen: linie #DCEFF8 z glow, czerwien #FF4A2E dla Roll/zmian). */
import { DB_FLOOR } from '../analysis/analyze';
import type { AnalysisResult } from '../analysis/types';

const INK = '#DCEFF8';
const HOT = '#FF4A2E';
const SUB = '#8FA9B8';

const defs = (id: string) => `<defs>
  <filter id="${id}-g" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <linearGradient id="${id}-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${INK}" stop-opacity=".16"/><stop offset="1" stop-color="${INK}" stop-opacity="0"/></linearGradient>
</defs>`;

const f1 = (v: number) => v.toFixed(1);

/** Wykres odpowiedzi skokowej 0-300 ms z wymiarowanym przeregulowaniem Roll. */
export function stepChart(res: AnalysisResult): string {
  const W = 740;
  const H = 226;
  const l = 46;
  const r = 70;
  const t = 16;
  const b = 34;
  const pw = W - l - r;
  const ph = H - t - b;
  const TMAX = 300;
  let peak = 1.2;
  for (const a of res.axes) if (a.step) for (let i = 0; i <= TMAX; i++) peak = Math.max(peak, a.step[i]!);
  const ymax = Math.max(1.4, Math.ceil((peak + 0.04) * 5) / 5);
  const x = (ms: number) => l + (ms / TMAX) * pw;
  const y = (v: number) => t + (1 - v / ymax) * ph;

  let g = defs('st');
  for (let v = 0; v <= ymax + 1e-6; v += 0.2) {
    g += `<line x1="${l}" x2="${l + pw}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="${INK}" stroke-opacity="${v === 0 ? 0.5 : 0.08}"/>`;
    g += `<text x="${l - 8}" y="${f1(y(v) + 3.5)}" text-anchor="end" class="at-tick">${v.toFixed(1)}</text>`;
  }
  for (let ms = 0; ms <= TMAX; ms += 50) {
    g += `<line x1="${f1(x(ms))}" x2="${f1(x(ms))}" y1="${t + ph}" y2="${t + ph + 4}" stroke="${INK}" stroke-opacity=".5"/>`;
    g += `<text x="${f1(x(ms))}" y="${t + ph + 17}" text-anchor="middle" class="at-tick">${ms}</text>`;
  }
  g += `<text x="${l + pw}" y="${t + ph + 31}" text-anchor="end" class="at-tick">t [ms]</text>`;
  g += `<line x1="${l}" x2="${l + pw}" y1="${f1(y(1))}" y2="${f1(y(1))}" stroke="${INK}" stroke-opacity=".55" stroke-dasharray="1.5 4" stroke-linecap="round"/>`;
  g += `<text x="${l + pw - 4}" y="${f1(y(1) - 6)}" text-anchor="end" class="at-tick">setpoint 1.0</text>`;

  const path = (step: number[]) => {
    let d = '';
    for (let i = 0; i <= TMAX; i += 2) d += `${i === 0 ? 'M' : 'L'}${f1(x(i))} ${f1(y(Math.min(ymax, Math.max(0, step[i]!))))}`;
    return d;
  };
  const [roll, pitch, yaw] = res.axes;
  if (yaw?.step) g += `<path d="${path(yaw.step)}" fill="none" stroke="${INK}" stroke-opacity=".6" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  if (pitch?.step) g += `<path d="${path(pitch.step)}" fill="none" stroke="${INK}" stroke-width="1.7" filter="url(#st-g)"/>`;
  if (roll?.step) g += `<path d="${path(roll.step)}" fill="none" stroke="${HOT}" stroke-width="2.2" filter="url(#st-g)"/>`;

  // wymiar przeregulowania Roll jak na rysunku technicznym
  if (roll?.step && roll.peakTime !== null && roll.peakValue !== null && roll.peakTime <= TMAX && roll.overshoot! >= 1) {
    const px = x(roll.peakTime);
    const py = y(roll.peakValue);
    const dx = l + pw + 26;
    const y1 = y(1);
    g += `<circle cx="${f1(px)}" cy="${f1(py)}" r="3.6" fill="#070B10" stroke="${HOT}" stroke-width="1.6"/>`;
    g += `<text x="${f1(px - 8)}" y="${f1(py - 9)}" text-anchor="end" class="at-tick at-t-ink">${roll.peakValue.toFixed(2)} @ ${roll.peakTime} ms</text>`;
    g += `<line x1="${f1(px + 5)}" x2="${f1(dx + 8)}" y1="${f1(py)}" y2="${f1(py)}" stroke="${INK}" stroke-opacity=".75"/>`;
    g += `<line x1="${f1(l + pw)}" x2="${f1(dx + 8)}" y1="${f1(y1)}" y2="${f1(y1)}" stroke="${INK}" stroke-opacity=".75"/>`;
    g += `<line x1="${f1(dx)}" x2="${f1(dx)}" y1="${f1(py + 1)}" y2="${f1(y1 - 1)}" stroke="${INK}"/>`;
    g += `<path d="M${f1(dx - 3)} ${f1(py + 8)} L${f1(dx)} ${f1(py)} L${f1(dx + 3)} ${f1(py + 8)} M${f1(dx - 3)} ${f1(y1 - 8)} L${f1(dx)} ${f1(y1)} L${f1(dx + 3)} ${f1(y1 - 8)}" fill="none" stroke="${INK}"/>`;
    g += `<text x="${f1(dx + 10)}" y="${f1((py + y1) / 2 + 4)}" class="at-dim" fill="${HOT}">${roll.overshoot!.toFixed(0)}%</text>`;
  }
  if (!roll?.step && !pitch?.step && !yaw?.step) {
    g += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="at-tick">Za mało ruchu drążka w logu, aby policzyć odpowiedź skokową.</text>`;
  }
  return `<svg class="at-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Odpowiedź skokowa Roll, Pitch, Yaw">${g}</svg>`;
}

/** Widmo gyro 0-500 Hz z opisanymi pikami. */
export function spectrumChart(res: AnalysisResult): string {
  const W = 740;
  const H = 200;
  const l = 46;
  const r = 20;
  const t = 14;
  const b = 34;
  const pw = W - l - r;
  const ph = H - t - b;
  const { df, maxHz, db } = res.spectrum;
  const x = (hz: number) => l + (hz / maxHz) * pw;
  const y = (v: number) => t + (Math.min(0, Math.max(DB_FLOOR, v)) / DB_FLOOR) * ph;

  let g = defs('sp');
  for (let v = 0; v >= DB_FLOOR + 1; v -= 20) {
    g += `<line x1="${l}" x2="${l + pw}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="${INK}" stroke-opacity=".08"/>`;
    g += `<text x="${l - 8}" y="${f1(y(v) + 3.5)}" text-anchor="end" class="at-tick">${v}</text>`;
  }
  g += `<line x1="${l}" x2="${l + pw}" y1="${t + ph}" y2="${t + ph}" stroke="${INK}" stroke-opacity=".5"/>`;
  g += `<text x="4" y="${t + 3}" class="at-tick">dB</text>`;
  for (let hz = 0; hz <= maxHz; hz += 100) {
    g += `<line x1="${f1(x(hz))}" x2="${f1(x(hz))}" y1="${t + ph}" y2="${t + ph + 4}" stroke="${INK}" stroke-opacity=".5"/>`;
    g += `<text x="${f1(x(hz))}" y="${t + ph + 17}" text-anchor="middle" class="at-tick">${hz}</text>`;
  }
  g += `<text x="${l + pw}" y="${t + ph + 31}" text-anchor="end" class="at-tick">f [Hz]</text>`;

  const line = (a: number[]) => a.map((v, k) => `${k === 0 ? 'M' : 'L'}${f1(x(k * df))} ${f1(y(v))}`).join('');
  const [dr, dp, dy] = db as [number[], number[], number[]];
  g += `<path d="${line(dy)}" fill="none" stroke="${INK}" stroke-opacity=".28" stroke-dasharray="5 4"/>`;
  g += `<path d="${line(dp)}" fill="none" stroke="${INK}" stroke-opacity=".5"/>`;
  g += `<path d="${line(dr)}L${f1(x((dr.length - 1) * df))} ${t + ph}L${l} ${t + ph}Z" fill="url(#sp-f)"/>`;
  g += `<path d="${line(dr)}" fill="none" stroke="${INK}" stroke-width="1.5" filter="url(#sp-g)"/>`;

  const mark = (hz: number, label: string, hot: boolean, ly: number) => {
    const k = Math.round(hz / df);
    const v = ((dr[k] ?? 0) + (dp[k] ?? 0)) / 2;
    const px = x(hz);
    const py = y(Math.max(dr[k] ?? v, dp[k] ?? v));
    const c = hot ? HOT : INK;
    return (
      `<line x1="${f1(px)}" x2="${f1(px)}" y1="${ly}" y2="${f1(py - 4)}" stroke="${c}" stroke-dasharray="2 3"/>` +
      `<circle cx="${f1(px)}" cy="${f1(py)}" r="3.4" fill="${hot ? HOT : '#070B10'}" stroke="${c}" stroke-width="1.5"/>` +
      `<text x="${f1(px + 7)}" y="${ly + 4}" class="at-tick" fill="${c}" style="fill:${c}">${label}</text>`
    );
  };
  const { motor, frame } = res.peaks;
  if (frame) g += mark(frame.hz, `rama · ${frame.hz.toFixed(0)} Hz`, false, t + 40);
  if (motor) g += mark(motor.hz, `silniki · ${motor.hz.toFixed(0)} Hz`, true, t + 14);
  return `<svg class="at-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Widmo szumu gyro 0-${maxHz} Hz">${g}</svg>`;
}
