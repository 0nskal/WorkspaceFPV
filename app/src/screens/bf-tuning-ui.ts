/**
 * Shared UI helpers for the tuning / receiver / modes tabs: a small edit model (current vs. as-read values per group),
 * field rendering with changed-value highlighting, delegated input handling with range validation, and the sticky save bar.
 * Classes are prefixed .bf-tuning- (the three tabs share this block of CSS).
 */
import type { Values } from '../bf/fieldtable';
import { escapeHtml } from '../ui/dom';
import { fmtNum, t } from '../i18n';
import { icon } from '../ui/icons';

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
const numStr = (raw: number, scale: number) => (raw * scale).toFixed(decimals(scale));

/** Renders one control; a field the firmware does not report is shown dimmed with a tooltip. */
export function fieldHtml(f: Form, s: FieldSpec): string {
  const tip = s.tip ? ` title="${escapeHtml(s.tip)}"` : '';
  const label = s.bare ? '' : `<span class="bf-tuning-lb"${tip}>${escapeHtml(s.label)}</span>`;
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
    const rng = s.slider ? `<input type="range" class="bf-tuning-rng" ${dat} data-sync min="${s.min * sc}" max="${s.max * sc}" step="${sc}" value="${numStr(v, sc)}" aria-label="${escapeHtml(s.label)}">` : '';
    ctl = `${rng}<input type="number" class="bf-tuning-num mono" ${dat} min="${s.min * sc}" max="${s.max * sc}" step="${sc}" value="${numStr(v, sc)}" aria-label="${escapeHtml(s.label)}">${s.unit ? `<span class="bf-tuning-u mono">${escapeHtml(s.unit)}</span>` : ''}`;
  }
  return `<div class="bf-tuning-f${ch} ${s.slider ? 'sl' : ''} ${s.cls ?? ''}" data-fk="${s.g}.${s.k}">${label}<span class="bf-tuning-c">${ctl}</span></div>`;
}

export const sectionHtml = (title: string, body: string, note = ''): string =>
  `<section class="bf-tuning-sec"><div class="bf-tuning-cap mono"><span>${escapeHtml(title)}</span>${note ? `<span class="dim">${escapeHtml(note)}</span>` : ''}</div>${body}</section>`;

/**
 * Delegated handler for [data-g][data-k] controls. Out-of-range or non-numeric typing is marked `.bad` and ignored;
 * `change` snaps the control back to the current valid value. `onChange` runs after a valid edit.
 */
export function bindForm(root: HTMLElement, form: Form, specs: () => FieldSpec[], onChange: (g: string, k: string) => void): () => void {
  const find = (g: string, k: string) => specs().find((s) => s.g === g && s.k === k);
  const refreshWrap = (inp: HTMLElement, g: string, k: string) => {
    const wrap = inp.closest<HTMLElement>('.bf-tuning-f');
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
    // keep slider and number box of the same control in sync
    if (inp instanceof HTMLInputElement && inp.type !== 'checkbox') {
      inp.closest('.bf-tuning-c')?.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((o) => {
        if (o !== inp) o.value = numStr(raw, sc);
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
    <button class="btn light" data-act="save" disabled>${icon('check', 16)}<span data-bar-save>${t('bfTuning.common.save')}</span></button>
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

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
