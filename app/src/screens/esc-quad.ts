/**
 * Motors tab: clean Quad X diagram seen from above, like the Betaflight "Model type" picture.
 * Numbered motors 1..4, spin arrows (CW/CCW) for props in / props out, nose arrow, problem motors in hot red,
 * motors that the test is spinning filled amber.
 */
import { escapeHtml } from '../ui/dom';

const INK = '#dceff8';
const SUB = '#8fa9b8';
const AMBER = '#e0a82e';
const HOT = '#ff4a2e';
const ARM = '#2c4152';

/** Betaflight Quad X: M1 rear right, M2 front right, M3 rear left, M4 front left. `out` = angle pointing away from the centre (SVG, y down). */
const POS = [
  { x: 232, y: 226, out: 45 },
  { x: 232, y: 78, out: -45 },
  { x: 72, y: 226, out: 135 },
  { x: 72, y: 78, out: -135 },
];
const CX = 152;
const CY = 152;
const f = (n: number) => +n.toFixed(1);

/** Betaflight default (props in): M1 and M4 spin clockwise seen from above, M2 and M3 counter-clockwise. */
export function spinsCw(motorIdx: number, propsOut: boolean): boolean {
  const cwIn = motorIdx === 0 || motorIdx === 3;
  return propsOut ? !cwIn : cwIn;
}

function arrow(p: (typeof POS)[number], cw: boolean, col: string): string {
  const r = 47;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a0 = rad(p.out - 52);
  const a1 = rad(p.out + 52);
  const pt = (a: number) => [p.x + r * Math.cos(a), p.y + r * Math.sin(a)];
  const [sx, sy] = pt(cw ? a0 : a1);
  const [ex, ey] = pt(cw ? a1 : a0);
  const end = cw ? a1 : a0;
  const dir = cw ? 1 : -1;
  const tx = -Math.sin(end) * dir;
  const ty = Math.cos(end) * dir;
  const nx = Math.cos(end);
  const ny = Math.sin(end);
  const head = `${f(ex + tx * 10)},${f(ey + ty * 10)} ${f(ex + nx * 6)},${f(ey + ny * 6)} ${f(ex - nx * 6)},${f(ey - ny * 6)}`;
  return `<path d="M${f(sx)} ${f(sy)}A${r} ${r} 0 0 ${cw ? 1 : 0} ${f(ex)} ${f(ey)}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/><polygon points="${head}" fill="${col}"/>`;
}

export interface QuadOpts {
  propsOut: boolean;
  /** Motor indexes with a problem (hot red ring). */
  hot: number[];
  /** Motor output 0..100 per motor while the test spins it (amber fill), else 0. */
  active: number[];
  aria: string;
  front: string;
}

export function quadSvg(o: QuadOpts): string {
  const arms = `<line x1="${POS[3].x}" y1="${POS[3].y}" x2="${POS[0].x}" y2="${POS[0].y}" stroke="${ARM}" stroke-width="18" stroke-linecap="round"/><line x1="${POS[1].x}" y1="${POS[1].y}" x2="${POS[2].x}" y2="${POS[2].y}" stroke="${ARM}" stroke-width="18" stroke-linecap="round"/>`;
  const body = `<rect x="${CX - 30}" y="${CY - 36}" width="60" height="72" rx="10" fill="#132230" stroke="#3a5266" stroke-width="1.5"/>`;
  const nose = `<path d="M${CX} ${CY - 26}l13 16h-7v24h-12v-24h-7z" fill="${HOT}"/>`;
  const motors = POS.map((p, i) => {
    const hot = o.hot.includes(i);
    const act = Math.max(0, Math.min(100, o.active[i] ?? 0));
    const ring = hot ? HOT : AMBER;
    const cw = spinsCw(i, o.propsOut);
    const lx = p.x + Math.cos(((p.out + (cw ? -76 : 76)) * Math.PI) / 180) * 47;
    const ly = p.y + Math.sin(((p.out + (cw ? -76 : 76)) * Math.PI) / 180) * 47;
    return `<g class="mt-q-m${hot ? ' hot' : ''}" data-qm="${i}">
      <circle cx="${p.x}" cy="${p.y}" r="36" fill="${act > 0 ? `rgba(224,168,46,${(0.12 + act / 220).toFixed(2)})` : 'rgba(11,20,28,.9)'}" stroke="${ring}" stroke-width="${hot ? 3 : 2}"${hot ? ' filter="url(#mt-q-glow)"' : ''}/>
      <circle cx="${p.x}" cy="${p.y}" r="17" fill="${hot ? HOT : '#cfe6f2'}"/>
      <text x="${p.x}" y="${p.y + 6.5}" text-anchor="middle" class="mt-q-n">${i + 1}</text>
      ${arrow(p, cw, hot ? HOT : INK)}
      <text x="${f(lx)}" y="${f(ly + 4)}" text-anchor="middle" class="mt-q-dir">${cw ? 'CW' : 'CCW'}</text>
    </g>`;
  }).join('');
  return `<svg class="mt-quad-svg" viewBox="0 0 304 296" role="img" aria-label="${escapeHtml(o.aria)}">
    <defs><filter id="mt-q-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <text x="${CX}" y="14" text-anchor="middle" class="mt-q-front" fill="${SUB}">▲ ${escapeHtml(o.front)}</text>
    ${arms}${body}${nose}${motors}
  </svg>`;
}
