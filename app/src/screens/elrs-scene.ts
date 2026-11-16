import { renderDrone } from '../ui/drone-xray';

/**
 * Scena ekranu ELRS: rozklad drona (przygaszony), odbiornik jako ognisko i "DETAL A 3:1" w kole.
 * Wszystko w jednym SVG, wiec ognisko i prowadnica do detalu zawsze trafiaja w odbiornik.
 */
const INK = '#DCEFF8';
const BG = '#070B10';
const RED = '#FF4A2E';
const mono = `font-family="IBM Plex Mono, ui-monospace, Consolas, monospace"`;

/** Srodek odbiornika w ukladzie viewBox rozkladu (1000x848); patrz drone-xray: prL(Y.rx)(0,0,2.4). */
const RX: [number, number] = [470, 601.8];
const RX_R = 42;
export const SCENE_VB = { x: -30, y: 0, w: 800, h: 848 };
const DC: [number, number] = [150, 625]; // srodek detalu
const DR = 150;

type Pt = [number, number];
const n = (v: number) => +v.toFixed(1);
const pts = (a: Pt[]) => a.map((p) => `${n(p[0])},${n(p[1])}`).join(' ');
const poly = (a: Pt[], fill: string, sw = 1) => `<polygon points="${pts(a)}" fill="${fill}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`;

