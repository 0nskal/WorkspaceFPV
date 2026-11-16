/** Small wireframe quad in an isometric view, drawn in the Rentgen style (thin light lines, red nose marker). Pure SVG, no dependencies. */
type V3 = [number, number, number];

const INK = '#DCEFF8';
const HOT = '#FF4A2E';

const box = (hx: number, y0: number, y1: number, hz: number): V3[][] => {
  const c = (x: number, y: number, z: number): V3 => [x, y, z];
  const top = [c(-hx, y1, -hz), c(hx, y1, -hz), c(hx, y1, hz), c(-hx, y1, hz), c(-hx, y1, -hz)];
  const bot = [c(-hx, y0, -hz), c(hx, y0, -hz), c(hx, y0, hz), c(-hx, y0, hz), c(-hx, y0, -hz)];
  const posts = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => [c(x!, y0, z!), c(x!, y1, z!)]);
  return [top, bot, ...posts];
};

const ring = (cx: number, cy: number, cz: number, r: number): V3[] => Array.from({ length: 25 }, (_, i) => [cx + r * Math.cos((i / 24) * Math.PI * 2), cy, cz + r * Math.sin((i / 24) * Math.PI * 2)] as V3);

const MOTORS: Array<[number, number]> = [[-62, 62], [62, 62], [-62, -62], [62, -62]];

const SHAPES: V3[][] = [
  ...box(20, -5, 5, 34),
  ...box(13, 5, 14, 28),
  ...MOTORS.map(([x, z]) => [[0, 0, 0], [x!, 0, z!]] as V3[]),
  ...MOTORS.map(([x, z]) => ring(x!, 4, z!, 36)),
  ...MOTORS.map(([x, z]) => ring(x!, 4, z!, 6)),
];
const NOSE: V3[] = [[-12, 0, 34], [0, 0, 56], [12, 0, 34]];

const rad = (d: number) => (d * Math.PI) / 180;

function transform(p: V3, roll: number, pitch: number, yaw: number): V3 {
  let [x, y, z] = p;
  // roll about the forward axis (positive = right side down)
  const r = rad(-roll);
  [x, y] = [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
  // pitch about the lateral axis (positive = nose up)
  const q = rad(pitch);
  [y, z] = [y * Math.cos(q) + z * Math.sin(q), -y * Math.sin(q) + z * Math.cos(q)];
  // heading about the vertical axis
  const h = rad(-yaw);
  [x, z] = [x * Math.cos(h) + z * Math.sin(h), -x * Math.sin(h) + z * Math.cos(h)];
  // fixed isometric camera: 35 deg azimuth, 28 deg elevation
  const a = rad(35);
  [x, z] = [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
  const e = rad(28);
  [y, z] = [y * Math.cos(e) - z * Math.sin(e), y * Math.sin(e) + z * Math.cos(e)];
  return [x, y, z];
}

const pts = (line: V3[], roll: number, pitch: number, yaw: number): string =>
  line
    .map((p) => {
      const [x, y] = transform(p, roll, pitch, yaw);
      return `${(200 + x * 1.35).toFixed(1)},${(150 - y * 1.35).toFixed(1)}`;
    })
    .join(' ');

/** Markup of the model in its resting pose (attributes are updated by updateModel). */
export function modelSvg(): string {
  const lines = SHAPES.map((s, i) => `<polyline data-s="${i}" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round" opacity="${i < 6 ? 0.95 : 0.55}" points="${pts(s, 0, 0, 0)}"/>`).join('');
  return `<svg class="bf-su-model" viewBox="0 0 400 300" role="img" aria-hidden="true">${lines}<polyline data-nose fill="rgba(255,74,46,.25)" stroke="${HOT}" stroke-width="1.6" points="${pts(NOSE, 0, 0, 0)}"/></svg>`;
}

export function updateModel(svg: SVGElement, roll: number, pitch: number, heading: number): void {
  svg.querySelectorAll<SVGPolylineElement>('polyline[data-s]').forEach((pl) => {
    pl.setAttribute('points', pts(SHAPES[Number(pl.dataset.s)]!, roll, pitch, heading));
  });
  svg.querySelector('polyline[data-nose]')?.setAttribute('points', pts(NOSE, roll, pitch, heading));
}
