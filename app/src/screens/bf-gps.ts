/**
 * GPS tab (like Betaflight's): GPS feature, provider, auto config, Galileo, home point, SBAS (editable through the form engine),
 * plus live satellite signal table, position facts and a satellite / street map (Esri tiles, ui/tile-map.ts) with the
 * home point and the quad. A link opens the position in OpenStreetMap in the system browser.
 */
import './bf-gps.css';
import { C } from '../bf/codes';
import * as D from '../bf/decode';
import { fieldHtml, mountFormTab, type Draft, type FieldDef, type Group, type TabSpec } from '../bf/form';
import { decorateForm, type PanelRule, type RowRule } from '../bf/form-decor';
import type { BfCommand, BfData, MspWrite } from '../bf/store';
import type { AppContext, ScreenMount } from '../context';
import { fmtNum, t, type Key } from '../i18n';
import { escapeHtml } from '../ui/dom';
import { intro, tip } from '../ui/tip';
import { mountTileMap, type MapPoint } from '../ui/tile-map';

const K = (k: string) => `gps.${k}` as Key;
const RAW_GPS: BfCommand<D.RawGps> = { code: C.RAW_GPS, decode: (p) => D.decodeRawGps(p) };
const COMP_GPS: BfCommand<D.CompGps> = { code: C.COMP_GPS, decode: (p) => D.decodeCompGps(p) };
const SV_INFO: BfCommand<D.SvChannel[]> = { code: C.GPS_SV_INFO, decode: (p) => D.decodeGpsSvInfo(p) };
const ATTITUDE: BfCommand<D.Attitude> = { code: C.ATTITUDE, decode: (p) => D.decodeAttitude(p) };
const COMPASS: BfCommand<number> = { code: C.COMPASS_CONFIG, minApi: 46, decode: (p) => D.decodeCompassDeclination(p) };

const PROVIDERS = ['NMEA', 'UBLOX', 'MSP', 'VIRTUAL'];
const UBLOX = 1;

/* ---------------- draft / writes ---------------- */

function toDraft(bf: BfData): Draft {
  const d: Draft = {};
  if (bf.features !== null) d.feature = D.hasFeature(bf.features, D.FEATURE.GPS);
  if (bf.gpsConfig) {
    d.provider = bf.gpsConfig.provider;
    d.autoConfig = bf.gpsConfig.autoConfig;
    d.galileo = bf.gpsConfig.useGalileo;
    d.homeOnce = bf.gpsConfig.homePointOnce;
    d.sbas = bf.gpsConfig.sbas;
  }
  return d;
}

const CFG_KEYS = ['provider', 'autoConfig', 'galileo', 'homeOnce', 'sbas'];

function toWrites(draft: Draft, bf: BfData): MspWrite[] {
  const base = toDraft(bf);
  const w: MspWrite[] = [];
  if (bf.features !== null && draft.feature !== base.feature) {
    w.push({ code: C.SET_FEATURE_CONFIG, label: 'SET_FEATURE_CONFIG', payload: D.encodeFeatures(D.withFeature(bf.features, D.FEATURE.GPS, !!draft.feature)) });
  }
  if (bf.gpsConfig && CFG_KEYS.some((k) => draft[k] !== base[k])) {
    const cfg: D.GpsConfig = { ...bf.gpsConfig, provider: Number(draft.provider), sbas: Number(draft.sbas), autoConfig: !!draft.autoConfig, useGalileo: !!draft.galileo, homePointOnce: !!draft.homeOnce };
    w.push({ code: C.SET_GPS_CONFIG, label: 'SET_GPS_CONFIG', payload: D.encodeGpsConfig(cfg, bf.raw.get('gpsCfg')) });
  }
  return w;
}

/* ---------------- groups ---------------- */

const row = (label: string, value: string, extra = '') => `<dt>${escapeHtml(label)}${extra}</dt><dd>${value}</dd>`;

