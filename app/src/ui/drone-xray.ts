/**
 * Rozklad drona w stylu "Rentgen" (port generatora design/html/src-h/gen-H-rentgen.js).
 * renderDrone() zwraca gotowy SVG (viewBox 1000x848): rysunek, etykiety, ognisko i oznaczenia kliszy.
 */
import polygonClipping from 'polygon-clipping';
import type { Part } from '../fc/diagnose';
import { t } from '../i18n';

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
  /** Tekst przy czerwonym ognisku (po prawej), np. "ESC · DShot300 · bidir off". */
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

/* ---------- elementy wielokrotnego uzytku (symbole <g id> + <use>) ---------- */
const COP = 'rgba(255,160,100,.3)'; // miedz: slaba domieszka (max .35)
const COPS = 'rgba(255,160,100,.2)';
const MET = X(0.42); // metal: jasniejszy
const METS = X(0.28);
const DARK = '#0E1822';
const HOTF = 'rgba(255,74,46,.55)';

const polyS = (a: Pt[], fill: string, sw = 0.6, stroke = INK, so = 0.85) =>
  `<polygon points="${pts(a)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-opacity="${so}" stroke-linejoin="round"/>`;
const R = (a: number, u: number, v: number): Pt => [u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a)];

/** Symbol rysowany w lokalnym ukladzie (0,0,0) i wstawiany przez <use>; -CX kasuje przesuniecie rzutu. */
const sym = (id: string, inner: string) => `<g id="${id}"><g transform="translate(${-CX} 0)">${inner}</g></g>`;
const useAt = (id: string, x: number, y: number, cy: number, z = 0, sc = 1) =>
  `<use href="#${id}" transform="translate(${f(CX + y + K * x)} ${f(cy + SY * x - z)})${sc !== 1 ? ` scale(${sc})` : ''}"/>`;

function annulus(cy: number, x: number, y: number, r1: number, r2: number, z: number, fill: string, n = 24): string {
  const pr = proj(cy);
  const ring = (r: number) => 'M' + circ(x, y, r, n).map((p) => pr(p[0], p[1], z)).map((p) => f(p[0]) + ',' + f(p[1])).join('L') + 'Z';
  return `<path d="${ring(r1)}${ring(r2)}" fill-rule="evenodd" fill="${fill}" stroke="${INK}" stroke-width=".6" stroke-opacity=".85"/>`;
}

