/** SVG charts for the PID Tuning tab (Rentgen style): rate curves, throttle curve, filter response sketch. */
import type { Values } from '../bf/fieldtable';
import { RATES_TYPES, axisRatesFromValues, lowpassGain, notchGain, rateAt, throttleCurve, toDb, type AxisRates, type RatesType } from '../bf/tuning';
import { t } from '../i18n';

const INK = '#DCEFF8';
const HOT = '#FF4A2E';
const SUB = '#8FA9B8';
const f1 = (v: number) => v.toFixed(1);

export const ratesTypeOf = (v: Values): RatesType => RATES_TYPES[v.ratesType ?? 0] ?? 'betaflight';

const DASH = ['', '7 4', '2 4'];

function frame(W: number, H: number, l: number, tp: number, r: number, b: number) {
  return { W, H, l, t: tp, pw: W - l - r, ph: H - tp - b, b };
}

/** Deflection (0..100 %) vs rate (deg/s) for the three axes. `orig` is drawn dotted under an axis that was edited. */
export function ratesChart(cur: Values, orig: Values): string {
  const type = ratesTypeOf(cur);
  const otype = ratesTypeOf(orig);
  const c = frame(560, 250, 46, 12, 14, 30);
  const rates = (v: Values, a: 0 | 1 | 2): AxisRates => axisRatesFromValues(v, a);
  const N = 50;
  const pts = (ty: RatesType, r: AxisRates) => Array.from({ length: N + 1 }, (_, i) => [i / N, Math.abs(rateAt(ty, r, i / N))] as const);
  const all = [0, 1, 2].flatMap((a) => [...pts(type, rates(cur, a as 0 | 1 | 2)), ...pts(otype, rates(orig, a as 0 | 1 | 2))]);
  const peak = Math.max(300, ...all.map((p) => p[1]));
  const ymax = Math.ceil(peak / 200) * 200;
  const x = (u: number) => c.l + u * c.pw;
  const y = (v: number) => c.t + (1 - v / ymax) * c.ph;
  let g = '';
  const step = ymax > 1200 ? 400 : 200;
  for (let v = 0; v <= ymax; v += step) {
    g += `<line x1="${c.l}" x2="${c.l + c.pw}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="${INK}" stroke-opacity="${v === 0 ? 0.5 : 0.09}"/>`;
    g += `<text x="${c.l - 7}" y="${f1(y(v) + 3.5)}" text-anchor="end" class="bf-tuning-tick">${v}</text>`;
  }
  for (let p = 0; p <= 100; p += 25) {
    g += `<line x1="${f1(x(p / 100))}" x2="${f1(x(p / 100))}" y1="${c.t}" y2="${c.t + c.ph}" stroke="${INK}" stroke-opacity="${p === 0 ? 0.5 : 0.07}"/>`;
    g += `<text x="${f1(x(p / 100))}" y="${c.t + c.ph + 15}" text-anchor="middle" class="bf-tuning-tick">${p}%</text>`;
  }
  g += `<text x="${c.l + c.pw}" y="${c.t + c.ph + 27}" text-anchor="end" class="bf-tuning-tick">${t('bfTuning.rates.axisX')}</text>`;
  g += `<text x="${c.l + 6}" y="${c.t + 10}" class="bf-tuning-tick">${t('bfTuning.rates.axisY')}</text>`;
  const path = (p: readonly (readonly [number, number])[]) => p.map((q, i) => `${i ? 'L' : 'M'}${f1(x(q[0]))} ${f1(y(q[1]))}`).join('');
  const labels: Array<{ v: number; y: number; hot: boolean }> = [];
  for (let a = 2; a >= 0; a--) {
    const r = rates(cur, a as 0 | 1 | 2);
    const o = rates(orig, a as 0 | 1 | 2);
    const changed = type !== otype || r.rcRate !== o.rcRate || r.expo !== o.expo || r.superRate !== o.superRate || r.limit !== o.limit;
    if (changed) g += `<path d="${path(pts(otype, o))}" fill="none" stroke="${SUB}" stroke-width="1.2" stroke-dasharray="1.5 3.5" stroke-linecap="round"/>`;
    g += `<path d="${path(pts(type, r))}" fill="none" stroke="${changed ? HOT : INK}" stroke-width="${a === 0 ? 2.2 : 1.8}" ${DASH[a] ? `stroke-dasharray="${DASH[a]}"` : ''}/>`;
    const mx = pts(type, r)[N]![1];
    if (!labels.some((l) => l.v === Math.round(mx))) labels.push({ v: Math.round(mx), y: y(mx) - 5, hot: changed });
  }
  // end-of-curve max labels: equal values once, close ones pushed apart so they never overlap
  labels.sort((p, q) => p.y - q.y);
  for (let i = 1; i < labels.length; i++) labels[i]!.y = Math.max(labels[i]!.y, labels[i - 1]!.y + 11);
  for (const l of labels) g += `<text x="${f1(x(1) - 4)}" y="${f1(l.y)}" text-anchor="end" class="bf-tuning-tick ${l.hot ? 'hot' : 'ink'}">${l.v}</text>`;
  return `<svg class="bf-tuning-svg" viewBox="0 0 ${c.W} ${c.H}" role="img" aria-label="${t('bfTuning.rates.chartAria')}">${g}</svg>`;
}

