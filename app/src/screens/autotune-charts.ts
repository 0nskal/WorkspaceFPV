/**
 * Charts of the Autotune PID tab, lightweight and dependency-free: SVG strings for the line charts (X-ray style: ink
 * #DCEFF8 with a soft glow, red #FF4A2E for roll / what matters) and one canvas for the spectrogram heatmap.
 * Colour is never the only cue: lines also differ in dash pattern and every chart has a text legend in the screen.
 */
import type { Spectrogram, FrameBands, RidgeKind } from '../analysis/noise';

export const INK = '#DCEFF8';
export const HOT = '#FF4A2E';
export const AMBER = '#E0A82E';
export const GREEN = '#5FD3A5';
export const BLUE = '#8FB8FF';
/** Series / rounds palette with dash patterns, so lines stay apart without colour. */
export const SERIES_STYLE: Array<{ color: string; dash: string }> = [
  { color: BLUE, dash: '2 3' },
  { color: GREEN, dash: '7 3' },
  { color: INK, dash: '' },
  { color: AMBER, dash: '10 3 2 3' },
  { color: HOT, dash: '' },
  { color: '#C79BFF', dash: '4 4' },
];

const f1 = (v: number) => v.toFixed(1);
const defs = (id: string) => `<defs>
  <filter id="${id}-g" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <linearGradient id="${id}-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${INK}" stop-opacity=".16"/><stop offset="1" stop-color="${INK}" stop-opacity="0"/></linearGradient>
</defs>`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

let uid = 0;

export interface StepLine {
  /** Normalised response, 1 ms per point (1 = setpoint). */
  y: ArrayLike<number> | null;
  color: string;
  dash?: string;
  width?: number;
  glow?: boolean;
  /** Overshoot dimension at the peak (only for one line). */
  dim?: boolean;
}