function groups(bf: BfData, draft: Draft): Group[] {
  const cfgFields: FieldDef[] = [];
  if (bf.features !== null) cfgFields.push({ key: 'feature', type: 'check', label: t(K('feature')) });
  if (bf.gpsConfig) {
    const cur = Number(draft.provider ?? bf.gpsConfig.provider);
    const names = PROVIDERS.slice(0, bf.api >= 47 ? 4 : 3);
    const options: Array<{ value: number; label: string }> = names.map((label, value) => ({ value, label }));
    if (!options.some((o) => o.value === cur)) options.push({ value: cur, label: t(K('protoUnknown'), { n: cur }) });
    cfgFields.push({ key: 'provider', type: 'select', label: t(K('protocol')), options });
    if (cur === UBLOX) cfgFields.push({ key: 'autoConfig', type: 'check', label: t(K('autoConfig')) }, { key: 'galileo', type: 'check', label: t(K('galileo')) });
    cfgFields.push({ key: 'homeOnce', type: 'check', label: t(K('homeOnce')) });
    if (cur === UBLOX) cfgFields.push({ key: 'sbas', type: 'select', label: t(K('sbas')), options: [0, 1, 2, 3, 4, 5].map((value) => ({ value, label: t(K(`sbas${value}`)) })) });
  }
  const noPort = !!bf.serial && !bf.serial.ports.some((p) => (p.mask & D.SERIAL_FN.GPS) !== 0);
  return [
    {
      title: t(K('gConfig')),
      fields: cfgFields,
      render: (dr, bs) => `${cfgFields.map((x) => fieldHtml(x, dr, bs)).join('')}${noPort && (draft.feature ?? true) ? `<p class="v1-note gp-note">${escapeHtml(t(K('noPort')))}</p>` : ''}`,
    },
    { title: t(K('gSignal')), fields: [], render: () => `<div class="gp-sig" data-gp="signal"></div>` },
    {
      title: t(K('gGeneral')),
      fields: [],
      render: () => `<dl class="gp-kv" data-gp="general">
        ${row(t(K('fix')), '<span class="gp-badge">—</span>')}${row(t(K('sats')), '—')}${row(t(K('alt')), '—')}${row(t(K('speed')), '—')}${row(t(K('heading')), '—')}
        ${row(t(K('lat')), '—')}${row(t(K('lon')), '—')}${row(t(K('dist')), '—')}${row(t(K('dop')), '—', ` ${tip('tips.gps.dop')}`)}${row(t(K('decl')), '—', ` ${tip('tips.gps.declination')}`)}</dl>`,
    },
    { title: t(K('gLocation')), fields: [], render: () => `<div class="gp-loc"><div class="gp-map" data-gp="map"></div><div class="gp-loc-foot"><small>${escapeHtml(t(K('mapNote')))}</small><span data-gp="osm"></span></div></div>` },
  ];
}

/* ---------------- live rendering helpers ---------------- */

const GNSS_BADGE = (gnss: number) => (gnss < D.GNSS_NAMES.length ? D.GNSS_NAMES[gnss]! : '–');

function qualityBadge(q: number): { cls: string; label: string } {
  const code = q & 7;
  const label = t(K(`q${Math.min(5, code)}`));
  return { cls: code >= 5 ? 'full' : code === 4 ? 'lock' : 'off', label };
}

function signalHtml(sv: D.SvChannel[] | null, waiting: boolean): string {
  const gnssFormat = (sv?.length ?? 0) > 16;
  const rows = (sv ?? []).filter((c) => !gnssFormat || c.gnss < D.GNSS_NAMES.length);
  if (!rows.length) return `<p class="gp-empty">${escapeHtml(waiting ? t(K('noSensor')) : t(K('noSats')))}</p>`;
  const body = rows
    .map((c) => {
      const used = gnssFormat ? (c.quality & 8) !== 0 : false;
      const q = gnssFormat ? qualityBadge(c.quality) : { cls: 'off', label: String(c.quality) };
      const pct = Math.max(0, Math.min(100, (c.cno / 55) * 100));
      return `<tr><td>${escapeHtml(gnssFormat ? GNSS_BADGE(c.gnss) : '–')}</td>
        <td><span class="gp-sat ${used ? 'used' : 'unused'}" title="${escapeHtml(used ? t(K('satUsed')) : t(K('satUnused')))}">${c.svid}</span></td>
        <td><span class="gp-bar" title="${c.cno} dB-Hz"><i style="width:${pct.toFixed(0)}%"></i></span></td>
        <td><span class="gp-q ${q.cls}">${escapeHtml(q.label)}</span></td></tr>`;
    })
    .join('');
  return `<table class="gp-table"><thead><tr><th>${escapeHtml(t(K('colGnss')))}</th><th>${escapeHtml(t(K('colSat')))}</th><th>${escapeHtml(t(K('colStrength')))}</th><th>${escapeHtml(t(K('colQuality')))}</th></tr></thead><tbody>${body}</tbody></table>`;
}