export const maxRatesOf = (v: Values): [number, number, number] => {
  const ty = ratesTypeOf(v);
  return [0, 1, 2].map((a) => Math.round(Math.abs(rateAt(ty, axisRatesFromValues(v, a as 0 | 1 | 2), 1)))) as [number, number, number];
};

/** Throttle curve chart; `api` selects the firmware curve (4.5 table or the 2025.12 Bezier through thr_hover). */
export function throttleChart(cur: Values, orig: Values, api = 46): string {
  const c = frame(260, 250, 34, 12, 12, 30);
  const x = (u: number) => c.l + u * c.pw;
  const y = (u: number) => c.t + (1 - u) * c.ph;
  const N = 40;
  const line = (mid: number, expo: number, hover?: number) => Array.from({ length: N + 1 }, (_, i) => `${i ? 'L' : 'M'}${f1(x(i / N))} ${f1(y(throttleCurve(mid, expo, i / N, { hover, api })))}`).join('');
  let g = '';
  for (let p = 0; p <= 100; p += 25) {
    g += `<line x1="${c.l}" x2="${c.l + c.pw}" y1="${f1(y(p / 100))}" y2="${f1(y(p / 100))}" stroke="${INK}" stroke-opacity="${p === 0 ? 0.5 : 0.09}"/>`;
    g += `<text x="${c.l - 6}" y="${f1(y(p / 100) + 3.5)}" text-anchor="end" class="bf-tuning-tick">${p}</text>`;
    g += `<line x1="${f1(x(p / 100))}" x2="${f1(x(p / 100))}" y1="${c.t}" y2="${c.t + c.ph}" stroke="${INK}" stroke-opacity="${p === 0 ? 0.5 : 0.07}"/>`;
    g += `<text x="${f1(x(p / 100))}" y="${c.t + c.ph + 15}" text-anchor="middle" class="bf-tuning-tick">${p}</text>`;
  }
  g += `<text x="${c.l + c.pw}" y="${c.t + c.ph + 27}" text-anchor="end" class="bf-tuning-tick">${t('bfTuning.rates.thrX')}</text>`;
  const changed = cur.throttleMid !== orig.throttleMid || cur.throttleExpo !== orig.throttleExpo || (api >= 47 && cur.throttleHover !== orig.throttleHover);
  if (changed) g += `<path d="${line(orig.throttleMid ?? 50, orig.throttleExpo ?? 0, orig.throttleHover)}" fill="none" stroke="${SUB}" stroke-width="1.2" stroke-dasharray="1.5 3.5" stroke-linecap="round"/>`;
  g += `<path d="${line(cur.throttleMid ?? 50, cur.throttleExpo ?? 0, cur.throttleHover)}" fill="none" stroke="${changed ? HOT : INK}" stroke-width="2"/>`;
  const hov = cur.throttleHover;
  if (hov !== undefined) g += `<line x1="${c.l}" x2="${c.l + c.pw}" y1="${f1(y(hov / 100))}" y2="${f1(y(hov / 100))}" stroke="${INK}" stroke-opacity=".45" stroke-dasharray="3 4"/><text x="${c.l + 4}" y="${f1(y(hov / 100) - 4)}" class="bf-tuning-tick">${t('bfTuning.rates.hover')} ${hov}%</text>`;
  return `<svg class="bf-tuning-svg" viewBox="0 0 ${c.W} ${c.H}" role="img" aria-label="${t('bfTuning.rates.throttleAria')}">${g}</svg>`;
}

