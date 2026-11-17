/**
 * Receiver tab: provider, channel map, RSSI channel, deadband, RC smoothing, plus live channel bars (MSP_RC, 10 Hz),
 * a 2D stick view and ELRS link quality from channels 15/16. Edits stay local until "Save".
 */
import type { AppContext, ScreenMount } from '../context';
import { AREA, CMD, rawKey, rawOf, STEP } from '../bf/steps';
import { C } from '../bf/codes';
import type { MspWrite } from '../bf/store';
import type { Values } from '../bf/fieldtable';
import {
  channelName, decodeRc, decodeRssiChannel, decodeRxConfig, decodeRcDeadband, decodeRxMap, elrsLink, encodeRcDeadband, encodeRssiChannel, encodeRxConfig, encodeRxMap,
  mapToString, PROVIDER_CRSF, RX_MAP_PRESETS, RX_PROVIDERS, sticksFromRc, stringToMap,
} from '../bf/receiver';
import { escapeHtml } from '../ui/dom';
import { fmtNum, t, type Key } from '../i18n';
import { intro, tip, type TipKey } from '../ui/tip';
import { bindForm, disconnectedHtml, errorHtml, Form, updateBar, type FieldSpec } from './bf-tuning-ui';
import './bf-receiver.css';

const k = (x: string) => `bfReceiver.${x}` as Key;
const CH_MIN = 1000;
const CH_MAX = 2000;