function dopBadge(dop: number): string {
  const [stars, cls] = dop < 1 ? ['★★★★★', 'best'] : dop < 2 ? ['★★★★☆', 'good'] : dop < 5 ? ['★★★☆☆', 'mid'] : dop < 10 ? ['★★☆☆☆', 'low'] : dop < 20 ? ['★☆☆☆☆', 'bad'] : ['☆☆☆☆☆', 'none'];
  return `<span class="gp-stars">${stars}</span><span class="gp-badge dop-${cls}">${fmtNum(dop, 2)}</span>`;
}

function osmLink(gps: D.RawGps | null): string {
  const has = !!gps && gps.fix > 0 && (gps.lat !== 0 || gps.lon !== 0);
  return has && gps
    ? `<a class="btn ghost gp-osm" href="https://www.openstreetmap.org/?mlat=${gps.lat.toFixed(6)}&mlon=${gps.lon.toFixed(6)}#map=17/${gps.lat.toFixed(6)}/${gps.lon.toFixed(6)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t(K('osm')))}</a>`
    : '';
}

/** Home point from the quad position and its offset from home. */
function homeOf(gps: D.RawGps, comp: D.CompGps | null): MapPoint | null {
  if (!comp) return null;
  const off = D.offsetFromHome(comp);
  const lat = gps.lat - off.north / 111320;
  return { lat, lon: gps.lon - off.east / (111320 * Math.cos((gps.lat * Math.PI) / 180)) };
}

/* ---------------- mount ---------------- */

const ROWS: RowRule[] = [
  { key: 'feature', tip: 'tips.gps.enable' },
  { key: 'provider', tip: 'tips.gps.protocol' },
  { key: 'autoConfig', tip: 'tips.gps.autoConfig' },
  { key: 'galileo', tip: 'tips.gps.galileo' },
  { key: 'homeOnce', tip: 'tips.gps.homeOnce' },
  { key: 'sbas', tip: 'tips.gps.sbas' },
];

export const mount: ScreenMount = (el, ctx) => {
  const spec: TabSpec = {
    id: 'gps',
    title: t(K('title')),
    areas: ['features', 'gps', 'status', 'serial'],
    ready: (bf) => !!(bf.gpsConfig || bf.features !== null),
    toDraft,
    groups,
    toWrites,
    dynamic: ['provider'],
    needsReboot: () => true,
    top: () => intro('tips.gps.intro'),
    live: (root, c) => startLive(root, c),
  };
  const off = mountFormTab(el, ctx, spec);
  const panels: PanelRule[] = [
    { title: t(K('gSignal')), tip: 'tips.gps.signal' },
    { title: t(K('gGeneral')), tip: 'tips.gps.general' },
    { title: t(K('gLocation')), tip: 'tips.gps.location' },
  ];
  const stop = decorateForm(el, ROWS, panels);
  return () => {
    stop();
    off();
  };
};

