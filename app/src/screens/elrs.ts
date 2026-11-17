/**
 * ELRS tab (1.0 layout): receiver facts (read from the receiver over CRSF passthrough), an update checklist
 * (versions, binding phrase, region, method, link check) and links to the ELRS Web Flasher and Configurator.
 * Nothing is flashed from here and nothing is written to the FC.
 */
import type { AppContext, ScreenMount } from '../context';
import { hwInfo, type HwJob } from '../bf/hw-info';
import { readRxConfig } from '../fc/read';
import { jobText } from './bf-esc-info';
import { rssiPct } from '../fc/state';
import type { FcLink } from '../serial/types';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { t } from '../i18n';
import { intro, tip, type TipKey } from '../ui/tip';
import { CONFIGURATOR_URL, FLASHER_URL, compat, loadLocal, providerLabel, saveLocal, type ElrsLocal, type Method, type Region } from './elrs-data';
import './elrs.css';

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  let local: ElrsLocal = loadLocal();
  let rxProvider: number | null = null;
  let rxLink: FcLink | null = null;
  let disposed = false;

  el.innerHTML = `<div class="elrs-v1">
    <header class="bf-head"><h2>${t('bfInfo.elrs.pageTitle')}</h2><span class="elrs-sub">${t('bfInfo.elrs.pageSub')}</span><button class="btn ghost bf-ask" type="button" data-act="ai">${icon('chip', 16)}${t('elrs.askAi')}</button></header>
    <div class="bf-body elrs-body"></div>
  </div>`;
  const body = el.querySelector<HTMLElement>('.elrs-body') as HTMLElement;

  /** The receiver version is only ever read from the receiver (state.hw.elrs); nothing is typed in. */
  const rxVersion = () => ctx.state.get().hw.elrs?.version ?? '';
  const hw = hwInfo();
  const connected = () => ctx.state.get().conn === 'connected';

  function update(patch: Partial<ElrsLocal>): void {
    local = { ...local, ...patch };
    saveLocal(local);
    render();
  }

  /** MSP_RX_CONFIG once per connection. */
  function loadRx(): void {
    const link = connected() ? ctx.link() : null;
    if (!link) {
      rxProvider = null;
      rxLink = null;
      return;
    }
    if (link === rxLink) return;
    rxLink = link;
    rxProvider = null;
    void readRxConfig(link)
      .then((r) => {
        if (disposed || rxLink !== link) return;
        rxProvider = r.serialRxProvider;
        render();
      })
      .catch(() => undefined);
  }

  const sw = (name: string, on: boolean, label: string) => `<label class="bf-sw${on ? ' on' : ''}"><input type="checkbox" name="${name}" ${on ? 'checked' : ''} aria-label="${escapeHtml(label)}"><i></i></label>`;
  const row = (ctl: string, label: string, tk: TipKey, extra = '') => `<div class="bf-row"><div class="bf-ctl">${ctl}</div><label class="bf-lbl">${label}</label>${tip(tk)}${extra}</div>`;
  const opt = (v: string, cur: string, label: string) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;

  /** Receiver panel: facts read from the FC / receiver, the read button and its status. */
  function receiverPanel(): string {
    const s = ctx.state.get();
    const rx = rxVersion();
    const tx = local.txVersion.trim();
    const prov = rxProvider === null ? null : providerLabel(rxProvider);
    const dash = '<span class="elrs-na">—</span>';
    const rssi = s.telemetry ? `${rssiPct(s.telemetry.rssi)}%` : '—';
    const job: HwJob = hw?.elrs ?? { phase: 'idle' };
    const busy = job.phase === 'checking' || job.phase === 'running' || job.phase === 'reconnecting';
    const info = s.hw.elrs;
    const cls = busy ? 'run' : job.phase === 'error' ? 'bad' : job.phase === 'blocked' ? 'warn' : '';
    let status = busy || job.phase === 'blocked' || job.phase === 'error' ? jobText(job) : '';
    const rc = hw?.reconnectLine();
    if (rc && s.conn === 'reconnecting') status = rc;
    const canRead = connected() && !!hw && !busy;
    const showHow = job.phase === 'blocked' && ['noUart', 'noAnswer', 'noAnswerSeen', 'notCrsf'].includes(job.reason ?? '');
    const kv = (k: string, v: string, tk: TipKey) => `<dt>${k}${tip(tk)}</dt><dd>${v}</dd>`;
    const na = (k: 'elrs.notGiven' | 'elrs.notChosen' | 'elrs.phraseNotConfirmed') => `<span class="elrs-na">${t(k)}</span>`;
    return `<section class="bf-panel"><header><span class="bf-legend">${t('bfInfo.elrs.rxHead')} ${tip('tips.elrs.rxVersion')}</span>${connected() ? '' : `<small>${t('elrs.off')}</small>`}</header>
      <dl class="v1-kv elrs-kv">
        ${kv(t('elrs.rowProtocol'), connected() ? (prov ? `${escapeHtml(prov.text)}${prov.elrs ? '' : ` <small>${t('elrs.usuallyCrsf')}</small>`}` : dash) : dash, 'tips.elrs.protocol')}
        ${kv(t('elrs.rowRx'), rx ? escapeHtml('ELRS ' + rx) : `<span class="elrs-na">${t('bfInfo.elrs.notRead')}</span>`, 'tips.elrs.rxVersion')}
        ${kv(t('elrs.rowTx'), tx ? escapeHtml(tx) : na('elrs.notGiven'), 'tips.elrs.txVersion')}
        ${kv(t('elrs.rowRssi'), `<span data-live="rssi">${rssi}</span>`, 'tips.elrs.rssi')}
        ${kv(t('elrs.rowRegion'), local.region ? (local.region === 'LBT' ? 'LBT (EU)' : 'FCC') : na('elrs.notChosen'), 'tips.elrs.region')}
        ${kv(t('elrs.rowPhrase'), local.phrase ? `${t('elrs.phraseSaved')} ${icon('check', 15)}` : na('elrs.phraseNotConfirmed'), 'tips.elrs.phrase')}
      </dl>
      ${info ? `<p class="elrs-meta">${escapeHtml(t('bfInfo.elrs.deviceName', { name: info.name }))}</p>` : ''}
      <div class="elrs-readrow"><button class="btn amber" type="button" data-act="read-elrs" ${canRead ? '' : 'disabled'}>${busy ? t('bfInfo.elrs.reading') : rx ? t('bfInfo.elrs.rereadBtn') : t('bfInfo.elrs.readBtn')}</button></div>
      ${status ? `<p class="elrs-status ${cls}" role="status" aria-live="polite">${escapeHtml(status)}</p>` : `<p class="elrs-status">${connected() ? t('bfInfo.elrs.readLead') : t('bfInfo.elrs.needsConn')}</p>`}
      ${showHow ? `<div class="v1-note elrs-how2"><b>${t('bfInfo.elrs.howHead')}</b><ol>${t('bfInfo.elrs.how')}</ol></div>` : ''}
      <div class="bf-row"><div class="bf-ctl"><input type="text" name="tx" value="${escapeHtml(local.txVersion)}" placeholder="${t('elrs.s1ph2')}" autocomplete="off" spellcheck="false" aria-label="${escapeHtml(t('bfInfo.elrs.txLabel'))}"></div><label class="bf-lbl">${t('bfInfo.elrs.txLabel')}</label>${tip('tips.elrs.txVersion')}</div>
      <p class="elrs-hint">${t('bfInfo.elrs.txHint')}</p>
    </section>`;
  }

  /** Checklist panel: the same five steps as before, as Betaflight-style rows. */
  function checklistPanel(): string {
    const rx = rxVersion();
    const c = compat(rx, local.txVersion);
    const s = ctx.state.get();
    const rssi = s.telemetry ? `${rssiPct(s.telemetry.rssi)}%` : '—';
    const compatBox = `<div class="${c.kind === 'warn' ? 'v1-warn' : 'v1-note'} elrs-compat ${c.kind}"><b>${t('elrs.s1')}</b>${tip('tips.elrs.versionMatch')}<span>${escapeHtml(c.text)}</span></div>`;
    const region = `<select name="region" aria-label="${escapeHtml(t('elrs.s3'))}">${opt('', local.region, t('elrs.notChosen'))}${opt('LBT', local.region, 'LBT (EU)')}${opt('FCC', local.region, 'FCC')}</select>`;
    const method = `<select name="method" aria-label="${escapeHtml(t('elrs.s4'))}">${opt('', local.method, t('elrs.notChosen'))}${opt('passthrough', local.method, t('elrs.s4pass'))}${opt('wifi', local.method, t('elrs.s4wifi'))}</select>`;
    return `<section class="bf-panel"><header><span class="bf-legend">${t('bfInfo.elrs.updateHead')} ${tip('tips.elrs.settings')}</span></header>
      ${compatBox}
      ${row(sw('phrase', local.phrase, t('elrs.s2')), `${t('elrs.s2')}<small class="elrs-rowsub">${t('elrs.s2chk')}</small>`, 'tips.elrs.phrase')}
      ${row(region, `${t('elrs.s3')}<small class="elrs-rowsub">${t('elrs.s3sub')}</small>`, 'tips.elrs.region')}
      ${row(method, `${t('elrs.s4')}<small class="elrs-rowsub">${t('elrs.s4sub')}</small>`, 'tips.elrs.method')}
      ${row(sw('verified', local.verified, t('elrs.s5')), `${t('elrs.s5')}<small class="elrs-rowsub">${escapeHtml(t('elrs.s5sub', { rssi }))}</small>`, 'tips.elrs.verify')}
    </section>`;
  }

  /** Tools panel: web flasher + configurator links and the how-to for the chosen method. */
  function toolsPanel(): string {
    const how = local.method === 'wifi' ? t('elrs.howWifi') : t('elrs.howPass');
    return `<section class="bf-panel"><header><span class="bf-legend">${t('bfInfo.elrs.toolsHead')}</span></header>
      <div class="elrs-links">
        <a class="btn amber" href="${FLASHER_URL}" target="_blank" rel="noopener noreferrer">${icon('external', 15)}${t('elrs.openFlasher')}</a>
        <a class="btn ghost" href="${CONFIGURATOR_URL}" target="_blank" rel="noopener noreferrer">${icon('external', 15)}${t('bfInfo.elrs.configurator')}</a>
      </div>
      <div class="elrs-howbox"><div class="elrs-how-h">${local.method === 'wifi' ? t('elrs.howWifiHead') : t('elrs.howPassHead')}</div><ol>${how}</ol></div>
      <p class="elrs-hint">${t('elrs.plan')}</p>
    </section>`;
  }

  function render(): void {
    const focus = document.activeElement as HTMLElement | null;
    const focusName = focus && body.contains(focus) ? focus.getAttribute('name') : null;
    const pos = focus instanceof HTMLInputElement && focusName === 'tx' ? focus.selectionStart : null;
    body.innerHTML = `<div class="elrs-intro" data-only="basic">${intro('tips.elrs.intro')}</div><div class="v1-cols elrs-cols"><div class="elrs-col">${receiverPanel()}</div><div class="elrs-col">${checklistPanel()}${toolsPanel()}</div></div>`;
    if (focusName) {
      const n = body.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${focusName}"]`);
      n?.focus();
      if (n instanceof HTMLInputElement && pos !== null) n.setSelectionRange(pos, pos);
    }
  }

  function askAi(): void {
    const prov = rxProvider === null ? t('common.unknown') : providerLabel(rxProvider).text;
    const dk = t('elrs.ai.dontKnow');
    const parts = [
      t('elrs.ai.intro'),
      t('elrs.ai.versions', { rx: rxVersion() || dk, tx: local.txVersion.trim() || dk }),
      t('elrs.ai.protocol', { p: prov }),
      t('elrs.ai.region', {
        r: local.region === 'LBT' ? 'LBT (EU)' : local.region || t('elrs.ai.notChosenYet'),
        m: local.method === 'wifi' ? t('elrs.ai.methodWifi') : local.method === 'passthrough' ? t('elrs.ai.methodPass') : t('elrs.ai.notChosenYet'),
      }),
      t('elrs.ai.question'),
    ];
    ctx.askAi(parts.join(' '));
  }

  /* events */
  el.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg.closest('[data-act="read-elrs"]')) void hw?.runElrs('manual');
    else if (tg.closest('[data-act="ai"]')) askAi();
  });
  el.addEventListener('change', (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.name === 'phrase') update({ phrase: inp.checked });
    else if (inp.name === 'verified') update({ verified: inp.checked });
    else if (inp.name === 'tx') update({ txVersion: inp.value.trim() });
    else if (inp.name === 'region') update({ region: inp.value as Region });
    else if (inp.name === 'method') update({ method: inp.value as Method });
  });

  const offState = ctx.state.subscribe(() => {
    loadRx();
    render();
  });
  const offSettings = ctx.settings.subscribe(render);
  const offHw = hw?.subscribe(render);
  const offTel = ctx.state.subscribeTelemetry(() => {
    const tl = ctx.state.get().telemetry;
    const txt = tl ? `${rssiPct(tl.rssi)}%` : '—';
    el.querySelectorAll<HTMLElement>('[data-live="rssi"]').forEach((n) => {
      if (n.textContent !== txt) n.textContent = txt;
    });
  });

  loadRx();
  render();

  return () => {
    disposed = true;
    offState();
    offSettings();
    offHw?.();
    offTel();
  };
};