/** Silnik: podstawa, 3 przewody, stojan 12 zebow z uzwojeniem, os, lozyska, pierscien magnesow, dzwon z otworami. */
function motorSym(hot: boolean): string {
  const pr = proj(0);
  const bell: Pal = hot ? HOT : [C.l3, C.l4, C.l3];
  let s = '';
  s += extrude(cham(-16, 16, -16, 16, 5), 0, 0, 2, C.l3, C.l5, C.l4);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) s += hole(0, sx * 11.5, sy * 11.5, 2, 1.3);
  for (let i = -1; i <= 1; i++) {
    const a = pr(3, i * 2.4, 1);
    const b = pr(14, i * 2.4, -2);
    const c = pr(20, i * 5 - 8, -8);
    const e = pr(32, i * 5 - 16, -12);
    const d = `M${f(a[0])},${f(a[1])}C${f(b[0])},${f(b[1])} ${f(c[0])},${f(c[1])} ${f(e[0])},${f(e[1])}`;
    s += `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.1" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${DARK}" stroke-width=".9" stroke-linecap="round"/><circle cx="${f(e[0])}" cy="${f(e[1])}" r="1.1" fill="${COP}"/>`;
  }
  s += cyl(0, 0, 0, 2, 3, 3.8, MET, METS);
  const teeth = Array.from({ length: 12 }, (_, k) => (k * Math.PI) / 6).sort((p, q) => Math.cos(p) - K * Math.sin(p) - (Math.cos(q) - K * Math.sin(q)));
  for (const a of teeth) {
    s += extrude([R(a, 5.2, -1.2), R(a, 11.2, -1.4), R(a, 11.2, 1.4), R(a, 5.2, 1.2)], 0, 4, 5, MET, METS, METS);
    s += extrude([R(a, 5.8, -2.6), R(a, 10.2, -2.9), R(a, 10.2, 2.9), R(a, 5.8, 2.6)], 0, 4.5, 4.2, COP, COPS, COPS);
  }
  s += cyl(0, 0, 0, 4, 5, 5.2, METS, X(0.2));
  s += cyl(0, 0, 0, 0, 46, 1.5, MET, METS);
  s += cyl(0, 0, 0, 9, 2.4, 3.2, MET, METS);
  // pierscien magnesow
  s += annulus(0, 0, 0, 12, 10.6, 21, X(0.34), 28);
  let tick = '';
  for (let k = 0; k < 14; k++) {
    const a = (k * 2 * Math.PI) / 14;
    const p = pr(10.6 * Math.cos(a), 10.6 * Math.sin(a), 21);
    const q = pr(12 * Math.cos(a), 12 * Math.sin(a), 21);
    tick += `M${f(p[0])},${f(p[1])}L${f(q[0])},${f(q[1])}`;
  }
  s += `<path d="${tick}" stroke="${INK}" stroke-width=".5" opacity=".7" fill="none"/>`;
  s += cyl(0, 0, 0, 20, 15, 12.8, bell[0], bell[1]);
  const t1 = Math.atan2(1, K);
  for (let j = 0; j < 6; j++) {
    const th = t1 - Math.PI + ((j + 0.5) * Math.PI) / 6;
    const dl = 0.13;
    const q = (t: number, z: number) => pr(12.8 * Math.cos(t), 12.8 * Math.sin(t), z);
    s += polyS([q(th - dl, 24), q(th + dl, 24), q(th + dl, 31), q(th - dl, 31)], HOLE, 0.5);
  }
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5 + 0.35;
    const w = 0.27;
    const P: Pt[] = [];
    for (let i = 0; i <= 3; i++) P.push(pr(11 * Math.cos(a - w + (2 * w * i) / 3), 11 * Math.sin(a - w + (2 * w * i) / 3), 35));
    for (let i = 3; i >= 0; i--) P.push(pr(5.8 * Math.cos(a - w + (2 * w * i) / 3), 5.8 * Math.sin(a - w + (2 * w * i) / 3), 35));
    s += polyS(P, HOLE, 0.5);
  }
  s += disc(0, 0, 0, 35, 4.4, X(0.22), 0.6);
  s += cyl(0, 0, 0, 35, 11, 1.5, MET, METS);
  return s;
}

/** Smiglo trojlopatowe: zakrzywione lopaty, piasta z nakretka (polprzezroczyste). */
function propSym(mirror: boolean): string {
  const pr = proj(0);
  const sg = mirror ? -1 : 1;
  const rot0 = ((mirror ? 80 : 20) * Math.PI) / 180;
  let s = '';
  const N = 12;
  for (let k = 0; k < 3; k++) {
    const a = rot0 + (k * 2 * Math.PI) / 3;
    const Lp: Pt[] = [];
    const Rp: Pt[] = [];
    const Hp: Pt[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const u = 6 + 68 * t;
      const vc = 10 * t * t - 1.5;
      const w = 2.4 + 9.5 * Math.sin(Math.PI * Math.pow(t, 0.62));
      Lp.push(R(a, u, sg * (vc + 0.8 * w)));
      Rp.push(R(a, u, sg * (vc - 1.15 * w)));
      Hp.push(R(a, u, sg * (vc + 0.05 * w)));
    }
    const tip = R(a, 75.5, sg * 8.2);
    const P = Lp.concat([tip], Rp.slice().reverse());
    s += polyS(P.map((p) => pr(p[0], p[1], 0)), k === 0 ? C.l1 : C.l3, 0.8);
    s += `<polygon points="${pts(Lp.concat(Hp.slice().reverse()).map((p) => pr(p[0], p[1], 0)))}" fill="${X(0.1)}"/>`;
    s += `<polyline points="${pts(Hp.slice(1).map((p) => pr(p[0], p[1], 0)))}" fill="none" stroke="${INK}" stroke-width=".5" opacity=".5"/>`;
  }
  s += cyl(0, 0, 0, 0, 4, 6.8, X(0.24), X(0.16));
  s += extrude(circ(0, 0, 3.6, 6), 0, 4, 2.6, MET, METS, METS);
  s += disc(0, 0, 0, 6.6, 1.2, HOLE, 0.5);
  return s;
}

