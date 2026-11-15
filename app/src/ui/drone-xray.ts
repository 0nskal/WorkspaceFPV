/**
 * Rozklad drona w stylu "Rentgen" (port generatora design/html/src-h/gen-H-rentgen.js).
 * renderDrone() zwraca gotowy SVG (viewBox 1000x848): rysunek, etykiety, ognisko i oznaczenia kliszy.
 */
import polygonClipping from 'polygon-clipping';
import type { Part } from '../fc/diagnose';

type Pt = [number, number];
type Pal = [top: string, sideF: string, sideL: string];

export interface XrayLabels {
  /** Gorny srodkowy napis kliszy, np. `ROTORLAB · 5" FREESTYLE · 15.11.2026`. */
  filmTop: string;
  filmBottom: string;
  fcTitle: string; // np. "SpeedyBee F405 V4"
  fcSub: string; // np. "Betaflight 4.5.1"
  rxTitle: string; // np. "ELRS 3.4.3"
  rxSub?: string; // opcjonalna zolta uwaga
  batteryText: string; // np. "6S 24.9 V"
  /** Procenty mocy silnikow M1..M4; null = brak danych. */
  motors: number[] | null;
  /** Tekst przy czerwonym ognisku (po prawej), np. "ESC · DShot300 · bidir wyłączony". */
  hotText?: string;
}

export interface RenderOptions {
  highlight: Part | null;
  labels: XrayLabels;
  /** Sam rysunek bez etykiet, slupkow i oznaczen kliszy (tlo ekranu startowego). */
  bare?: boolean;
}

/** Wysokosc (w pikselach viewBox), na ktorej leader czerwonego ogniska wchodzi do szuflady. */
export const ENTRY_Y = 192;
export const VIEW_W = 1000;
export const VIEW_H = 848;

const K = 0.28;
const SY = 0.42;
const CX = 500;
const INK = '#DCEFF8';
const BG = '#070B10';
const SEC = '#8FA9B8';
const AMB = '#E0A82E';
const SW = 0.9;
const REDS = '#FF4A2E';
const HOLE = 'rgba(7,11,16,.6)';
const X = (o: number) => `rgba(207,230,242,${o})`;
const C = { l1: X(0.25), l2: X(0.2), l3: X(0.16), l4: X(0.12), l5: X(0.1), l6: X(0.09), l7: X(0.08) };
const NORMAL: Pal = [C.l3, C.l5, C.l4];
const HOT: Pal = ['rgba(255,74,46,.34)', 'rgba(255,74,46,.22)', 'rgba(255,74,46,.16)'];

const A = 100;
const B = 135;
const SC = 1.22;
const Y = { props: 86, motors: 204, top: 296, fc: 366, esc: 432, rx: 494, bot: 574, bat: 668 };

const f = (n: number) => +n.toFixed(2);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const proj = (cy: number) => (x: number, y: number, z = 0): Pt => [CX + y + K * x, cy + SY * x - z];
const pts = (a: Pt[]) => a.map((p) => f(p[0]) + ',' + f(p[1])).join(' ');
const poly = (a: Pt[], fill: string, extra = '') =>
  `<polygon points="${pts(a)}" fill="${fill}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round" ${extra}/>`;

function extrude(P: Pt[], cy: number, z0: number, t: number, top: string, sideF: string, sideL: string): string {
  const pr = proj(cy);
  let area = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sgn = area > 0 ? 1 : -1;
  const sides: Array<{ d: number; s: string }> = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let nx = dy * sgn;
    let ny = -dx * sgn;
    const L = Math.hypot(nx, ny);
    nx /= L;
    ny /= L;
    const vis = nx - K * ny;
    if (vis > 0.001) {
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const quad = [pr(a[0], a[1], z0), pr(b[0], b[1], z0), pr(b[0], b[1], z0 + t), pr(a[0], a[1], z0 + t)];
      sides.push({ d: mx - K * my, s: poly(quad, Math.abs(nx) >= Math.abs(ny) * 0.9 && nx > 0 ? sideF : sideL) });
    }
  }
  sides.sort((p, q) => p.d - q.d);
  const topP = P.map((p) => pr(p[0], p[1], z0 + t));
  return sides.map((s) => s.s).join('') + poly(topP, top);
}

