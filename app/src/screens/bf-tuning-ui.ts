/**
 * Shared UI helpers for the tuning / receiver / modes tabs: a small edit model (current vs. as-read values per group),
 * field rendering with changed-value highlighting, delegated input handling with range validation, and the sticky save bar.
 * Classes are prefixed .bf-tuning- (the three tabs share this block of CSS).
 */
import type { Values } from '../bf/fieldtable';
import { escapeHtml } from '../ui/dom';
import { fmtNum, t } from '../i18n';
import { icon } from '../ui/icons';
import { tip, tipText, type TipKey } from '../ui/tip';

export class Form {
  cur: Record<string, Values> = {};
  orig: Record<string, Values> = {};

  load(g: string, v: Values): void {
    this.orig[g] = { ...v };
    this.cur[g] = { ...v };
  }
  has(g: string, k: string): boolean {
    return this.cur[g]?.[k] !== undefined;
  }
  get(g: string, k: string): number {
    return this.cur[g]?.[k] ?? 0;
  }
  set(g: string, k: string, v: number): void {
    (this.cur[g] ??= {})[k] = v;
  }
  isChanged(g: string, k: string): boolean {
    return this.cur[g]?.[k] !== this.orig[g]?.[k];
  }
  groupChanged(g: string): boolean {
    const c = this.cur[g] ?? {};
    return Object.keys(c).some((k) => c[k] !== this.orig[g]?.[k]);
  }
  count(): number {
    let n = 0;
    for (const g of Object.keys(this.cur)) for (const k of Object.keys(this.cur[g]!)) if (this.isChanged(g, k)) n++;
    return n;
  }
  revert(): void {
    for (const g of Object.keys(this.orig)) this.cur[g] = { ...this.orig[g]! };
  }
  /** Marks the current values as saved. */
  commit(): void {
    for (const g of Object.keys(this.cur)) this.orig[g] = { ...this.cur[g]! };
  }
  clear(): void {
    this.cur = {};
    this.orig = {};
  }
}

export interface FieldSpec {
  g: string;
  k: string;
  label: string;
  tip?: string;
  /** Lightbulb tip (docs/TIPS.md); replaces the native title tooltip. */
  tipKey?: TipKey;
  /** Raw range (as stored in the MSP payload). */
  min: number;
  max: number;
  /** Displayed value = raw * scale (default 1). */
  scale?: number;
  unit?: string;
  slider?: boolean;
  options?: { v: number; label: string }[];
  check?: boolean;
  /** Extra class on the wrapper. */
  cls?: string;
  /** No visible label (table cells); the aria-label still carries it. */
  bare?: boolean;
}

const decimals = (scale: number) => (scale >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(scale) - 1e-9)));
export const fmtVal = (raw: number, scale = 1): string => fmtNum(raw * scale, decimals(scale));
const pct = (raw: number, s: { min: number; max: number }) => (s.max > s.min ? Math.max(0, Math.min(100, ((raw - s.min) / (s.max - s.min)) * 100)) : 0);
const numStr = (raw: number, scale: number) => (raw * scale).toFixed(decimals(scale));

