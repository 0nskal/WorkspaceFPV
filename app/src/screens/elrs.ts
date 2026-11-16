import type { AppContext, ScreenMount } from '../context';
import { readRxConfig } from '../fc/read';
import { rssiPct } from '../fc/state';
import type { FcLink } from '../serial/types';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { t } from '../i18n';
import { FLASHER_URL, compat, loadLocal, providerLabel, saveLocal, type ElrsLocal, type Method, type Region } from './elrs-data';
import { renderElrsScene } from './elrs-scene';

type StepState = 'done' | 'warn' | 'todo';

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  let local: ElrsLocal = loadLocal();
  let rxProvider: number | null = null;
  let rxLink: FcLink | null = null;
  let disposed = false;
  let sceneKey = '';

  el.innerHTML = `<div class="elrs">
    <div class="elrs-stage"><div class="elrs-art"></div><div class="elrs-data" aria-label="${t('elrs.dataAria')}"></div></div>
    <aside class="elrs-card" aria-label="${t('elrs.cardAria')}"></aside>
  </div>`;
  const art = el.querySelector<HTMLElement>('.elrs-art') as HTMLElement;
  const dataEl = el.querySelector<HTMLElement>('.elrs-data') as HTMLElement;
  const card = el.querySelector<HTMLElement>('.elrs-card') as HTMLElement;

  const rxVersion = () => (ctx.settings.get().elrsVersion || ctx.state.get().meta.elrsVersion || '').trim();
  const connected = () => ctx.state.get().conn === 'connected';

  function update(patch: Partial<ElrsLocal>): void {
    local = { ...local, ...patch };
    saveLocal(local);
    render();
  }

  /** Odczyt MSP_RX_CONFIG raz na polaczenie. */
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

  function steps(): Array<{ state: StepState }> {
    const c = compat(rxVersion(), local.txVersion);
    return [
      { state: c.kind === 'ok' ? 'done' : c.kind === 'warn' ? 'warn' : 'todo' },
      { state: local.phrase ? 'done' : 'todo' },
      { state: local.region ? 'done' : 'todo' },
      { state: local.method ? 'done' : 'todo' },
      { state: local.verified ? 'done' : 'todo' },
    ];
  }

  function renderData(): void {
    const s = ctx.state.get();
    const rx = rxVersion();
    const tx = local.txVersion.trim();
    const prov = rxProvider === null ? null : providerLabel(rxProvider);
    const dash = '<span class="elrs-na">—</span>';
    const na = (k: 'elrs.notGiven' | 'elrs.notChosen' | 'elrs.phraseNotConfirmed') => `<span class="elrs-na">${t(k)}</span>`;
    const rssi = s.telemetry ? `${rssiPct(s.telemetry.rssi)}%` : '—';
    const rows: Array<[string, string]> = [
      [t('elrs.rowProtocol'), connected() ? (prov ? `${escapeHtml(prov.text)}${prov.elrs ? '' : ` <small>${t('elrs.usuallyCrsf')}</small>`}` : dash) : dash],
      [t('elrs.rowRx'), rx ? escapeHtml(rx) : na('elrs.notGiven')],
      [t('elrs.rowTx'), tx ? escapeHtml(tx) : na('elrs.notGiven')],
      [t('elrs.rowRssi'), `<span data-live="rssi">${rssi}</span>`],
      [t('elrs.rowRegion'), local.region ? (local.region === 'LBT' ? 'LBT (EU)' : 'FCC') : na('elrs.notChosen')],
      [t('elrs.rowPhrase'), local.phrase ? `${t('elrs.phraseSaved')} ${icon('check', 15)}` : na('elrs.phraseNotConfirmed')],
    ];
    dataEl.innerHTML =
      rows.map(([k, v]) => `<div class="elrs-row"><span class="elrs-k mono">${k}</span><span class="elrs-v">${v}</span></div>`).join('') +
      (connected() ? '' : `<div class="elrs-off">${t('elrs.off')}</div>`);
  }

  function marker(i: number, st: StepState, current: boolean): string {
    if (st === 'done') return `<span class="elrs-mk done">${icon('check', 14)}</span>`;
    if (st === 'warn') return `<span class="elrs-mk warn">${icon('alert', 13)}</span>`;
    return `<span class="elrs-mk${current ? ' cur' : ''}">${i + 1}</span>`;
  }

  function renderCard(): void {
    const focus = document.activeElement as HTMLElement | null;
    const focusName = focus && card.contains(focus) ? focus.getAttribute('name') : null;
    const rx = rxVersion();
    const c = compat(rx, local.txVersion);
    const st = steps();
    const curIdx = st.findIndex((x) => x.state !== 'done');
    const s = ctx.state.get();
    const rssi = s.telemetry ? `${rssiPct(s.telemetry.rssi)}%` : '—';
    const seg = (name: string, val: string, opts: Array<[string, string]>) =>
      `<div class="elrs-seg" role="radiogroup">${opts
        .map(([v, l]) => `<button type="button" role="radio" aria-checked="${val === v}" class="${val === v ? 'on' : ''}" data-set="${name}" data-val="${v}">${l}</button>`)
        .join('')}</div>`;
    const chk = (name: string, on: boolean, label: string) =>
      `<label class="elrs-chk"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}/><span class="box">${icon('check', 13)}</span><span>${label}</span></label>`;

    const items: Array<{ t: string; sub: string; subCls?: string; body: string }> = [
      {
        t: t('elrs.s1'),
        sub: c.text,
        subCls: c.kind,
        body: `<div class="elrs-pair"><label><span class="mono">${t('elrs.lblRx')}</span><input type="text" name="rx" value="${escapeHtml(rx)}" placeholder="${t('elrs.s1ph')}" autocomplete="off" spellcheck="false"/></label><label><span class="mono">${t('elrs.lblTx')}</span><input type="text" name="tx" value="${escapeHtml(local.txVersion)}" placeholder="${t('elrs.s1ph2')}" autocomplete="off" spellcheck="false"/></label></div>`,
      },
      { t: t('elrs.s2'), sub: t('elrs.s2sub'), body: chk('phrase', local.phrase, t('elrs.s2chk')) },
      {
        t: t('elrs.s3'),
        sub: t('elrs.s3sub'),
        body: seg('region', local.region, [
          ['LBT', 'LBT (EU)'],
          ['FCC', 'FCC'],
        ]),
      },
      {
        t: t('elrs.s4'),
        sub: t('elrs.s4sub'),
        body: seg('method', local.method, [
          ['passthrough', t('elrs.s4pass')],
          ['wifi', t('elrs.s4wifi')],
        ]),
      },
      { t: t('elrs.s5'), sub: t('elrs.s5sub', { rssi }), body: chk('verified', local.verified, t('elrs.s5chk')) },
    ];

    const how =
      local.method === 'wifi' ? t('elrs.howWifi') : t('elrs.howPass');

    const hot = curIdx === -1 ? 'ok' : st.some((x) => x.state === 'warn') ? 'warn' : '';
    card.innerHTML = `
      <div class="elrs-h"><i class="${hot}"></i><span>${t('elrs.headTitle')}</span><span class="r">${escapeHtml(rx || '?')} → ${escapeHtml(local.txVersion || '?')}</span></div>
      <div class="elrs-body">
        <ol class="elrs-steps">${items
          .map(
            (it, i) => `<li class="${st[i].state}${i === curIdx ? ' cur' : ''}">${marker(i, st[i].state, i === curIdx)}<div class="elrs-st"><div class="elrs-t">${it.t}</div><div class="elrs-sub mono ${it.subCls ?? ''}">${escapeHtml(it.sub)}</div><div class="elrs-ctl">${it.body}</div></div></li>`,
          )
          .join('')}</ol>
        <div class="elrs-how"><div class="elrs-how-h mono">${local.method === 'wifi' ? t('elrs.howWifiHead') : t('elrs.howPassHead')}</div><ol>${how}</ol></div>
      </div>
      <div class="elrs-foot">
        <div class="elrs-act">
          <a class="btn p" href="${FLASHER_URL}" target="_blank" rel="noopener noreferrer">${icon('external', 15)}${t('elrs.openFlasher')}</a>
          <button class="btn s" type="button" data-act="ai">${t('elrs.askAi')}</button>
        </div>
        <div class="elrs-plan mono">${t('elrs.plan')}</div>
      </div>`;
    if (focusName) card.querySelector<HTMLInputElement>(`input[name="${focusName}"]`)?.focus();
  }

  function renderScene(): void {
    const rx = rxVersion();
    const key = rx;
    if (key === sceneKey) return;
    sceneKey = key;
    art.innerHTML = renderElrsScene(`RX · ${rx ? 'ELRS ' + escapeHtml(rx) : t('elrs.receiver')}`);
  }

  function render(): void {
    renderScene();
    renderData();
    renderCard();
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

  /* zdarzenia */
  card.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const setBtn = t.closest<HTMLElement>('[data-set]');
    if (setBtn) {
      const name = setBtn.dataset.set;
      const val = setBtn.dataset.val ?? '';
      if (name === 'region') update({ region: (local.region === val ? '' : val) as Region });
      else if (name === 'method') update({ method: (local.method === val ? '' : val) as Method });
      return;
    }
    if (t.closest('[data-act="ai"]')) askAi();
  });
  card.addEventListener('change', (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.name === 'phrase') update({ phrase: inp.checked });
    else if (inp.name === 'verified') update({ verified: inp.checked });
    else if (inp.name === 'tx') update({ txVersion: inp.value.trim() });
    else if (inp.name === 'rx') ctx.settings.set({ elrsVersion: inp.value.trim() });
  });

  const offState = ctx.state.subscribe(() => {
    loadRx();
    render();
  });
  const offSettings = ctx.settings.subscribe(render);
  const offTel = ctx.state.subscribeTelemetry(() => {
    const t = ctx.state.get().telemetry;
    const txt = t ? `${rssiPct(t.rssi)}%` : '—';
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
    offTel();
  };
};