function detail(): string {
  const O: Pt = [-95, 22];
  const U: Pt = [150, -42];
  const V: Pt = [70, 48];
  const P = (u: number, v: number, z = 0): Pt => [O[0] + u * U[0] + v * V[0], O[1] + u * U[1] + v * V[1] - z];
  const T = 'rgba(255,74,46,.34)';
  const SF = 'rgba(255,74,46,.22)';
  const SL = 'rgba(255,74,46,.14)';
  const box = (u0: number, u1: number, v0: number, v1: number, z0: number, h: number, top: string, sf: string, sl: string) =>
    poly([P(u0, v0, z0), P(u0, v1, z0), P(u0, v1, z0 + h), P(u0, v0, z0 + h)], sl) +
    poly([P(u0, v1, z0), P(u1, v1, z0), P(u1, v1, z0 + h), P(u0, v1, z0 + h)], sf) +
    poly([P(u0, v0, z0 + h), P(u1, v0, z0 + h), P(u1, v1, z0 + h), P(u0, v1, z0 + h)], top);

  let g = '';
  // antena T (za plytka): pret + przewod
  const bar: [Pt, Pt] = [
    [-128, -92],
    [-86, -6],
  ];
  g += `<line x1="${bar[0][0]}" y1="${bar[0][1]}" x2="${bar[1][0]}" y2="${bar[1][1]}" stroke="${INK}" stroke-width="15"/><line x1="${bar[0][0]}" y1="${bar[0][1]}" x2="${bar[1][0]}" y2="${bar[1][1]}" stroke="#101c27" stroke-width="12.5"/>`;
  const fm: Pt = [(bar[0][0] + bar[1][0]) / 2, (bar[0][1] + bar[1][1]) / 2];
  const fp = P(0.06, 0.2, 3);
  g += `<line x1="${n(fm[0])}" y1="${n(fm[1])}" x2="${n(fp[0])}" y2="${n(fp[1])}" stroke="${INK}" stroke-width="3.5"/><circle cx="${n(fm[0])}" cy="${n(fm[1])}" r="3" fill="${INK}"/>`;
  // plytka (grubosc 7)
  g += box(0, 1, 0, 1, -7, 7, T, SF, SL);
  // maly uklad (filtr) i glowny chip
  g += box(0.1, 0.24, 0.3, 0.52, 0, 3, 'rgba(207,230,242,.14)', 'rgba(207,230,242,.1)', 'rgba(207,230,242,.08)');
  g += box(0.36, 0.68, 0.26, 0.64, 0, 8, 'rgba(11,16,22,.92)', 'rgba(11,16,22,.8)', 'rgba(11,16,22,.7)');
  const dot = P(0.4, 0.31, 8);
  g += `<circle cx="${n(dot[0])}" cy="${n(dot[1])}" r="2" fill="${INK}"/>`;
  // oslona RF (shield can), kondensatory, kwarc, zlacze u.FL, sciezki i pady montazowe
  g += box(0.08, 0.3, 0.58, 0.76, 0, 6, 'rgba(207,230,242,.3)', 'rgba(207,230,242,.2)', 'rgba(207,230,242,.14)');
  for (const [u, v] of [[0.74, 0.3], [0.82, 0.3], [0.74, 0.5], [0.82, 0.5], [0.5, 0.74]]) g += box(u, u + 0.06, v, v + 0.08, 0, 2.2, 'rgba(207,230,242,.34)', 'rgba(207,230,242,.2)', 'rgba(207,230,242,.14)');
  g += box(0.74, 0.9, 0.12, 0.22, 0, 3.4, 'rgba(207,230,242,.3)', 'rgba(207,230,242,.2)', 'rgba(207,230,242,.14)');
  const ufl = P(0.04, 0.12, 3);
  g += `<circle cx="${n(ufl[0])}" cy="${n(ufl[1])}" r="5" fill="rgba(207,230,242,.34)" stroke="${INK}" stroke-width=".9"/><circle cx="${n(ufl[0])}" cy="${n(ufl[1])}" r="2" fill="${BG}" stroke="${INK}" stroke-width=".6"/>`;
  const tr = (a: Array<[number, number]>) => `<polyline points="${pts(a.map(([u, v]) => P(u, v, 0.2)))}" fill="none" stroke="${INK}" stroke-width=".8" opacity=".6"/>`;
  g += tr([[0.3, 0.4], [0.36, 0.4]]) + tr([[0.68, 0.4], [0.74, 0.34]]) + tr([[0.68, 0.55], [0.82, 0.55]]) + tr([[0.5, 0.64], [0.5, 0.74]]) + tr([[0.1, 0.52], [0.1, 0.3], [0.2, 0.2]]);
  for (const [u, v] of [[0.04, 0.9], [0.96, 0.9], [0.96, 0.08]]) {
    const q = P(u, v, 0);
    g += `<circle cx="${n(q[0])}" cy="${n(q[1])}" r="3.6" fill="rgba(207,230,242,.3)" stroke="${INK}" stroke-width=".7"/><circle cx="${n(q[0])}" cy="${n(q[1])}" r="1.6" fill="${BG}"/>`;
  }
  // zlacze: rzad padow przy krawedzi
  for (let i = 0; i < 6; i++) {
    const a = 0.14 + i * 0.13;
    g += poly([P(a, 0.8, 0), P(a + 0.07, 0.8, 0), P(a + 0.07, 0.93, 0), P(a, 0.93, 0)], 'rgba(224,168,46,.55)', 0.8);
  }
  // opisy
  const chip = P(0.52, 0.45, 8);
  const pad = P(0.5, 0.93, 0);
  const lbl = (x: number, y: number, t: string, anchor = 'start') =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" ${mono} font-size="11.5" letter-spacing=".1em" fill="${INK}">${t}</text>`;
  g +=
    `<path d="M${n(chip[0])},${n(chip[1])}L${n(chip[0])},-84" stroke="${INK}" stroke-width=".8" fill="none"/><circle cx="${n(chip[0])}" cy="${n(chip[1])}" r="2.6" fill="${INK}" stroke="${BG}"/>` +
    lbl(n(chip[0]), -92, 'CHIP', 'middle');
  g += `<path d="M${n(fm[0] - 6)},${n(fm[1] + 8)}L-100,64" stroke="${INK}" stroke-width=".8" fill="none"/>` + lbl(-104, 80, 'ANTENA T');
  g +=
    `<path d="M${n(pad[0])},${n(pad[1])}L${n(pad[0] - 14)},104" stroke="${INK}" stroke-width=".8" fill="none"/><circle cx="${n(pad[0])}" cy="${n(pad[1])}" r="2.6" fill="${INK}" stroke="${BG}"/>` +
    lbl(n(pad[0] - 14), 118, 'ZŁĄCZE', 'middle');
  return g;
}

