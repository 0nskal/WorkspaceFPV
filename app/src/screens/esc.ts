/**
 * Motors tab ("Silniki", hash `esc`), laid out like the Betaflight Motors tab:
 *   left  = Model type (mixer, reversed direction, quad diagram), ESC/Motor features, 3D, ESC info (4-way, read-only)
 *   right = live gyro/accel graph with voltage/current/mAh, motor test (tiles with RPM/Err/Temp, vertical sliders,
 *           master slider, "I understand the risks" switch = our props-off lock, STOP + Space).
 * Safety: sliders are disabled until the switch is on, 30 % cap unless unlocked, the test stops on STOP/Space,
 * window blur, tab leave, disconnect and reconnect. Settings are written only by the Save button (bf-motors-cfg.ts).
 */
import type { AppContext, ScreenMount } from '../context';
import './esc.css';
import { escLabel, summarizeEsc } from '../bf/esc-summary';
import { MOTOR_PROTOCOLS, pctToMotor, telemetryActive } from '../bf/motors';
import { fmtNum, t } from '../i18n';
import { motorPct } from '../fc/state';
import { hasWebSerial } from '../serial/port';
import { MSP } from '../serial/msp';
import { escapeHtml } from '../ui/dom';
import { mountEscInfo } from './bf-esc-info';
import { icon } from '../ui/icons';
import { intro, tip } from '../ui/tip';
import { mountMotorConfig, type MotorCfgHandle, type Recommendation } from './bf-motors-cfg';
import { mountMotorTelemetry, type MotorTelHandle } from './bf-motors-tel';
import { quadSvg } from './esc-quad';
import { mountMotorsBasic } from './motors-basic';
import { currentMode } from '../ui/mode';

const SAFE_MAX = 30;
const TICK_MS = 100;
const HIST = 160;
const COLORS = ['#ff4a2e', '#5fd3a5', '#5aa9e6', '#e0a82e'];