/** MOSFET z trzema nozkami (wariant lewy/prawy); w ognisku czerwony. */
function mosSym(left: boolean, hotE: boolean): string {
  const pr = proj(0);
  const sg = left ? 1 : -1;
  let s = '';
  for (let i = 0; i < 3; i++) s += polyS(rect(5 * sg, 8.6 * sg, 1.8 + i * 4.2, 3.2 + i * 4.2).map((p) => pr(p[0], p[1], 0.6)), hotE ? HOTF : MET, 0.5);
  s += extrude(rect(-5, 5, 0, 13), 0, 0, 2.6, hotE ? HOTF : X(0.2), hotE ? 'rgba(255,74,46,.4)' : X(0.14), hotE ? 'rgba(255,74,46,.3)' : X(0.12));
  s += polyS(rect(-3.4, 3.4, 8.6, 12).map((p) => pr(p[0], p[1], 2.6)), hotE ? 'rgba(255,120,90,.5)' : MET, 0.5);
  const d = pr(-3.4, 2.2, 2.6);
  s += `<circle cx="${f(d[0])}" cy="${f(d[1])}" r=".9" fill="${INK}"/>`;
  return s;
}

const screwSym = () =>
  cyl(0, 0, 0, 0, 12, 1.3, METS, METS) +
  cyl(0, 0, 0, 12, 2.4, 3.4, MET, METS) +
  (() => {
    const a = proj(0)(-1.8, 0, 14.4);
    const b = proj(0)(1.8, 0, 14.4);
    const c = proj(0)(0, -1.8, 14.4);
    const d = proj(0)(0, 1.8, 14.4);
    return `<path d="M${f(a[0])},${f(a[1])}L${f(b[0])},${f(b[1])}M${f(c[0])},${f(c[1])}L${f(d[0])},${f(d[1])}" stroke="${INK}" stroke-width=".6" opacity=".7"/>`;
  })();
const standoffSym = () => cyl(0, 0, 0, 0, 30, 3.6, X(0.3), X(0.2)) + disc(0, 0, 0, 30, 1.3, HOLE, 0.5);
const grommetSym = () => cyl(0, 0, 0, 0, 3.4, 4.8, C.l3, C.l2) + disc(0, 0, 0, 3.4, 2.2, HOLE, 0.5);

const ringHole = (cy: number, x: number, y: number, z: number, ro: number, ri: number) => disc(cy, x, y, z, ro, X(0.3), 0.5) + hole(cy, x, y, z, ri);
const carbonTop = (P: Pt[], cy: number, z: number) => `<polygon points="${pts(P.map((p) => proj(cy)(p[0], p[1], z)))}" fill="url(#cf)" stroke="none"/>`;

