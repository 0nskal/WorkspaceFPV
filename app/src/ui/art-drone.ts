/**
 * Drone artwork: a top-down studio render of a typical 5" freestyle quad (true-X frame, 2207 motors, 3-blade props,
 * 30x30 stack, HD camera, digital VTX, ELRS receiver, XT60) with an SVG overlay in the same 1024x1024 space:
 * status rings on parts, a hover focus ring and spinning prop discs driven by telemetry.
 * Front is up. Motor numbering is Betaflight's Quad X: M1 rear right, M2 front right, M3 rear left, M4 front left
 * (default spin: M1/M4 clockwise, props in).
 */
import droneImg from '../assets/img/drone-top.webp';

export type DronePart = 'fc' | 'esc' | 'rx' | 'motors' | 'battery' | 'camera' | 'vtx';
export type PartState = 'ok' | 'warn' | 'fail' | 'idle';

export const ART_W = 1024;
export const ART_H = 1024;

/** Motor centres on the render, BF order (index 0 = M1). */
export const MOTORS: Array<{ x: number; y: number; cw: boolean }> = [
  { x: 818, y: 795, cw: true },
  { x: 818, y: 240, cw: false },
  { x: 210, y: 795, cw: false },
  { x: 210, y: 240, cw: true },
];
const PROP_R = 196;

/** Part centre and ring size on the render. */
export const ANCHORS: Record<DronePart, { x: number; y: number; r: number }> = {
  camera: { x: 513, y: 218, r: 52 },
  fc: { x: 513, y: 512, r: 92 },
  esc: { x: 592, y: 532, r: 60 },
  vtx: { x: 513, y: 692, r: 66 },
  rx: { x: 606, y: 728, r: 46 },
  battery: { x: 515, y: 905, r: 54 },
  motors: { x: 818, y: 240, r: 52 },
};

export interface DroneArtOptions {
  label: string;
  /** Per-part status ring; parts not listed are drawn plain. */
  states?: Partial<Record<DronePart, PartState>>;
  /** Extra SVG (callout lines) drawn into the overlay. */
  overlay?: string;
}

function wedges(): string {
  // motion blur of a spinning 3-blade prop: three soft sectors
  return [0, 120, 240]
    .map((a) => `<path d="M0 0 L${PROP_R} 0 A${PROP_R} ${PROP_R} 0 0 1 ${(PROP_R * Math.cos(0.9)).toFixed(1)} ${(PROP_R * Math.sin(0.9)).toFixed(1)} Z" transform="rotate(${a})"/>`)
    .join('');
}

export function droneArt(opts: DroneArtOptions): string {
  const st = opts.states ?? {};
  const discs = MOTORS.map(
    (m, i) => `<g transform="translate(${m.x} ${m.y})"><circle class="d-disc" data-disc="${i}" r="${PROP_R}"/><g class="d-blur" data-prop="${i}">${wedges()}</g></g>`,
  ).join('');
  const rings = (Object.keys(ANCHORS) as DronePart[])
    .map((p) => {
      const a = ANCHORS[p];
      const s = st[p];
      const motorRings = p === 'motors' ? MOTORS.map((m) => `<circle cx="${m.x}" cy="${m.y}" r="${a.r}"/>`).join('') : `<circle cx="${a.x}" cy="${a.y}" r="${a.r}"/>`;
      return `<g class="d-ring" data-part="${p}"${s && s !== 'idle' ? ` data-state="${s}"` : ''}>${motorRings}</g>`;
    })
    .join('');
  return `<div class="d-stage">
    <img class="d-img" src="${droneImg}" alt="" width="${ART_W}" height="${ART_H}" decoding="async" draggable="false" />
    <svg class="d-over" viewBox="0 0 ${ART_W} ${ART_H}" role="img" aria-label="${opts.label}">${discs}${rings}${opts.overlay ?? ''}</svg>
  </div>`;
}

/**
 * Spins the prop discs from motor outputs (0..100 %). One rAF loop per drawing; returns a stop function.
 * With reduced motion the disc only fades in to show that a motor is running.
 */
export function spinProps(root: Element, read: () => number[] | null): () => void {
  const blur = [0, 1, 2, 3].map((i) => root.querySelector<SVGGElement>(`[data-prop="${i}"]`));
  const discs = [0, 1, 2, 3].map((i) => root.querySelector<SVGCircleElement>(`[data-disc="${i}"]`));
  const angle = [0, 30, 60, 90];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(64, now - last) / 1000;
    last = now;
    const pct = read() ?? [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const p = Math.max(0, Math.min(100, pct[i] ?? 0));
      const on = p > 2;
      discs[i]?.classList.toggle('on', on);
      blur[i]?.classList.toggle('on', on && !reduce);
      if (!reduce && on) {
        // visual speed only; past ~30 % it reads as a blur anyway
        const speed = 120 + p * 14;
        angle[i] = (angle[i]! + (MOTORS[i]!.cw ? 1 : -1) * speed * dt) % 360;
        blur[i]?.setAttribute('transform', `rotate(${angle[i]!.toFixed(1)})`);
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