/** Lightbulb text per field key (tips.receiver.<key>). */
const FIELD_TIPS: Record<string, TipKey> = {
  provider: 'tips.receiver.provider',
  ch: 'tips.receiver.rssiChannel',
  minCheck: 'tips.receiver.minCheck',
  midRc: 'tips.receiver.midRc',
  maxCheck: 'tips.receiver.maxCheck',
  deadband: 'tips.receiver.deadband',
  yawDeadband: 'tips.receiver.yawDeadband',
  smoothMode: 'tips.receiver.smoothMode',
  smoothSetpointCutoff: 'tips.receiver.smoothSetpointCutoff',
  smoothThrottleCutoff: 'tips.receiver.smoothThrottleCutoff',
  smoothFeedforwardCutoff: 'tips.receiver.smoothFeedforwardCutoff',
  smoothAutoFactor: 'tips.receiver.smoothAutoFactor',
  smoothAutoFactorThrottle: 'tips.receiver.smoothAutoFactorThrottle',
};

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  const form = new Form();
  const root = document.createElement('div');
  root.className = 'bf-tab rx';
  root.dataset.tab = 'bf-receiver';
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

  let shownKey = '';
  const IDS = [STEP.rx, STEP.rxMap, STEP.deadband, STEP.rssi];
  const api = () => ctx.bf.get().api || 46;
  const connected = () => ctx.state.get().conn === 'connected' && ctx.link() !== null;
  const map = (): number[] => Array.from({ length: 8 }, (_, i) => form.get('map', `m${i}`));
  const s = (g: string, key: string, label: string, min: number, max: number, extra: Partial<FieldSpec> = {}): FieldSpec => ({ g, k: key, label, min, max, ...extra });

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
  /** Fills the form from the Betaflight store; false when the FC did not answer MSP_RX_CONFIG. */
  function fromStore(): boolean {
    const d = ctx.bf.get();
    const rxBytes = rawOf(d, STEP.rx);
    if (!rxBytes) return false;
    const a = api();
    const rx = decodeRxConfig(rxBytes, a);
    rxRaw = rx.raw;
    form.load('rx', rx.values);
    mapRaw = rawOf(d, STEP.rxMap) ?? mapRaw;
    const mv: Values = {};
    decodeRxMap(mapRaw).forEach((v, i) => (mv[`m${i}`] = v));
    form.load('map', mv);
    const db = rawOf(d, STEP.deadband);
    hasDb = !!db;
    dbRaw = db ?? new Uint8Array(0);
    form.load('db', db ? decodeRcDeadband(db, a).values : {});
    const rs = rawOf(d, STEP.rssi);
    form.load('rssi', rs ? { ch: decodeRssiChannel(rs) } : {});
    shownKey = rawKey(d, IDS);
    return true;
  }

  /** Shows what the connect-time read stored, then re-reads the tab's commands. Live channels come from the 10 Hz poll. */
  async function load(): Promise<void> {
    if (!connected()) {
      phase = 'idle';
      render();
      return;
    }
    loadedLink = ctx.link();
    phase = fromStore() ? 'ready' : 'loading';
    render();
    await ctx.bf.refresh(AREA.receiver);
    if (disposed || busy || (phase === 'ready' && form.count())) return;
    const changed = phase !== 'ready' || rawKey(ctx.bf.get(), IDS) !== shownKey;
    if (fromStore()) phase = 'ready';
    else {
      phase = 'error';
      error = t('bfTuning.common.unsupported');
    }
    if (changed) render();
  }

  const needsReboot = () => form.isChanged('rx', 'provider');

  async function save(): Promise<void> {
    if (busy || !form.count()) return;
    busy = true;
    updateBar(root, form.count(), { busy });
    const a = api();
    const writes: MspWrite[] = [];
    if (form.groupChanged('rx')) writes.push({ code: C.SET_RX_CONFIG, payload: encodeRxConfig(rxRaw, form.cur.rx!, a), label: 'SET_RX_CONFIG' });
    if (form.groupChanged('map')) writes.push({ code: CMD.SET_RX_MAP, payload: encodeRxMap(map(), mapRaw), label: 'SET_RX_MAP' });
    if (hasDb && form.groupChanged('db')) writes.push({ code: CMD.SET_RC_DEADBAND, payload: encodeRcDeadband(dbRaw, form.cur.db!, a), label: 'SET_RC_DEADBAND' });
    if (form.groupChanged('rssi')) writes.push({ code: CMD.SET_RSSI_CONFIG, payload: encodeRssiChannel(form.get('rssi', 'ch')), label: 'SET_RSSI_CONFIG' });
    const reboot = needsReboot();
    const res = await ctx.bf.saveSettings(writes, { reboot, areas: AREA.receiver });
    busy = false;
    if (!res.ok) {
      ctx.toast(t('bfTuning.common.saveFail', { msg: res.error ?? '' }), 'error');
      updateBar(root, form.count(), { busy });
      return;
    }
    ctx.toast(reboot ? t('bfReceiver.savedReboot') : t('bfTuning.common.saved'), 'ok');
    if (!disposed && fromStore()) render();
  }

  /* ---------------- live view ---------------- */
  const norm = (us: number) => Math.max(0, Math.min(1, (us - CH_MIN) / (CH_MAX - CH_MIN)));

  function stickSvg(label: string, xKey: string, yKey: string): string {
    return `<figure class="rx-stick"><svg viewBox="-60 -60 120 120" role="img" aria-label="${escapeHtml(label)}">
      <rect x="-56" y="-56" width="112" height="112" fill="none" stroke="#DCEFF8" stroke-opacity=".5"/>
      <path d="M-56 0H56M0 -56V56" stroke="#DCEFF8" stroke-opacity=".15"/>
      <circle cx="0" cy="0" r="28" fill="none" stroke="#DCEFF8" stroke-opacity=".12"/>
      <circle data-dot="${xKey}${yKey}" cx="0" cy="0" r="5" fill="#FF4A2E"/></svg><figcaption class="mono">${escapeHtml(label)}</figcaption></figure>`;
  }

  const LETTER: Record<string, string> = { Roll: 'A', Pitch: 'E', Yaw: 'R', Throttle: 'T' };
  function barsHtml(): string {
    const m = map();
    const prov = form.get('rx', 'provider');
    const link = elrsLink(rc, prov);
    const rssiCh = form.get('rssi', 'ch');
    return rc
      .map((us, i) => {
        const base = link && i === 14 ? 'LQ' : link && i === 15 ? 'RSSI' : channelName(i, m);
        const name = LETTER[base] ? `${base} [${LETTER[base]}]` : base;
        const tag = rssiCh === i + 1 ? `<em class="mono">RSSI</em>` : '';
        const kind = LETTER[base] ? 'stick' : link && i >= 14 ? 'link' : 'aux';
        return `<div class="rx-ch ${kind}" data-ch="${i}"${i >= 12 ? ' data-level="expert"' : ''}><span class="nm">${escapeHtml(name)}${tag}</span><span class="bar"><i style="width:${(norm(us) * 100).toFixed(1)}%"></i><b class="us mono">${us}</b></span></div>`;
      })
      .join('');
  }

  function linkHtml(): string {
    const prov = form.get('rx', 'provider');
    const link = elrsLink(rc, prov);
    if (prov !== PROVIDER_CRSF) return `<div class="rx-lq dim">${t('bfReceiver.lqNotCrsf')}</div>`;
    if (!link) return `<div class="rx-lq dim">${t('bfReceiver.lqNone')}</div>`;
    return `<dl class="v1-kv rx-lqkv"><dt>${t('bfReceiver.lq')} ${tip('tips.receiver.link')}</dt><dd>${fmtNum(link.lq, 0)} %</dd><dt>${t('bfReceiver.rssiDbm')}</dt><dd>~${fmtNum(link.rssiDbm, 0)} dBm</dd></dl><p class="rx-lqnote">${t('bfReceiver.lqNote')}</p>`;
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
    root.classList.toggle('rx-stale', stale >= 3);
  }

  function startPoll(): void {
    if (poll) return;
    poll = setInterval(() => {
      if (inflight || disposed || phase !== 'ready' || !connected() || ctx.link()?.busy) return;
      inflight = true;
      ctx.bf
        .send(C.RC)
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
  const head = () => `<header class="bf-head"><h2>${t('bfReceiver.tab')}</h2><button class="btn ghost bf-ask" data-act="ask">${t('bfCore.askAi')}</button></header>`;

  /** One Betaflight-style row: [control | label | bulb]. Works with bindForm (data-g / data-k). */
  function rowHtml(key: string, g = 'rx', kind: 'num' | 'sw' = 'num'): string {
    const sp = spec(key, g);
    const tk = FIELD_TIPS[key];
    const bulb = tk ? tip(tk) : '<span class="bf-tip-gap"></span>';
    const lbl = escapeHtml(sp.label);
    if (!form.has(g, key)) return `<div class="bf-row na" data-fk="${g}.${key}"><div class="bf-ctl"><span class="bf-info mono">—</span></div><label class="bf-lbl">${lbl}</label>${bulb}</div>`;
    const v = form.get(g, key);
    const dat = `data-g="${g}" data-k="${key}"`;
    let ctl: string;
    if (kind === 'sw') ctl = `<label class="bf-sw ${v ? 'on' : ''}"><input type="checkbox" ${dat} ${v ? 'checked' : ''} aria-label="${lbl}" /><i></i></label>`;
    else if (sp.options) ctl = `<select ${dat} aria-label="${lbl}">${sp.options.map((o) => `<option value="${o.v}"${o.v === v ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
    else ctl = `<input type="number" ${dat} min="${sp.min}" max="${sp.max}" step="1" value="${v}" aria-label="${lbl}" />${sp.unit ? `<span class="bf-unit mono">${escapeHtml(sp.unit)}</span>` : ''}`;
    return `<div class="bf-row${form.isChanged(g, key) ? ' chg' : ''}" data-fk="${g}.${key}"><div class="bf-ctl">${ctl}</div><label class="bf-lbl">${lbl}</label>${bulb}</div>`;
  }
  const panel = (title: string, body: string, opts: { tip?: TipKey; tip2?: TipKey; hint?: string; expert?: boolean; cls?: string } = {}) =>
    `<section class="bf-panel ${opts.cls ?? ''}"${opts.expert ? ' data-level="expert"' : ''}><header><span class="bf-legend">${escapeHtml(title)}${opts.tip ? ` ${tip(opts.tip)}` : ''}${opts.tip2 ? tip(opts.tip2) : ''}</span>${opts.hint ? `<small>${escapeHtml(opts.hint)}</small>` : ''}</header>${body}</section>`;

  function render(): void {
    if (disposed) return;
    const top = root.querySelector<HTMLElement>('.bf-body')?.scrollTop ?? 0;
    if (!connected() || phase === 'idle') {
      root.innerHTML = `${head()}<div class="bf-body">${disconnectedHtml()}</div>`;
      return;
    }
    if (phase === 'loading') {
      root.innerHTML = `${head()}<div class="bf-body"><div class="bf-empty"><p>${t('bfTuning.common.loading')}</p></div></div>`;
      return;
    }
    if (phase === 'error') {
      root.innerHTML = `${head()}<div class="bf-body">${errorHtml(error)}</div>`;
      return;
    }
    const cur = mapToString(map());
    const preset = RX_MAP_PRESETS.includes(cur) ? cur : 'custom';
    const mapChanged = form.groupChanged('map');
    const mapRow = `<div class="bf-row${mapChanged ? ' chg' : ''}"><div class="bf-ctl"><select data-preset aria-label="${escapeHtml(t('bfReceiver.map'))}">${RX_MAP_PRESETS.map((p) => `<option value="${p}"${p === preset ? ' selected' : ''}>${p.slice(0, 4)}</option>`).join('')}${preset === 'custom' ? `<option value="custom" selected>${escapeHtml(cur)}</option>` : ''}</select></div><label class="bf-lbl">${t('bfReceiver.map')}</label>${tip('tips.receiver.map')}</div>`;
    const smoothKeys = [api() >= 47 ? 'smoothThrottleCutoff' : 'smoothFeedforwardCutoff', 'smoothSetpointCutoff', 'smoothAutoFactor', ...(api() >= 47 ? ['smoothAutoFactorThrottle'] : [])];
    const prov = form.get('rx', 'provider');
    const reboot = needsReboot();
    const live = panel(
      t('bfReceiver.capLive'),
      `<div class="rx-top"><div class="rx-sticks">${stickSvg(`${t('bfReceiver.yaw')} / ${t('bfReceiver.throttle')}`, 'yaw', 'thr')}${stickSvg(`${t('bfReceiver.roll')} / ${t('bfReceiver.pitch')}`, 'roll', 'pitch')}</div><div class="rx-lqbox" data-link>${linkHtml()}</div></div><div class="rx-bars" data-bars>${barsHtml()}</div>`,
      { tip: 'tips.receiver.live', tip2: 'tips.receiver.failsafe', hint: t('bfReceiver.live10'), cls: 'rx-live' },
    );
    const side = [
      panel(t('bfReceiver.capSetup'), `${prov === 0 ? `<div class="v1-warn">${escapeHtml(t('bfReceiver.noProvider'))}</div>` : ''}${rowHtml('provider')}${reboot ? `<div class="v1-note">${escapeHtml(t('bfReceiver.rebootNeeded'))}</div>` : ''}`),
      panel(t('bfReceiver.capRssi'), rowHtml('ch', 'rssi')),
      panel(t('bfReceiver.capMap'), mapRow),
      panel(t('bfReceiver.capSticks'), `${rowHtml('minCheck')}${rowHtml('midRc')}${rowHtml('maxCheck')}${hasDb ? `${rowHtml('deadband', 'db')}${rowHtml('yawDeadband', 'db')}` : ''}`, { tip: 'tips.receiver.sticks', expert: true }),
      panel(t('bfReceiver.capSmooth'), `${rowHtml('smoothMode', 'rx', 'sw')}${smoothKeys.map((x) => rowHtml(x)).join('')}`, { hint: t('bfReceiver.smoothNote'), expert: true }),
    ].join('');
    root.innerHTML = `${head()}<div class="bf-body">${intro('tips.receiver.intro')}<div class="rx-cols">${live}<div class="rx-side">${side}</div></div></div>
      <footer class="bf-save"><span class="bf-save-msg" data-bar-n></span><button class="btn ghost" data-act="revert" disabled>${t('bfTuning.common.revert')}</button><button class="btn light" data-act="save" disabled><span data-bar-save>${t('bfTuning.common.save')}</span></button></footer>`;
    const bodyEl = root.querySelector<HTMLElement>('.bf-body');
    if (bodyEl) bodyEl.scrollTop = top;
    updateBar(root, form.count(), { busy, reboot });
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
    const rowEl = root.querySelector<HTMLElement>(`[data-fk="${g}.${key}"]`);
    rowEl?.classList.toggle('chg', form.isChanged(g, key));
    rowEl?.querySelector('.bf-sw')?.classList.toggle('on', !!form.get(g, key));
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
    const on = connected();
    if (on && ctx.link() !== loadedLink) void load();
    else if (!on && phase !== 'idle') {
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
