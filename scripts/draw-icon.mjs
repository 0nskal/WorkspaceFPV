// Rysuje ikone appki jako wektor w scisle izometrycznym rzucie (30 st.).
// Uzycie: node scripts/draw-icon.mjs  -> zapisuje assets/icon.svg i assets/icon-small.svg
// Potem: npm run icons (PNG/ICO).
import { writeFile } from 'node:fs/promises';

const C = Math.cos(Math.PI / 6); // 0.866
const CY = 272; // poziom srodka plyty na ekranie
const CYAN = '#DCEFF8';
const RED = '#FF4A2E';
const OCC = '#0B151F'; // wypelnienie "zaslaniajace" (kolor tla)
const SW = 2.9; // jedna grubosc linii (512 jednostek = 1.6 px przy 256 px)

const f = (n) => (Math.round(n * 10) / 10).toString();
const P = (x, y, z = 0, cy = CY, cx = 256) => [cx + (x - y) * C, cy + (x + y) * 0.5 - z];
const pts = (a) => a.map((p) => f(p[0]) + ' ' + f(p[1]));
const path = (a, close = true) => 'M' + pts(a).join('L') + (close ? 'Z' : '');
const world = (a, z, o = {}) => a.map(([x, y]) => P(x, y, z, o.cy ?? CY, o.cx ?? 256));
// okrag w plaszczyznie xy (elipsa) i xz (probkowany)
const ell = (x, y, z, r, extra = '', cy = CY, cx = 256) => {
  const [sx, sy] = P(x, y, z, cy, cx);
  return `<ellipse cx="${f(sx)}" cy="${f(sy)}" rx="${f(r * Math.sqrt(1.5))}" ry="${f(r * Math.SQRT1_2)}"${extra}/>`;
};
const circXZ = (x, y, z, r, n = 48) =>
  path(Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return P(x + r * Math.cos(a), y, z + r * Math.sin(a)); }));
const sq = (h, cx = 0, cy = 0) => [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];

// ---------------- rama X (obrys jako suma ramion i srodkowej plytki) ----------------
const A = 76, RING = 19, HW = 10, S = 28; // pozycja silnika, promien oczka, polowa szerokosci ramienia, polowa plytki
const D = A * Math.SQRT2;
const rot = (p, k) => { let [x, y] = p; for (let i = 0; i < k; i++) [x, y] = [-y, x]; return [x, y]; };
function frameOutline() {
  const out = [];
  // punkty przeciecia krawedzi ramienia (v=+-HW) z bokami plytki x=S / y=S
  const uA = S * Math.SQRT2 - HW; // v=+HW na x=S
  const yA = (uA - HW) / Math.SQRT2; // = y tego punktu
  for (let k = 0; k < 4; k++) {
    const u = (u0, v) => [(u0 + v) / Math.SQRT2, (u0 - v) / Math.SQRT2];
    out.push(rot([S, yA], k));
    const uT = D - Math.sqrt(RING * RING - HW * HW);
    const p1 = u(uT, HW), p2 = u(uT, -HW);
    out.push(rot(p1, k));
    const c = [A, A];
    let t1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
    let t2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
    while (t2 <= t1) t2 += Math.PI * 2;
    const N = 28;
    for (let i = 1; i < N; i++) { const t = t1 + (t2 - t1) * (i / N); out.push(rot([c[0] + RING * Math.cos(t), c[1] + RING * Math.sin(t)], k)); }
    out.push(rot(p2, k));
    out.push(rot([yA, S], k));
  }
  return out;
}
const outline = frameOutline();

// ---------------- rotor (silnik + smiglo), rysowany wzgledem srodka silnika ----------------
function rotor() {
  const Z0 = 14, Z1 = 32, ZB = 35, ZC = 38; // rama, gora dzwonu, plaszczyzna smigla, gora piasty
  const R = 44, R0 = 5;
  const o = { cy: 0, cx: 0 };
  let s = '';
  // dzwon: dolny luk + boki + gorna elipsa
  const rx = 13 * Math.sqrt(1.5), ry = 13 * Math.SQRT1_2;
  s += `<path d="M${f(-rx)} ${-Z0}A${f(rx)} ${f(ry)} 0 0 0 ${f(rx)} ${-Z0}"/>`;
  s += `<path d="M${f(-rx)} ${-Z0}V${-Z1}M${f(rx)} ${-Z0}V${-Z1}"/>`;
  s += ell(0, 0, Z1, 13, ` fill="${OCC}"`, 0, 0);
  // smiglo: 3 lopatki
  const th0 = (3 * Math.PI) / 4;
  for (let k = 0; k < 3; k++) {
    const a = th0 + (k * 2 * Math.PI) / 3, ca = Math.cos(a), sa = Math.sin(a);
    const prof = [[R0, 2.4], [26, 6.5], [39, 6.2], [R, 3.6]];
    const left = prof.map(([r, w]) => [r * ca - w * sa, r * sa + w * ca]);
    const right = prof.map(([r, w]) => [r * ca + w * sa, r * sa - w * ca]).reverse();
    s += `<path d="${path(world([...left, ...right], ZB, o))}" fill="${OCC}" fill-opacity=".6"/>`;
  }
  // piasta
  const hr = 4.6, hx = hr * Math.sqrt(1.5);
  s += `<path d="M${f(-hx)} ${-Z1}V${-ZC}M${f(hx)} ${-Z1}V${-ZC}"/>`;
  s += `<path d="M${f(-hx)} ${-Z1}A${f(hx)} ${f(hr * Math.SQRT1_2)} 0 0 0 ${f(hx)} ${-Z1}"/>`;
  s += ell(0, 0, ZC, hr, ` fill="${OCC}"`, 0, 0);
  return s;
}

