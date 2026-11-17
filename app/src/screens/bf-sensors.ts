/**
 * Sensors tab (like Betaflight's): sensor hardware switches, board alignment (+ auto-detect), accelerometer calibration and trim,
 * live attitude and live sensor graphs (gyro, accelerometer, magnetometer, barometer). Built on the declarative form engine:
 * the editable fields go through the same draft / Save path as every other tab, the live parts run only while the tab is open.
 */
import './bf-sensors.css';
import { C } from '../bf/codes';
import * as D from '../bf/decode';
import { fieldHtml, mountFormTab, type Draft, type FieldDef, type Group, type LiveApi, type TabSpec } from '../bf/form';
import { decorateForm, type PanelRule, type RowRule } from '../bf/form-decor';
import type { BfCommand, BfData, MspWrite } from '../bf/store';
import type { AppContext, ScreenMount } from '../context';
import { fmtNum, t, type Key } from '../i18n';
import { escapeHtml } from '../ui/dom';
import { intro, tip } from '../ui/tip';
import { mountAttitudeModel, type AttitudeModel } from './bf-setup-3d';
import { modelSvg, updateModel } from './bf-setup-model';

const K = (k: string) => `sensors.${k}` as Key;
const ATTITUDE: BfCommand<D.Attitude> = { code: C.ATTITUDE, decode: (p) => D.decodeAttitude(p) };
const RAW_IMU: BfCommand<D.RawImu> = { code: C.RAW_IMU, decode: (p) => D.decodeRawImu(p) };
const ALTITUDE: BfCommand<{ altM: number; varioMs: number }> = { code: C.ALTITUDE, decode: (p) => D.decodeAltitude(p) };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SW = ['acc', 'baro', 'mag'] as const;
const HW_KEY = { acc: 'acc', baro: 'baro', mag: 'mag' } as const;

/* ---------------- draft / writes ---------------- */

function toDraft(bf: BfData): Draft {
  const d: Draft = {};
  if (bf.sensorConfig) for (const s of SW) d[s] = bf.sensorConfig[HW_KEY[s]] !== D.SENSOR_NONE;
  if (bf.boardAlign) {
    d.boardRoll = bf.boardAlign.roll;
    d.boardPitch = bf.boardAlign.pitch;
    d.boardYaw = bf.boardAlign.yaw;
  }
  if (bf.accTrim) {
    d.trimRoll = bf.accTrim.roll;
    d.trimPitch = bf.accTrim.pitch;
  }
  return d;
}

const sameKeys = (a: Draft, b: Draft, keys: string[]) => keys.every((k) => a[k] === b[k]);

function toWrites(draft: Draft, bf: BfData): MspWrite[] {
  const base = toDraft(bf);
  const w: MspWrite[] = [];
  if (bf.sensorConfig && !sameKeys(draft, base, [...SW])) {
    // on: keep the hardware the FC reported (or 0 = auto-detect when it was NONE); off: NONE
    const pick = (s: (typeof SW)[number]) => (!draft[s] ? D.SENSOR_NONE : bf.sensorConfig![s] === D.SENSOR_NONE ? 0 : bf.sensorConfig![s]);
    w.push({ code: C.SET_SENSOR_CONFIG, label: 'SET_SENSOR_CONFIG', payload: D.encodeSensorConfig({ acc: pick('acc'), baro: pick('baro'), mag: pick('mag') }, bf.raw.get('sensorCfg'), bf.api) });
  }
  if (bf.boardAlign && !sameKeys(draft, base, ['boardRoll', 'boardPitch', 'boardYaw'])) {
    w.push({ code: C.SET_BOARD_ALIGNMENT_CONFIG, label: 'SET_BOARD_ALIGNMENT_CONFIG', payload: D.encodeBoardAlignment({ roll: Number(draft.boardRoll), pitch: Number(draft.boardPitch), yaw: Number(draft.boardYaw) }, bf.raw.get('boardAlign')) });
  }
  if (bf.accTrim && !sameKeys(draft, base, ['trimRoll', 'trimPitch'])) {
    w.push({ code: C.SET_ACC_TRIM, label: 'SET_ACC_TRIM', payload: D.encodeAccTrim({ roll: Number(draft.trimRoll), pitch: Number(draft.trimPitch) }) });
  }
  return w;
}

