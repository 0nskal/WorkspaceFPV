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
import { mountAttitudeModel, type AttitudeModel } from './bf-setup-3d';

const K = (k: string) => `bfSetup.${k}` as Key;
const ATTITUDE: BfCommand<D.Attitude> = { code: C.ATTITUDE, decode: (p) => D.decodeAttitude(p) };

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  let magTimer: ReturnType<typeof setInterval> | null = null;
  let magLeft = 0;
  let busy = false;
  let poll: ReturnType<typeof setInterval> | null = null;

  const row = (k: string, v: string, tk?: TipKey, expert = false) => `<div class="bf-su-kv"${expert ? ' data-level="expert"' : ''}><span>${escapeHtml(k)}${tk ? ` ${tip(tk)}` : ''}</span><b class="mono">${escapeHtml(v)}</b></div>`;

  function info(): string {
    const s = ctx.state.get();
    const bf = ctx.bf.get();
    const b = bf.board;
    const rate = b?.gyroRateHz ?? 0;
    const pid = bf.advanced && rate ? `${fmtNum(rate / bf.advanced.gyroSyncDenom / bf.advanced.pidProcessDenom / 1000, 2)} kHz` : '—';
    const st = bf.status;
    const rows = [
      row(t(K('firmware')), `${bf.variant === 'BTFL' ? 'Betaflight' : bf.variant} ${bf.version}`, 'tips.setup.firmware'),
      row(t(K('api')), `1.${bf.api}`, 'tips.setup.api', true),
      row(t(K('board')), `${boardDisplayName(s.info)} (${b?.boardId ?? '—'})`, 'tips.setup.board'),
      row(t(K('target')), b?.targetName || '—', undefined, true),
      row(t(K('manufacturer')), b?.manufacturer || '—'),
      ...(bf.mcuName ? [row(t(K('mcu')), bf.mcuName, undefined, true)] : []),
      row(t(K('build')), bf.build ? `${bf.build.date} ${bf.build.time} (${bf.build.hash})` : '—', undefined, true),
      row(t(K('gyroRate')), rate ? `${fmtNum(rate / 1000, rate % 1000 ? 2 : 0)} kHz` : '—', 'tips.setup.gyroRate', true),
      row(t(K('pidLoop')), pid, 'tips.setup.pidLoop', true),
      row(t(K('cfgState')), b ? t(K(`cfg${Math.min(2, b.configState)}`)) : '—', 'tips.setup.cfgState', true),
      row(t(K('uid')), bf.uid || '—', undefined, true),
      row(t(K('craft')), bf.craftName || '—'),
      row(t(K('cpu')), st ? `${st.cpuLoad}%` : '—', 'tips.setup.cpu', true),
      row(t(K('cycle')), st ? `${st.cycleTimeUs} µs` : '—', 'tips.setup.cycle', true),
      row(t(K('i2c')), st ? String(st.i2cErrors) : '—', 'tips.setup.i2c', true),
      ...(st?.cpuTempC ? [row(t(K('temp')), `${st.cpuTempC} °C`, undefined, true)] : []),
    ];
    return rows.join('');
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
    return list
      .map(([name, bit, hw]) => {
        const on = ((bits >> bit) & 1) === 1;
        return `<div class="bf-su-sens ${on ? 'on' : ''}"><i></i><span>${escapeHtml(t(K(name)))}</span><b class="mono">${on ? t(K('found')) : t(K('missing'))}</b>${on && hw !== undefined && hw !== 255 ? `<small class="mono">${escapeHtml(t(K('hw'), { n: hw }))}</small>` : ''}</div>`;
      })
      .join('');
  }

  function arming(): string {
    const bf = ctx.bf.get();
    const st = bf.status;
    if (!st) return '';
    const flags = decodeArmFlags(st.armingFlags, bf.api, st.armingFlagCount);
    const real = flags.filter((f) => !BENIGN_ARM_FLAGS.has(f.name));
    const items = flags.map((f) => `<li class="${BENIGN_ARM_FLAGS.has(f.name) ? 'benign' : 'block'}"><b class="mono">${escapeHtml(f.name)}</b><span>${escapeHtml(armingDesc(f.name))}</span>${BENIGN_ARM_FLAGS.has(f.name) ? `<em>${escapeHtml(t(K('armNormal')))}</em>` : ''}</li>`).join('');
    return `${real.length === 0 ? `<p class="bf-su-ok">${escapeHtml(t(K('armOk')))}</p>` : ''}${items ? `<ul class="bf-su-flags">${items}</ul>` : ''}${st.rebootRequired ? `<p class="bf-note">${escapeHtml(t(K('rebootReq')))}</p>` : ''}<p class="bf-su-small">${escapeHtml(t(K('armWorkspaceFPV')))}</p>`;
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
    const btn = (act: string, label: string, text: string, cls = 'ghost', dis = false, tk?: TipKey, expert = false) => `<div class="bf-su-act"${expert ? ' data-level="expert"' : ''}><button class="btn ${cls}" data-su="${act}" ${dis ? 'disabled' : ''}>${escapeHtml(label)}</button><small>${escapeHtml(text)}${tk ? ` ${tip(tk)}` : ''}</small></div>`;
    el.innerHTML = `<div class="bf-tab" data-tab="setup">
      <header class="bf-head"><h2>${escapeHtml(t(K('title')))}</h2><button class="btn ghost bf-ask" data-su="ask">${escapeHtml(t('bfCore.askAi'))}</button></header>
      <div class="bf-body">${intro('tips.setup.intro')}<div class="bf-grid bf-su-grid">
        <section class="bf-panel"><header><span>${escapeHtml(t(K('gAttitude')))}</span><small>${escapeHtml(t(K('modelNote')))} ${tip('tips.setup.attitude')}</small></header>
          <div class="bf-su-attitude">${modelSvg()}
            <div class="bf-su-angles"><div><small>${escapeHtml(t(K('roll')))}</small><b class="mono" data-att="roll">0.0°</b></div><div><small>${escapeHtml(t(K('pitch')))}</small><b class="mono" data-att="pitch">0.0°</b></div><div><small>${escapeHtml(t(K('heading')))}</small><b class="mono" data-att="heading">0°</b></div></div>
          </div></section>
        <section class="bf-panel"><header><span>${escapeHtml(t(K('gInfo')))}</span></header><div class="bf-su-info" data-part="info">${info()}</div></section>
        <section class="bf-panel"><header><span>${escapeHtml(t(K('gSensors')))} ${tip('tips.setup.sensors')}</span></header><div class="bf-su-sensors" data-part="sensors">${sensors()}</div></section>
        <section class="bf-panel"><header><span>${escapeHtml(t(K('gArming')))} ${tip('tips.setup.arming')}</span></header><div class="bf-su-arming" data-part="arming">${arming()}</div></section>
        <section class="bf-panel"><header><span>${escapeHtml(t(K('gCal')))}</span></header><div class="bf-su-actions">
          ${needsAcc ? `<p class="bf-note">${escapeHtml(t(K('accNeeds')))}</p>` : ''}
          ${btn('acc', t(K('accBtn')), t(K('accText')), needsAcc ? 'light' : 'ghost', false, 'tips.setup.accCal')}
          ${btn('mag', t(K('magBtn')), magOn ? t(K('magText')) : t(K('magNone')), 'ghost', !magOn, 'tips.setup.magCal')}
          <p class="bf-su-small" data-mag-msg></p>
        </div></section>
        <section class="bf-panel"><header><span>${escapeHtml(t(K('gSystem')))}</span></header><div class="bf-su-actions">
          ${btn('reboot', t(K('rebootBtn')), t(K('rebootText')), 'ghost', false, 'tips.setup.reboot')}
          ${btn('dfu', t(K('dfuBtn')), t(K('dfuText')), 'ghost', false, 'tips.setup.dfu', true)}
          ${caps & CAP.FLASH_BOOTLOADER ? btn('flashboot', t(K('flashBootBtn')), t(K('flashBootText')), 'ghost', false, 'tips.setup.flashBoot', true) : ''}
          ${btn('msc', t(K('mscBtn')), t(K('mscText')), 'ghost', false, 'tips.setup.msc', true)}
          ${btn('reset', t(K('resetBtn')), t(K('resetText')), 'ghost danger', false, 'tips.setup.reset')}
        </div></section>
      </div></div></div>`;
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
      const lines = [info().replace(/<div class="bf-su-kv"[^>]*><span>(.*?)<\/span><b class="mono">(.*?)<\/b><\/div>/g, (_m, k: string, v: string) => '- ' + k.replace(/<[^>]*>/g, '').trim() + ': ' + v + '\n').replace(/&amp;/g, '&')];
      ctx.askAi(`${t('bfCore.askPrompt', { tab: t(K('title')) })}\n${lines.join('')}`);
    }
  });

  let lastKey = '';
  const onChange = () => {
    const s = ctx.state.get();
    const key = `${s.conn}|${ctx.bf.store.isReady()}|${ctx.bf.get().supported}|${ctx.bf.get().status?.sensors ?? ''}`;
    if (key !== lastKey || !el.querySelector('.bf-su-grid')) {
      lastKey = key;
      if (!busy) render();
      return;
    }
    refreshParts();
  };
  const offA = ctx.state.subscribe(onChange);
  const offB = ctx.bf.subscribe(onChange);
  onChange();
  if (ctx.state.get().conn === 'connected') void ctx.bf.refresh(['status', 'ident', 'sensors']);

  return () => {
    offA();
    offB();
    stopPoll();
    drop3d();
    if (magTimer) clearInterval(magTimer);
  };
};