function startLive(el: HTMLElement, ctx: AppContext): () => void {
  let dead = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Betaflight layout: configuration + signal table on the left, facts on the right, the map across the full width
  const grid = el.querySelector<HTMLElement>('.bf-grid');
  if (grid && grid.children.length === 4) {
    const [a, b, c, d] = [...grid.children] as HTMLElement[];
    const left = document.createElement('div');
    const right = document.createElement('div');
    left.className = right.className = 'gp-col';
    left.append(a!, b!);
    right.append(c!);
    d!.classList.add('gp-wide');
    grid.append(left, right, d!);
  }

  const q = <T extends Element>(s: string) => el.querySelector<T>(s);
  let gps: D.RawGps | null = null;
  let comp: D.CompGps | null = null;
  let sv: D.SvChannel[] | null = null;
  let heading = 0;
  let decl: number | null = null;
  const mapHost = q<HTMLElement>('[data-gp="map"]');
  const map = mapHost
    ? mountTileMap(mapHost, {
        sat: t(K('mapSat')),
        hybrid: t(K('mapHybrid')),
        road: t(K('mapRoad')),
        zoomIn: t(K('mapIn')),
        zoomOut: t(K('mapOut')),
        full: t(K('mapFull')),
        home: t(K('radarHome')),
        waiting: t(K('waiting')),
        offline: t(K('mapOffline')),
        aria: t(K('gLocation')),
      })
    : null;
  const hasMag = () => ((ctx.bf.get().status?.sensors ?? 0) >> 2) & 1;

  const paint = () => {
    const sig = q<HTMLElement>('[data-gp="signal"]');
    if (sig) sig.innerHTML = signalHtml(sv, !!ctx.bf.get().features && D.hasFeature(ctx.bf.get().features!, D.FEATURE.GPS));
    const gen = q<HTMLElement>('[data-gp="general"]');
    if (gen) {
      const fix = !!gps && gps.fix > 0;
      const dist = comp?.distanceM ?? 0;
      gen.innerHTML = [
        row(t(K('fix')), `<span class="gp-badge ${fix ? 'ok' : 'no'}">${escapeHtml(t(K(fix ? 'fixOk' : 'fixNo')))}</span>`),
        row(t(K('sats')), String(gps?.numSat ?? 0)),
        row(t(K('alt')), `${fmtNum(gps?.altM ?? 0, 0)} m`),
        row(t(K('speed')), `${fmtNum(gps?.speedCms ?? 0, 0)} cm/s`),
        row(t(K('heading')), `${fmtNum(heading < 0 ? heading + 360 : heading, 0)} / ${fmtNum(gps?.courseDeg ?? 0, 0)} ${escapeHtml(t(K('deg')))}`),
        row(t(K('lat')), `<span class="gp-coord">${fmtNum(gps?.lat ?? 0, 6)} ${escapeHtml(t(K('deg')))}</span>`),
        row(t(K('lon')), `<span class="gp-coord">${fmtNum(gps?.lon ?? 0, 6)} ${escapeHtml(t(K('deg')))}</span>`),
        row(t(K('dist')), `${fmtNum(dist, 0)} m`),
        row(t(K('dop')), gps && gps.pdop > 0 ? dopBadge(gps.pdop) : '—', ` ${tip('tips.gps.dop')}`),
        row(t(K('decl')), hasMag() && decl !== null ? `${fmtNum(decl, 1)} ${escapeHtml(t(K('deg')))}` : '—', ` ${tip('tips.gps.declination')}`),
      ].join('');
    }
    const hasPos = !!gps && gps.fix > 0 && (gps.lat !== 0 || gps.lon !== 0);
    map?.update({ quad: hasPos ? { lat: gps!.lat, lon: gps!.lon } : null, home: hasPos ? homeOf(gps!, comp) : null, headingDeg: heading < 0 ? heading + 360 : heading });
    const osm = q<HTMLElement>('[data-gp="osm"]');
    const link = osmLink(gps);
    if (osm && osm.dataset.has !== String(!!link)) {
      osm.innerHTML = link;
      osm.dataset.has = String(!!link);
    } else if (osm && link) osm.querySelector('a')?.setAttribute('href', link.match(/href="([^"]+)"/)![1]!.replace(/&amp;/g, '&'));
  };

  let n = 0;
  const tick = async () => {
    timer = null;
    if (dead) return;
    if (!ctx.link()?.busy) {
      gps = (await ctx.bf.read(RAW_GPS).catch(() => null)) ?? gps;
      comp = (await ctx.bf.read(COMP_GPS).catch(() => null)) ?? comp;
      sv = (await ctx.bf.read(SV_INFO).catch(() => null)) ?? sv;
      const att = await ctx.bf.read(ATTITUDE).catch(() => null);
      if (att) heading = att.headingDeg;
      if (decl === null && hasMag() && n++ % 10 === 0) decl = (await ctx.bf.read(COMPASS).catch(() => null)) ?? null;
      if (dead) return;
      paint();
    }
    timer = setTimeout(() => void tick(), 200);
  };
  paint();
  void tick();

  return () => {
    dead = true;
    map?.destroy();
    if (timer) clearTimeout(timer);
  };
}