/* ---------------- groups ---------------- */

const f = (key: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label, type: 'number', ...extra });

function groups(bf: BfData): Group[] {
  const rows = (list: FieldDef[], dr: Draft, bs: Draft) => list.map((x) => fieldHtml(x, dr, bs)).join('');
  const sw = bf.sensorConfig ? (['acc', 'mag', 'baro'] as const).map((s) => f(s, t(K(s)), { type: 'check' })) : [];
  const board = bf.boardAlign
    ? [
        f('boardRoll', t(K('boardRoll')), { unit: '°', min: -180, max: 360 }),
        f('boardPitch', t(K('boardPitch')), { unit: '°', min: -180, max: 360 }),
        f('boardYaw', t(K('boardYaw')), { unit: '°', min: -180, max: 360 }),
      ]
    : [];
  const trim = bf.accTrim ? [f('trimRoll', t(K('trimRoll')), { unit: '0.1°', min: -300, max: 300 }), f('trimPitch', t(K('trimPitch')), { unit: '0.1°', min: -300, max: 300 })] : [];
  return [
    {
      title: t(K('gHardware')),
      fields: [...sw, ...board],
      render: (dr, bs) => `${rows(sw, dr, bs)}${board.length ? `<div class="sn-sub">${escapeHtml(t(K('orientation')))}</div>${rows(board, dr, bs)}<div class="sn-act"><button type="button" class="btn amber" data-sn="auto">${escapeHtml(t(K('autoBtn')))}</button>${tip('tips.sensors.autoAlign')}</div>` : ''}`,
    },
    {
      title: t(K('gAccel')),
      fields: trim,
      render: (dr, bs) => `<div class="sn-act"><button type="button" class="btn amber" data-sn="cal">${escapeHtml(t(K('calBtn')))}</button>${tip('tips.sensors.calibrate')}</div>${rows(trim, dr, bs)}`,
    },
    {
      title: t(K('gAttitude')),
      fields: [],
      render: () => `<div class="sn-att">
        <dl class="sn-read mono"><dt>${escapeHtml(t(K('yaw')))}</dt><dd data-att="yaw">0.0</dd><dt>${escapeHtml(t(K('pitch')))}</dt><dd data-att="pitch">0.0</dd><dt>${escapeHtml(t(K('roll')))}</dt><dd data-att="roll">0.0</dd></dl>
        <div class="sn-view bf-su-attitude">${modelSvg()}</div>
        <div class="sn-act"><button type="button" class="btn ghost" data-sn="resetz">${escapeHtml(t(K('resetZ')))}</button></div>
      </div>`,
    },
    {
      title: t(K('gLive')),
      wide: true,
      fields: [],
      render: () => `<div class="sn-live" data-sn-live></div>`,
    },
  ];
}

/* ---------------- live graphs ---------------- */

const COLORS = ['#ff4a2e', '#5fd3a5', '#8fb8ff'];
const AXES = ['X', 'Y', 'Z'];
const RATES = [10, 20, 30, 40, 50, 100, 250, 500, 1000];
const SCALES = { gyro: [1, 2, 3, 4, 5, 10, 25, 50, 100, 200, 300, 400, 500, 1000, 2000], acc: [0.5, 1, 2], mag: [100, 200, 500, 1000, 2000, 5000, 10000], baro: [1, 2, 5, 10, 20, 50, 100] };
type GraphId = 'gyro' | 'acc' | 'mag' | 'baro';
const MAX_POINTS = 300;

interface LiveState {
  on: boolean;
  rate: number;
  scale: Record<GraphId, number>;
  buf: Record<GraphId, number[][]>;
}