/** Gain in dB for a frequency, from the filter settings (sketch: ignores the PID loop/gyro rate interplay). */
export function filterChart(v: Values): string {
  const c = frame(640, 270, 46, 12, 16, 34);
  const FMIN = 20;
  const FMAX = 1000;
  const DBMIN = -36;
  const x = (f: number) => c.l + (Math.log10(f / FMIN) / Math.log10(FMAX / FMIN)) * c.pw;
  const y = (db: number) => c.t + (1 - (Math.max(DBMIN, Math.min(3, db)) - DBMIN) / (3 - DBMIN)) * c.ph;
  let g = '';
  for (let db = 0; db >= DBMIN; db -= 12) {
    g += `<line x1="${c.l}" x2="${c.l + c.pw}" y1="${f1(y(db))}" y2="${f1(y(db))}" stroke="${INK}" stroke-opacity="${db === 0 ? 0.5 : 0.09}"/>`;
    g += `<text x="${c.l - 7}" y="${f1(y(db) + 3.5)}" text-anchor="end" class="bf-tuning-tick">${db}</text>`;
  }
  for (const f of [20, 50, 100, 200, 500, 1000]) {
    g += `<line x1="${f1(x(f))}" x2="${f1(x(f))}" y1="${c.t}" y2="${c.t + c.ph}" stroke="${INK}" stroke-opacity=".07"/>`;
    g += `<text x="${f1(x(f))}" y="${c.t + c.ph + 15}" text-anchor="middle" class="bf-tuning-tick">${f}</text>`;
  }
  g += `<text x="${c.l + c.pw}" y="${c.t + c.ph + 29}" text-anchor="end" class="bf-tuning-tick">Hz</text><text x="${c.l + 6}" y="${c.t + 10}" class="bf-tuning-tick">dB</text>`;

  const freqs: number[] = [];
  for (let i = 0; i <= 120; i++) freqs.push(FMIN * Math.pow(FMAX / FMIN, i / 120));
  const curve = (fn: (f: number) => number) => freqs.map((f, i) => `${i ? 'L' : 'M'}${f1(x(f))} ${f1(y(toDb(fn(f))))}`).join('');

  // dynamic notch band
  const nMin = v.dynNotchMin ?? 0;
  const nMax = v.dynNotchMax ?? 0;
  const nCount = v.dynNotchCount ?? 0;
  if (nCount > 0 && nMin > 0 && nMax > nMin) {
    g += `<rect x="${f1(x(Math.max(FMIN, nMin)))}" y="${c.t}" width="${f1(x(Math.min(FMAX, nMax)) - x(Math.max(FMIN, nMin)))}" height="${c.ph}" fill="${INK}" fill-opacity=".07"/>`;
    g += `<text x="${f1(x(Math.max(FMIN, nMin)) + 5)}" y="${c.t + c.ph - 6}" class="bf-tuning-tick">${t('bfTuning.filters.dynBand', { n: nCount })}</text>`;
    const q = (v.dynNotchQ ?? 300) / 100;
    const mid = Math.sqrt(nMin * nMax);
    g += `<path d="${curve((f) => notchGain(mid, q, f))}" fill="none" stroke="${INK}" stroke-opacity=".5" stroke-width="1" stroke-dasharray="2 3"/>`;
  }
  // RPM filter: harmonics start at min Hz
  const harm = v.rpmHarmonics ?? 0;
  const rpmMin = v.rpmMinHz ?? 0;
  if (harm > 0 && rpmMin > 0) {
    g += `<line x1="${f1(x(rpmMin))}" x2="${f1(x(rpmMin))}" y1="${c.t}" y2="${c.t + c.ph}" stroke="${HOT}" stroke-opacity=".7" stroke-dasharray="4 3"/>`;
    g += `<text x="${f1(x(rpmMin) + 4)}" y="${c.t + 12}" class="bf-tuning-tick hot">${t('bfTuning.filters.rpmMark', { n: harm, hz: rpmMin })}</text>`;
  }
  // gyro: LPF1 (dynamic range or static) * LPF2
  const gType1 = v.gyroLpf1Type ?? 0;
  const gType2 = v.gyroLpf2Type ?? 0;
  const gDyn = (v.gyroLpf1DynMin ?? 0) > 0 && (v.gyroLpf1DynMax ?? 0) > 0 && !(v.gyroLpf1Hz ?? 0);
  const gyro = (lp1: number) => (f: number) => lowpassGain(gType1, lp1, f) * lowpassGain(gType2, v.gyroLpf2Hz ?? 0, f);
  if (gDyn) {
    g += `<path d="${curve(gyro(v.gyroLpf1DynMin!))}" fill="none" stroke="${INK}" stroke-opacity=".4" stroke-width="1.2"/>`;
    g += `<path d="${curve(gyro(v.gyroLpf1DynMax!))}" fill="none" stroke="${INK}" stroke-width="2"/>`;
  } else g += `<path d="${curve(gyro(v.gyroLpf1Hz ?? 0))}" fill="none" stroke="${INK}" stroke-width="2"/>`;
  // D-term
  const dDyn = (v.dtermLpf1DynMin ?? 0) > 0 && (v.dtermLpf1DynMax ?? 0) > 0;
  const dT1 = v.dtermLpf1Type ?? 0;
  const dT2 = v.dtermLpf2Type ?? 0;
  const dterm = (lp1: number) => (f: number) => lowpassGain(dT1, lp1, f) * lowpassGain(dT2, v.dtermLpf2Hz ?? 0, f);
  if (dDyn) {
    g += `<path d="${curve(dterm(v.dtermLpf1DynMin!))}" fill="none" stroke="${SUB}" stroke-opacity=".5" stroke-width="1.2" stroke-dasharray="6 4"/>`;
    g += `<path d="${curve(dterm(v.dtermLpf1DynMax!))}" fill="none" stroke="${SUB}" stroke-width="1.8" stroke-dasharray="6 4"/>`;
  } else g += `<path d="${curve(dterm(v.dtermLpf1Hz ?? 0))}" fill="none" stroke="${SUB}" stroke-width="1.8" stroke-dasharray="6 4"/>`;
  return `<svg class="bf-tuning-svg" viewBox="0 0 ${c.W} ${c.H}" role="img" aria-label="${t('bfTuning.filters.chartAria')}">${g}</svg>`;
}
