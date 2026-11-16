/**
 * Receiver tab: provider, channel map, RSSI channel, deadband, RC smoothing, plus live channel bars (MSP_RC, 10 Hz),
 * a 2D stick view and ELRS link quality from channels 15/16. Edits stay local until "Save".
 */
import type { AppContext, ScreenMount } from '../context';
import { createIo, CMD } from '../bf/io';
import type { Values } from '../bf/fieldtable';
import {
  channelName, decodeRc, decodeRssiChannel, decodeRxConfig, decodeRcDeadband, decodeRxMap, elrsLink, encodeRcDeadband, encodeRssiChannel, encodeRxConfig, encodeRxMap,
  mapToString, PROVIDER_CRSF, RX_MAP_PRESETS, RX_PROVIDERS, sticksFromRc, stringToMap,
} from '../bf/receiver';
import { escapeHtml } from '../ui/dom';
import { fmtNum, t, type Key } from '../i18n';
import { barHtml, bindForm, disconnectedHtml, errMsg, errorHtml, fieldHtml, Form, noticeHtml, sectionHtml, updateBar, type FieldSpec } from './bf-tuning-ui';

const k = (x: string) => `bfReceiver.${x}` as Key;
const CH_MIN = 1000;
const CH_MAX = 2000;

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  const io = createIo(ctx);
  const form = new Form();
  const root = document.createElement('div');
  root.className = 'bf-tuning bf-receiver';
  el.appendChild(root);

  let disposed = false;
  let phase: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  let error = '';
  let busy = false;
  let loadedLink: unknown = null;
  let rxRaw: Uint8Array = new Uint8Array(0);
  let dbRaw: Uint8Array = new Uint8Array(0);
  let mapRaw: Uint8Array = Uint8Array.from([0, 1, 3, 2, 4, 5, 6, 7]);
  let hasDb = false;
  let rc: number[] = [];
  let stale = 0;
  let poll: ReturnType<typeof setInterval> | null = null;
  let inflight = false;

  const api = () => io.apiMinor();
  const map = (): number[] => Array.from({ length: 8 }, (_, i) => form.get('map', `m${i}`));
  const tipFor = (key: string) => {
    const v = t(k(`tips.${key}`));
    return v === k(`tips.${key}`) ? undefined : v;
  };
  const s = (g: string, key: string, label: string, min: number, max: number, extra: Partial<FieldSpec> = {}): FieldSpec => ({ g, k: key, label, min, max, tip: tipFor(key), ...extra });

  function specs(): FieldSpec[] {
    const cur = form.get('rx', 'provider');
    const provs = Object.entries(RX_PROVIDERS).map(([v, label]) => ({ v: Number(v), label }));
    if (!(cur in RX_PROVIDERS)) provs.push({ v: cur, label: `#${cur}` });
    const rssiOpts = [{ v: 0, label: t('bfReceiver.rssiOff') }];
    for (let ch = 5; ch <= 18; ch++) rssiOpts.push({ v: ch, label: t('bfReceiver.channelN', { n: ch, aux: ch - 4 }) });
    const a = api();
    return [
      s('rx', 'provider', t('bfReceiver.provider'), 0, 255, { options: provs }),
      s('rssi', 'ch', t('bfReceiver.rssiChannel'), 0, 18, { options: rssiOpts }),
      s('rx', 'minCheck', t('bfReceiver.minCheck'), 750, 1500, { unit: 'µs' }),
      s('rx', 'midRc', t('bfReceiver.midRc'), 1400, 1600, { unit: 'µs' }),
      s('rx', 'maxCheck', t('bfReceiver.maxCheck'), 1500, 2250, { unit: 'µs' }),
      s('db', 'deadband', t('bfReceiver.deadband'), 0, 32, { unit: 'µs' }),
      s('db', 'yawDeadband', t('bfReceiver.yawDeadband'), 0, 100, { unit: 'µs' }),
      s('rx', 'smoothMode', t('bfReceiver.smoothMode'), 0, 1, { options: [{ v: 0, label: t('common.off') }, { v: 1, label: t('common.on') }] }),
      s('rx', 'smoothSetpointCutoff', t('bfReceiver.smoothSetpoint'), 0, 255, { unit: 'Hz' }),
      a >= 47 ? s('rx', 'smoothThrottleCutoff', t('bfReceiver.smoothThrottle'), 0, 255, { unit: 'Hz' }) : s('rx', 'smoothFeedforwardCutoff', t('bfReceiver.smoothFf'), 0, 255, { unit: 'Hz' }),
      s('rx', 'smoothAutoFactor', t('bfReceiver.smoothFactor'), 1, 250),
      ...(a >= 47 ? [s('rx', 'smoothAutoFactorThrottle', t('bfReceiver.smoothFactorThr'), 1, 250)] : []),
    ];
  }
  const spec = (key: string, g = 'rx') => specs().find((x) => x.g === g && x.k === key)!;

  /* ---------------- load / save ---------------- */
  async function load(): Promise<void> {
    if (!io.connected()) {
      phase = 'idle';
      render();
      return;
    }
    phase = 'loading';
    render();
    const a = api();
    try {
      const rx = decodeRxConfig(await io.read(CMD.RX_CONFIG), a);
      rxRaw = rx.raw;
      form.load('rx', rx.values);
      mapRaw = (await io.tryRead(CMD.RX_MAP)) ?? mapRaw;
      const mv: Values = {};
      decodeRxMap(mapRaw).forEach((v, i) => (mv[`m${i}`] = v));
      form.load('map', mv);
      const db = await io.tryRead(CMD.RC_DEADBAND);
      hasDb = !!db;
      dbRaw = db ?? new Uint8Array(0);
      form.load('db', db ? decodeRcDeadband(db, a).values : {});
      const rs = await io.tryRead(CMD.RSSI_CONFIG);
      form.load('rssi', rs ? { ch: decodeRssiChannel(rs) } : {});
      const live = await io.tryRead(CMD.RC);
      rc = live ? decodeRc(live) : [];
      phase = 'ready';
    } catch (e) {
      phase = 'error';
      error = errMsg(e);
    }
    loadedLink = ctx.link();
    if (!disposed) render();
  }

  const needsReboot = () => form.isChanged('rx', 'provider');

  async function save(): Promise<void> {
    if (busy || !form.count()) return;
    busy = true;
    updateBar(root, form.count(), { busy });
    const a = api();
    try {
      if (form.groupChanged('rx')) await io.write(CMD.SET_RX_CONFIG, encodeRxConfig(rxRaw, form.cur.rx!, a));
      if (form.groupChanged('map')) await io.write(CMD.SET_RX_MAP, encodeRxMap(map(), mapRaw));
      if (hasDb && form.groupChanged('db')) await io.write(CMD.SET_RC_DEADBAND, encodeRcDeadband(dbRaw, form.cur.db!, a));
      if (form.groupChanged('rssi')) await io.write(CMD.SET_RSSI_CONFIG, encodeRssiChannel(form.get('rssi', 'ch')));
      const reboot = needsReboot();
      await io.save({ reboot });
      ctx.toast(reboot ? t('bfReceiver.savedReboot') : t('bfTuning.common.saved'), 'ok');
      busy = false;
      if (reboot) {
        form.commit();
        updateBar(root, 0, {});
      } else await load();
    } catch (e) {
      busy = false;
      ctx.toast(t('bfTuning.common.saveFail', { msg: errMsg(e) }), 'error');
      updateBar(root, form.count(), { busy, reboot: needsReboot() });
    }
  }

  /* ---------------- live view ---------------- */
  const norm = (us: number) => Math.max(0, Math.min(1, (us - CH_MIN) / (CH_MAX - CH_MIN)));

  function stickSvg(label: string, xKey: string, yKey: string): string {
    return `<figure class="bf-receiver-stick"><svg viewBox="-60 -60 120 120" role="img" aria-label="${escapeHtml(label)}">
      <rect x="-56" y="-56" width="112" height="112" fill="none" stroke="#DCEFF8" stroke-opacity=".5"/>
      <path d="M-56 0H56M0 -56V56" stroke="#DCEFF8" stroke-opacity=".15"/>
      <circle cx="0" cy="0" r="28" fill="none" stroke="#DCEFF8" stroke-opacity=".12"/>
      <circle data-dot="${xKey}${yKey}" cx="0" cy="0" r="5" fill="#FF4A2E"/></svg><figcaption class="mono">${escapeHtml(label)}</figcaption></figure>`;
  }

  function barsHtml(): string {
    const m = map();
    const prov = form.get('rx', 'provider');
    const link = elrsLink(rc, prov);
    const rssiCh = form.get('rssi', 'ch');
    return rc
      .map((us, i) => {
        const name = link && i === 14 ? 'LQ' : link && i === 15 ? 'RSSI' : channelName(i, m);
        const tag = rssiCh === i + 1 ? `<em class="mono">RSSI</em>` : '';
        return `<div class="bf-receiver-ch" data-ch="${i}"><span class="n mono">CH${i + 1}</span><span class="nm">${escapeHtml(name)}${tag}</span><span class="bar"><i style="width:${(norm(us) * 100).toFixed(1)}%"></i><b></b></span><span class="us mono">${us}</span></div>`;
      })
      .join('');
  }

  function linkHtml(): string {
    const prov = form.get('rx', 'provider');
    const link = elrsLink(rc, prov);
    if (prov !== PROVIDER_CRSF) return `<div class="bf-receiver-lq dim">${t('bfReceiver.lqNotCrsf')}</div>`;
    if (!link) return `<div class="bf-receiver-lq dim">${t('bfReceiver.lqNone')}</div>`;
    return `<div class="bf-receiver-lq"><div class="bf-tuning-k"><div class="l mono">${t('bfReceiver.lq')}</div><div class="v">${fmtNum(link.lq, 0)}<small>%</small></div></div><div class="bf-tuning-k"><div class="l mono">${t('bfReceiver.rssiDbm')}</div><div class="v">~${fmtNum(link.rssiDbm, 0)}<small>dBm</small></div></div></div><p class="bf-tuning-hint">${t('bfReceiver.lqNote')}</p>`;
  }

  function updateLive(): void {
    const m = map();
    const mid = form.get('rx', 'midRc') || 1500;
    const sticks = sticksFromRc(rc, m, mid);
    const dot = (id: string, x: number, y: number) => {
      const d = root.querySelector<SVGCircleElement>(`[data-dot="${id}"]`);
      d?.setAttribute('cx', String(Math.round(x * 52)));
      d?.setAttribute('cy', String(Math.round(-y * 52)));
    };
    dot('yawthr', sticks.yaw, sticks.throttle * 2 - 1);
    dot('rollpitch', sticks.roll, sticks.pitch);
    const bars = root.querySelectorAll<HTMLElement>('[data-ch]');
    if (bars.length !== rc.length) {
      const wrap = root.querySelector('[data-bars]');
      if (wrap) wrap.innerHTML = barsHtml();
    } else {
      bars.forEach((b, i) => {
        (b.querySelector('i') as HTMLElement).style.width = `${(norm(rc[i]!) * 100).toFixed(1)}%`;
        (b.querySelector('.us') as HTMLElement).textContent = String(rc[i]);
      });
    }
    const lq = root.querySelector('[data-link]');
    if (lq) lq.innerHTML = linkHtml();
    root.classList.toggle('bf-receiver-stale', stale >= 3);
  }

  function startPoll(): void {
    if (poll) return;
    poll = setInterval(() => {
      if (inflight || disposed || phase !== 'ready' || !io.connected() || ctx.link()?.busy) return;
      inflight = true;
      io.read(CMD.RC)
        .then((p) => {
          rc = decodeRc(p);
          stale = 0;
          if (!disposed) updateLive();
        })
        .catch(() => {
          stale++;
          if (!disposed) updateLive();
        })
        .finally(() => (inflight = false));
    }, 100);
  }

  /* ---------------- view ---------------- */
  function render(): void {
    if (disposed) return;
    const top = root.scrollTop;
    if (!io.connected() || phase === 'idle') {
      root.innerHTML = disconnectedHtml();
      return;
    }
    if (phase === 'loading') {
      root.innerHTML = `<div class="bf-tuning-empty"><div class="bf-tuning-film mono">${t('bfTuning.common.film')}</div><h1>${t('bfTuning.common.loading')}</h1></div>`;
      return;
    }
    if (phase === 'error') {
      root.innerHTML = errorHtml(error);
      return;
    }
    const f = (key: string, g = 'rx') => fieldHtml(form, spec(key, g));
    const cur = mapToString(map());
    const preset = RX_MAP_PRESETS.includes(cur) ? cur : 'custom';
    const mapChanged = form.groupChanged('map');
    const mapSel = `<div class="bf-tuning-f${mapChanged ? ' chg' : ''}"><span class="bf-tuning-lb" title="${escapeHtml(t('bfReceiver.tips.map'))}">${t('bfReceiver.map')}</span><span class="bf-tuning-c"><select data-preset aria-label="${escapeHtml(t('bfReceiver.map'))}">${RX_MAP_PRESETS.map((p) => `<option value="${p}"${p === preset ? ' selected' : ''}>${p.slice(0, 4)}</option>`).join('')}${preset === 'custom' ? `<option value="custom" selected>${escapeHtml(cur)}</option>` : ''}</select></span></div>`;
    const smoothKeys = ['smoothMode', 'smoothSetpointCutoff', api() >= 47 ? 'smoothThrottleCutoff' : 'smoothFeedforwardCutoff', 'smoothAutoFactor', ...(api() >= 47 ? ['smoothAutoFactorThrottle'] : [])];
    const prov = form.get('rx', 'provider');
    root.innerHTML = `<div class="bf-tuning-head"><div class="bf-tuning-title mono"><span class="bf-tuning-sq"></span>${t('bfReceiver.tab')}</div><span class="bf-tuning-pnote dim">${t('bfReceiver.note')}</span></div>
      <div class="bf-tuning-body"><div class="bf-tuning-rates">
        <div class="bf-tuning-rcol">
          ${sectionHtml(t('bfReceiver.capSetup'), `${prov === 0 ? noticeHtml('warn', t('bfReceiver.noProvider')) : ''}<div class="bf-tuning-grid">${f('provider')}${mapSel}${f('ch', 'rssi')}</div>`, needsReboot() ? t('bfReceiver.rebootNeeded') : '')}
          ${sectionHtml(t('bfReceiver.capSticks'), `<div class="bf-tuning-grid">${f('minCheck')}${f('midRc')}${f('maxCheck')}${hasDb ? `${f('deadband', 'db')}${f('yawDeadband', 'db')}` : ''}</div>`)}
          ${sectionHtml(t('bfReceiver.capSmooth'), `<div class="bf-tuning-grid">${smoothKeys.map((x) => f(x)).join('')}</div>`, t('bfReceiver.smoothNote'))}
        </div>
        <div class="bf-tuning-rcol">
          ${sectionHtml(t('bfReceiver.capLive'), `<div class="bf-receiver-live"><div class="bf-receiver-sticks">${stickSvg(`${t('bfReceiver.yaw')} / ${t('bfReceiver.throttle')}`, 'yaw', 'thr')}${stickSvg(`${t('bfReceiver.roll')} / ${t('bfReceiver.pitch')}`, 'roll', 'pitch')}</div><div data-link>${linkHtml()}</div></div><div class="bf-receiver-bars" data-bars>${barsHtml()}</div>`, t('bfReceiver.live10'))}
        </div>
      </div></div>${barHtml()}`;
    root.scrollTop = top;
    updateBar(root, form.count(), { busy, reboot: needsReboot() });
    updateLive();
  }

  function summary(): string {
    const rx = form.cur.rx ?? {};
    const link = elrsLink(rc, rx.provider ?? 0);
    const lines = [
      t('bfReceiver.ai.intro', { provider: RX_PROVIDERS[rx.provider ?? 0] ?? `#${rx.provider}`, map: mapToString(map()), channels: rc.length }),
      `stick thresholds min ${rx.minCheck} mid ${rx.midRc} max ${rx.maxCheck}; deadband ${form.cur.db?.deadband ?? '?'} yaw ${form.cur.db?.yawDeadband ?? '?'}; RSSI channel ${form.get('rssi', 'ch')}`,
      `RC smoothing mode ${rx.smoothMode ?? '?'}, setpoint cutoff ${rx.smoothSetpointCutoff ?? '?'} Hz (0 = auto), auto factor ${rx.smoothAutoFactor ?? '?'}`,
      link ? `ELRS LQ ${Math.round(link.lq)}%, RSSI ~${Math.round(link.rssiDbm)} dBm` : t('bfReceiver.ai.noLink'),
    ];
    if (form.count()) lines.push(t('bfTuning.ai.unsaved', { n: form.count() }));
    return lines.join('\n');
  }

  /* ---------------- events ---------------- */
  const unbind = bindForm(root, form, specs, (g, key) => {
    updateBar(root, form.count(), { busy, reboot: needsReboot() });
    if (g === 'rx' && (key === 'provider' || key === 'midRc')) render();
    else if (g === 'rssi') root.querySelector('[data-bars]')!.innerHTML = barsHtml();
  });

  root.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (!sel.matches?.('[data-preset]')) return;
    const m = stringToMap(sel.value === 'custom' ? mapToString(map()) : sel.value);
    if (m) m.forEach((v, i) => form.set('map', `m${i}`, v));
    render();
  });
  root.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'save') void save();
    else if (act === 'revert') {
      form.revert();
      render();
    } else if (act === 'reload') void load();
    else if (act === 'ask') ctx.askAi(summary());
  });

  const off = ctx.state.subscribe(() => {
    if (disposed || busy) return;
    const connected = io.connected();
    if (connected && ctx.link() !== loadedLink && phase !== 'loading') void load();
    else if (!connected && phase !== 'idle') {
      phase = 'idle';
      loadedLink = null;
      form.clear();
      render();
    }
  });

  startPoll();
  void load();

  return () => {
    disposed = true;
    if (poll) clearInterval(poll);
    off();
    unbind();
    root.remove();
  };
};
