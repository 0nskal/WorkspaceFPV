/** "ESC info" panel for the ESC tab: per-ESC cards read through the 4-way interface (read-only). */
import type { AppContext } from '../context';
import { supportsBidir, type EscField } from '../bf/esc-eeprom';
import type { EscDevice } from '../bf/esc-flow';
import { escLabel } from '../bf/esc-summary';
import { hwInfo, type HwJob } from '../bf/hw-info';
import { onReconnectStatus } from '../serial/reconnect-status';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { t, type Key } from '../i18n';
import { tip, type TipKey } from '../ui/tip';

/** Lightbulb per ESC setting (only the ones a beginner can act on). */
const FIELD_TIP: Record<string, TipKey> = {
  direction: 'tips.motors.escInfo.direction',
  pwm: 'tips.motors.escInfo.pwm',
  timing: 'tips.motors.escInfo.timing',
  startupPower: 'tips.motors.escInfo.startupPower',
  brakeOnStop: 'tips.motors.escInfo.brakeOnStop',
  beaconStrength: 'tips.motors.escInfo.beacon',
  beaconDelay: 'tips.motors.escInfo.beacon',
  tempProtection: 'tips.motors.escInfo.tempProtection',
};

type Row = [label: string, value: string, tipKey?: TipKey, expert?: boolean];

/** Fields shown on the card itself; the rest sits behind "All settings". */
const PRIMARY = ['direction', 'pwm', 'timing', 'bidirMode', 'brakeOnStop', 'beaconStrength', 'beaconDelay'];

export function fieldLabel(id: string): string {
  return t(`bfInfo.f.${id}` as Key);
}

export function fieldValue(f: EscField): string {
  switch (f.kind) {
    case 'bool':
      return f.value ? t('common.on') : t('common.off');
    case 'enum':
      return t(`bfInfo.val.${String(f.value)}` as Key);
    case 'num':
      return `${f.value}${f.unit ? ' ' + f.unit : ''}`;
    default:
      return String(f.value);
  }
}

/** Status line text for a job (progress step or the reason it stopped). */
export function jobText(j: HwJob): string {
  if (j.phase === 'checking') return t('bfInfo.step.checking');
  if (j.phase === 'running' || j.phase === 'reconnecting') {
    if (j.step === 'esc') return t('bfInfo.step.esc', { n: (j.index ?? 0) + 1, total: j.count ?? '?' });
    return t(`bfInfo.step.${j.step ?? 'passthrough'}` as Key);
  }
  if (j.reason) return t(`bfInfo.reason.${j.reason}` as Key);
  return '';
}

function cardHtml(e: EscDevice): string {
  const m = t('bfInfo.esc.motor', { n: e.index + 1 });
  if (e.status === 'no-response') {
    return `<article class="bf-esc-card bad"><header><b class="mono">${m}</b><span>${t('bfInfo.esc.noAnswer')}</span></header><p class="bf-esc-note">${t('bfInfo.esc.noAnswerNote')}</p></article>`;
  }
  const label = escLabel(e);
  const s = e.settings && e.settings.firmware !== 'unknown' ? e.settings : null;
  const title = label ?? (e.note === 'unknownLayout' ? t('bfInfo.esc.unknownLayout') : e.mcuName ?? '?');
  const rows: Row[] = [];
  if (s) {
    rows.push([t('bfInfo.esc.firmware'), s.firmwareName, 'tips.motors.escInfo.firmware'], [t('bfInfo.esc.version'), s.version ?? '—']);
    if (s.target) rows.push([t('bfInfo.esc.target'), s.target, undefined, true]);
  }
  if (e.mcuName) rows.push([t('bfInfo.esc.mcu'), e.mcuName, undefined, true]);
  const primary = s ? s.fields.filter((f) => PRIMARY.includes(f.id)) : [];
  const rest = s ? s.fields.filter((f) => !PRIMARY.includes(f.id)) : [];
  const lv = (x?: boolean) => (x ? ' data-level="expert"' : '');
  const dl = (list: Row[]) => `<dl>${list.map(([k, v, tk, x]) => `<dt${lv(x)}>${escapeHtml(k)}${tk ? ' ' + tip(tk) : ''}</dt><dd${lv(x)}>${escapeHtml(v)}</dd>`).join('')}</dl>`;
  rows.push(...primary.map((f): Row => [fieldLabel(f.id), fieldValue(f), FIELD_TIP[f.id]]));

  let note = '';
  const mcu = e.mcuName ?? '';
  if (e.note === 'unknownLayout') note = t('bfInfo.esc.unknownLayoutNote', { head: e.rawHead ?? '—' });
  else if (e.note === 'blheli32') note = t('bfInfo.esc.blheli32Note');
  else if (e.note === 'atmel') note = t('bfInfo.esc.atmelNote');
  else if (e.note === 'unsupportedMcu') note = t('bfInfo.esc.unsupportedMcu', { mcu });
  else if (e.note === 'readFail') note = t('bfInfo.esc.readFail');
  const bidir = supportsBidir(e.firmware);
  const bidirTxt = bidir === 'yes' ? t('bfInfo.esc.bidirYes') : bidir === 'no' ? t('bfInfo.esc.bidirNo') : t('bfInfo.esc.bidirUnknown');
  const cls = e.note ? 'warn' : 'ok';
  return `<article class="bf-esc-card ${cls}">
    <header><b class="mono">${m}</b><span>${escapeHtml(title)}</span></header>
    ${rows.length ? dl(rows) : ''}
    ${rest.length ? `<details data-level="expert"><summary class="mono">${t('bfInfo.esc.more')}</summary>${dl(rest.map((f): Row => [fieldLabel(f.id), fieldValue(f), FIELD_TIP[f.id]]))}</details>` : ''}
    ${bidir !== 'unknown' || s ? `<p class="bf-esc-bidir mono ${bidir}">${bidirTxt} ${tip('tips.motors.escInfo.bidirStatus')}</p>` : ''}
    ${note ? `<p class="bf-esc-note">${escapeHtml(note)}</p>` : ''}
  </article>`;
}