/** Renders one control; a field the firmware does not report is shown dimmed with a tooltip. */
export function fieldHtml(f: Form, s: FieldSpec): string {
  const title = s.tip && !s.tipKey ? ` title="${escapeHtml(s.tip)}"` : '';
  const label = s.bare ? '' : `<span class="bf-tuning-lb"${title}>${escapeHtml(s.label)}${s.tipKey ? ` ${tip(s.tipKey)}` : ''}</span>`;
  if (!f.has(s.g, s.k)) {
    return `<div class="bf-tuning-f na ${s.cls ?? ''}" title="${escapeHtml(t('bfTuning.common.unsupported'))}">${label}<span class="bf-tuning-na mono">—</span></div>`;
  }
  const v = f.get(s.g, s.k);
  const sc = s.scale ?? 1;
  const ch = f.isChanged(s.g, s.k) ? ' chg' : '';
  const dat = `data-g="${s.g}" data-k="${s.k}"`;
  let ctl: string;
  if (s.options) {
    ctl = `<select ${dat} aria-label="${escapeHtml(s.label)}">${s.options.map((o) => `<option value="${o.v}"${o.v === v ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
  } else if (s.check) {
    ctl = `<label class="bf-tuning-chk"><input type="checkbox" ${dat} ${v ? 'checked' : ''} aria-label="${escapeHtml(s.label)}"><span class="box">${icon('check', 14)}</span></label>`;
  } else {
    const rng = s.slider ? `<input type="range" class="bf-tuning-rng" ${dat} data-sync style="--p:${pct(v, s).toFixed(1)}%" min="${s.min * sc}" max="${s.max * sc}" step="${sc}" value="${numStr(v, sc)}" aria-label="${escapeHtml(s.label)}">` : '';
    ctl = `${rng}<input type="number" class="bf-tuning-num mono" ${dat} min="${s.min * sc}" max="${s.max * sc}" step="${sc}" value="${numStr(v, sc)}" aria-label="${escapeHtml(s.label)}">${s.unit ? `<span class="bf-tuning-u mono">${escapeHtml(s.unit)}</span>` : ''}`;
  }
  return `<div class="bf-tuning-f${ch} ${s.slider ? 'sl' : ''} ${s.cls ?? ''}" data-fk="${s.g}.${s.k}">${label}<span class="bf-tuning-c">${ctl}</span></div>`;
}

/** Betaflight-style row: [control | label | help bulb]. Same data attributes as fieldHtml, so bindForm drives it too. */
export function rowHtml(f: Form, s: FieldSpec): string {
  const bulb = s.tipKey ? tip(s.tipKey) : s.tip ? tipText(s.tip, s.label) : '<span class="bf-tip-gap"></span>';
  const lbl = `<label class="bf-lbl">${escapeHtml(s.label)}</label>`;
  if (!f.has(s.g, s.k)) return `<div class="bf-row na" title="${escapeHtml(t('bfTuning.common.unsupported'))}"><div class="bf-ctl"><span class="bf-tuning-na mono">—</span></div>${lbl}${bulb}</div>`;
  const v = f.get(s.g, s.k);
  const sc = s.scale ?? 1;
  const dat = `data-g="${s.g}" data-k="${s.k}"`;
  let ctl: string;
  if (s.options) ctl = `<select ${dat} aria-label="${escapeHtml(s.label)}">${s.options.map((o) => `<option value="${o.v}"${o.v === v ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
  else if (s.check) ctl = `<label class="bf-sw${v ? ' on' : ''}"><input type="checkbox" ${dat} ${v ? 'checked' : ''} aria-label="${escapeHtml(s.label)}"><i></i><span class="bf-sw-t">${escapeHtml(s.label)}</span></label>`;
  else {
    const rng = s.slider ? `<input type="range" class="bf-tuning-rng" ${dat} data-sync style="--p:${pct(v, s).toFixed(1)}%" min="${s.min * sc}" max="${s.max * sc}" step="${sc}" value="${numStr(v, sc)}" aria-label="${escapeHtml(s.label)}">` : '';
    ctl = `<input type="number" class="mono" ${dat} min="${s.min * sc}" max="${s.max * sc}" step="${sc}" value="${numStr(v, sc)}" aria-label="${escapeHtml(s.label)}">${s.unit ? `<span class="bf-unit mono">${escapeHtml(s.unit)}</span>` : ''}${rng}`;
  }
  return `<div class="bf-row${f.isChanged(s.g, s.k) ? ' chg' : ''}${s.slider ? ' sl' : ''}" data-fk="${s.g}.${s.k}"><div class="bf-ctl">${ctl}</div>${lbl}${bulb}</div>`;
}

/** Bare number / select cell for tables (no label); changed values are marked on the cell. */
export function cellHtml(f: Form, s: FieldSpec): string {
  if (!f.has(s.g, s.k)) return `<span class="tn-cell na" title="${escapeHtml(t('bfTuning.common.unsupported'))}"><span class="bf-tuning-na mono">—</span></span>`;
  const v = f.get(s.g, s.k);
  const sc = s.scale ?? 1;
  const dat = `data-g="${s.g}" data-k="${s.k}"`;
  return `<span class="tn-cell bf-ctl${f.isChanged(s.g, s.k) ? ' chg' : ''}" data-fk="${s.g}.${s.k}"><input type="number" class="mono" ${dat} min="${s.min * sc}" max="${s.max * sc}" step="${sc}" value="${numStr(v, sc)}" aria-label="${escapeHtml(s.label)}">${s.unit ? `<span class="bf-unit mono">${escapeHtml(s.unit)}</span>` : ''}</span>`;
}

/** Panel with an amber pill title (the v1 kit's .bf-panel). */
export const panelHtml = (title: string, body: string, opts: { tip?: TipKey; tipTxt?: string; hint?: string; expert?: boolean; cls?: string } = {}): string =>
  `<section class="bf-panel ${opts.cls ?? ''}"${opts.expert ? ' data-level="expert"' : ''}><header><span class="bf-legend">${escapeHtml(title)}${opts.tip ? tip(opts.tip) : opts.tipTxt ? tipText(opts.tipTxt) : ''}</span>${opts.hint ? `<small>${escapeHtml(opts.hint)}</small>` : ''}</header>${body}</section>`;

export const sectionHtml = (title: string, body: string, note = '', opts: { tip?: TipKey; expert?: boolean } = {}): string =>
  `<section class="bf-tuning-sec"${opts.expert ? ' data-level="expert"' : ''}><div class="bf-tuning-cap mono"><span>${escapeHtml(title)}${opts.tip ? ` ${tip(opts.tip)}` : ''}</span>${note ? `<span class="dim">${escapeHtml(note)}</span>` : ''}</div>${body}</section>`;

/**
 * Delegated handler for [data-g][data-k] controls. Out-of-range or non-numeric typing is marked `.bad` and ignored;
 * `change` snaps the control back to the current valid value. `onChange` runs after a valid edit.
 */
export function bindForm(root: HTMLElement, form: Form, specs: () => FieldSpec[], onChange: (g: string, k: string) => void): () => void {
  const find = (g: string, k: string) => specs().find((s) => s.g === g && s.k === k);
  const refreshWrap = (inp: HTMLElement, g: string, k: string) => {
    const wrap = inp.closest<HTMLElement>('.bf-tuning-f, .bf-row, .tn-cell');
    wrap?.classList.toggle('chg', form.isChanged(g, k));
  };
  const onInput = (e: Event) => {
    const inp = e.target as HTMLInputElement | HTMLSelectElement;
    const g = inp.dataset.g;
    const k = inp.dataset.k;
    if (!g || !k) return;
    const spec = find(g, k);
    if (!spec) return;
    const sc = spec.scale ?? 1;
    let raw: number;
    if (inp instanceof HTMLInputElement && inp.type === 'checkbox') raw = inp.checked ? 1 : 0;
    else {
      const val = Number(inp.value);
      raw = Math.round(val / sc);
      if (inp.value === '' || !Number.isFinite(val) || raw < spec.min || raw > spec.max) {
        inp.classList.add('bad');
        return;
      }
    }
    inp.classList.remove('bad');
    form.set(g, k, raw);
    if (inp instanceof HTMLInputElement && inp.type === 'checkbox') inp.closest('.bf-sw')?.classList.toggle('on', inp.checked);
    // keep slider and number box of the same control in sync
    if (inp instanceof HTMLInputElement && inp.type !== 'checkbox') {
      inp.closest('.bf-tuning-c, .bf-ctl')?.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((o) => {
        if (o !== inp) o.value = numStr(raw, sc);
        if (o.type === 'range') o.style.setProperty('--p', `${pct(raw, spec).toFixed(1)}%`);
        o.classList.remove('bad');
      });
    }
    refreshWrap(inp, g, k);
    onChange(g, k);
  };
  const onCommit = (e: Event) => {
    const inp = e.target as HTMLInputElement;
    const g = inp.dataset?.g;
    const k = inp.dataset?.k;
    if (!g || !k || inp.type === 'checkbox' || inp instanceof HTMLSelectElement) return;
    const spec = find(g, k);
    if (spec && form.has(g, k)) {
      inp.value = numStr(form.get(g, k), spec.scale ?? 1);
      inp.classList.remove('bad');
    }
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  root.addEventListener('focusout', onCommit);
  return () => {
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onInput);
    root.removeEventListener('focusout', onCommit);
  };
}

/** Sticky bar: change counter, Revert, Save (or Save and reboot). */
export function barHtml(): string {
  return `<div class="bf-tuning-bar" role="region" aria-label="${escapeHtml(t('bfTuning.common.save'))}">
    <span class="bf-tuning-bar-n mono" data-bar-n></span>
    <span class="bf-tuning-bar-sp"></span>
    <button class="btn ghost" data-act="ask">${icon('chip', 16)}${t('bfTuning.common.askAi')}</button>
    <button class="btn ghost" data-act="revert" disabled>${t('bfTuning.common.revert')}</button>
    <button class="btn amber" data-act="save" disabled>${icon('check', 16)}<span data-bar-save>${t('bfTuning.common.save')}</span></button>
  </div>`;
}

export function updateBar(root: HTMLElement, n: number, opts: { busy?: boolean; reboot?: boolean } = {}): void {
  const cnt = root.querySelector<HTMLElement>('[data-bar-n]');
  if (cnt) {
    cnt.textContent = n ? t('bfTuning.common.changes', { n }) : t('bfTuning.common.noChanges');
    cnt.classList.toggle('hot', n > 0);
  }
  const save = root.querySelector<HTMLButtonElement>('[data-act="save"]');
  const rev = root.querySelector<HTMLButtonElement>('[data-act="revert"]');
  if (save) save.disabled = n === 0 || !!opts.busy;
  if (rev) rev.disabled = n === 0 || !!opts.busy;
  const lbl = root.querySelector<HTMLElement>('[data-bar-save]');
  if (lbl) lbl.textContent = opts.busy ? t('bfTuning.common.saving') : opts.reboot ? t('bfTuning.common.saveReboot') : t('bfTuning.common.save');
}

export function noticeHtml(kind: 'info' | 'warn' | 'err', text: string): string {
  return `<div class="bf-tuning-note ${kind}" role="${kind === 'err' ? 'alert' : 'status'}"><i></i><span>${escapeHtml(text)}</span></div>`;
}

export function disconnectedHtml(): string {
  return `<div class="bf-tuning-empty"><div class="bf-tuning-film mono">${escapeHtml(t('bfTuning.common.film'))}</div><h1>${escapeHtml(t('bfTuning.common.needFcTitle'))}</h1><p>${escapeHtml(t('bfTuning.common.needFcLead'))}</p></div>`;
}

export function errorHtml(msg: string): string {
  return `<div class="bf-tuning-empty"><div class="bf-tuning-film mono">${escapeHtml(t('bfTuning.common.film'))}</div><h1>${escapeHtml(t('bfTuning.common.readFailTitle'))}</h1><p class="bf-tuning-err" role="alert">${escapeHtml(msg)}</p><div class="bf-tuning-btns"><button class="btn light" data-act="reload">${t('bfTuning.common.retry')}</button></div></div>`;
}

export { errMsg } from '../bf/steps';