type Sensor = 'gyro' | 'acc';
const SCALES: Record<Sensor, number[]> = { gyro: [2000, 1000, 500, 250, 100, 50, 20, 10], acc: [4, 2, 1, 0.5, 0.25] };
const RATES = [100, 200, 500];

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  // Basic mode: the step-by-step motor check on the render (motors-basic.ts); Expert keeps this full tab
  if (currentMode(ctx.settings) === 'basic') {
    el.classList.replace('legacy', 'modern');
    return mountMotorsBasic(el, ctx);
  }
  let view: 'empty' | 'main' | '' = '';
  let propsOut = false;
  let cfgHandle: MotorCfgHandle | null = null;
  let telHandle: MotorTelHandle | null = null;
  let offInfo: (() => void) | null = null;
  // motor test
  let propsOff = false; // "I understand the risks": always off when the tab opens
  let unlock = false;
  const vals = [0, 0, 0, 0];
  let master = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight = false;
  // live graph
  let sensor: Sensor = 'gyro';
  let scale = 2000;
  let rate = 100;
  let lastSample = 0;
  let oneG = 0;
  const hist: Array<[number, number, number]> = [];
  let drawQueued = false;
  let quadKey = '';

  const q = <T extends Element = HTMLElement>(sel: string): T | null => el.querySelector<T>(sel);
  const maxPct = () => (unlock ? 100 : SAFE_MAX);
  const anyActive = () => vals.some((v) => v > 0);

  /* ---------- motor test: sending ---------- */
  function payload(): Uint8Array {
    const b = new Uint8Array(16);
    const dv = new DataView(b.buffer);
    for (let i = 0; i < 8; i++) dv.setUint16(i * 2, i < 4 ? pctToMotor(vals[i]) : 1000, true);
    return b;
  }

  function sendNow(): void {
    const link = ctx.link();
    if (!link || link.busy) return;
    if (ctx.state.get().mode === 'demo') return; // demo: simulated in the UI only
    if (inflight) return;
    inflight = true;
    link
      .request(MSP.SET_MOTOR, payload(), 400)
      .catch(() => undefined)
      .finally(() => {
        inflight = false;
      });
  }

  function startLoop(): void {
    if (timer) return;
    sendNow();
    timer = setInterval(() => {
      if (!propsOff || !anyActive()) {
        stopTest();
        return;
      }
      sendNow();
    }, TICK_MS);
  }

  function sendZeros(): void {
    const link = ctx.link();
    if (!link || link.busy || ctx.state.get().mode === 'demo') return;
    const zeros = new Uint8Array(16);
    const dv = new DataView(zeros.buffer);
    for (let i = 0; i < 8; i++) dv.setUint16(i * 2, 1000, true);
    for (let i = 0; i < 2; i++) link.request(MSP.SET_MOTOR, zeros, 400).catch(() => undefined);
  }

  function stopTest(): void {
    const was = anyActive() || timer !== null;
    if (timer) clearInterval(timer);
    timer = null;
    vals.fill(0);
    master = 0;
    if (was) sendZeros();
    paintTest();
    paintMotors();
  }

  /* ---------- diagnosis: problem motors and the protocol recommendation ---------- */
  function motorTags(): string[] {
    const s = ctx.state.get();
    const tel = telHandle?.latest() ?? [];
    const active = telemetryActive(tel);
    const scan = s.hw.esc;
    const sum = summarizeEsc(scan);
    const main = sum ? [...sum.groups].sort((a, b) => b.motors.length - a.motors.length)[0].name : null;
    const anyRpm = active && tel.slice(0, 4).some((m) => m && m.rpm > 0);
    return [0, 1, 2, 3].map((i) => {
      const m = tel[i];
      const live = !!m && active;
      const dev = scan?.escs.find((e) => e.index === i);
      const fw = dev ? escLabel(dev) : null;
      if (dev?.status === 'no-response') return t('bfMotors.tagNoEsc');
      if (dev && !fw) return t('bfMotors.tagUnknownFw');
      if (fw && main && sum && sum.groups.length > 1 && fw !== main) return t('bfMotors.tagFwDiffers');
      if (live && anyRpm && m.rpm === 0) return t('bfMotors.tagNoRpm');
      if (live && m.invalidPct >= 2) return t('bfMotors.tagHighLost');
      if (live && m.tempC >= 60) return t('bfMotors.tagHot');
      return '';
    });
  }

  function recommend(): Recommendation | null {
    const d = ctx.diagnosis();
    const problems = d.checks.filter((c) => c.part === 'esc' && (c.severity === 'fail' || c.severity === 'warn')).map((c) => c.label);
    const grab = (id: string) => d.suggestions.find((x) => x.id === id);
    const name = grab('protocol')?.commands[0]?.match(/=\s*(\w+)/)?.[1] ?? '';
    const proto = MOTOR_PROTOCOLS.find((p) => p.name === name.toUpperCase())?.id ?? null;
    const bidir = !!grab('bidir');
    if (!problems.length && proto === null && !bidir) return null;
    return { problems, protocol: proto, bidir };
  }

  /* ---------- painting ---------- */
  function currentPct(): Array<number | null> {
    const s = ctx.state.get();
    if (s.mode === 'demo' && anyActive()) return vals.slice();
    const tl = s.telemetry;
    return tl ? tl.motors.slice(0, 4).map(motorPct) : [null, null, null, null];
  }

  function paintMotors(): void {
    if (view !== 'main') return;
    const pcts = currentPct();
    const tel = telHandle?.latest() ?? [];
    const active = telemetryActive(tel);
    const tags = motorTags();
    const scan = ctx.state.get().hw.esc;
    const dash = '—';
    for (let i = 0; i < 4; i++) {
      const tile = q(`[data-tile="${i}"]`);
      if (!tile) continue;
      const p = pcts[i];
      const m = tel[i];
      const live = !!m && active;
      const dev = scan?.escs.find((e) => e.index === i);
      const fw = dev ? escLabel(dev) : null;
      const tag = tags[i];
      const html = `<div class="mt-tile-v mono">${p === null ? dash : pctToMotor(p)}</div><div class="mt-tile-p mono">${p === null ? '' : `${p}%`}</div>${tag ? `<span class="mt-tag">${escapeHtml(tag)}</span>` : ''}`;
      if (tile.dataset.sig !== html) {
        tile.dataset.sig = html;
        tile.innerHTML = html;
      }
      tile.classList.toggle('hot', !!tag);
      tile.classList.toggle('live', vals[i] > 0);
      const st = q(`[data-stats="${i}"]`);
      if (st) {
        const lost = live && m.invalidPct >= 2;
        const hotT = live && m.tempC >= 60;
        const sh = `<div><span>RPM</span><b class="mono">${live ? fmtNum(m.rpm) : dash}</b></div><div><span>Err</span><b class="mono${lost ? ' bad' : ''}">${live ? `${fmtNum(m.invalidPct, 1)}%` : dash}</b></div><div><span>Temp</span><b class="mono${hotT ? ' bad' : ''}">${live ? `${fmtNum(m.tempC, 0)} °C` : dash}</b></div>${fw ? `<div class="mt-fw" title="${escapeHtml(t('bfMotors.cardFw'))}"><span>FW</span><b class="mono">${escapeHtml(fw)}</b></div>` : ''}`;
        if (st.dataset.sig !== sh) {
          st.dataset.sig = sh;
          st.innerHTML = sh;
        }
      }
    }
    paintQuad(tags);
  }

  function paintQuad(tags = motorTags()): void {
    const box = q('.mt-quad');
    if (!box) return;
    const mixer = cfgHandle?.mixer() ?? 3;
    const hot = tags.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    const key = JSON.stringify([mixer, propsOut, hot, vals, t('bfMotors.front')]);
    if (key === quadKey) return;
    quadKey = key;
    box.innerHTML = mixer === 3
      ? quadSvg({ propsOut, hot, active: vals, aria: t('bfMotors.quadAria'), front: t('bfMotors.front') })
      : `<p class="mt-msg">${t('bfMotors.quadOnly')}</p>`;
  }

  function paintTest(): void {
    if (view !== 'main') return;
    const state = q('.mt-state');
    if (state) {
      state.textContent = !propsOff ? t('esc.stateLocked') : anyActive() ? t('esc.stateLive') : t('esc.stateReady');
      state.className = `mt-state ${!propsOff ? 'locked' : anyActive() ? 'live' : 'ready'}`;
    }
    const max = maxPct();
    el.querySelectorAll<HTMLInputElement>('input.mt-range').forEach((r) => {
      const idx = r.dataset.m;
      r.disabled = !propsOff;
      r.max = String(max);
      const v = idx === 'all' ? master : vals[Number(idx)];
      r.value = String(v);
      r.style.setProperty('--p', `${((v / max) * 100).toFixed(1)}%`);
      const col = r.closest('.mt-col-m');
      const out = col?.querySelector('.mt-sl-v');
      if (out) out.textContent = `${v}%`;
      col?.classList.toggle('dis', !propsOff);
      col?.classList.toggle('on', v > 0);
    });
    const sw = q('.mt-risk .bf-sw');
    sw?.classList.toggle('on', propsOff);
    const un = q<HTMLInputElement>('#esc-unlock');
    if (un) un.disabled = !propsOff;
    q('.mt-unlock')?.classList.toggle('dis', !propsOff);
    q('.mt-risk')?.classList.toggle('on', propsOff);
    q('.mt-stop')?.classList.toggle('armed', propsOff && anyActive());
    const mv = q('[data-master]');
    if (mv) mv.textContent = String(pctToMotor(master));
  }

  function paintOverlay(): void {
    const ov = q('.mt-overlay');
    if (ov) ov.hidden = ctx.state.get().conn !== 'reconnecting';
  }

  /* ---------- live graph ---------- */
  function sample(): void {
    const tl = ctx.state.get().telemetry;
    if (!tl || view !== 'main') return;
    const now = Date.now();
    if (now - lastSample < rate - 15) return;
    lastSample = now;
    let v: [number, number, number];
    if (sensor === 'gyro') v = [tl.gyro[0], tl.gyro[1], tl.gyro[2]];
    else {
      // MSP_RAW_IMU sends 512 per g on most boards (2048 on some); pick by the magnitude at the first sample
      const mag = Math.hypot(tl.acc[0], tl.acc[1], tl.acc[2]);
      if (!oneG) oneG = mag > 1200 ? 2048 : 512;
      v = [tl.acc[0] / oneG, tl.acc[1] / oneG, tl.acc[2] / oneG];
    }
    hist.push(v);
    if (hist.length > HIST) hist.shift();
    paintReadout(v);
    paintPower();
    if (!drawQueued) {
      drawQueued = true;
      requestAnimationFrame(() => {
        drawQueued = false;
        drawGraph();
      });
    }
  }

  function paintReadout(v: [number, number, number]): void {
    const rms = Math.sqrt((v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 3);
    const d = sensor === 'gyro' ? 2 : 3;
    [...v, rms].forEach((x, i) => {
      const o = q(`[data-ro="${i}"]`);
      if (o) o.textContent = fmtNum(x, d);
    });
  }

  function paintPower(): void {
    const tl = ctx.state.get().telemetry;
    const set = (k: string, s: string) => {
      const o = q(`[data-pw="${k}"]`);
      if (o && o.textContent !== s) o.textContent = s;
    };
    set('v', tl ? `${fmtNum(tl.vbat, 2)} V` : '—');
    set('a', tl ? `${fmtNum(tl.amperage, 2)} A` : '—');
    set('mah', tl ? `${fmtNum(tl.mah)} mAh` : '—');
  }

  function drawGraph(): void {
    const cv = q<HTMLCanvasElement>('.mt-graph canvas');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
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
    const left = 44;
    const pw = w - left - 6;
    const top = 8;
    const ph = h - top - 8;
    const y = (v: number) => top + ph / 2 - (Math.max(-scale, Math.min(scale, v)) / scale) * (ph / 2);
    g.font = '11px "IBM Plex Mono", monospace';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const k of [-1, -0.5, 0, 0.5, 1]) {
      const yy = y(k * scale);
      g.strokeStyle = k === 0 ? '#3a5266' : '#1c2c3a';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(left, Math.round(yy) + 0.5);
      g.lineTo(left + pw, Math.round(yy) + 0.5);
      g.stroke();
      g.fillStyle = '#8fa9b8';
      g.fillText(fmtNum(k * scale, scale < 1 ? 2 : 0), left - 6, yy);
    }
    for (let i = 1; i < 4; i++) {
      const xx = Math.round(left + (pw * i) / 4) + 0.5;
      g.strokeStyle = '#1c2c3a';
      g.beginPath();
      g.moveTo(xx, top);
      g.lineTo(xx, top + ph);
      g.stroke();
    }
    const n = hist.length;
    if (n < 2) return;
    const dx = pw / (HIST - 1);
    const x0 = left + pw - (n - 1) * dx;
    for (let a = 0; a < 3; a++) {
      g.strokeStyle = COLORS[a];
      g.lineWidth = 1.6;
      g.beginPath();
      hist.forEach((v, i) => (i ? g.lineTo(x0 + i * dx, y(v[a])) : g.moveTo(x0, y(v[a]))));
      g.stroke();
    }
  }

  function resetGraph(): void {
    hist.length = 0;
    oneG = 0;
    for (let i = 0; i < 4; i++) {
      const o = q(`[data-ro="${i}"]`);
      if (o) o.textContent = '0';
    }
    drawGraph();
  }

  function scaleOptions(): string {
    const unit = sensor === 'gyro' ? 'deg/s' : 'g';
    return SCALES[sensor].map((v) => `<option value="${v}" ${v === scale ? 'selected' : ''}>${v} ${unit}</option>`).join('');
  }

  /* ---------- views ---------- */
  function buildEmpty(): void {
    const s = ctx.state.get();
    const busy = s.conn === 'connecting';
    const noSerial = !hasWebSerial();
    el.innerHTML = `
      <div class="bf-tab mt">
        <header class="bf-head"><h2>${t('bfMotors.title')}</h2></header>
        <div class="mt-empty">
          <h3>${t('esc.emptyTitle')}</h3>
          <p>${t('esc.emptyLead')}</p>
          <div class="start-btns">
            <button class="btn amber" data-act="connect" ${busy || noSerial ? 'disabled' : ''}>${icon('plug', 16)}${busy ? t('common.connecting') : t('common.connect')}</button>
            <button class="btn ghost" data-act="demo" ${busy ? 'disabled' : ''}>${icon('play', 16)}${t('common.demo')}</button>
          </div>
          ${noSerial ? `<div class="start-msg warn">${t('conn.noWebSerial')}</div>` : ''}
          ${s.error ? `<div class="start-msg err" role="alert">${escapeHtml(s.error)}</div>` : ''}
        </div>
      </div>`;
    view = 'empty';
    offInfo?.();
    offInfo = null;
    destroyBf();
  }

  function buildMain(): void {
    propsOff = false;
    unlock = false;
    vals.fill(0);
    master = 0;
    quadKey = '';
    hist.length = 0;
    destroyBf();
    propsOut = false;
    const col = (i: number | 'all') => {
      const all = i === 'all';
      const aria = all ? t('esc.allPower') : t('esc.motorPower', { n: (i as number) + 1 });
      return `<div class="mt-col-m${all ? ' all' : ''} dis">
        <div class="mt-col-n mono">${all ? escapeHtml(t('bfMotors.master')) : (i as number) + 1}</div>
        ${all ? `<div class="mt-tile mt-tile-all">${tip('tips.motors.master')}<div class="mt-tile-v mono" data-master>1000</div><div class="mt-tile-p mono">${escapeHtml(t('esc.all'))}</div></div><div class="mt-stats"></div>` : `<div class="mt-tile" data-tile="${i}" aria-live="off"></div><div class="mt-stats" data-stats="${i}"></div>`}
        <div class="mt-sl-v mono">0%</div>
        <div class="mt-sl"><input class="mt-range" type="range" min="0" max="${SAFE_MAX}" step="1" value="0" data-m="${i}" disabled aria-label="${escapeHtml(aria)}"></div>
      </div>`;
    };
    const gyroSel = `<select class="v1-in" data-g="sensor" aria-label="${escapeHtml(t('bfMotors.sensor'))}"><option value="gyro">${t('bfMotors.gyro')}</option><option value="acc">${t('bfMotors.acc')}</option></select>`;
    const rateSel = `<select class="v1-in" data-g="rate" aria-label="${escapeHtml(t('bfMotors.rate'))}">${RATES.map((r) => `<option value="${r}" ${r === rate ? 'selected' : ''}>${r} ms</option>`).join('')}</select>`;
    const scaleSel = `<select class="v1-in" data-g="scale" aria-label="${escapeHtml(t('bfMotors.scale'))}">${scaleOptions()}</select>`;
    const ro = (i: number, l: string) => `<div class="mt-ro"><span>${l}</span><b class="mono" data-ro="${i}" style="--c:${COLORS[i]}">0</b></div>`;
    el.innerHTML = `
      <div class="bf-tab mt">
        <header class="bf-head"><h2>${t('bfMotors.title')}</h2></header>
        <div class="bf-body mt-body">
          ${intro('tips.motors.intro')}
          <div class="mt-grid">
            <div class="mt-left">
              <section class="bf-panel mt-model">
                <header><span class="bf-legend">${t('bfMotors.pModel')}</span></header>
                <div class="mt-model-cfg"></div>
                <div class="mt-quad"></div>
                <p class="mt-quad-cap">${t('bfMotors.numbering')} ${tip('tips.motors.numbering')}</p>
              </section>
              <section class="bf-panel">
                <header><span class="bf-legend">${t('bfMotors.pEsc')}</span></header>
                <div class="mt-esc-cfg"></div>
              </section>
              <section class="bf-panel" data-level="expert">
                <header><span class="bf-legend">${t('bfMotors.p3d')}</span></header>
                <div class="mt-3d-cfg"></div>
              </section>
              <div class="mt-escinfo"></div>
            </div>
            <div class="mt-right">
              <section class="bf-panel mt-live" data-level="expert">
                <header><span class="bf-legend">${t('bfMotors.pLive')} ${tip('tips.motors.liveGraph')}</span></header>
                <div class="mt-live-grid">
                  <div class="mt-graph"><canvas aria-label="${escapeHtml(t('bfMotors.graphAria'))}" role="img"></canvas></div>
                  <div class="mt-gctl">
                    <div class="mt-gctl-top"><button type="button" class="btn amber mt-btn-sm" data-act="greset">${t('bfMotors.reset')}</button>${gyroSel}</div>
                    <label class="mt-gl"><span>${t('bfMotors.rate')}</span>${rateSel}</label>
                    <label class="mt-gl"><span>${t('bfMotors.scale')}</span>${scaleSel}</label>
                    ${ro(0, 'X')}${ro(1, 'Y')}${ro(2, 'Z')}${ro(3, 'RMS')}
                  </div>
                </div>
                <dl class="mt-power">
                  <div><dt>${t('bfMotors.voltage')}</dt><dd class="mono" data-pw="v">—</dd></div>
                  <div><dt>${t('bfMotors.current')}</dt><dd class="mono" data-pw="a">—</dd></div>
                  <div><dt>${t('bfMotors.used')}</dt><dd class="mono" data-pw="mah">—</dd></div>
                </dl>
              </section>
              <section class="bf-panel mt-test">
                <header><span class="bf-legend">${t('bfMotors.pTest')} ${tip('tips.motors.testHead')}</span><small class="mt-state locked">${t('esc.stateLocked')}</small></header>
                <div class="mt-cols">${[0, 1, 2, 3].map(col).join('')}${col('all')}</div>
                <div class="mt-tel"></div>
                <div class="mt-risk">
                  <div class="mt-risk-txt">
                    <h4>${t('bfMotors.riskTitle')}</h4>
                    <p class="mt-risk-red">${t('bfMotors.riskRed')}</p>
                    <ul>
                      <li>${t('bfMotors.risk1')}</li>
                      <li>${t('bfMotors.risk2')}</li>
                      <li>${t('bfMotors.risk3')}</li>
                      <li>${t('bfMotors.risk4')}</li>
                    </ul>
                  </div>
                  <div class="mt-risk-ctl">
                    <label class="mt-understand"><span class="bf-sw"><input type="checkbox" id="esc-propsoff"><i></i></span><b>${t('bfMotors.understand')}</b>${tip('tips.motors.propsOff')}</label>
                    <label class="mt-unlock dis"><input type="checkbox" id="esc-unlock" disabled><span>${t('esc.unlock', { max: SAFE_MAX })}</span>${tip('tips.motors.unlock')}</label>
                    <button type="button" class="mt-stop">${icon('stop', 18)}<span>${t('bfMotors.stopMotors')}</span><kbd class="mono">${t('esc.space')}</kbd></button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
        <footer class="bf-save mt-bar"></footer>
        <div class="mt-overlay" hidden><div>${t('esc.restarting')}</div></div>
      </div>`;
    view = 'main';
    paintTest();
    paintPower();
    cfgHandle = mountMotorConfig(
      { model: q('.mt-model-cfg')!, esc: q('.mt-esc-cfg')!, d3: q('.mt-3d-cfg')!, bar: q('.mt-bar')! },
      ctx,
      {
        onReversed: (v) => {
          propsOut = v;
          paintQuad();
        },
        stopTest,
        recommend,
      },
    );
    telHandle = mountMotorTelemetry(q('.mt-tel')!, ctx, () => paintMotors());
    offInfo?.();
    offInfo = mountEscInfo(q('.mt-escinfo') as HTMLElement, ctx);
    paintMotors();
    requestAnimationFrame(drawGraph);
  }

  function destroyBf(): void {
    cfgHandle?.destroy();
    telHandle?.destroy();
    cfgHandle = null;
    telHandle = null;
  }

  function render(): void {
    const s = ctx.state.get();
    if (s.conn !== 'connected' && s.conn !== 'reconnecting') {
      stopTest();
      if (view !== 'empty' || s.conn === 'connecting' || s.error) buildEmpty();
      return;
    }
    if (s.conn === 'reconnecting') stopTest();
    if (view !== 'main') buildMain();
    paintOverlay();
    paintMotors();
    cfgHandle?.refreshRec();
  }

  /* ---------- events ---------- */
  el.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    const act = tg.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'connect') return void ctx.connect();
    if (act === 'demo') return void ctx.connectDemo();
    if (act === 'greset') return resetGraph();
    if (tg.closest('.mt-stop')) return stopTest();
  });

  el.addEventListener('change', (e) => {
    const tg = e.target as HTMLInputElement | HTMLSelectElement;
    const g = tg.dataset.g;
    if (g === 'sensor') {
      sensor = tg.value === 'acc' ? 'acc' : 'gyro';
      scale = sensor === 'gyro' ? 2000 : 2;
      const sc = q<HTMLSelectElement>('[data-g="scale"]');
      if (sc) sc.innerHTML = scaleOptions();
      resetGraph();
      return;
    }
    if (g === 'rate') return void (rate = Number(tg.value) || 100);
    if (g === 'scale') {
      scale = Number(tg.value) || scale;
      return drawGraph();
    }
    if (tg.id === 'esc-propsoff') {
      propsOff = (tg as HTMLInputElement).checked;
      if (!propsOff) {
        stopTest();
        unlock = false;
        const un = q<HTMLInputElement>('#esc-unlock');
        if (un) un.checked = false;
      }
      paintTest();
    } else if (tg.id === 'esc-unlock') {
      unlock = (tg as HTMLInputElement).checked;
      if (!unlock) {
        for (let i = 0; i < 4; i++) vals[i] = Math.min(vals[i], SAFE_MAX);
        master = Math.min(master, SAFE_MAX);
      }
      paintTest();
    }
  });

  el.addEventListener('input', (e) => {
    const tg = e.target as HTMLInputElement;
    if (!tg.classList.contains('mt-range') || !propsOff) return;
    const v = Math.max(0, Math.min(maxPct(), Math.round(Number(tg.value))));
    if (tg.dataset.m === 'all') {
      master = v;
      vals.fill(v);
    } else vals[Number(tg.dataset.m)] = v;
    paintTest();
    paintMotors();
    if (anyActive()) startLoop();
    else stopTest();
  });

  const onKey = (e: KeyboardEvent) => {
    if ((e.code === 'Space' || e.key === ' ') && (anyActive() || timer)) {
      e.preventDefault();
      stopTest();
    }
  };
  const onBlur = () => stopTest();
  const onVis = () => {
    if (document.hidden) stopTest();
  };
  const onResize = () => drawGraph();
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVis);

  const off = ctx.state.subscribe(render);
  const offT = ctx.state.subscribeTelemetry(() => {
    if (view !== 'main') return;
    paintMotors();
    sample();
  });
  render();

  return () => {
    stopTest();
    offInfo?.();
    destroyBf();
    off();
    offT();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVis);
  };
};