/** Skladniki rysunku scenicznego (bez filtra glow), z podswietleniem jednej czesci. */
function buildDrone(hot: Part | null): string {
  const pal = (part: Part, normal: Pal): Pal => (hot === part ? HOT : normal);
  let out = `<defs>${sym('mot', motorSym(hot === 'motors'))}${sym('propA', propSym(false))}${sym('propB', propSym(true))}${sym('mosL', mosSym(true, hot === 'esc'))}${sym('mosR', mosSym(false, hot === 'esc'))}${sym('scr', screwSym())}${sym('sto', standoffSym())}${sym('grm', grommetSym())}</defs>`;

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

  // bateria 6S: 6 ogniw widocznych na czole, paski niklowe, pasek, przewod z XT60
  {
    const cy = Y.bat;
    const pr = proj(cy);
    const H = 36;
    const bx = 32;
    const by = 62;
    const l0 = pr(0, -by, 14);
    const lx = l0[0] - 72;
    const ly = l0[1] + 22;
    const lead = `M${f(l0[0])},${f(l0[1])} C ${f(l0[0] - 40)},${f(l0[1] + 6)} ${f(l0[0] - 50)},${f(l0[1] + 20)} ${f(lx)},${f(ly)}`;
    out += `<path d="${lead}" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/><path d="${lead}" fill="none" stroke="${DARK}" stroke-width="1.3" stroke-linecap="round"/>`;
    // XT60
    out += polyS([[lx - 15, ly - 5], [lx, ly - 5], [lx, ly + 5], [lx - 15, ly + 5]], X(0.3), 0.8);
    out += polyS([[lx - 15, ly - 5], [lx - 12, ly - 8], [lx + 3, ly - 8], [lx, ly - 5]], X(0.2), 0.8);
    out += polyS([[lx - 13, ly - 3], [lx - 9, ly - 3], [lx - 9, ly + 3], [lx - 13, ly + 3]], MET, 0.5);
    out += polyS([[lx - 7, ly - 3], [lx - 3, ly - 3], [lx - 3, ly + 3], [lx - 7, ly + 3]], MET, 0.5);
    const bp = pal('battery', [C.l2, C.l4, C.l5]);
    out += extrude(rect(-bx, bx, -by, by), cy, 0, H, bp[0], bp[1], bp[2]);
    const cw = (2 * by) / 6;
    for (let i = 0; i < 6; i++) {
      const y0 = -by + 1 + i * cw;
      out += poly(rect(-26, 26, y0, y0 + cw - 2).map((p) => pr(p[0], p[1], H)), X(0.14));
      const c = pr(bx, -by + cw / 2 + i * cw, H / 2);
      out += `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="9" fill="${X(0.18)}" stroke="${INK}" stroke-width=".8"/><circle cx="${f(c[0])}" cy="${f(c[1])}" r="5.6" fill="${X(0.1)}" stroke="${INK}" stroke-width=".5" stroke-opacity=".7"/><circle cx="${f(c[0])}" cy="${f(c[1])}" r="2.1" fill="${MET}"/>`;
    }
    for (let i = 0; i < 5; i++) {
      const y0 = -by + cw / 2 + i * cw;
      const sx = i % 2 === 0 ? 1 : -1;
      out += poly(rect(sx * 20, sx * 28, y0, y0 + cw).map((p) => pr(p[0], p[1], H + 0.7)).map((p) => p), X(0.42));
    }
    out += poly(rect(-8, 8, -62, -56).map((p) => pr(p[0], p[1], H)), X(0.35));
    const s0 = 22;
    const s1 = 40;
    out += poly([pr(bx, s0, 0), pr(bx, s1, 0), pr(bx, s1, H), pr(bx, s0, H)], C.l7);
    out += poly([pr(-bx, s0, H + 0.6), pr(bx, s0, H + 0.6), pr(bx, s1, H + 0.6), pr(-bx, s1, H + 0.6)], C.l6);
    out += poly([pr(-8, s0 + 2, H + 0.6), pr(8, s0 + 2, H + 0.6), pr(8, s1 - 2, H + 0.6), pr(-8, s1 - 2, H + 0.6)], C.l3);
    out += extrude(rect(-9, 9, -by - 16, -by), cy, 8, 14, C.l3, C.l5, C.l4);
  }

  // plyta dolna (rama z karbonu)
  {
    const cy = Y.bot;
    const pr = proj(cy);
    out += extrude(bottomPlateRing(), cy, 0, 4, C.l3, C.l5, C.l4);
    const z = 4;
    out += carbonTop(bottomPlateRing(), cy, z);
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) {
        out += ringHole(cy, sx * 30, sy * 33, z, 4.6, 2.4);
        out += hole(cy, A * sx, B * sy, z, 6.5);
        out += disc(cy, A * sx, B * sy, z, 8.6, 'none', 0.5);
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
        out += useAt('grm', sx * 30, sy * 33, cy, z);
      }
    out += poly(rect(-22, 22, -12, 12).map((p) => pr(p[0], p[1], z)), HOLE);
    out += poly(rect(-22, 22, 24, 36).map((p) => pr(p[0], p[1], z)), HOLE);
    out += poly(rect(-22, 22, -36, -24).map((p) => pr(p[0], p[1], z)), HOLE);

    // kamera FPV w bocznych plytkach (z przodu)
    for (const yy of [-17, 14]) out += extrude(rect(52, 86, yy, yy + 3), cy, 4, 26, C.l4, C.l5, C.l4);
    out += extrude(rect(58, 76, -12, 12), cy, 10, 14, X(0.18), X(0.14), X(0.12));
    out += extrude(rect(62, 70, -9, 9), cy, 24, 3, C.l5, C.l6, C.l6);
    const lz = 17;
    const ring = (r: number) => circ(0, 0, r, 18).map(([u, v]) => pr(76, u, lz + v));
    out += poly(ring(7), X(0.28)) + poly(ring(5), 'rgba(7,11,16,.75)') + poly(ring(2.6), X(0.5));
    out += poly([pr(76, -9, 24), pr(76, 9, 24), pr(76, 9, 26.5), pr(76, -9, 26.5)], C.l1);
    for (const yy of [-17, 14]) {
      const sc = pr(86, yy + 1.5, 21);
      out += `<circle cx="${f(sc[0])}" cy="${f(sc[1])}" r="1.6" fill="${MET}" stroke="${INK}" stroke-width=".5"/>`;
    }
  }

  // dystanse ramy -> ESC
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) out += useAt('sto', sx * 30, sy * 33, Y.bot, 14);

  // odbiornik ELRS z antena T
  {
    const cy = Y.rx;
    const pr = proj(cy);
    const a0 = pr(-12, -6, 1.5);
    const a1 = pr(-44, -34, 10);
    out += `<line x1="${f(a0[0])}" y1="${f(a0[1])}" x2="${f(a1[0])}" y2="${f(a1[1])}" stroke="${INK}" stroke-width="1.25"/>`;
    const a2 = pr(-70, -66, 26);
    out += `<line x1="${f(a1[0])}" y1="${f(a1[1])}" x2="${f(a2[0])}" y2="${f(a2[1])}" stroke="${INK}" stroke-width="7" stroke-linecap="butt"/><line x1="${f(a1[0])}" y1="${f(a1[1])}" x2="${f(a2[0])}" y2="${f(a2[1])}" stroke="${C.l6}" stroke-width="4.6"/><line x1="${f(a1[0])}" y1="${f(a1[1])}" x2="${f(a2[0])}" y2="${f(a2[1])}" stroke="${DARK}" stroke-width="1.2"/>`;
    const p = pal('rx', NORMAL);
    out += extrude(rect(-15, 15, -22, 22), cy, 0, 2.4, p[0], p[1], p[2]);
    out += extrude(rect(-6, 6, -10, 2), cy, 2.4, 2.5, X(0.14), C.l6, C.l6); // ukl. glowny
    out += extrude(rect(-4, 5, 6, 14), cy, 2.4, 3, MET, METS, METS); // oslona (shield can)
    out += extrude(rect(8, 13, -18, -10), cy, 2.4, 1.6, C.l1, C.l3, C.l3);
    out += extrude(rect(-13, -9, 10, 18), cy, 2.4, 2, C.l1, C.l3, C.l3);
    out += cyl(cy, -12, -6, 2.4, 1.6, 1.9, MET, METS); // zlacze u.FL
    out += hole(cy, 9, 16, 2.4, 1.6);
    out += ringHole(cy, -11, 18, 2.4, 2.8, 1.3) + ringHole(cy, 11, 18, 2.4, 2.8, 1.3);
    for (let i = 0; i < 4; i++) out += poly(rect(13.5, 15, 8 + i * 3.4, 10 + i * 3.4).map((q) => pr(q[0], q[1], 2.4)), MET);
    out += trace(cy, 2.4, [[-8, -10], [-8, -16], [4, -16]]) + trace(cy, 2.4, [[6, -4], [10, -4], [10, 6]]);
  }

  // ESC 4w1: 8 MOSFET, kondensator, pady silnikow, zlacze 8-pin
  {
    const cy = Y.esc;
    const pr = proj(cy);
    const hotE = hot === 'esc';
    const p = pal('esc', NORMAL);
    out += extrude(cham(-40, 40, -44, 44, 6), cy, 0, 3, p[0], p[1], p[2]);
    const z = 3;
    for (let i = 0; i < 4; i++) {
      const y0 = -30 + i * 20;
      out += trace(cy, z, [[-20, y0 + 7], [-8, y0 + 7], [-2, 0]]) + trace(cy, z, [[20, y0 + 7], [10, y0 + 7], [4, 0]]);
    }
    for (const x of [-26, 26]) for (let i = 0; i < 4; i++) out += useAt(x < 0 ? 'mosL' : 'mosR', x, -38 + i * 20 + 0.5, cy, z);
    out += cyl(cy, -2, 0, z, 16, 9.5, X(0.3), X(0.2));
    out += disc(cy, -2, 0, z + 16, 7, 'none', 0.5);
    {
      const a = pr(-8.5, 0, z + 16);
      const b = pr(4.5, 0, z + 16);
      out += `<path d="M${f(a[0])},${f(a[1])}L${f(b[0])},${f(b[1])}" stroke="${INK}" stroke-width=".6" opacity=".7"/>`;
    }
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (let i = 0; i < 3; i++) {
          const x0 = sx * (18 + i * 7);
          out += poly(rect(x0 - 2.5, x0 + 2.5, sy * 41 - 2.5, sy * 41 + 2.5).map((q) => pr(q[0], q[1], z)), hotE ? HOTF : X(0.42), 'stroke-opacity=".6"');
        }
    out += extrude(rect(-14, 14, 36, 42), cy, z, 3, X(0.2), X(0.14), X(0.12));
    for (let i = 0; i < 8; i++) out += poly(rect(-13 + i * 3.45, -11.4 + i * 3.45, 37.5, 40.5).map((q) => pr(q[0], q[1], z + 3)), MET, 'stroke-opacity=".5"');
    for (let i = 0; i < 6; i++) out += poly(rect(36, 39, -16 + i * 6, -13 + i * 6).map((q) => pr(q[0], q[1], z)), X(0.4));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) out += ringHole(cy, sx * 30, sy * 33, z, 4.4, 2.2);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) out += useAt('grm', sx * 30, sy * 33, cy, z);
  }

  // dystanse ESC -> FC i wiazka 8-pin (miedzy plytkami)
  {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) out += useAt('sto', sx * 30, sy * 33, Y.esc, 12);
    let rib = '';
    for (let i = 0; i < 8; i++) {
      const xi = -14 + i * 4;
      const e = proj(Y.esc)(xi, 39, 6);
      const g = proj(Y.fc)(xi, 39, 0);
      rib += `<path d="M${f(e[0])},${f(e[1])}C${f(e[0] + 30)},${f(e[1] - 8)} ${f(g[0] + 30)},${f(g[1] + 8)} ${f(g[0])},${f(g[1])}" fill="none" stroke="${INK}" stroke-width=".8" stroke-opacity=".7"/>`;
    }
    out += rib;
  }

  // FC: MCU, zyroskop, USB-C, pady, otwory
  {
    const cy = Y.fc;
    const pr = proj(cy);
    const p = pal('fc', NORMAL);
    out += extrude(cham(-40, 40, -44, 44, 6), cy, 0, 3, p[0], p[1], p[2]);
    const z = 3;
    // USB-C z otworem
    out += extrude(rect(40, 52, -12, 12), cy, z, 4, MET, X(0.3), X(0.22));
    out += poly([pr(52, -7, z + 1), pr(52, 7, z + 1), pr(52, 7, z + 3), pr(52, -7, z + 3)], 'rgba(7,11,16,.8)');
    out += poly([pr(52, -4, z + 1.9), pr(52, 4, z + 1.9), pr(52, 4, z + 2.1), pr(52, -4, z + 2.1)], MET);
    // MCU z wyprowadzeniami
    out += poly(rect(-15, 15, -17, 17).map((q) => pr(q[0], q[1], z + 0.4)), 'none', 'stroke-dasharray=".8 1.2" stroke-opacity=".8"').replace('stroke-width="0.9"', 'stroke-width="2.4"');
    out += extrude(rect(-12, 12, -14, 14), cy, z, 3.4, X(0.2), X(0.15), X(0.14));
    const dot = pr(-9, -11, z + 3.4);
    out += `<circle cx="${f(dot[0])}" cy="${f(dot[1])}" r="1.1" fill="${INK}"/>`;
    // zyroskop + flash + elementy SMD
    out += extrude(rect(-30, -22, 18, 26), cy, z, 1.8, X(0.22), X(0.16), X(0.14));
    const gd = pr(-28.5, 19.5, z + 1.8);
    out += `<circle cx="${f(gd[0])}" cy="${f(gd[1])}" r=".8" fill="${INK}"/>`;
    out += extrude(rect(18, 30, -34, -22), cy, z, 1.8, X(0.2), X(0.15), X(0.14));
    for (let i = 0; i < 6; i++) out += extrude(rect(24, 27, 6 + i * 5, Math.min(9 + i * 5, 43)), cy, z, 0.8, X(0.26), C.l3, C.l3);
    const smd: Array<[number, number, number, number]> = [[-34, 8, -30, 10], [-34, 12, -30, 14], [-20, 30, -16, 32], [-6, 28, -2, 30], [6, 28, 10, 30], [14, 22, 18, 24], [-18, -30, -14, -28], [-8, -34, -4, -32], [4, -34, 8, -32], [30, 14, 34, 16]];
    for (const [a, b, c, d] of smd) out += poly(rect(a, c, b, d).map((q) => pr(q[0], q[1], z)), X(0.3), 'stroke-opacity=".6"');
    for (let i = 0; i < 8; i++) out += poly(rect(-36 + i * 8.6, -33 + i * 8.6, 38, 42).map((q) => pr(q[0], q[1], z)), X(0.4));
    for (let i = 0; i < 6; i++) out += poly(rect(33, 37, -38 + i * 7, -35 + i * 7).map((q) => pr(q[0], q[1], z)), X(0.4));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) out += ringHole(cy, sx * 30, sy * 33, z, 4.6, 2.4);
    out +=
      trace(cy, z, [[-30, 38], [-30, 20], [-14, 14]]) +
      trace(cy, z, [[-8, 38], [-8, 24], [-14, 16]]) +
      trace(cy, z, [[14, 0], [22, -10], [34, -10], [34, -30]]) +
      trace(cy, z, [[14, 6], [26, 6], [26, 30], [33, 36]]) +
      trace(cy, z, [[-34, -30], [-20, -30], [-14, -16]]) +
      trace(cy, z, [[0, -14], [0, -36], [-16, -36]]);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) out += useAt('sto', sx * 30, sy * 33, Y.fc, 12);
  }

  // plyta gorna (karbon) ze srubami
  {
    const cy = Y.top;
    const pr = proj(cy);
    const topP = cham(-68, 68, -52, 52, 20);
    out += extrude(topP, cy, 0, 4, C.l2, C.l4, C.l5);
    const z = 4;
    out += carbonTop(topP, cy, z);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) out += ringHole(cy, sx * 30, sy * 33, z, 5.2, 3.2);
    out += poly(rect(-8, 8, -44, -22).map((p) => pr(p[0], p[1], z)), HOLE);
    out += poly(rect(-8, 8, 22, 44).map((p) => pr(p[0], p[1], z)), HOLE);
    out += poly(rect(52, 60, -10, 10).map((p) => pr(p[0], p[1], z)), HOLE);
    out += poly(rect(-56, -46, -10, 10).map((p) => pr(p[0], p[1], z)), HOLE);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) out += useAt('scr', sx * 30, sy * 33, cy, 14);
  }

  // silniki
  for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as Array<[number, number]>) out += useAt('mot', sx * A, sy * B, Y.motors, 0, 1.2);

  // smigla
  for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as Array<[number, number]>) out += useAt(sx * sy > 0 ? 'propA' : 'propB', sx * A, sy * B, Y.props);
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
<pattern id="cf" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="matrix(${K} ${SY} 1 0 0 0)"><path d="M0 0h2.5v2.5H0zM2.5 2.5H5V5H2.5z" fill="rgba(207,230,242,.11)"/><path d="M2.5 0H5v2.5H2.5zM0 2.5h2.5V5H0z" fill="rgba(207,230,242,.03)"/></pattern>
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
    lab += `<text x="${LX}" y="${f(ay - 52)}" ${mono} font-size="12" fill="${INK}" letter-spacing=".06em">${esc(t('xray.rx'))}</text>`;
    lab += `<text x="${LX}" y="${f(ay - 28)}" ${sans(18, 600)} fill="${INK}">${esc(labels.rxTitle)}</text>`;
    if (labels.rxSub) lab += dotMark(LX + 4, ay - 14, AMB) + `<text x="${LX + 14}" y="${f(ay - 9)}" ${mono} font-size="12.5" fill="${AMB}">${esc(labels.rxSub)}</text>`;
  }
  // Bateria
  {
    const [ax, ay] = prL(Y.bat)(0, -62, 18);
    lab += hair(LX, ay, ax, ay) + anchorDot(ax, ay);
    lab += `<text x="${LX}" y="${f(ay - 33)}" ${mono} font-size="12" fill="${INK}" letter-spacing=".06em">${esc(t('xray.battery'))}</text>`;
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
    lab += `<text x="${RX}" y="${f(my - 12)}" ${mono} font-size="12" fill="${highlight === 'motors' ? REDS : INK}" letter-spacing=".06em">${esc(t('xray.motors'))}</text>`;
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

  return `<svg class="xray" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMaxYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(t('xray.aria'))}">${DEFS}${marks}${glow}<g filter="url(#glow)" transform="translate(${CX + DX} ${TY}) scale(${SC}) translate(${-CX} 0)">${out}</g>${lab}${over}${film}</svg>`;
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