// ---------------- plyta z siatka i linijka ----------------
function plate() {
  const H = 104, I = 95;
  let s = `<path d="${path(world(sq(H), 0))}"/>`;
  s += `<path d="${path(world(sq(I), 0))}" stroke-opacity=".55"/>`;
  let g = '';
  for (let i = -2; i <= 2; i++) {
    const v = (i * I) / 3;
    g += `M${pts([P(v, -I), P(v, I)]).join('L')}M${pts([P(-I, v), P(I, v)]).join('L')}`;
  }
  s += `<path d="${g}" stroke-opacity=".2"/>`;
  // linijka na dwoch przednich krawedziach (x=+H i y=+H)
  let t = '';
  for (let i = 0; i <= 16; i++) {
    const v = -I + (i * 2 * I) / 16;
    const long = i % 4 === 0;
    const a = long ? I : (I + H) / 2 - 1;
    t += `M${pts([P(H, v), P(a + (H - I) * 0, v)]).join('L')}`;
    t += `M${pts([P(v, H), P(v, a)]).join('L')}`;
  }
  s += `<path d="${t.replace(/M(\S+ \S+)L(\S+ \S+)/g, 'M$1L$2')}" stroke-opacity=".5"/>`;
  return s;
}

// ---------------- plytka (slab) ----------------
function slab(h, z0, z1, top, ext = '') {
  const c = sq(h);
  const [bl, , fr, lf] = [c[0], c[1], c[2], c[3]]; // (-,-), (+,-), (+,+), (-,+)
  const rg = [c[1], c[2]]; // (+,-),(+,+)
  let s = `<path d="${path([P(lf[0], lf[1], z0), P(fr[0], fr[1], z0), P(rg[0][0], rg[0][1], z0)], false)}" ${ext}/>`;
  s += `<path d="M${pts([P(lf[0], lf[1], z0), P(lf[0], lf[1], z1)]).join('L')}M${pts([P(fr[0], fr[1], z0), P(fr[0], fr[1], z1)]).join('L')}M${pts([P(rg[0][0], rg[0][1], z0), P(rg[0][0], rg[0][1], z1)]).join('L')}" ${ext}/>`;
  s += `<path d="${path(world(c, z1))}" ${top}/>`;
  return s;
}

// ---------------- kamera FPV w klatce (przod = +y, lewy przod) ----------------
function camera() {
  const x0 = -15, x1 = 15, y0 = 28, y1 = 50, z0 = 14, z1 = 44;
  const fill = `fill="${OCC}"`;
  const V = (x, y, z) => P(x, y, z);
  let s = '';
  s += `<path d="${path([V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), V(x1, y0, z1)])}" ${fill}/>`; // +x
  s += `<path d="${path([V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1), V(x0, y1, z1)])}" ${fill}/>`; // +y (obiektyw)
  s += `<path d="${path([V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)])}" ${fill}/>`; // gora
  // wewnetrzna rama klatki na scianie +y
  s += `<path d="${path([V(-11, y1, 18), V(11, y1, 18), V(11, y1, 40), V(-11, y1, 40)])}" stroke-opacity=".55"/>`;
  { const r = 8, a1 = (3 * Math.PI) / 4, a2 = -Math.PI / 4; const L = (a) => [P(r * Math.cos(a), y1, 29 + r * Math.sin(a)), P(r * Math.cos(a), y1 + 5, 29 + r * Math.sin(a))]; s += `<path d="M${pts(L(a1)).join('L')}M${pts(L(a2)).join('L')}"/>`; }
  s += `<path d="${circXZ(0, y1, 29, 8)}" fill="${OCC}"/>`;
  s += `<path d="${circXZ(0, y1 + 5, 29, 8)}" fill="${OCC}"/>`;
  s += `<path d="${circXZ(0, y1 + 5, 29, 3.6)}"/>`;
  return s;
}

