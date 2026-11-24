/**
 * Small slippy map without a library: Web Mercator tiles from Esri (satellite, hybrid labels, streets), the home point
 * and the quad with its heading on top. It follows the quad; the user picks the layer and the zoom.
 * Only tile images are requested (no API key, no cookies); the position is sent to the tile host as tile numbers.
 */
import './tile-map.css';
import { escapeHtml } from './dom';

export type MapLayer = 'sat' | 'hybrid' | 'road';
export interface MapPoint {
  lat: number;
  lon: number;
}
export interface MapView {
  quad: MapPoint | null;
  home: MapPoint | null;
  headingDeg: number;
}
export interface MapLabels {
  sat: string;
  hybrid: string;
  road: string;
  zoomIn: string;
  zoomOut: string;
  full: string;
  home: string;
  waiting: string;
  offline: string;
  aria: string;
}

const T = 256;
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const URLS: Record<MapLayer, string[]> = {
  sat: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
  hybrid: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
  road: [`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`],
};
const CREDIT: Record<MapLayer, string> = {
  sat: 'Esri, Maxar, Earthstar Geographics',
  hybrid: 'Esri, Maxar, Earthstar Geographics, HERE',
  road: 'Esri, HERE, Garmin, OpenStreetMap',
};
const MIN_Z = 3;
const MAX_Z = 19;

/** World pixel coordinates at zoom z. */
export function project(p: MapPoint, z: number): { x: number; y: number } {
  const s = T * 2 ** z;
  const lat = Math.max(-85.05, Math.min(85.05, p.lat));
  const r = (lat * Math.PI) / 180;
  return { x: ((p.lon + 180) / 360) * s, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s };
}

const QUAD = `<svg viewBox="-20 -20 40 40" width="40" height="40" aria-hidden="true"><circle r="17" class="tm-q-bg"/><path d="M0 -14 L6 -6 L-6 -6 Z" class="tm-q-arrow"/><g class="tm-q-body"><path d="M-7 -7 L7 7 M7 -7 L-7 7"/><circle cx="-7" cy="-7" r="3.6"/><circle cx="7" cy="-7" r="3.6"/><circle cx="-7" cy="7" r="3.6"/><circle cx="7" cy="7" r="3.6"/><rect x="-3" y="-3.5" width="6" height="7" rx="1.2"/></g></svg>`;

