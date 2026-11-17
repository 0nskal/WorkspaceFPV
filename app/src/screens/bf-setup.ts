/** Setup tab: firmware/board info, live attitude model, sensors, accelerometer/magnetometer calibration, arming flags, reboot and reset. */
import { decodeArmFlags, BENIGN_ARM_FLAGS } from '../bf/arming';
import { C } from '../bf/codes';
import * as D from '../bf/decode';
import { CAP } from '../bf/decode';
import type { BfCommand } from '../bf/store';
import type { AppContext, ScreenMount } from '../context';
import { armingDesc } from '../fc/diagnose';
import { boardDisplayName } from '../fc/board';
import { fmtNum, t, type Key } from '../i18n';
import { escapeHtml } from '../ui/dom';
import { intro, tip, type TipKey } from '../ui/tip';
import { modelSvg, updateModel } from './bf-setup-model';
import './bf-setup.css';
import { mountAttitudeModel, type AttitudeModel } from './bf-setup-3d';

const K = (k: string) => `bfSetup.${k}` as Key;
const ATTITUDE: BfCommand<D.Attitude> = { code: C.ATTITUDE, decode: (p) => D.decodeAttitude(p) };

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  let magTimer: ReturnType<typeof setInterval> | null = null;
  let magLeft = 0;
  let busy = false;
  let poll: ReturnType<typeof setInterval> | null = null;

  interface Kv {
    k: string;
    v: string;
    tk?: TipKey;
    expert?: boolean;
    cls?: 'ok' | 'warn' | 'bad';
  }
  const kvHtml = (rows: Kv[]) => `<dl class="v1-kv">${rows.map((r) => `<dt${r.expert ? ' data-level="expert"' : ''}>${escapeHtml(r.k)}${r.tk ? ` ${tip(r.tk)}` : ''}</dt><dd${r.expert ? ' data-level="expert"' : ''}${r.cls ? ` class="${r.cls}"` : ''}>${escapeHtml(r.v)}</dd>`).join('')}</dl>`;

  /** Live numbers panel (battery, current, RSSI, CPU...). */
  function systemRows(): Kv[] {
    const bf = ctx.bf.get();
    const tel = ctx.state.get().telemetry;
    const st = bf.status;
    const usb = !tel || tel.vbat < 5;
    const flags = st ? decodeArmFlags(st.armingFlags, bf.api, st.armingFlagCount).filter((f) => !BENIGN_ARM_FLAGS.has(f.name)) : [];
    return [
      { k: t(K('armFlags')), v: st ? (flags.length ? flags.map((f) => f.name).join(', ') : t(K('armNone'))) : '—', tk: 'tips.setup.arming', cls: st ? (flags.length ? 'bad' : 'ok') : undefined },
      { k: t(K('vbat')), v: usb ? '—' : `${fmtNum(tel.vbat, 2)} V` },
      { k: t(K('mahUsed')), v: tel ? `${Math.round(tel.mah)} mAh` : '—' },
      { k: t(K('amps')), v: tel ? `${fmtNum(tel.amperage, 2)} A` : '—' },
      { k: t(K('rssi')), v: tel && tel.rssi > 0 ? `${Math.round((tel.rssi / 1023) * 100)} %` : '—' },
      { k: t(K('mcu')), v: bf.mcuName || '—', expert: true },
      { k: t(K('cpu')), v: st ? `${st.cpuLoad}%` : '—', tk: 'tips.setup.cpu', expert: true, cls: st && st.cpuLoad > 75 ? 'warn' : undefined },
      { k: t(K('cycle')), v: st ? `${st.cycleTimeUs} µs` : '—', tk: 'tips.setup.cycle', expert: true },
      { k: t(K('i2c')), v: st ? String(st.i2cErrors) : '—', tk: 'tips.setup.i2c', expert: true, cls: st && st.i2cErrors > 0 ? 'warn' : undefined },
      ...(st?.cpuTempC ? [{ k: t(K('temp')), v: `${st.cpuTempC} °C`, expert: true }] : []),
    ];
  }

  function firmwareRows(): Kv[] {
    const s = ctx.state.get();
    const bf = ctx.bf.get();
    const b = bf.board;
    const rate = b?.gyroRateHz ?? 0;
    const pid = bf.advanced && rate ? `${fmtNum(rate / bf.advanced.gyroSyncDenom / bf.advanced.pidProcessDenom / 1000, 2)} kHz` : '—';
    return [
      { k: t(K('board')), v: `${boardDisplayName(s.info)} (${b?.boardId ?? '—'})`, tk: 'tips.setup.board' },
      { k: t(K('firmware')), v: `${bf.variant === 'BTFL' ? 'Betaflight' : bf.variant} ${bf.version}`, tk: 'tips.setup.firmware' },
      { k: t(K('api')), v: `1.${bf.api}`, tk: 'tips.setup.api', expert: true },
      { k: t(K('target')), v: b?.targetName || '—', expert: true },
      { k: t(K('manufacturer')), v: b?.manufacturer || '—' },
      { k: t(K('build')), v: bf.build ? `${bf.build.date} ${bf.build.time} (${bf.build.hash})` : '—', expert: true },
      { k: t(K('gyroRate')), v: rate ? `${fmtNum(rate / 1000, rate % 1000 ? 2 : 0)} kHz` : '—', tk: 'tips.setup.gyroRate', expert: true },
      { k: t(K('pidLoop')), v: pid, tk: 'tips.setup.pidLoop', expert: true },
      { k: t(K('cfgState')), v: b ? t(K(`cfg${Math.min(2, b.configState)}`)) : '—', tk: 'tips.setup.cfgState', expert: true },
      { k: t(K('uid')), v: bf.uid || '—', expert: true },
      { k: t(K('craft')), v: bf.craftName || '—' },
    ];
  }

  function info(): string {
    return kvHtml(firmwareRows());
  }
  function system(): string {
    return kvHtml(systemRows());
  }

  function sensors(): string {
    const bf = ctx.bf.get();
    const bits = bf.status?.sensors ?? 0;
    const act = bf.sensorActive;
    const list: Array<[string, number, number | undefined]> = [
      ['acc', 0, act?.acc],
      ['baro', 1, act?.baro],
      ['mag', 2, act?.mag],
      ['gps', 3, undefined],
      ['range', 4, act?.rangefinder],
      ['gyro', 5, act?.gyro],
    ];
    return `<dl class="v1-kv">${list
      .map(([name, bit, hw]) => {
        const on = ((bits >> bit) & 1) === 1;
        const hwTxt = on && hw !== undefined && hw !== 255 ? ` (${t(K('hw'), { n: hw })})` : '';
        return `<dt>${escapeHtml(t(K(name)))}</dt><dd class="${on ? 'ok' : 'dim'}">${escapeHtml(on ? t(K('found')) : t(K('missing')))}${escapeHtml(hwTxt)}</dd>`;
      })
      .join('')}</dl>`;
  }

  function arming(): string {
    const bf = ctx.bf.get();
    const st = bf.status;
    if (!st) return '';
    const flags = decodeArmFlags(st.armingFlags, bf.api, st.armingFlagCount);
    const real = flags.filter((f) => !BENIGN_ARM_FLAGS.has(f.name));
    const items = flags.map((f) => `<li class="${BENIGN_ARM_FLAGS.has(f.name) ? 'benign' : 'block'}"><b class="mono">${escapeHtml(f.name)}</b><span>${escapeHtml(armingDesc(f.name))}${BENIGN_ARM_FLAGS.has(f.name) ? ` <em>(${escapeHtml(t(K('armNormal')))})</em>` : ''}</span></li>`).join('');
    return `${real.length === 0 ? `<p class="su-ok">${escapeHtml(t(K('armOk')))}</p>` : ''}${items ? `<ul class="su-flags">${items}</ul>` : ''}${st.rebootRequired ? `<div class="v1-note">${escapeHtml(t(K('rebootReq')))}</div>` : ''}<p class="su-small">${escapeHtml(t(K('armWorkspaceFPV')))}</p>`;
  }

  /** 3D quad (three.js, loaded on demand); null while loading or when WebGL is missing (the SVG drawing stays). */
  let model3d: AttitudeModel | null = null;
  let model3dGen = 0;
  function drop3d(): void {
    model3dGen++;
    model3d?.destroy();
    model3d = null;
  }
  function mount3d(): void {
    const host = el.querySelector<HTMLElement>('.bf-su-attitude');
    if (!host) return;
    const gen = ++model3dGen;
    void mountAttitudeModel(host).then((m) => {
      if (!m) return;
      if (gen !== model3dGen || !host.isConnected) return m.destroy();
      model3d = m;
      host.classList.add('has-3d');
    });
  }

  function render(): void {
    const s = ctx.state.get();
    stopPoll();
    drop3d();
    if (s.conn !== 'connected' || !ctx.bf.store.isReady()) {
      el.innerHTML = `<div class="bf-tab"><header class="bf-head"><h2>${escapeHtml(t(K('title')))}</h2></header><div class="bf-empty"><p>${escapeHtml(t(s.conn === 'connected' ? 'bfCore.loading' : 'bfCore.needConnect'))}</p>${s.conn === 'disconnected' ? `<button class="btn light" data-su="demo">${escapeHtml(t('start.demo'))}</button>` : ''}</div></div>`;
      return;
    }
    const bf = ctx.bf.get();
    if (!bf.supported) {
      el.innerHTML = `<div class="bf-tab"><header class="bf-head"><h2>${escapeHtml(t(K('title')))}</h2></header><div class="bf-empty"><p>${escapeHtml(t(K('notBtfl')))}</p></div></div>`;
      return;
    }
    const caps = bf.board?.capabilities ?? 0;
    const magOn = (((bf.status?.sensors ?? 0) >> 2) & 1) === 1;
    const needsAcc = ((bf.board?.problems ?? 0) & 1) === 1 || ((bf.status?.armingFlags ?? 0) & (1 << 23)) !== 0;
    const btn = (act: string, label: string, text: string, cls = 'ghost', dis = false, tk?: TipKey, expert = false) => `<div class="su-act"${expert ? ' data-level="expert"' : ''}><button class="btn ${cls}" data-su="${act}" ${dis ? 'disabled' : ''}>${escapeHtml(label)}</button><span>${escapeHtml(text)}${tk ? ` ${tip(tk)}` : ''}</span></div>`;
    el.innerHTML = `<div class="bf-tab su" data-tab="setup">
      <header class="bf-head"><h2>${escapeHtml(t(K('title')))}</h2><button class="btn ghost bf-ask" data-su="ask">${escapeHtml(t('bfCore.askAi'))}</button></header>
      <div class="bf-body">${intro('tips.setup.intro')}
        <section class="bf-panel su-model"><header><span class="bf-legend">${escapeHtml(t(K('gAttitude')))} ${tip('tips.setup.attitude')}</span><small>${escapeHtml(t(K('modelNote')))}</small></header>
          <div class="bf-su-attitude">${modelSvg()}
            <div class="su-angles"><div><small>${escapeHtml(t(K('yaw')))}</small><b class="mono" data-att="heading">0°</b></div><div><small>${escapeHtml(t(K('pitch')))}</small><b class="mono" data-att="pitch">0.0°</b></div><div><small>${escapeHtml(t(K('roll')))}</small><b class="mono" data-att="roll">0.0°</b></div></div>
            <div class="su-inst" aria-hidden="true">
              <svg viewBox="-50 -50 100 100" class="su-horizon"><defs><clipPath id="su-hclip"><circle r="46"/></clipPath></defs><g clip-path="url(#su-hclip)"><g data-horizon><rect x="-120" y="-160" width="240" height="160" fill="#1d3a52"/><rect x="-120" y="0" width="240" height="160" fill="#3a2a17"/><path d="M-120 0H120" stroke="#dceff8" stroke-width="1.5"/></g></g><circle r="46" fill="none" stroke="#5b7385" stroke-width="2"/><path d="M-22 0h14M8 0h14M0 -2v4" stroke="#e0a82e" stroke-width="2.4"/></svg>
              <svg viewBox="-50 -50 100 100" class="su-compass"><circle r="46" fill="#0b141c" stroke="#5b7385" stroke-width="2"/><g data-compass><text y="-30" text-anchor="middle" font-size="12" fill="#ff4a2e" font-weight="700">N</text><text x="30" y="4" text-anchor="middle" font-size="10" fill="#8fa9b8">E</text><text y="38" text-anchor="middle" font-size="10" fill="#8fa9b8">S</text><text x="-30" y="4" text-anchor="middle" font-size="10" fill="#8fa9b8">W</text></g><path d="M0 -44l5 10h-10z" fill="#e0a82e"/></svg>
            </div>
          </div></section>
        <div class="v1-cols su-cols" data-su-cols>
          <section class="bf-panel"><header><span class="bf-legend">${escapeHtml(t(K('gSystemInfo')))}</span></header><div data-part="system">${system()}</div></section>
          <section class="bf-panel"><header><span class="bf-legend">${escapeHtml(t(K('gSensors')))} ${tip('tips.setup.sensors')}</span></header><div data-part="sensors">${sensors()}</div></section>
          <section class="bf-panel"><header><span class="bf-legend">${escapeHtml(t(K('gInfo')))}</span></header><div data-part="info">${info()}</div>
            <div class="su-btns">${btn('dfu', t(K('dfuBtn')), t(K('dfuText')), 'amber', false, 'tips.setup.dfu', true)}${btn('reset', t(K('resetBtn')), t(K('resetText')), 'danger', false, 'tips.setup.reset')}</div></section>
          <section class="bf-panel"><header><span class="bf-legend">${escapeHtml(t(K('gCal')))}</span></header><div class="su-btns">
            ${needsAcc ? `<div class="v1-warn">${escapeHtml(t(K('accNeeds')))}</div>` : ''}
            ${btn('acc', t(K('accBtn')), t(K('accText')), needsAcc ? 'amber' : 'ghost', false, 'tips.setup.accCal')}
            ${btn('mag', t(K('magBtn')), magOn ? t(K('magText')) : t(K('magNone')), 'ghost', !magOn, 'tips.setup.magCal')}
            <p class="su-small" data-mag-msg></p>
            ${btn('reboot', t(K('rebootBtn')), t(K('rebootText')), 'ghost', false, 'tips.setup.reboot')}
            ${caps & CAP.FLASH_BOOTLOADER ? btn('flashboot', t(K('flashBootBtn')), t(K('flashBootText')), 'ghost', false, 'tips.setup.flashBoot', true) : ''}
            ${btn('msc', t(K('mscBtn')), t(K('mscText')), 'ghost', false, 'tips.setup.msc', true)}
          </div></section>
        </div>
        <section class="bf-panel su-arming"><header><span class="bf-legend">${escapeHtml(t(K('gArming')))} ${tip('tips.setup.arming')}</span></header><div data-part="arming">${arming()}</div></section>
      </div></div>`;
    mount3d();
    startPoll();
  }

  /** Cheap partial refresh of the status-driven parts (sensors, arming, info) without touching the model or buttons. */
  function refreshParts(): void {
    const set = (part: string, html: string) => {
      const e = el.querySelector<HTMLElement>(`[data-part="${part}"]`);
      if (e && e.innerHTML !== html) e.innerHTML = html;
    };
    set('info', info());
    set('system', system());
    set('sensors', sensors());
    set('arming', arming());
  }

  function startPoll(): void {
    const svg = el.querySelector<SVGElement>('.bf-su-model');
    if (!svg) return;
    let inflight = false;
    poll = setInterval(() => {
      if (inflight || ctx.link()?.busy) return;
      inflight = true;
      void ctx.bf
        .read(ATTITUDE)
        .then((a) => {
          if (!a || !el.isConnected) return;
          if (model3d) model3d.set(a.rollDeg, a.pitchDeg, a.headingDeg);
          else updateModel(svg, a.rollDeg, a.pitchDeg, a.headingDeg);
          const set = (k: string, v: string) => {
            const e = el.querySelector<HTMLElement>(`[data-att="${k}"]`);
            if (e) e.textContent = v;
          };
          const hz = el.querySelector<SVGGElement>('[data-horizon]');
          if (hz) hz.setAttribute('transform', `rotate(${(-a.rollDeg).toFixed(1)}) translate(0 ${(a.pitchDeg * 0.6).toFixed(1)})`);
          const cp = el.querySelector<SVGGElement>('[data-compass]');
          if (cp) cp.setAttribute('transform', `rotate(${(-a.headingDeg).toFixed(1)})`);
          set('roll', `${fmtNum(a.rollDeg, 1)}°`);
          set('pitch', `${fmtNum(a.pitchDeg, 1)}°`);
          set('heading', `${Math.round(a.headingDeg)}°`);
        })
        .finally(() => (inflight = false));
    }, 100);
  }
  function stopPoll(): void {
    if (poll) clearInterval(poll);
    poll = null;
  }

  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  async function calibrateAcc(): Promise<void> {
    const ok = await ctx.confirm({ title: t(K('accTitle')), body: `<p>${escapeHtml(t(K('accBody')))}</p>`, confirmText: t(K('accBtn')) });
    if (!ok || busy) return;
    busy = true;
    try {
      await ctx.bf.send(C.ACC_CALIBRATION, undefined, 2000);
      ctx.toast(t(K('accStarted')), 'info');
      await wait(2500);
      await ctx.bf.refresh(['status', 'ident']);
      ctx.toast(t(K('accDone')), 'ok');
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      busy = false;
      render();
    }
  }

  async function calibrateMag(): Promise<void> {
    if (busy) return;
    try {
      await ctx.bf.send(C.MAG_CALIBRATION, undefined, 2000);
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : String(e), 'error');
      return;
    }
    busy = true;
    magLeft = 30;
    const msg = () => el.querySelector<HTMLElement>('[data-mag-msg]');
    magTimer = setInterval(() => {
      magLeft--;
      const m = msg();
      if (m) m.textContent = magLeft > 0 ? t(K('magCount'), { n: magLeft }) : t(K('magDone'));
      if (magLeft <= 0) {
        if (magTimer) clearInterval(magTimer);
        magTimer = null;
        busy = false;
      }
    }, 1000);
    const m = msg();
    if (m) m.textContent = t(K('magCount'), { n: magLeft });
  }

  async function reboot(kind: 'firmware' | 'bootloader' | 'flashBootloader' | 'msc'): Promise<void> {
    const key = { firmware: 'confirm', bootloader: 'dfu', flashBootloader: 'dfu', msc: 'msc' }[kind];
    const ok = await ctx.confirm({ title: t(K(`${key}Title`)), body: `<p>${escapeHtml(t(K(`${key}Body`)))}</p>`, danger: kind !== 'firmware' });
    if (!ok) return;
    const res = await ctx.bf.rebootTo(kind);
    if (!res.ok) ctx.toast(res.error ?? t('bfCore.saveFail'), 'error');
    else ctx.toast(res.demo ? t(K('demoNotSent')) : t(K('sent')), res.demo ? 'info' : 'ok');
  }

  async function resetAll(): Promise<void> {
    const ok = await ctx.confirm({ title: t(K('resetTitle')), body: `<p class="warn-note">${escapeHtml(t(K('resetBody')))}</p>`, confirmText: t(K('resetConfirm')), danger: true, requireText: t(K('resetType')) });
    if (!ok) return;
    ctx.toast(t(K('resetting')), 'info');
    const res = await ctx.bf.resetConfig();
    ctx.toast(res.ok ? t(K('resetDone')) : (res.error ?? t('bfCore.saveFail')), res.ok ? 'ok' : 'error');
  }

  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-su]')?.dataset.su;
    if (act === 'demo') void ctx.connectDemo();
    else if (act === 'acc') void calibrateAcc();
    else if (act === 'mag') void calibrateMag();
    else if (act === 'reboot') void reboot('firmware');
    else if (act === 'dfu') void reboot('bootloader');
    else if (act === 'flashboot') void reboot('flashBootloader');
    else if (act === 'msc') void reboot('msc');
    else if (act === 'reset') void resetAll();
    else if (act === 'ask') {
      const lines = [...systemRows(), ...firmwareRows()].map((r) => `- ${r.k}: ${r.v}
`);
      ctx.askAi(`${t('bfCore.askPrompt', { tab: t(K('title')) })}\n${lines.join('')}`);
    }
  });

  let lastKey = '';
  const onChange = () => {
    const s = ctx.state.get();
    const key = `${s.conn}|${ctx.bf.store.isReady()}|${ctx.bf.get().supported}|${ctx.bf.get().status?.sensors ?? ''}`;
    if (key !== lastKey || !el.querySelector('[data-su-cols]')) {
      lastKey = key;
      if (!busy) render();
      return;
    }
    refreshParts();
  };
  const offA = ctx.state.subscribe(onChange);
  const offB = ctx.bf.subscribe(onChange);
  const offT = ctx.state.subscribeTelemetry(() => {
    if (el.querySelector('[data-su-cols]')) refreshParts();
  });
  onChange();
  if (ctx.state.get().conn === 'connected') void ctx.bf.refresh(['status', 'ident', 'sensors']);

  return () => {
    offA();
    offB();
    offT();
    stopPoll();
    drop3d();
    if (magTimer) clearInterval(magTimer);
  };
};