/** Mounts the panel into `host`; returns a cleanup function. */
export function mountEscInfo(host: HTMLElement, ctx: AppContext): () => void {
  const hw = hwInfo();
  host.innerHTML = `<section class="esc-panel bf-esc-panel" aria-label="${t('bfInfo.esc.head')}">
    <header><span class="mono">${t('bfInfo.esc.head')} ${tip('tips.motors.escInfo.head')}</span><span class="mono esc-key" data-level="expert">${t('bfInfo.esc.key')}</span></header>
    <div class="bf-esc-body">
      <p class="bf-esc-lead">${t('bfInfo.esc.lead')} ${t('bfInfo.esc.needs')}</p>
      <div class="bf-esc-status mono" role="status" aria-live="polite"></div>
      <div class="bf-esc-actions"><button type="button" class="btn light bf-esc-read">${icon('chip', 15)}<span></span></button></div>
      <div class="bf-esc-cards"></div>
    </div>
  </section>`;
  const statusEl = host.querySelector<HTMLElement>('.bf-esc-status') as HTMLElement;
  const btn = host.querySelector<HTMLButtonElement>('.bf-esc-read') as HTMLButtonElement;
  const btnLabel = btn.querySelector('span') as HTMLElement;
  const cards = host.querySelector<HTMLElement>('.bf-esc-cards') as HTMLElement;

  function paint(): void {
    const s = ctx.state.get();
    const scan = s.hw.esc;
    const job: HwJob = hw?.esc ?? { phase: 'idle' };
    const busy = job.phase === 'checking' || job.phase === 'running';
    btn.disabled = busy || !hw || s.conn !== 'connected';
    btnLabel.textContent = busy ? t('bfInfo.esc.reading') : scan ? t('bfInfo.esc.reread') : t('bfInfo.esc.read');

    let line = '';
    let cls = '';
    if (busy) {
      line = jobText(job);
      cls = 'run';
    } else if (job.phase === 'blocked' || job.phase === 'error') {
      line = jobText(job);
      cls = job.phase === 'error' ? 'err' : 'warn';
      if (job.detail && job.phase === 'error') line += ` (${job.detail})`;
    } else if (scan) {
      const ok = scan.escs.filter((e) => e.status === 'ok').length;
      line = t('bfInfo.esc.summaryOk', { n: ok, total: scan.escs.length });
    } else {
      line = ctx.settings.get().autoEscInfo ? `${t('bfInfo.esc.notRead')} ${t('bfInfo.esc.autoOn')}` : t('bfInfo.esc.notRead');
    }
    const rc = hw?.reconnectLine();
    if (rc && s.conn === 'reconnecting') line = rc;
    statusEl.className = `bf-esc-status mono ${cls}`;
    statusEl.textContent = line;

    const sig = JSON.stringify(scan ?? null) + t('bfInfo.esc.head');
    if (cards.dataset.sig !== sig) {
      cards.dataset.sig = sig;
      cards.innerHTML = scan ? scan.escs.map(cardHtml).join('') : '';
    }
  }

  btn.addEventListener('click', () => void hw?.runEsc('manual'));
  const offs = [ctx.state.subscribe(paint), hw?.subscribe(paint) ?? (() => undefined), ctx.settings.subscribe(paint), onReconnectStatus(paint)];
  paint();
  return () => offs.forEach((o) => o());
}
