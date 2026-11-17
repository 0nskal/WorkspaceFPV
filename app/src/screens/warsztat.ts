import { RX_PROVIDERS } from '../bf/decode';
import type { BfData } from '../bf/store';
import type { AppContext, ScreenMount } from '../context';
import { partLabel, type Diagnosis } from '../fc/diagnose';
import { boardDisplayName, firmwareName } from '../fc/board';
import { isDshot, motorPct, protocolName, rssiPct, type FcState } from '../fc/state';
import { hasWebSerial } from '../serial/port';
import { escapeHtml } from '../ui/dom';
import { fmtDate, fmtNum, t } from '../i18n';
import { ENTRY_Y, VIEW_H, VIEW_W, renderDrone, updateMotorBars, type XrayLabels } from '../ui/drone-xray';
import { icon } from '../ui/icons';
import { loadBackup } from '../settings';
import { APP_VERSION } from '../updates';
import './warsztat.css';
import heroImg from '../assets/img/ws-hero.webp';
import connectImg from '../assets/img/connect.webp';
import { intro, tip } from '../ui/tip';

function buildLabels(s: Readonly<FcState>, d: Diagnosis, bf: Readonly<BfData>): XrayLabels {
  const tel = s.telemetry;
  const craft = (s.info?.craftName || t('common.drone')).toUpperCase();
  const elrs = s.hw.elrs?.version;
  const provider = bf.rx && bf.rx.serialRxProvider > 0 ? (RX_PROVIDERS[bf.rx.serialRxProvider] ?? '') : '';
  const cellCount = bf.batteryState?.cells || s.cells;
  const rxProblem = d.checks.find((c) => c.part === 'rx' && (c.severity === 'fail' || c.severity === 'warn'));
  const focusCheck = d.focus ? d.checks.find((c) => c.part === d.focus && (c.severity === 'fail' || c.severity === 'warn')) : undefined;
  let hotText: string | undefined;
  if (d.focus && d.focus !== 'motors') {
    const friendly = (n: string) => n.replace(/^DSHOT/, 'DShot');
    const extra = d.focus === 'esc' && s.config ? friendly(protocolName(s.config.motorPwmProtocol)) : '';
    const bidirOff = d.focus === 'esc' && s.config && isDshot(s.config.motorPwmProtocol) && !s.config.bidir ? t('xray.bidirOff') : '';
    hotText = [partLabel(d.focus), extra, bidirOff, d.focus !== 'esc' ? focusCheck?.label : ''].filter(Boolean).join(' · ');
  }
  return {
    filmTop: `WORKSPACEFPV · ${craft} · ${fmtDate()}`,
    filmBottom: 'kV 60 · mAs 2',
    fcTitle: boardDisplayName(s.info),
    fcSub: firmwareName(s.info) + (s.info ? ` · API ${s.info.apiVersion.major}.${s.info.apiVersion.minor}` : ''),
    rxTitle: elrs ? `ELRS ${elrs}` : provider && tel ? `${provider} · ${rssiPct(tel.rssi)}%` : tel ? t('xray.signal', { pct: rssiPct(tel.rssi) }) : t('xray.noData'),
    rxSub: rxProblem?.label,
    batteryText: tel ? (cellCount ? `${cellCount}S ${fmtNum(tel.vbat, 1)} V` : t('xray.usb', { v: fmtNum(tel.vbat, 1) })) : '—',
    motors: tel ? tel.motors.slice(0, 4).map(motorPct) : null,
    hotText,
  };
}

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  const ro = new ResizeObserver(() => positionTab());
  let stage: HTMLElement | null = null;
  let renderedKey = '';
  let view: 'start' | 'scene' | '' = '';

  function positionTab() {
    if (!stage) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    const scale = Math.min(w / VIEW_W, h / VIEW_H);
    const y = (h - VIEW_H * scale) / 2 + ENTRY_Y * scale - 14;
    document.documentElement.style.setProperty('--tab-y', `${y.toFixed(1)}px`);
  }

  const progressText = () => {
    const p = ctx.bf.store.progress();
    return p ? t('bfCore.progress', { done: p.done, total: p.total }) : t('bfCore.loading');
  };
  const progressPct = () => {
    const p = ctx.bf.store.progress();
    return p ? Math.round((p.done / Math.max(1, p.total)) * 100) : 0;
  };

  /* ---------- ekran startowy ---------- */
  function renderStart(): void {
    const s = ctx.state.get();
    const busy = s.conn === 'connecting';
    const noSerial = !hasWebSerial();
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'mode.wsGreetMorning' : hr < 18 ? 'mode.wsGreetDay' : 'mode.wsGreetEvening';
    const bk = loadBackup();
    const cards = [
      bk
        ? `<div class="ws-card">${icon('download', 22)}<div class="ws-card-t"><b>${t('mode.wsBackup')}</b><span class="ws-v">${escapeHtml(bk.craft || t('common.drone'))} · ${escapeHtml(fmtDate(new Date(bk.at)))}</span></div><button class="btn ghost" data-act="backup">${t('mode.wsBackupDownload')}</button></div>`
        : '',
      `<div class="ws-card">${icon('chip', 22)}<div class="ws-card-t"><b>${t('mode.wsVersion')}</b><span class="ws-v">${escapeHtml(t('mode.wsVersionText', { version: APP_VERSION }))}</span></div></div>`,
      `<button class="ws-card" data-act="demo" ${busy ? 'disabled' : ''}>${icon('play', 22)}<span class="ws-card-t"><b>${t('mode.wsDemoCard')}</b><span class="ws-v">${t('mode.wsDemoText')}</span></span></button>`,
    ].join('');
    el.innerHTML = `
      <div class="ws-start"><div class="ws-in">
        <div class="ws-top">
          <header class="ws-head">
            <h1>${t(greet)} ${t('mode.wsSub')}</h1>
            <p>${t('start.lead')}</p>
            <div class="ws-intro">${intro('tips.warsztat.intro')}</div>
          </header>
          <img class="ws-hero" src="${heroImg}" alt="" aria-hidden="true" width="1200" height="670" decoding="async" />
        </div>
        <section class="ws-zone">
          <img class="ws-zone-img" src="${connectImg}" alt="" aria-hidden="true" width="800" height="446" decoding="async" />
          <div class="ws-zone-body">
            <h2>${t('mode.wsZoneTitle')}</h2>
            <p>${t('mode.wsZoneHelp')}</p>
            ${busy ? `<div class="bf-progress mono" role="status"><span>${progressText()}</span><i><b style="width:${progressPct()}%"></b></i></div>` : ''}
            <div class="start-btns">
              <button class="btn primary-amber" data-act="connect" ${busy || noSerial ? 'disabled' : ''}>${icon('plug', 16)}${busy ? t('common.connecting') : t('start.connect')}</button>${tip('tips.warsztat.connect')}
              <button class="btn ghost" data-act="demo" ${busy ? 'disabled' : ''}>${icon('play', 16)}${t('start.demo')}</button>${tip('tips.warsztat.demo')}
            </div>
            ${noSerial ? `<div class="start-msg warn">${t('start.noSerial')}</div>` : ''}
            ${s.error ? `<div class="start-msg err" role="alert">${escapeHtml(s.error)}</div>` : ''}
          </div>
        </section>
        <div class="ws-cards">${cards}</div>
      </div></div>`;
    stage = null;
    document.body.classList.remove('has-hot');
  }

  function emptyLabels(): XrayLabels {
    return { filmTop: '', filmBottom: '', fcTitle: '', fcSub: '', rxTitle: '', batteryText: '', motors: null };
  }

  /* ---------- scena ---------- */
  function renderScene(): void {
    const s = ctx.state.get();
    const d = ctx.diagnosis();
    const labels = buildLabels(s, d, ctx.bf.get());
    const key = JSON.stringify([d.focus, { ...labels, motors: null }, s.conn]);
    if (view !== 'scene' || !stage) {
      el.innerHTML = `<div class="stage"></div>
        <div class="scene-tips">${(
          [
            ['tips.warsztat.diagnosis', t('mode.tipDiag')],
            ['tips.warsztat.parts', t('mode.tipParts')],
            ['tips.warsztat.battery', t('mode.tipBattery')],
            ['tips.warsztat.receiver', t('mode.tipReceiver')],
            ['tips.warsztat.esc', t('mode.tipEsc')],
          ] as const
        )
          .map(([k, l]) => `<span class="st-tip">${tip(k, l)}<span>${l}</span></span>`)
          .join('')}</div>
        <div class="overlay" hidden></div>`;
      stage = el.querySelector('.stage');
      if (stage) ro.observe(stage);
      renderedKey = '';
      view = 'scene';
    }
    if (!stage) return;
    if (key !== renderedKey) {
      stage.innerHTML = renderDrone({ highlight: d.focus, labels });
      renderedKey = key;
    }
    updateMotorBars(stage, labels.motors);
    document.body.classList.toggle('has-hot', d.focus !== null);
    const overlay = el.querySelector<HTMLElement>('.overlay');
    if (overlay) {
      overlay.hidden = s.conn !== 'reconnecting';
      overlay.innerHTML = s.conn === 'reconnecting' ? `<div class="mono">${t('start.reconnecting')}</div>` : '';
    }
    positionTab();
  }

  function render(): void {
    const s = ctx.state.get();
    const wantScene = s.conn === 'connected' || s.conn === 'reconnecting';
    if (!wantScene) {
      view = 'start';
      renderedKey = '';
      renderStart();
    } else {
      if (view === 'start') view = '';
      renderScene();
    }
  }

  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'connect') void ctx.connect();
    else if (act === 'demo') void ctx.connectDemo();
    else if (act === 'backup') ctx.downloadBackup();
  });

  const offState = ctx.state.subscribe(render);
  const offBf = ctx.bf.subscribe(() => {
    const box = el.querySelector<HTMLElement>('.bf-progress');
    if (box) {
      const sp = box.querySelector('span');
      if (sp) sp.textContent = progressText();
      const b = box.querySelector<HTMLElement>('b');
      if (b) b.style.width = `${progressPct()}%`;
    } else if (view === 'scene') render();
  });
  const offTel = ctx.state.subscribeTelemetry(() => {
    if (view !== 'scene' || !stage) return;
    const tel = ctx.state.get().telemetry;
    updateMotorBars(stage, tel ? tel.motors.slice(0, 4).map(motorPct) : null);
  });
  render();

  return () => {
    offState();
    offBf();
    offTel();
    ro.disconnect();
    document.body.classList.remove('has-hot');
  };
};