// ---------------- pelna ikona ----------------
function full() {
  const mpos = { up: [-A, -A], left: [-A, A], right: [A, -A], down: [A, A] };
  const at = ([mx, my]) => P(mx, my, 0);
  const use = (k) => { const [x, y] = at(mpos[k]); return `<use href="#rotor" x="${f(x)}" y="${f(y)}"/>`; };
  const holeSq = path(world(sq(13), 14));
  const frameD = path(world(outline, 14));
  const frameLow = path(world(outline, 10));

  // wytrawione linie wplotu weglowego (clip do ramy)
  let weave = '';
  for (let v = -110; v <= 110; v += 16) weave += `M${pts([P(v, -110, 14), P(v, 110, 14)]).join('L')}M${pts([P(-110, v, 14), P(110, v, 14)]).join('L')}`;

  const stack = () => {
    let s = '';
    const st = [[-17, -17], [17, -17], [17, 17], [-17, 17]];
    for (const [x, y] of st) s += `M${pts([P(x, y, 14), P(x, y, 36)]).join('L')}M${pts([P(x, y, 39), P(x, y, 52)]).join('L')}`;
    s = `<path d="${s}"/>`;
    s += slab(24, 36, 39, `fill="${OCC}" fill-opacity=".92"`);
    s += `<path d="${path(world(sq(11), 39))}" stroke-opacity=".55"/>`;
    return s;
  };

  const fc = () => {
    let s = slab(24, 52, 55, `fill="${OCC}"`, '') ;
    s += `<path d="${path(world(sq(24), 55))}" fill="${RED}" fill-opacity=".16"/>`;
    s += `<path d="${path(world(sq(8), 55))}" fill="${RED}" fill-opacity=".4"/>`;
    for (const [x, y] of [[-17, -17], [17, -17], [17, 17], [-17, 17]]) s += ell(x, y, 55, 2.6);
    return s;
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0F1A24"/><stop offset="1" stop-color="#070B10"/></linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
    <clipPath id="fr"><path clip-rule="evenodd" d="${frameD}${holeSq}"/></clipPath>
    <g id="rotor">${rotor()}</g>
    <g id="fc" stroke="${RED}">${fc()}</g>
  </defs>
  <rect x="8" y="8" width="496" height="496" rx="112" fill="url(#bg)"/>
  <rect x="9.5" y="9.5" width="493" height="493" rx="110.5" fill="none" stroke="${CYAN}" stroke-opacity=".1" stroke-width="3"/>
  <use href="#art" filter="url(#glow)" opacity=".28"/>
  <g id="art" transform="translate(256 256) scale(1.16) translate(-256 -254)" fill="none" stroke="${CYAN}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round">
    <g>${plate()}</g>
    <path d="${frameLow}" stroke-opacity=".45"/>
    <path d="${frameD}${holeSq}" fill="${OCC}" fill-opacity=".92" fill-rule="evenodd"/>
    <g clip-path="url(#fr)"><path d="${weave}" stroke-opacity=".22"/></g>
    ${use('up')}
    ${use('left')}
    ${use('right')}
    <g>${stack()}</g>
    <g opacity=".5" filter="url(#glow)" stroke="${RED}"><use href="#fc"/></g>
    <use href="#fc"/>
    <g>${camera()}</g>
    ${use('down')}
  </g>
</svg>
`;
}

// ---------------- wariant maly (16/24/32 px) ----------------
function small() {
  const a = 80, rxD = 80, ryD = 46;
  const mp = [[0, -a], [a * 1.732, 0], [0, a], [-a * 1.732, 0]].map(([x, y]) => [256 + x, 262 + y]);
  const arms = mp.map(([x, y]) => `M256 262L${f(x)} ${f(y)}`).join('');
  const discs = mp.map(([x, y]) => `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${rxD}" ry="${ryD}" fill="#0B151F"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="${rxD}" ry="${ryD}" fill="${CYAN}" fill-opacity=".28"/>`).join('');
  const fcPts = [[-26, -26], [26, -26], [26, 26], [-26, 26]].map(([x, y]) => P(x, y, 0, 262));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0F1A24"/><stop offset="1" stop-color="#070B10"/></linearGradient></defs>
  <rect x="8" y="8" width="496" height="496" rx="112" fill="url(#bg)"/>
  <g stroke="${CYAN}" stroke-linejoin="round" stroke-linecap="butt">
    <path d="${arms}" fill="none" stroke-width="30"/>
    <g stroke-width="18">${discs}</g>
    <path d="${path(fcPts)}" fill="${RED}" stroke="${RED}" stroke-width="12"/>
  </g>
</svg>
`;
}

await writeFile('assets/icon.svg', full());
await writeFile('assets/icon-small.svg', small());
console.log('SVG gotowe');
