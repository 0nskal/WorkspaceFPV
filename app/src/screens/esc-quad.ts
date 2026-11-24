/**
 * Motors tab: the Quad X "Model type" picture on the drone render (the same as the Drone screen), like Betaflight's:
 * numbered motors 1..4, spin arrows (CW/CCW) for props in / props out, problem motors red, motors the test spins blue.
 */
import { droneArt, MOTORS } from '../ui/art-drone';
import { escapeHtml } from '../ui/dom';

/** Angle pointing away from the centre for M1..M4 on the render (SVG, y down). */
export const MOTOR_OUT = [45, -45, 135, -135];

/** Betaflight default (props in): M1 and M4 spin clockwise seen from above, M2 and M3 counter-clockwise. */
export function spinsCw(motorIdx: number, propsOut: boolean): boolean {
  const cwIn = motorIdx === 0 || motorIdx === 3;
  return propsOut ? !cwIn : cwIn;
}

/** Spin-direction arc around motor i on the 1024 px render, with an arrowhead at its end. */
export function motorArrow(i: number, propsOut: boolean, cls: string, r = 118): string {
  const m = MOTORS[i]!;
  const cw = spinsCw(i, propsOut);
  const rad = (d: number) => (d * Math.PI) / 180;
  const a0 = rad(MOTOR_OUT[i]! - 55);
  const a1 = rad(MOTOR_OUT[i]! + 55);
  const pt = (a: number) => [m.x + r * Math.cos(a), m.y + r * Math.sin(a)] as const;
  const [sx, sy] = pt(cw ? a0 : a1);
  const [ex, ey] = pt(cw ? a1 : a0);
  const end = cw ? a1 : a0;
  const tx = -Math.sin(end) * (cw ? 1 : -1);
  const ty = Math.cos(end) * (cw ? 1 : -1);
  const nx = Math.cos(end);
  const ny = Math.sin(end);
  const h = 18;
  const head = `M${(ex + tx * h).toFixed(1)} ${(ey + ty * h).toFixed(1)} L${(ex + nx * h * 0.6).toFixed(1)} ${(ey + ny * h * 0.6).toFixed(1)} L${(ex - nx * h * 0.6).toFixed(1)} ${(ey - ny * h * 0.6).toFixed(1)} Z`;
  return `<g class="mb-arrow ${cls}"><path d="M${sx.toFixed(1)} ${sy.toFixed(1)} A${r} ${r} 0 0 ${cw ? 1 : 0} ${ex.toFixed(1)} ${ey.toFixed(1)}" /><path class="mb-head" d="${head}"/></g>`;
}

export interface QuadOpts {
  propsOut: boolean;
  /** Motor indexes with a problem (red). */
  hot: number[];
  /** Motor output 0..100 per motor while the test spins it (blue), else 0. */
  active: number[];
  aria: string;
  front: string;
}

export function quadSvg(o: QuadOpts): string {
  const over = MOTORS.map((m, i) => {
    const cls = o.hot.includes(i) ? 'bad' : (o.active[i] ?? 0) > 0 ? 'cur' : 'idle';
    const cw = spinsCw(i, o.propsOut);
    // CW / CCW label just outside the arc, on the side the arrow starts
    const a = ((MOTOR_OUT[i]! + (cw ? -80 : 80)) * Math.PI) / 180;
    const lx = m.x + Math.cos(a) * 150;
    const ly = m.y + Math.sin(a) * 150;
    return `${motorArrow(i, o.propsOut, cls)}<g class="mb-badge q-badge ${cls}" transform="translate(${m.x} ${m.y})"><circle r="52"/><text text-anchor="middle" y="15">${i + 1}</text></g><text class="q-dir" x="${lx.toFixed(1)}" y="${(ly + 12).toFixed(1)}" text-anchor="middle">${cw ? 'CW' : 'CCW'}</text>`;
  }).join('');
  const front = `<text class="q-front" x="512" y="48" text-anchor="middle">▲ ${escapeHtml(o.front)}</text>`;
  return `<div class="mt-quad-art">${droneArt({ label: escapeHtml(o.aria), overlay: over + front })}</div>`;
}