function newLive(): LiveState {
  return { on: false, rate: 50, scale: { gyro: 50, acc: 2, mag: 1000, baro: 5 }, buf: { gyro: [[], [], []], acc: [[], [], []], mag: [[], [], []], baro: [[]] } };
}

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function drawGraph(cv: HTMLCanvasElement, series: number[][], scale: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const line = cssVar('--v1-line-2', '#1a2834');
  const sub = cssVar('--sub', '#8fa9b8');
  g.font = '11px "IBM Plex Mono", monospace';
  g.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = Math.round((i / 4) * (h - 1)) + 0.5;
    g.strokeStyle = i === 2 ? '#33495b' : line;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.fillStyle = sub;
  g.textAlign = 'left';
  g.fillText(fmtNum(scale, scale < 1 ? 1 : 0), 4, 8);
  g.fillText(fmtNum(-scale, scale < 1 ? 1 : 0), 4, h - 8);
  series.forEach((s, i) => {
    if (s.length < 2) return;
    g.strokeStyle = COLORS[i] ?? COLORS[0]!;
    g.lineWidth = 1.5;
    g.beginPath();
    s.forEach((v, j) => {
      const x = (j / (MAX_POINTS - 1)) * w + (w - ((s.length - 1) / (MAX_POINTS - 1)) * w);
      const y = h / 2 - (Math.max(-scale, Math.min(scale, v)) / scale) * (h / 2 - 2);
      if (j === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  });
}

function liveHtml(live: LiveState, hasMag: boolean, hasBaro: boolean): string {
  if (!live.on) return `<div class="sn-act"><button type="button" class="btn amber" data-sn="live">${escapeHtml(t(K('liveShow')))}</button>${tip('tips.sensors.live')}</div>`;
  const opts = (list: number[], cur: number, suffix = '') => list.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v}${suffix}</option>`).join('');
  const graph = (id: GraphId, title: string, unit: string, axes: number) => `<figure class="sn-g" data-g="${id}">
      <figcaption><b>${escapeHtml(title)}</b><span class="sn-leg mono" data-leg="${id}">${axes === 1 ? '' : AXES.map((a, i) => `<span><i style="background:${COLORS[i]}"></i>${a} 0</span>`).join('')}</span>
        <label>${escapeHtml(t(K('scale')))} <select data-sn-scale="${id}">${opts(SCALES[id], live.scale[id])}</select> <span class="mono">${escapeHtml(unit)}</span></label></figcaption>
      <canvas></canvas></figure>`;
  return `<div class="sn-act"><button type="button" class="btn ghost" data-sn="live">${escapeHtml(t(K('liveHide')))}</button>
      <label class="sn-rate">${escapeHtml(t(K('rate')))} <select data-sn-rate>${opts(RATES, live.rate, ' ms')}</select></label></div>
    <div class="sn-graphs">
      ${graph('gyro', t(K('gyro')), t(K('unitGyro')), 3)}
      ${graph('acc', t(K('accel')), t(K('unitAcc')), 3)}
      ${hasMag ? graph('mag', t(K('magn')), t(K('unitMag')), 3) : `<p class="sn-none">${escapeHtml(t(K('liveNoMag')))}</p>`}
      ${hasBaro ? graph('baro', t(K('baroGraph')), t(K('unitBaro')), 1) : `<p class="sn-none">${escapeHtml(t(K('liveNoBaro')))}</p>`}
    </div>`;
}

/* ---------------- mount ---------------- */

const ROWS: RowRule[] = [
  { key: 'acc', tip: 'tips.sensors.acc' },
  { key: 'mag', tip: 'tips.sensors.mag' },
  { key: 'baro', tip: 'tips.sensors.baro' },
  { key: 'boardRoll', tip: 'tips.sensors.orientation' },
  { key: 'trimRoll', tip: 'tips.sensors.trim' },
];

export const mount: ScreenMount = (el, ctx) => {
  const live = newLive();
  const spec: TabSpec = {
    id: 'sensors',
    title: t(K('title')),
    areas: ['sensors', 'alignment', 'status'],
    ready: (bf) => !!(bf.sensorConfig || bf.boardAlign || bf.accTrim),
    toDraft,
    groups,
    toWrites,
    needsReboot: (changed) => changed.some((k) => (SW as readonly string[]).includes(k)),
    top: () => intro('tips.sensors.intro'),
    live: (root, c, api) => startLive(root, c, api, live),
  };
  const off = mountFormTab(el, ctx, spec);
  const panels: PanelRule[] = [
    { title: t(K('gHardware')), tip: 'tips.sensors.hardware' },
    { title: t(K('gAttitude')), tip: 'tips.sensors.attitude' },
  ];
  const stop = decorateForm(el, ROWS, panels);
  return () => {
    stop();
    off();
  };
};

function startLive(el: HTMLElement, ctx: AppContext, api: LiveApi, live: LiveState): () => void {
  const ac = new AbortController();
  let dead = false;
  let busy = false;
  let zOffset = 0;
  let lastHeading = 0;
  let model: AttitudeModel | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const sens = () => ctx.bf.get().status?.sensors ?? 0;
  const hasMag = () => ((sens() >> 2) & 1) === 1 || ctx.bf.get().sensorConfig?.mag === 0;
  const hasBaro = () => ((sens() >> 1) & 1) === 1;
  const q = <T extends Element>(s: string) => el.querySelector<T>(s);

  /* attitude: 3D model (SVG stays as the fallback) + numbers, polled every 100 ms */
  const view = q<HTMLElement>('.sn-view');
  const svg = q<SVGElement>('.bf-su-model');
  if (view) {
    void mountAttitudeModel(view).then((m) => {
      if (!m) return;
      if (dead || !view.isConnected) return m.destroy();
      model = m;
      view.classList.add('has-3d');
    });
  }
  let inflight = false;
  const poll = setInterval(() => {
    if (inflight || ctx.link()?.busy) return;
    inflight = true;
    void ctx.bf
      .read(ATTITUDE)
      .then((a) => {
        if (!a || dead || !el.isConnected) return;
        lastHeading = a.headingDeg;
        const yaw = (((a.headingDeg - zOffset) % 360) + 360) % 360;
        if (model) model.set(a.rollDeg, a.pitchDeg, yaw);
        else if (svg) updateModel(svg, a.rollDeg, a.pitchDeg, yaw);
        const set = (k: string, v: string) => {
          const e = q<HTMLElement>(`[data-att="${k}"]`);
          if (e) e.textContent = v;
        };
        set('yaw', fmtNum(yaw, 1));
        set('pitch', fmtNum(a.pitchDeg, 1));
        set('roll', fmtNum(a.rollDeg, 1));
      })
      .catch(() => undefined)
      .finally(() => (inflight = false));
  }, 100);

  /* live sensor graphs */
  const host = q<HTMLElement>('[data-sn-live]');
  const draw = (id: GraphId) => {
    const cv = q<HTMLCanvasElement>(`[data-g="${id}"] canvas`);
    if (cv) drawGraph(cv, live.buf[id], live.scale[id]);
  };
  const push = (id: GraphId, vals: number[]) => {
    vals.forEach((v, i) => {
      const s = live.buf[id][i]!;
      s.push(v);
      if (s.length > MAX_POINTS) s.shift();
    });
    const leg = q<HTMLElement>(`[data-leg="${id}"]`);
    if (leg && vals.length === 3) leg.innerHTML = vals.map((v, i) => `<span><i style="background:${COLORS[i]}"></i>${AXES[i]} ${fmtNum(v, id === 'acc' ? 2 : id === 'gyro' ? 1 : 0)}</span>`).join('');
  };
  const stopTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const tick = async () => {
    timer = null;
    if (dead || !live.on) return;
    if (!ctx.link()?.busy) {
      const imu = await ctx.bf.read(RAW_IMU).catch(() => null);
      if (dead) return;
      if (imu) {
        push('gyro', imu.gyro);
        push('acc', imu.acc);
        draw('gyro');
        draw('acc');
        if (hasMag()) {
          push('mag', imu.mag);
          draw('mag');
        }
      }
      if (hasBaro()) {
        const alt = await ctx.bf.read(ALTITUDE).catch(() => null);
        if (dead) return;
        if (alt) {
          push('baro', [alt.altM]);
          const leg = q<HTMLElement>('[data-leg="baro"]');
          if (leg) leg.textContent = `${fmtNum(alt.altM, 2)} m`;
          draw('baro');
        }
      }
    }
    if (!dead && live.on) timer = setTimeout(() => void tick(), live.rate);
  };
  const renderLive = () => {
    stopTimer();
    if (!host) return;
    host.innerHTML = liveHtml(live, hasMag(), hasBaro());
    if (live.on) void tick();
  };
  renderLive();

  /* actions */
  const armed = () => {
    if (!ctx.bf.isArmed()) return false;
    ctx.toast(t(K('armedBlock')), 'error');
    return true;
  };

  async function calibrate(): Promise<void> {
    if (busy || armed()) return;
    if (ctx.bf.get().status && (sens() & 1) === 0) return ctx.toast(t(K('calNoAcc')), 'error');
    const ok = await ctx.confirm({ title: t(K('calTitle')), body: `<p>${escapeHtml(t(K('calBody')))}</p>`, confirmText: t(K('calBtn')) });
    if (!ok || dead) return;
    busy = true;
    try {
      await ctx.bf.send(C.ACC_CALIBRATION, undefined, 2000);
      ctx.toast(t(K('calStarted')), 'info');
      await wait(2500);
      await ctx.bf.refresh(['status', 'ident']);
      ctx.toast(t(K('calDone')), 'ok');
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      busy = false;
    }
  }

  /** Measures the tilt of the (unrotated) board from gravity and proposes Roll/Pitch; the user still has to Save. */
  async function autoDetect(): Promise<void> {
    if (busy || armed()) return;
    const bf = ctx.bf.get();
    if (bf.boardAlign && (bf.boardAlign.roll !== 0 || bf.boardAlign.pitch !== 0)) return ctx.toast(t(K('autoNeedZero')), 'error');
    const ok = await ctx.confirm({ title: t(K('autoTitle')), body: `<p>${escapeHtml(t(K('autoBody')))}</p>`, confirmText: t(K('autoConfirm')) });
    if (!ok || dead) return;
    busy = true;
    try {
      const s: Array<[number, number, number]> = [];
      for (let i = 0; i < 25 && !dead; i++) {
        const imu = await ctx.bf.read(RAW_IMU);
        if (imu) s.push(imu.acc);
        await wait(40);
      }
      if (dead) return;
      if (s.length < 15) return ctx.toast(t(K('autoNoData')), 'error');
      const mean = [0, 1, 2].map((i) => s.reduce((a, v) => a + v[i]!, 0) / s.length) as [number, number, number];
      const spread = [0, 1, 2].map((i) => Math.max(...s.map((v) => v[i]!)) - Math.min(...s.map((v) => v[i]!)));
      const norm = Math.hypot(...mean);
      if (norm < 0.5) return ctx.toast(t(K('autoNoData')), 'error');
      if (Math.max(...spread) > 0.08 * Math.max(1, norm) || norm < 0.8 || norm > 1.25) return ctx.toast(t(K('autoMoving')), 'error');
      const roll = Math.round((Math.atan2(mean[1], mean[2]) * 180) / Math.PI);
      const pitch = Math.round((-Math.atan2(mean[0], Math.hypot(mean[1], mean[2])) * 180) / Math.PI);
      if (roll === 0 && pitch === 0) return ctx.toast(t(K('autoLevel')), 'ok');
      api.set('boardRoll', roll);
      api.set('boardPitch', pitch);
      ctx.toast(t(K('autoDone'), { roll, pitch }), 'info');
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      busy = false;
    }
  }

  el.addEventListener(
    'click',
    (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-sn]')?.dataset.sn;
      if (act === 'cal') void calibrate();
      else if (act === 'auto') void autoDetect();
      else if (act === 'resetz') zOffset = lastHeading;
      else if (act === 'live') {
        live.on = !live.on;
        renderLive();
      }
    },
    { signal: ac.signal },
  );
  el.addEventListener(
    'change',
    (e) => {
      const tg = e.target as HTMLSelectElement;
      if (tg.dataset.snRate !== undefined) {
        live.rate = Number(tg.value);
        if (live.on) {
          stopTimer();
          void tick();
        }
      } else if (tg.dataset.snScale) {
        const id = tg.dataset.snScale as GraphId;
        live.scale[id] = Number(tg.value);
        draw(id);
      }
    },
    { signal: ac.signal },
  );

  return () => {
    dead = true;
    ac.abort();
    clearInterval(poll);
    stopTimer();
    model?.destroy();
    model = null;
  };
}