const rect = (x0: number, x1: number, y0: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const cham = (x0: number, x1: number, y0: number, y1: number, c: number): Pt[] => [
  [x0 + c, y0],
  [x1 - c, y0],
  [x1, y0 + c],
  [x1, y1 - c],
  [x1 - c, y1],
  [x0 + c, y1],
  [x0, y1 - c],
  [x0, y0 + c],
];
const circ = (cx: number, cy: number, r: number, n = 28): Pt[] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)] as Pt);

function disc(cy: number, x: number, y: number, z: number, r: number, fill: string, sw = SW): string {
  const [px, py] = proj(cy)(x, y, z);
  return `<g transform="matrix(${K} ${SY} 1 0 ${f(px)} ${f(py)})"><circle r="${r}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" vector-effect="non-scaling-stroke"/></g>`;
}

function cyl(cy: number, x: number, y: number, z0: number, h: number, r: number, topF: string, sideF: string): string {
  const pr = proj(cy);
  const t1 = Math.atan2(1, K);
  const ell = (t: number, z: number) => pr(x + r * Math.cos(t), y + r * Math.sin(t), z);
  const arc: Pt[] = [];
  for (let i = 0; i <= 32; i++) arc.push(ell(t1 - Math.PI + (Math.PI * i) / 32, z0));
  const body = [ell(t1 - Math.PI, z0 + h), ...arc, ell(t1, z0 + h)];
  let s = poly(body, sideF);
  const top: Pt[] = [];
  for (let i = 0; i < 40; i++) top.push(ell((2 * Math.PI * i) / 40, z0 + h));
  s += poly(top, topF);
  return s;
}

const hole = (cy: number, x: number, y: number, z: number, r: number) => disc(cy, x, y, z, r, HOLE);
const dashedLine = (x1: number, y1: number, x2: number, y2: number) =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${INK}" stroke-width=".8" stroke-dasharray="4 4" opacity=".35"/>`;
const trace = (cy: number, z: number, arr: Pt[]) =>
  `<polyline points="${pts(arr.map((p) => proj(cy)(p[0], p[1], z)))}" fill="none" stroke="${INK}" stroke-width=".6" opacity=".55"/>`;

/** Obrys plyty dolnej (korpus + ramiona + kolka silnikow) - liczony raz. */
let plateRing: Pt[] | null = null;
function bottomPlateRing(): Pt[] {
  if (plateRing) return plateRing;
  const arm = (sx: number, sy: number): Pt[] => {
    const ux = (A - 46) * sx;
    const uy = (B - 22) * sy;
    const L = Math.hypot(ux, uy);
    const dx = ux / L;
    const dy = uy / L;
    const nx = -dy;
    const ny = dx;
    const w = 11;
    const bx = 46 * sx;
    const by = 22 * sy;
    const tx = A * sx;
    const ty = B * sy;
    return [
      [bx + nx * w, by + ny * w],
      [tx + nx * w, ty + ny * w],
      [tx - nx * w, ty - ny * w],
      [bx - nx * w, by - ny * w],
    ];
  };
  const signs: Array<[number, number]> = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  const polys: Array<Array<Array<[number, number]>>> = [
    [cham(-66, 66, -44, 44, 16)],
    ...signs.map(([a, b]) => [arm(a, b)]),
    ...signs.map(([a, b]) => [circ(A * a, B * b, 19, 24)]),
  ];
  const u = polygonClipping.union(polys[0], ...polys.slice(1));
  plateRing = u[0][0].slice(0, -1) as Pt[];
  return plateRing;
}