/** Step response chart 0..tmax ms with the setpoint line and the +-5 % settle band. */
export function stepChart(lines: StepLine[], o: { aria: string; noData: string; tmax?: number; h?: number }): string {
  const W = 740;
  const H = o.h ?? 210;
  const l = 46;
  const r = 66;
  const t = 14;
  const b = 32;
  const pw = W - l - r;
  const ph = H - t - b;
  const TMAX = o.tmax ?? 300;
  const id = `st${++uid}`;
  let peak = 1.2;
  for (const ln of lines) if (ln.y) for (let i = 0; i <= TMAX && i < ln.y.length; i++) peak = Math.max(peak, ln.y[i]!);
  const ymax = Math.min(2.4, Math.max(1.4, Math.ceil((peak + 0.04) * 5) / 5));
  const x = (ms: number) => l + (ms / TMAX) * pw;
  const y = (v: number) => t + (1 - v / ymax) * ph;
  let g = defs(id);
  // settle band +-5 %
  g += `<rect x="${l}" y="${f1(y(1.05))}" width="${pw}" height="${f1(y(0.95) - y(1.05))}" fill="${INK}" fill-opacity=".05"/>`;
  for (let v = 0; v <= ymax + 1e-6; v += 0.2) {
    g += `<line x1="${l}" x2="${l + pw}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="${INK}" stroke-opacity="${v === 0 ? 0.5 : 0.08}"/>`;
    g += `<text x="${l - 8}" y="${f1(y(v) + 3.5)}" text-anchor="end" class="at-tick">${v.toFixed(1)}</text>`;
  }
  for (let ms = 0; ms <= TMAX; ms += 50) {
    g += `<line x1="${f1(x(ms))}" x2="${f1(x(ms))}" y1="${t + ph}" y2="${t + ph + 4}" stroke="${INK}" stroke-opacity=".5"/>`;
    g += `<text x="${f1(x(ms))}" y="${t + ph + 17}" text-anchor="middle" class="at-tick">${ms}</text>`;
  }
  g += `<text x="${l + pw}" y="${t + ph + 30}" text-anchor="end" class="at-tick">t [ms]</text>`;
  g += `<line x1="${l}" x2="${l + pw}" y1="${f1(y(1))}" y2="${f1(y(1))}" stroke="${INK}" stroke-opacity=".55" stroke-dasharray="1.5 4" stroke-linecap="round"/>`;
  g += `<text x="${l + pw + 6}" y="${f1(y(1) + 3.5)}" class="at-tick">1.0</text>`;
  let any = false;
  for (const ln of lines) {
    if (!ln.y || ln.y.length < 2) continue;
    any = true;
    let d = '';
    const n = Math.min(TMAX, ln.y.length - 1);
    for (let i = 0; i <= n; i += 2) d += `${i === 0 ? 'M' : 'L'}${f1(x(i))} ${f1(y(Math.min(ymax, Math.max(0, ln.y[i]!))))}`;
    g += `<path d="${d}" fill="none" stroke="${ln.color}" stroke-width="${ln.width ?? 1.7}"${ln.dash ? ` stroke-dasharray="${ln.dash}"` : ''}${ln.glow ? ` filter="url(#${id}-g)"` : ''} stroke-linejoin="round"/>`;
    if (ln.dim) {
      let pk = -Infinity;
      let pt = 0;
      for (let i = 0; i <= n; i++) if (ln.y[i]! > pk) {
        pk = ln.y[i]!;
        pt = i;
      }
      if (pk > 1.01) {
        const px = x(pt);
        const py = y(Math.min(ymax, pk));
        const dx = l + pw + 26;
        const y1 = y(1);
        g += `<circle cx="${f1(px)}" cy="${f1(py)}" r="3.4" fill="#070B10" stroke="${ln.color}" stroke-width="1.6"/>`;
        g += `<text x="${f1(px + 8)}" y="${f1(py - 7)}" class="at-tick at-t-ink">${pk.toFixed(2)} @ ${pt} ms</text>`;
        g += `<line x1="${f1(px + 5)}" x2="${f1(dx + 6)}" y1="${f1(py)}" y2="${f1(py)}" stroke="${INK}" stroke-opacity=".5"/>`;
        g += `<line x1="${f1(dx)}" x2="${f1(dx)}" y1="${f1(py + 1)}" y2="${f1(y1 - 1)}" stroke="${INK}"/>`;
        g += `<text x="${f1(dx + 6)}" y="${f1((py + y1) / 2 + 4)}" class="at-dim" fill="${ln.color}">${Math.round((pk - 1) * 100)}%</text>`;
      }
    }
  }
  if (!any) g += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="at-tick">${esc(o.noData)}</text>`;
  return `<svg class="at-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}">${g}</svg>`;
}

/** Throttle-averaged spectrum of one spectrogram with the noise floor, frame-size bands and labelled peaks. */
export function spectrumChart(s: Spectrogram, o: { aria: string; bands?: FrameBands; kind: Record<RidgeKind, string>; bandLabels?: { propwash: string; frame: string } }): string {
  const W = 740;
  const H = 190;
  const l = 46;
  const r = 16;
  const t = 18;
  const b = 32;
  const pw = W - l - r;
  const ph = H - t - b;
  const id = `sp${++uid}`;
  const sp = s.spectrum;
  const k0 = Math.max(1, Math.round(10 / s.df));
  let hi = -Infinity;
  for (let k = k0; k < sp.length; k++) hi = Math.max(hi, sp[k]!);
  const top = Math.ceil((hi + 3) / 10) * 10;
  const bottom = Math.floor((s.floorDb - 12) / 10) * 10;
  const x = (hz: number) => l + (hz / s.maxHz) * pw;
  const y = (v: number) => t + ((top - Math.min(top, Math.max(bottom, v))) / (top - bottom)) * ph;
  let g = defs(id);
  if (o.bands) {
    const band = (a: [number, number], label: string, op: number) => {
      const x0 = x(Math.min(s.maxHz, a[0]));
      const x1 = x(Math.min(s.maxHz, a[1]));
      return `<rect x="${f1(x0)}" y="${t}" width="${f1(Math.max(0, x1 - x0))}" height="${ph}" fill="${AMBER}" fill-opacity="${op}"/><text x="${f1(x0 + 3)}" y="${t + 10}" class="at-tick">${esc(label)}</text>`;
    };
    if (o.bandLabels) {
      g += band(o.bands.propwash, o.bandLabels.propwash, 0.07);
      g += band(o.bands.frame, o.bandLabels.frame, 0.045);
    }
  }
  for (let v = top; v >= bottom; v -= 10) {
    g += `<line x1="${l}" x2="${l + pw}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="${INK}" stroke-opacity=".07"/>`;
    if ((top - v) % 20 === 0) g += `<text x="${l - 8}" y="${f1(y(v) + 3.5)}" text-anchor="end" class="at-tick">${v}</text>`;
  }
  g += `<text x="4" y="${t - 6}" class="at-tick">dB</text>`;
  const step = s.maxHz > 600 ? 200 : 100;
  for (let hz = 0; hz <= s.maxHz; hz += step) {
    g += `<line x1="${f1(x(hz))}" x2="${f1(x(hz))}" y1="${t + ph}" y2="${t + ph + 4}" stroke="${INK}" stroke-opacity=".5"/>`;
    g += `<text x="${f1(x(hz))}" y="${t + ph + 17}" text-anchor="middle" class="at-tick">${hz}</text>`;
  }
  g += `<text x="${l + pw}" y="${t + ph + 30}" text-anchor="end" class="at-tick">f [Hz]</text>`;
  // noise floor
  g += `<line x1="${l}" x2="${l + pw}" y1="${f1(y(s.floorDb))}" y2="${f1(y(s.floorDb))}" stroke="${GREEN}" stroke-opacity=".7" stroke-dasharray="4 4"/>`;
  let d = '';
  for (let k = k0; k < sp.length; k++) d += `${k === k0 ? 'M' : 'L'}${f1(x(k * s.df))} ${f1(y(sp[k]!))}`;
  g += `<path d="${d}L${f1(x((sp.length - 1) * s.df))} ${t + ph}L${f1(x(k0 * s.df))} ${t + ph}Z" fill="url(#${id}-f)"/>`;
  g += `<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.5" filter="url(#${id}-g)"/>`;
  // peaks: label above, kind in words
  const placed: number[] = [];
  for (const p of s.peaks.slice(0, 6)) {
    const px = x(p.hz);
    const py = y(p.db);
    const c = p.kind === 'motor' ? HOT : p.kind === 'frame' ? AMBER : INK;
    let ly = t + 24;
    while (placed.some((q) => Math.abs(q - px) < 90 && ly < t + 70)) ly += 14;
    placed.push(px);
    g += `<line x1="${f1(px)}" x2="${f1(px)}" y1="${ly + 2}" y2="${f1(py - 4)}" stroke="${c}" stroke-dasharray="2 3"/>`;
    g += `<circle cx="${f1(px)}" cy="${f1(py)}" r="3.4" fill="${p.resonance ? c : '#070B10'}" stroke="${c}" stroke-width="1.5"/>`;
    g += `<text x="${f1(px + 6)}" y="${ly}" class="at-tick" style="fill:${c}">${Math.round(p.hz)} Hz · ${esc(o.kind[p.kind])}</text>`;
  }
  return `<svg class="at-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}">${g}</svg>`;
}