export function mountTileMap(host: HTMLElement, L: MapLabels, initial: MapLayer = 'sat'): { update: (v: MapView) => void; destroy: () => void } {
  let layer: MapLayer = initial;
  let z = 17;
  let view: MapView = { quad: null, home: null, headingDeg: 0 };
  let failed = 0;
  let loaded = 0;
  const btn = (act: string, label: string, text: string) => `<button type="button" class="tm-b" data-tm="${act}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${text}</button>`;
  host.innerHTML = `<div class="tm" role="img" aria-label="${escapeHtml(L.aria)}">
      <div class="tm-tiles"></div>
      <svg class="tm-line" aria-hidden="true"><line/></svg>
      <div class="tm-home" hidden><span>H</span><small>${escapeHtml(L.home)}</small></div>
      <div class="tm-quad" hidden>${QUAD}</div>
      <p class="tm-msg" hidden></p>
      <div class="tm-ctl">
        <div class="tm-seg" role="group">${btn('sat', L.sat, 'S')}${btn('hybrid', L.hybrid, 'H')}${btn('road', L.road, 'R')}</div>
        <div class="tm-seg" role="group">${btn('in', L.zoomIn, '+')}${btn('out', L.zoomOut, '−')}${btn('full', L.full, '⤢')}</div>
      </div>
      <small class="tm-credit"></small>
    </div>`;
  const root = host.querySelector<HTMLElement>('.tm')!;
  const tiles = root.querySelector<HTMLElement>('.tm-tiles')!;
  const line = root.querySelector<SVGLineElement>('.tm-line line')!;
  const homeEl = root.querySelector<HTMLElement>('.tm-home')!;
  const quadEl = root.querySelector<HTMLElement>('.tm-quad')!;
  const msg = root.querySelector<HTMLElement>('.tm-msg')!;
  const credit = root.querySelector<HTMLElement>('.tm-credit')!;
  const imgs = new Map<string, HTMLImageElement>();

  const syncButtons = () => {
    root.querySelectorAll<HTMLButtonElement>('[data-tm]').forEach((b) => {
      const a = b.dataset.tm!;
      if (a === 'sat' || a === 'hybrid' || a === 'road') b.setAttribute('aria-pressed', String(a === layer));
      if (a === 'in') b.disabled = z >= MAX_Z;
      if (a === 'out') b.disabled = z <= MIN_Z;
    });
    credit.textContent = `© ${CREDIT[layer]}`;
  };

  const paint = () => {
    const W = root.clientWidth;
    const H = root.clientHeight;
    const focus = view.quad ?? view.home;
    if (!focus || !W) {
      tiles.replaceChildren();
      imgs.clear();
      homeEl.hidden = quadEl.hidden = true;
      line.style.display = 'none';
      msg.hidden = false;
      msg.textContent = L.waiting;
      return;
    }
    const c = project(focus, z);
    const ox = c.x - W / 2;
    const oy = c.y - H / 2;
    const n = 2 ** z;
    const want = new Set<string>();
    for (let ty = Math.floor(oy / T); ty <= Math.floor((oy + H) / T); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(ox / T); tx <= Math.floor((ox + W) / T); tx++) {
        const wx = ((tx % n) + n) % n;
        URLS[layer].forEach((u, li) => {
          const key = `${layer}/${li}/${z}/${tx}/${ty}`;
          want.add(key);
          let im = imgs.get(key);
          if (!im) {
            im = new Image();
            im.alt = '';
            im.decoding = 'async';
            im.draggable = false;
            im.referrerPolicy = 'no-referrer';
            im.className = li ? 'over' : '';
            im.onload = () => {
              loaded++;
              im!.classList.add('in');
              msg.hidden = true;
            };
            im.onerror = () => {
              failed++;
              im!.remove();
              if (!loaded && failed > 3) {
                msg.hidden = false;
                msg.textContent = L.offline;
              }
            };
            im.src = u.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(ty));
            imgs.set(key, im);
            tiles.append(im);
          }
          im.style.transform = `translate(${Math.round(tx * T - ox)}px, ${Math.round(ty * T - oy)}px)`;
        });
      }
    }
    for (const [k, im] of imgs) {
      if (!want.has(k)) {
        im.remove();
        imgs.delete(k);
      }
    }
    if (loaded || failed <= 3) msg.hidden = true;
    const place = (el: HTMLElement, p: MapPoint | null) => {
      el.hidden = !p;
      if (!p) return null;
      const q = project(p, z);
      const x = q.x - ox;
      const y = q.y - oy;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      return { x, y };
    };
    const h = place(homeEl, view.home);
    const d = place(quadEl, view.quad);
    quadEl.querySelector<SVGElement>('svg')!.style.transform = `rotate(${view.headingDeg.toFixed(0)}deg)`;
    if (h && d && Math.hypot(h.x - d.x, h.y - d.y) > 14) {
      line.style.display = '';
      line.setAttribute('x1', h.x.toFixed(1));
      line.setAttribute('y1', h.y.toFixed(1));
      line.setAttribute('x2', d.x.toFixed(1));
      line.setAttribute('y2', d.y.toFixed(1));
    } else line.style.display = 'none';
  };

  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element).closest<HTMLElement>('[data-tm]')?.dataset.tm;
    if (!a) return;
    if (a === 'sat' || a === 'hybrid' || a === 'road') layer = a;
    else if (a === 'in') z = Math.min(MAX_Z, z + 1);
    else if (a === 'out') z = Math.max(MIN_Z, z - 1);
    else if (a === 'full') {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void root.requestFullscreen?.().catch(() => undefined);
      return;
    }
    syncButtons();
    paint();
  };
  root.addEventListener('click', onClick);
  const ro = new ResizeObserver(() => paint());
  ro.observe(root);
  syncButtons();
  paint();

  return {
    update: (v) => {
      view = v;
      paint();
    },
    destroy: () => {
      ro.disconnect();
      root.removeEventListener('click', onClick);
      host.replaceChildren();
    },
  };
}