/** Skladniki rysunku scenicznego (bez filtra glow), z podswietleniem jednej czesci. */
function buildDrone(hot: Part | null): string {
  const pal = (part: Part, normal: Pal): Pal => (hot === part ? HOT : normal);
  let out = '';

  // osie (za dronem)
  const ax: string[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const x = sx * A;
      const y = sy * B;
      const px = CX + y + K * x;
      ax.push(dashedLine(px, Y.props + SY * x, px, Y.bot + SY * x - 3));
    }
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const x = sx * 30;
      const y = sy * 33;
      const px = CX + y + K * x;
      ax.push(dashedLine(px, Y.top + SY * x - 3, px, Y.bot + SY * x - 3));
    }
  out += ax.join('');

  // bateria
  {
    const cy = Y.bat;
    const pr = proj(cy);
    const H = 36;
    const bx = 32;
    const by = 62;
    const l0 = pr(0, -by, 14);
    const lead = `M${f(l0[0])},${f(l0[1])} C ${f(l0[0] - 40)},${f(l0[1] + 6)} ${f(l0[0] - 50)},${f(l0[1] + 20)} ${f(l0[0] - 72)},${f(l0[1] + 22)}`;
    out += `<path d="${lead}" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/><path d="${lead}" fill="none" stroke="${C.l4}" stroke-width="1.2" stroke-linecap="round"/>`;
    const bp = pal('battery', [C.l2, C.l4, C.l5]);
    out += extrude(rect(-bx, bx, -by, by), cy, 0, H, bp[0], bp[1], bp[2]);
    for (let i = 0; i < 6; i++) {
      const y0 = -56 + i * 18.6;
      out += poly(rect(-26, 26, y0, y0 + 16).map((p) => pr(p[0], p[1], H)), 'rgba(207,230,242,.2)');
    }
    out += poly(rect(-8, 8, -62, -56).map((p) => pr(p[0], p[1], H)), X(0.35));
    const s0 = 22;
    const s1 = 40;
    out += poly([pr(bx, s0, 0), pr(bx, s1, 0), pr(bx, s1, H), pr(bx, s0, H)], C.l7);
    out += poly([pr(-bx, s0, H + 0.6), pr(bx, s0, H + 0.6), pr(bx, s1, H + 0.6), pr(-bx, s1, H + 0.6)], C.l6);
    out += poly([pr(-8, s0 + 2, H + 0.6), pr(8, s0 + 2, H + 0.6), pr(8, s1 - 2, H + 0.6), pr(-8, s1 - 2, H + 0.6)], C.l3);
    out += extrude(rect(-9, 9, -by - 16, -by), cy, 8, 14, C.l3, C.l5, C.l4);
  }

  // plyta dolna
  {
    const cy = Y.bot;
    const pr = proj(cy);
    out += extrude(bottomPlateRing(), cy, 0, 4, C.l3, C.l5, C.l4);
    const z = 4;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        out += hole(cy, sx * 30, sy * 33, z, 2.6);
        out += hole(cy, A * sx, B * sy, z, 6.5);
        for (let k = 0; k < 4; k++) {
          const a = Math.PI / 4 + (k * Math.PI) / 2;
          out += hole(cy, A * sx + 11.5 * Math.cos(a), B * sy + 11.5 * Math.sin(a), z, 1.6);
        }
        const mx = ((46 + A) / 2) * sx;
        const my = ((22 + B) / 2) * sy;
        const ux = (A - 46) * sx;
        const uy = (B - 22) * sy;
        const L = Math.hypot(ux, uy);
        const dx = ux / L;
        const dy = uy / L;
        const nx = -dy;
        const ny = dx;
        const slot: Pt[] = [
          [mx - dx * 11 + nx * 2.5, my - dy * 11 + ny * 2.5],
          [mx + dx * 11 + nx * 2.5, my + dy * 11 + ny * 2.5],
          [mx + dx * 11 - nx * 2.5, my + dy * 11 - ny * 2.5],
          [mx - dx * 11 - nx * 2.5, my - dy * 11 - ny * 2.5],
        ];
        out += poly(slot.map((p) => pr(p[0], p[1], z)), HOLE);
      }
    out += poly(rect(-22, 22, -12, 12).map((p) => pr(p[0], p[1], z)), HOLE);
  }

  // odbiornik
  {
    const cy = Y.rx;
    const pr = proj(cy);
    const a0 = pr(-12, -6, 1.5);
    const a1 = pr(-44, -34, 10);
    out += `<line x1="${f(a0[0])}" y1="${f(a0[1])}" x2="${f(a1[0])}" y2="${f(a1[1])}" stroke="${INK}" stroke-width="1.25"/>`;
    const a2 = pr(-70, -66, 26);
    out += `<line x1="${f(a1[0])}" y1="${f(a1[1])}" x2="${f(a2[0])}" y2="${f(a2[1])}" stroke="${INK}" stroke-width="7" stroke-linecap="butt"/><line x1="${f(a1[0])}" y1="${f(a1[1])}" x2="${f(a2[0])}" y2="${f(a2[1])}" stroke="${C.l6}" stroke-width="4.6"/>`;
    const p = pal('rx', NORMAL);
    out += extrude(rect(-15, 15, -22, 22), cy, 0, 2.4, p[0], p[1], p[2]);
    out += extrude(rect(-6, 6, -10, 2), cy, 2.4, 2.5, C.l7, C.l6, C.l6);
    out += extrude(rect(8, 13, -18, -10), cy, 2.4, 1.6, C.l1, C.l3, C.l3);
    out += extrude(rect(-13, -9, 10, 18), cy, 2.4, 2, C.l1, C.l3, C.l3);
    out += hole(cy, 9, 16, 2.4, 1.6);
    for (let i = 0; i < 4; i++) out += poly(rect(13.5, 15, 8 + i * 3.4, 10 + i * 3.4).map((q) => pr(q[0], q[1], 2.4)), C.l1, 'stroke-width=".8"');
  }

  // ESC
  {
    const cy = Y.esc;
    const pr = proj(cy);
    const p = pal('esc', NORMAL);
    out += extrude(cham(-40, 40, -44, 44, 6), cy, 0, 3, p[0], p[1], p[2]);
    const z = 3;
    for (const x of [-26, 26])
      for (let i = 0; i < 4; i++) {
        const y0 = -38 + i * 20;
        out += extrude(rect(x - 6, x + 6, y0, y0 + 14), cy, z, 2.6, C.l7, C.l6, C.l6);
      }
    out += cyl(cy, -2, 0, z, 16, 9.5, C.l5, C.l3);
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) out += poly(rect(sx * 36 - 3, sx * 36 + 3, sy * 40 - 3, sy * 40 + 3).map((q) => pr(q[0], q[1], z)), C.l1, 'stroke-width="1"');
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) out += hole(cy, sx * 30, sy * 33, z, 2.2);
    for (let i = 0; i < 4; i++) {
      const y0 = -30 + i * 20;
      out += trace(cy, z, [[-20, y0 + 7], [-8, y0 + 7], [-2, 0]]) + trace(cy, z, [[20, y0 + 7], [10, y0 + 7], [4, 0]]);
    }
    for (let i = 0; i < 6; i++) out += poly(rect(36, 39, -16 + i * 6, -13 + i * 6).map((q) => pr(q[0], q[1], z)), C.l1, 'stroke-width=".8"');
  }

  // FC
  {
    const cy = Y.fc;
    const pr = proj(cy);
    const p = pal('fc', NORMAL);
    out += extrude(cham(-40, 40, -44, 44, 6), cy, 0, 3, p[0], p[1], p[2]);
    const z = 3;
    out += extrude(rect(40, 52, -12, 12), cy, z, 4, C.l1, C.l4, C.l3);
    out += extrude(rect(-12, 12, -14, 14), cy, z, 3.4, C.l7, C.l6, C.l6);
    const dot = pr(-9, -11, z + 3.4);
    out += `<circle cx="${f(dot[0])}" cy="${f(dot[1])}" r="1.1" fill="${C.l1}"/>`;
    out += extrude(rect(-30, -20, 18, 30), cy, z, 2.4, C.l6, C.l5, C.l5);
    out += extrude(rect(18, 30, -34, -22), cy, z, 1.8, C.l4, C.l5, C.l5);
    for (let i = 0; i < 6; i++) out += extrude(rect(24, 27, 6 + i * 5, 9 + i * 5 > 43 ? 43 : 9 + i * 5), cy, z, 0.8, C.l1, C.l3, C.l3);
    for (let i = 0; i < 8; i++) out += poly(rect(-36 + i * 8.6, -33 + i * 8.6, 38, 42).map((q) => pr(q[0], q[1], z)), C.l1, 'stroke-width=".9"');
    for (let i = 0; i < 6; i++) out += poly(rect(33, 37, -38 + i * 7, -35 + i * 7).map((q) => pr(q[0], q[1], z)), C.l1, 'stroke-width=".9"');
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) out += hole(cy, sx * 30, sy * 33, z, 2.4);
    out +=
      trace(cy, z, [[-30, 38], [-30, 20], [-14, 14]]) +
      trace(cy, z, [[-8, 38], [-8, 24], [-14, 16]]) +
      trace(cy, z, [[14, 0], [22, -10], [34, -10], [34, -30]]) +
      trace(cy, z, [[14, 6], [26, 6], [26, 30], [33, 36]]) +
      trace(cy, z, [[-34, -30], [-20, -30], [-14, -16]]) +
      trace(cy, z, [[0, -14], [0, -36], [-16, -36]]);
  }

  // plyta gorna
  {
    const cy = Y.top;
    const pr = proj(cy);
    out += extrude(cham(-68, 68, -52, 52, 20), cy, 0, 4, C.l2, C.l4, C.l5);
    const z = 4;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) out += hole(cy, sx * 30, sy * 33, z, 3.2);
    out += poly(rect(-8, 8, -44, -22).map((p) => pr(p[0], p[1], z)), HOLE);
    out += poly(rect(-8, 8, 22, 44).map((p) => pr(p[0], p[1], z)), HOLE);
    out += poly(rect(52, 60, -10, 10).map((p) => pr(p[0], p[1], z)), HOLE);
    out += poly(rect(-56, -46, -10, 10).map((p) => pr(p[0], p[1], z)), HOLE);
  }

  // silniki
  {
    const cy = Y.motors;
    const order: Array<[number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    const mt = pal('motors', [C.l2, C.l3, C.l3]);
    for (const [sx, sy] of order) {
      const x = sx * A;
      const y = sy * B;
      out += cyl(cy, x, y, 0, 8, 14, hot === 'motors' ? HOT[0] : C.l3, hot === 'motors' ? HOT[1] : C.l4);
      out += cyl(cy, x, y, 8, 15, 12.5, hot === 'motors' ? HOT[0] : mt[0], hot === 'motors' ? HOT[1] : mt[1]);
      for (const rr of [5.5, 7.5, 9.5, 11.5]) out += disc(cy, x, y, 23, rr, 'none', 0.6);
      for (const rr of [4, 6.5, 9, 11]) out += disc(cy, x, y, 10, rr, 'none', 0.5);
      out += disc(cy, x, y, 23, 4, C.l4);
      out += disc(cy, x, y, 23, 1.2, C.l7, 0.8);
    }
  }

  // smigla
  {
    const cy = Y.props;
    const pr = proj(cy);
    const blade: Pt[] = [[7, -3], [18, -11], [38, -17], [58, -14], [72, -6], [74, 2], [62, 8], [40, 10], [18, 5]];
    const order: Array<[number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [sx, sy] of order) {
      const x = sx * A;
      const y = sy * B;
      const rot0 = ((sx * sy > 0 ? 20 : 80) * Math.PI) / 180;
      for (let k = 0; k < 3; k++) {
        const a = rot0 + (k * 2 * Math.PI) / 3;
        const P = blade.map(([u, v]) => {
          const vv = sx * sy > 0 ? v : -v;
          return [x + u * Math.cos(a) - vv * Math.sin(a), y + u * Math.sin(a) + vv * Math.cos(a)] as Pt;
        });
        out += poly(P.map((p) => pr(p[0], p[1], 0)), k === 0 ? C.l1 : C.l2);
        const m1 = pr(x + 14 * Math.cos(a), y + 14 * Math.sin(a), 0);
        const m2 = pr(x + 66 * Math.cos(a), y + 66 * Math.sin(a), 0);
        out += `<line x1="${f(m1[0])}" y1="${f(m1[1])}" x2="${f(m2[0])}" y2="${f(m2[1])}" stroke="${INK}" stroke-width=".7" opacity=".5"/>`;
      }
      out += disc(cy, x, y, 0, 9, C.l3);
      out += disc(cy, x, y, 0, 3, C.l7, 1);
    }
  }
  return out;
}