/* ---------------- spectrogram heatmap (canvas) ---------------- */

/** Perceptually uniform dark-to-bright scale (inferno-like stops): readable for colour-blind users and in greyscale. */
const HEAT_STOPS: Array<[number, [number, number, number]]> = [
  [0, [7, 11, 16]],
  [0.18, [40, 11, 84]],
  [0.38, [101, 21, 110]],
  [0.56, [159, 42, 99]],
  [0.72, [212, 72, 66]],
  [0.86, [245, 125, 21]],
  [1, [252, 230, 120]],
];

export function heatColor(v: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, v));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [p1, c1] = HEAT_STOPS[i]!;
    const [p0, c0] = HEAT_STOPS[i - 1]!;
    if (x <= p1) {
      const f = (x - p0) / (p1 - p0);
      return [Math.round(c0[0] + (c1[0] - c0[0]) * f), Math.round(c0[1] + (c1[1] - c0[1]) * f), Math.round(c0[2] + (c1[2] - c0[2]) * f)];
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1]![1];
}

/** CSS gradient of the heat scale (for the legend bar). */
export const heatGradient = (): string => `linear-gradient(90deg, ${HEAT_STOPS.map(([p, c]) => `rgb(${c.join(',')}) ${Math.round(p * 100)}%`).join(', ')})`;

/** dB range of a spectrogram for the colour scale: from just under the floor to the loudest cell. */
export function heatRange(s: Spectrogram): [number, number] {
  let hi = -Infinity;
  const k0 = Math.ceil(20 / s.df);
  for (const row of s.db) for (let k = k0; k < row.length; k++) hi = Math.max(hi, row[k]!);
  const lo = s.floorDb - 6;
  return [Math.round(lo), Math.round(Number.isFinite(hi) ? Math.max(hi, lo + 10) : lo + 30)];
}

export const heatCanvas = (aria: string): string => `<canvas class="ax-heat" data-heat role="img" aria-label="${esc(aria)}"></canvas>`;