export function renderElrsScene(rxLabel: string): string {
  const inner = /^<svg[^>]*>([\s\S]*)<\/svg>$/.exec(
    renderDrone({ highlight: null, bare: true, labels: { filmTop: '', filmBottom: '', fcTitle: '', fcSub: '', rxTitle: '', batteryText: '', motors: null } }),
  )?.[1];
  const [cx, cy] = DC;
  // prowadnica: od brzegu detalu do brzegu pierscienia ogniska
  const ang = Math.atan2(RX[1] - cy, RX[0] - cx);
  const p1: Pt = [cx + Math.cos(ang) * DR, cy + Math.sin(ang) * DR];
  const p2: Pt = [RX[0] - Math.cos(ang) * RX_R, RX[1] - Math.sin(ang) * RX_R];
  const sec = 'rgba(207,230,242,.5)';
  const mk = (x: number, y: number) => `<path d="M${x - 6},${y}H${x + 6}M${x},${y - 6}V${y + 6}" stroke="${INK}" stroke-width=".8" opacity=".5"/>`;
  const { x, y, w, h } = SCENE_VB;
  const ring =
    `<circle cx="${RX[0]}" cy="${RX[1]}" r="120" fill="url(#hot)"/>` +
    `<circle cx="${RX[0]}" cy="${RX[1]}" r="${RX_R}" fill="none" stroke="${RED}" stroke-width="1" stroke-opacity=".85"/>` +
    `<circle cx="${RX[0]}" cy="${RX[1]}" r="${RX_R * 0.72}" fill="none" stroke="${RED}" stroke-width="1.2" stroke-dasharray="3 3"/>` +
    `<text x="${RX[0] - RX_R - 6}" y="${RX[1] - RX_R - 14}" ${mono} font-size="13" font-weight="500" fill="${INK}" text-anchor="middle">A</text>`;
  const tag = `<rect x="${RX[0] + RX_R + 18}" y="${RX[1] - 3}" width="7" height="7" fill="${RED}"/><text x="${RX[0] + RX_R + 32}" y="${RX[1] + 5}" font-family="IBM Plex Sans, system-ui, sans-serif" font-size="17" font-weight="600" fill="${INK}">${rxLabel}</text>`;
  const det =
    `<circle cx="${cx}" cy="${cy}" r="${DR + 9}" fill="none" stroke="${sec}" stroke-width=".8" stroke-dasharray="2 4"/>` +
    `<clipPath id="elrs-clip"><circle cx="${cx}" cy="${cy}" r="${DR}"/></clipPath>` +
    `<circle cx="${cx}" cy="${cy}" r="${DR}" fill="#0a121a" stroke="${INK}" stroke-width="1.2"/>` +
    `<g clip-path="url(#elrs-clip)"><path d="M${cx - DR},${cy}H${cx + DR}M${cx},${cy - DR}V${cy + DR}" stroke="${sec}" stroke-width=".6" stroke-dasharray="4 5" opacity=".5"/><g transform="translate(${cx} ${cy}) scale(1.1)">${detail()}</g></g>` +
    `<rect x="${cx - 78}" y="${cy + DR + 26}" width="7" height="7" fill="${RED}"/><text x="${cx - 62}" y="${cy + DR + 34}" ${mono} font-size="12.5" letter-spacing=".1em" fill="${INK}">DETAL A · 3:1</text>`;
  const lead = `<path d="M${n(p1[0])},${n(p1[1])}L${n(p2[0])},${n(p2[1])}" stroke="${RED}" stroke-width="1.5" fill="none"/><circle cx="${n(p1[0])}" cy="${n(p1[1])}" r="3.4" fill="${RED}" stroke="${BG}" stroke-width="1.5"/>`;
  return `<svg class="elrs-svg" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMaxYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Rozkład drona z powiększeniem odbiornika"><g class="elrs-dim">${inner ?? ''}</g>${ring}${lead}${det}${tag}${mk(x + 22, 30)}${mk(x + w - 22, 30)}${mk(x + 22, 818)}${mk(x + w - 22, 818)}</svg>`;
}