const TY = 2;
const DX = -30;
const tf = (px: number, py: number): Pt => [CX + DX + (px - CX) * SC, TY + py * SC];
const prL = (cy: number) => (x: number, y: number, z = 0): Pt => {
  const p = proj(cy)(x, y, z);
  return tf(p[0], p[1]);
};

const mono = `font-family="'IBM Plex Mono', monospace"`;
const sans = (s: number, w: number) => `font-family="'IBM Plex Sans', sans-serif" font-size="${s}" font-weight="${w}"`;
const hair = (x1: number, y1: number, x2: number, y2: number, c = INK, w = 1) =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${c}" stroke-width="${w}"/>`;
const anchorDot = (x: number, y: number, c = INK) => `<circle cx="${f(x)}" cy="${f(y)}" r="3.4" fill="${c}" stroke="${BG}" stroke-width="1.5"/>`;
const dotMark = (x: number, y: number, c: string) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${c}"/>`;

const LX = 44;
const RX = 770;

/** Ognisko (poswiata + znacznik + prowadnica do szuflady) dla podswietlonej czesci. */
function hotMarkup(hot: Part, labels: XrayLabels, motorBracketY: number): { glow: string; over: string; text: string } {
  const centers: Record<Exclude<Part, 'motors'>, { c: Pt; a: Pt; r: number }> = {
    fc: { c: prL(Y.fc)(0, 0, 3), a: prL(Y.fc)(0, 44, 3), r: 64 },
    esc: { c: prL(Y.esc)(0, 0, 3), a: prL(Y.esc)(0, 44, 3), r: 64 },
    rx: { c: prL(Y.rx)(0, 0, 2.4), a: prL(Y.rx)(0, 22, 1.2), r: 42 },
    battery: { c: prL(Y.bat)(0, 0, 36), a: prL(Y.bat)(0, 62, 18), r: 92 },
  };
  const ring = (cx: number, cy: number, r: number) =>
    `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="none" stroke="${REDS}" stroke-width="1" stroke-opacity=".85"/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.72)}" fill="none" stroke="${REDS}" stroke-width="1.2" stroke-dasharray="3 3"/><path d="M${f(cx - r - 18)},${f(cy)}H${f(cx - r - 6)}M${f(cx + r + 6)},${f(cy)}H${f(cx + r + 18)}M${f(cx)},${f(cy - r - 18)}V${f(cy - r - 6)}M${f(cx)},${f(cy + r + 6)}V${f(cy + r + 18)}" stroke="${REDS}" stroke-width="1.2"/>`;
  const glowAt = (cx: number, cy: number, r: number) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="url(#hot)"/>`;
  const rx = 986;

  if (hot === 'motors') {
    const pts4: Pt[] = [[-A, -B], [-A, B], [A, -B], [A, B]].map(([x, y]) => prL(Y.motors)(x, y, 12));
    const glow = pts4.map((p) => glowAt(p[0], p[1], 70)).join('');
    const over = pts4.map((p) => ring(p[0], p[1], 34)).join('') + `<polyline points="960,${f(motorBracketY)} ${rx},${f(motorBracketY)} ${rx},${ENTRY_Y} 1000,${ENTRY_Y}" fill="none" stroke="${REDS}" stroke-width="1.5"/><rect x="994" y="${ENTRY_Y - 3.5}" width="7" height="7" fill="${REDS}"/>`;
    return { glow, over, text: '' };
  }
  const { c, a, r } = centers[hot];
  const over =
    ring(c[0], c[1], r) +
    `<polyline points="${f(a[0])},${f(a[1])} ${rx},${f(a[1])} ${rx},${ENTRY_Y} 1000,${ENTRY_Y}" fill="none" stroke="${REDS}" stroke-width="1.5"/>` +
    anchorDot(a[0], a[1], REDS) +
    `<rect x="994" y="${ENTRY_Y - 3.5}" width="7" height="7" fill="${REDS}"/>`;
  const text = labels.hotText
    ? dotMark(736, a[1] - 15, REDS) + `<text x="748" y="${f(a[1] - 10)}" ${sans(16, 600)} fill="${INK}">${esc(labels.hotText)}</text>`
    : '';
  return { glow: glowAt(c[0], c[1], hot === 'battery' ? 170 : 120), over, text };
}

const DEFS = `<defs>
<radialGradient id="hot"><stop offset="0" stop-color="#FF4A2E" stop-opacity=".5"/><stop offset=".5" stop-color="#FF4A2E" stop-opacity=".16"/><stop offset="1" stop-color="#FF4A2E" stop-opacity="0"/></radialGradient>
<filter id="glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;

/** Rysuje rozklad drona z etykietami. `highlight` zaznacza czerwone ognisko na wskazanej czesci. */
export function renderDrone(opts: RenderOptions): string {
  const { highlight, labels } = opts;
  const out = buildDrone(highlight);
  if (opts.bare) {
    return `<svg class="xray" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${DEFS}<g filter="url(#glow)" transform="translate(${CX + DX} ${TY}) scale(${SC}) translate(${-CX} 0)">${out}</g></svg>`;
  }
  let lab = '';

  // FC
  {
    const [ax, ay] = prL(Y.fc)(0, -44, 1.5);
    lab += hair(LX, ay, ax, ay) + anchorDot(ax, ay);
    lab += `<text x="${LX}" y="${f(ay - 52)}" ${mono} font-size="12" fill="${INK}" letter-spacing=".06em">FC</text>`;
    lab += `<text x="${LX}" y="${f(ay - 28)}" ${sans(18, 600)} fill="${INK}">${esc(labels.fcTitle)}</text>`;
    lab += `<text x="${LX}" y="${f(ay - 9)}" ${mono} font-size="12.5" fill="${SEC}">${esc(labels.fcSub)}</text>`;
  }
  // Odbiornik
  {
    const [ax, ay] = prL(Y.rx)(0, -22, 1.2);
    lab += hair(LX, ay, ax, ay) + anchorDot(ax, ay);
    lab += `<text x="${LX}" y="${f(ay - 52)}" ${mono} font-size="12" fill="${INK}" letter-spacing=".06em">Odbiornik</text>`;
    lab += `<text x="${LX}" y="${f(ay - 28)}" ${sans(18, 600)} fill="${INK}">${esc(labels.rxTitle)}</text>`;
    if (labels.rxSub) lab += dotMark(LX + 4, ay - 14, AMB) + `<text x="${LX + 14}" y="${f(ay - 9)}" ${mono} font-size="12.5" fill="${AMB}">${esc(labels.rxSub)}</text>`;
  }
  // Bateria
  {
    const [ax, ay] = prL(Y.bat)(0, -62, 18);
    lab += hair(LX, ay, ax, ay) + anchorDot(ax, ay);
    lab += `<text x="${LX}" y="${f(ay - 33)}" ${mono} font-size="12" fill="${INK}" letter-spacing=".06em">Bateria</text>`;
    lab += `<text x="${LX}" y="${f(ay - 9)}" ${sans(18, 600)} fill="${INK}">${esc(labels.batteryText)}</text>`;
  }
  // Silniki (po prawej, slupki)
  const m1 = prL(Y.motors)(-A, B, 11);
  const m2 = prL(Y.motors)(A, B, 11);
  const bx = 745;
  const my = (m1[1] + m2[1]) / 2;
  {
    lab += hair(m1[0] + 15, m1[1], bx, m1[1]) + hair(m2[0] + 15, m2[1], bx, m2[1]) + hair(bx, m1[1], bx, m2[1]) + hair(bx, my, 960, my);
    lab += anchorDot(m1[0] + 15, m1[1]) + anchorDot(m2[0] + 15, m2[1]);
    lab += `<text x="${RX}" y="${f(my - 12)}" ${mono} font-size="12" fill="${highlight === 'motors' ? REDS : INK}" letter-spacing=".06em">Silniki</text>`;
    const base = my + 62;
    for (let i = 0; i < 4; i++) {
      const v = labels.motors?.[i];
      const x = RX + i * 50;
      const h = (v ?? 0) * 0.4;
      lab += `<rect x="${x}" y="${f(base - 40)}" width="26" height="40" fill="none" stroke="${INK}" stroke-width=".8" opacity=".35"/>`;
      lab += `<rect data-mbar="${i}" data-base="${f(base)}" x="${x}" y="${f(base - h)}" width="26" height="${f(h)}" fill="${INK}"/>`;
      lab += `<text x="${x}" y="${f(base + 15)}" ${mono} font-size="11" fill="${INK}">M${i + 1}</text>`;
      lab += `<text data-mval="${i}" x="${x}" y="${f(base + 29)}" ${mono} font-size="11" fill="${SEC}">${v === undefined ? '—' : v + '%'}</text>`;
    }
  }

  // ognisko
  let glow = '';
  let over = '';
  if (highlight) {
    const h = hotMarkup(highlight, labels, my);
    glow = h.glow;
    over = h.over;
    lab += h.text;
  }

  // znaczniki naroznikow i oznaczenia kliszy
  const mk = (x: number, y: number) => `<path d="M${x - 6},${y}H${x + 6}M${x},${y - 6}V${y + 6}" stroke="${INK}" stroke-width=".8" opacity=".5"/>`;
  const marks = mk(20, 52) + mk(980, 52) + mk(20, 828) + mk(980, 828);
  const fm = (x: number, y: number, t: string, a = 'start') =>
    `<text x="${x}" y="${y}" text-anchor="${a}" ${mono} font-size="12" letter-spacing=".08em" fill="#fff" fill-opacity=".6">${esc(t)}</text>`;
  const film = fm(26, 36, 'L') + fm(500, 13, labels.filmTop, 'middle') + fm(940, 838, labels.filmBottom, 'end');

  return `<svg class="xray" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMaxYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Rozkład drona w stylu rentgena">${DEFS}${marks}${glow}<g filter="url(#glow)" transform="translate(${CX + DX} ${TY}) scale(${SC}) translate(${-CX} 0)">${out}</g>${lab}${over}${film}</svg>`;
}

/** Aktualizuje slupki silnikow w istniejacym SVG bez przerysowywania sceny (telemetria 10 Hz). */
export function updateMotorBars(root: ParentNode, values: number[] | null): void {
  for (let i = 0; i < 4; i++) {
    const bar = root.querySelector<SVGRectElement>(`[data-mbar="${i}"]`);
    const txt = root.querySelector<SVGTextElement>(`[data-mval="${i}"]`);
    if (!bar || !txt) continue;
    const v = values?.[i];
    const base = Number(bar.dataset.base);
    const h = (v ?? 0) * 0.4;
    bar.setAttribute('y', String(+(base - h).toFixed(2)));
    bar.setAttribute('height', String(+h.toFixed(2)));
    txt.textContent = v === undefined ? '—' : `${v}%`;
  }
}