/** Draws frequency (x) x throttle (y, 0 % at the bottom) with ridge lines; empty throttle bins are hatched. */
export function drawHeatmap(cv: HTMLCanvasElement, s: Spectrogram, o: { thrLabel: string; ridges?: boolean }): void {
  const cssW = cv.clientWidth || 740;
  const cssH = Math.round(Math.min(300, Math.max(190, cssW * 0.34)));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(cssW * dpr);
  cv.height = Math.round(cssH * dpr);
  cv.style.height = `${cssH}px`;
  const c = cv.getContext('2d');
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, cssW, cssH);
  const l = 44;
  const r = 10;
  const t = 8;
  const b = 28;
  const pw = cssW - l - r;
  const ph = cssH - t - b;
  const bins = s.db.length;
  const nb = Math.floor(s.maxHz / s.df) + 1;
  const [lo, hi] = heatRange(s);
  const img = c.createImageData(Math.max(1, Math.round(pw * dpr)), Math.max(1, Math.round(ph * dpr)));
  const IW = img.width;
  const IH = img.height;
  for (let py = 0; py < IH; py++) {
    const bin = Math.min(bins - 1, Math.floor(((IH - 1 - py) / IH) * bins));
    const row = s.db[bin]!;
    for (let px = 0; px < IW; px++) {
      const o4 = (py * IW + px) * 4;
      if (!row.length) {
        // hatched: no data in this throttle bin
        const on = (px + py) % 10 < 1;
        img.data[o4] = on ? 40 : 11;
        img.data[o4 + 1] = on ? 54 : 16;
        img.data[o4 + 2] = on ? 66 : 22;
        img.data[o4 + 3] = 255;
        continue;
      }
      const k = Math.min(nb - 1, Math.floor((px / IW) * nb));
      const [R, G, B] = heatColor(((row[k] ?? lo) - lo) / (hi - lo));
      img.data[o4] = R;
      img.data[o4 + 1] = G;
      img.data[o4 + 2] = B;
      img.data[o4 + 3] = 255;
    }
  }
  c.putImageData(img, Math.round(l * dpr), Math.round(t * dpr));
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const x = (hz: number) => l + (hz / s.maxHz) * pw;
  const y = (thr: number) => t + (1 - thr / 100) * ph;
  // ridges: motor = white dashed, frame = amber solid
  if (o.ridges !== false) {
    for (const rd of s.ridges.slice(0, 6)) {
      if (rd.points.length < 2) continue;
      c.beginPath();
      rd.points.forEach((p, i) => (i ? c.lineTo(x(p.hz), y(p.thr)) : c.moveTo(x(p.hz), y(p.thr))));
      c.strokeStyle = rd.kind === 'frame' ? AMBER : rd.kind === 'motor' ? '#ffffff' : 'rgba(220,239,248,0.6)';
      c.setLineDash(rd.kind === 'motor' ? [5, 4] : rd.kind === 'frame' ? [] : [2, 3]);
      c.lineWidth = 1.5;
      c.stroke();
    }
    c.setLineDash([]);
  }
  // axes
  c.font = '10.5px "IBM Plex Mono", ui-monospace, monospace';
  c.fillStyle = '#8fa9b8';
  c.strokeStyle = 'rgba(220,239,248,0.5)';
  c.lineWidth = 1;
  c.textAlign = 'right';
  for (let v = 0; v <= 100; v += 25) {
    c.fillText(`${v}`, l - 6, y(v) + 3.5);
    c.beginPath();
    c.moveTo(l - 3, y(v));
    c.lineTo(l, y(v));
    c.stroke();
  }
  c.save();
  c.translate(10, t + ph / 2);
  c.rotate(-Math.PI / 2);
  c.textAlign = 'center';
  c.fillText(o.thrLabel, 0, 0);
  c.restore();
  c.textAlign = 'center';
  const step = s.maxHz > 600 ? 200 : 100;
  for (let hz = 0; hz <= s.maxHz; hz += step) {
    c.fillText(`${hz}`, x(hz), t + ph + 16);
    c.beginPath();
    c.moveTo(x(hz), t + ph);
    c.lineTo(x(hz), t + ph + 3);
    c.stroke();
  }
  c.textAlign = 'right';
  c.fillText('f [Hz]', l + pw, t + ph + 27);
}

/* ---------------- small charts ---------------- */

/** Throttle-chop events along the flight (propwash). */
export function eventsChart(times: number[], duration: number, o: { aria: string }): string {
  const W = 740;
  const H = 54;
  const l = 10;
  const r = 10;
  const pw = W - l - r;
  const x = (s: number) => l + (s / Math.max(1, duration)) * pw;
  let g = `<line x1="${l}" x2="${l + pw}" y1="30" y2="30" stroke="${INK}" stroke-opacity=".35"/>`;
  for (const s of times) g += `<line x1="${f1(x(s))}" x2="${f1(x(s))}" y1="14" y2="30" stroke="${HOT}" stroke-width="2"/>`;
  const step = duration > 120 ? 30 : duration > 40 ? 10 : 5;
  for (let s = 0; s <= duration; s += step) g += `<text x="${f1(x(s))}" y="46" text-anchor="middle" class="at-tick">${s}s</text>`;
  return `<svg class="at-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}">${g}</svg>`;
}

/** Horizontal gauge 0..max with a marker and a "good up to" zone (filter delay, quality …). */
export function gauge(value: number | null, max: number, good: number): string {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%`;
  return `<span class="ax-gauge" aria-hidden="true"><i class="ok" style="width:${pct(good)}"></i>${value === null ? '' : `<b style="left:${pct(value)}"></b>`}</span>`;
}
