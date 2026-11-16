/**
 * Declarative editable tab: a TabSpec describes groups of fields, how to build the draft from the store and how to turn
 * the draft into MSP writes. mountFormTab() renders it (changed fields in red, validation, sticky Save/Revert bar,
 * "Ask AI about this tab") and saves through ctx.bf.saveSettings(). See docs/ARCHITECTURE.md.
 */
import type { AppContext } from '../context';
import { t, type Key } from '../i18n';
import { escapeHtml } from '../ui/dom';
import type { BfArea, BfData, MspWrite } from './store';

export type Val = number | string | boolean;
export type Draft = Record<string, Val>;

export interface FieldDef {
  key: string;
  label: string;
  /** One-line explanation (tooltip + small text). */
  tip?: string;
  type: 'number' | 'select' | 'check' | 'text' | 'info';
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  maxLen?: number;
  options?: Array<{ value: number | string; label: string }>;
  /** Value shown by type 'info' (read-only). */
  text?: string;
  disabled?: boolean;
  /** Amber note under the field. */
  note?: string;
}

export interface Group {
  title: string;
  hint?: string;
  fields: FieldDef[];
  /** Span both columns. */
  wide?: boolean;
  /** Custom markup instead of one row per field (the fields are still validated and summarised); use bareHtml() for the controls. */
  render?: (draft: Draft, base: Draft) => string;
}

/** Handed to TabSpec.live: lets a live panel read or change the draft. */
export interface LiveApi {
  draft(): Draft;
  /** Sets a draft value and re-renders the tab. */
  set(key: string, v: Val): void;
}

export interface TabSpec {
  id: string;
  title: string;
  /** Areas re-read when the tab opens and after saving. */
  areas: BfArea[];
  /** False -> "not supported by this firmware". */
  ready(bf: BfData): boolean;
  toDraft(bf: BfData): Draft;
  groups(bf: BfData, draft: Draft): Group[];
  toWrites(draft: Draft, bf: BfData): MspWrite[];
  needsReboot?(changed: string[], draft: Draft, bf: BfData): boolean;
  /** Extra validation: returns an error message or null. */
  validate?(draft: Draft, bf: BfData): string | null;
  /** Rebuild the groups when one of these keys changes (visibility depends on them). */
  dynamic?: string[] | ((key: string) => boolean);
  /** Custom HTML above the groups (live panels) and its updater (called on telemetry/state ticks). */
  top?(bf: BfData, draft: Draft): string;
  /** Called once after every full render; may attach live updates and return a cleanup. */
  live?(el: HTMLElement, ctx: AppContext, api: LiveApi): (() => void) | void;
}

const eq = (a: Val | undefined, b: Val | undefined) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 || (Number.isNaN(a) && Number.isNaN(b)) : a === b);

export function fieldError(f: FieldDef, v: Val | undefined): string | null {
  if (f.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return t('bfCore.errNumber');
    if (f.min !== undefined && v < f.min) return t('bfCore.errMin', { n: f.min });
    if (f.max !== undefined && v > f.max) return t('bfCore.errMax', { n: f.max });
  } else if (f.type === 'text' && f.maxLen !== undefined && String(v ?? '').length > f.maxLen) return t('bfCore.errLen', { n: f.maxLen });
  return null;
}

const fmtVal = (f: FieldDef, v: Val | undefined): string => {
  if (v === undefined) return '';
  if (f.type === 'number') return typeof v === 'number' && Number.isFinite(v) ? (f.decimals !== undefined ? v.toFixed(f.decimals) : String(v)) : '';
  if (f.type === 'check') return v ? t('common.on') : t('common.off');
  if (f.type === 'select') return f.options?.find((o) => String(o.value) === String(v))?.label ?? String(v);
  return String(v);
};

export function fieldHtml(f: FieldDef, draft: Draft, base: Draft): string {
  const v = draft[f.key];
  const chg = f.type !== 'info' && !eq(v, base[f.key]);
  const err = f.type !== 'info' ? fieldError(f, v) : null;
  const id = `bf-f-${f.key.replace(/[^\w-]/g, '_')}`;
  let ctl = '';
  const dis = f.disabled ? 'disabled' : '';
  if (f.type === 'number') {
    ctl = `<input id="${id}" data-k="${escapeHtml(f.key)}" data-t="n" type="number" inputmode="decimal" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} step="${f.step ?? 1}" value="${escapeHtml(fmtVal(f, v))}" ${dis} />${f.unit ? `<span class="bf-unit mono">${escapeHtml(f.unit)}</span>` : ''}`;
  } else if (f.type === 'text') {
    ctl = `<input id="${id}" data-k="${escapeHtml(f.key)}" data-t="s" type="text" maxlength="${f.maxLen ?? 64}" value="${escapeHtml(String(v ?? ''))}" autocomplete="off" spellcheck="false" ${dis} />`;
  } else if (f.type === 'select') {
    ctl = `<select id="${id}" data-k="${escapeHtml(f.key)}" data-t="o" ${dis}>${(f.options ?? []).map((o) => `<option value="${escapeHtml(String(o.value))}" ${String(o.value) === String(v) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
  } else if (f.type === 'check') {
    ctl = `<label class="bf-sw ${v ? 'on' : ''}"><input id="${id}" data-k="${escapeHtml(f.key)}" data-t="b" type="checkbox" ${v ? 'checked' : ''} ${dis} /><i></i><span class="mono">${escapeHtml(fmtVal(f, v))}</span></label>`;
  } else {
    ctl = `<span class="bf-info mono">${escapeHtml(f.text ?? '')}</span>`;
  }
  return `<div class="bf-row${chg ? ' chg' : ''}${err ? ' bad' : ''}${f.type === 'info' ? ' info' : ''}" data-row="${escapeHtml(f.key)}"${f.tip ? ` title="${escapeHtml(f.tip)}"` : ''}>
    <label class="bf-lbl" for="${id}">${escapeHtml(f.label)}</label>
    <div class="bf-ctl">${ctl}</div>
    ${f.tip ? `<small class="bf-tip">${escapeHtml(f.tip)}</small>` : ''}
    ${f.note ? `<small class="bf-note">${escapeHtml(f.note)}</small>` : ''}
    <small class="bf-err" role="alert">${err ? escapeHtml(err) : ''}</small>
  </div>`;
}

/** Control only (no label/tip) wrapped as a changeable row: for custom group layouts such as tables. */
export function bareHtml(f: FieldDef, draft: Draft, base: Draft): string {
  return fieldHtml({ ...f, tip: undefined, note: undefined }, draft, base).replace('<div class="bf-row', '<div class="bf-row bare').replace(/<label class="bf-lbl"[^>]*>.*?<\/label>/s, '');
}

export function groupsHtml(groups: Group[], draft: Draft, base: Draft): string {
  return groups
    .map(
      (g) => `<section class="bf-panel${g.wide ? ' wide' : ''}">
      <header><span>${escapeHtml(g.title)}</span>${g.hint ? `<small>${escapeHtml(g.hint)}</small>` : ''}</header>
      <div class="bf-fields">${g.render ? g.render(draft, base) : g.fields.map((f) => fieldHtml(f, draft, base)).join('')}</div>
    </section>`,
    )
    .join('');
}

/** Plain-text summary of the current values (and unsaved edits) for the assistant. */
export function summarize(groups: Group[], draft: Draft, base: Draft): string {
  const lines: string[] = [];
  for (const g of groups) {
    for (const f of g.fields) {
      if (f.type === 'info') continue;
      const v = fmtVal(f, draft[f.key]);
      const was = fmtVal(f, base[f.key]);
      lines.push(`- ${g.title} / ${f.label}: ${v}${f.unit ? ` ${f.unit}` : ''}${v !== was ? ` (unsaved edit, FC has ${was}${f.unit ? ` ${f.unit}` : ''})` : ''}`);
    }
  }
  return lines.join('\n');
}

export function changedKeys(draft: Draft, base: Draft): string[] {
  return Object.keys(draft).filter((k) => !eq(draft[k], base[k]));
}

/** Mounts an editable tab into `el`. Returns the cleanup function for ScreenMount. */
export function mountFormTab(el: HTMLElement, ctx: AppContext, spec: TabSpec): () => void {
  let base: Draft = {};
  let draft: Draft = {};
  let saving = false;
  let liveOff: (() => void) | void;
  let lastReady = false;

  const bf = () => ctx.bf.get() as BfData;
  const connected = () => ctx.state.get().conn === 'connected';

  function message(kind: 'connect' | 'unsupported' | 'loading'): void {
    liveOff?.();
    liveOff = undefined;
    el.innerHTML = `<div class="bf-tab" data-tab="${spec.id}"><header class="bf-head"><h2>${escapeHtml(spec.title)}</h2></header><div class="bf-empty"><p>${escapeHtml(t(kind === 'connect' ? 'bfCore.needConnect' : kind === 'loading' ? 'bfCore.loading' : 'bfCore.unsupportedFw'))}</p>${kind === 'connect' ? `<button class="btn light" data-bf="demo">${escapeHtml(t('start.demo'))}</button>` : ''}</div></div>`;
    lastReady = false;
  }

  function render(): void {
    const d = bf();
    if (!connected()) return message('connect');
    if (!ctx.bf.store.isReady()) return message('loading');
    if (!d.supported || !spec.ready(d)) return message('unsupported');
    const groups = spec.groups(d, draft);
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.k;
    el.innerHTML = `<div class="bf-tab" data-tab="${spec.id}">
      <header class="bf-head">
        <h2>${escapeHtml(spec.title)}</h2>
        <span class="bf-count mono"></span>
        <button class="btn ghost bf-ask" data-bf="ask">${escapeHtml(t('bfCore.askAi'))}</button>
      </header>
      <div class="bf-body">
        ${spec.top ? `<div class="bf-top">${spec.top(d, draft)}</div>` : ''}
        <div class="bf-grid">${groupsHtml(groups, draft, base)}</div>
      </div>
      <footer class="bf-save">
        <span class="bf-save-msg"></span>
        <button class="btn ghost" data-bf="revert">${escapeHtml(t('bfCore.revert'))}</button>
        <button class="btn light" data-bf="save"></button>
      </footer>
    </div>`;
    lastReady = true;
    if (focusKey) el.querySelector<HTMLElement>(`[data-k="${CSS.escape(focusKey)}"]`)?.focus();
    liveOff?.();
    liveOff = spec.live?.(el, ctx, {
      draft: () => draft,
      set: (k, v) => {
        draft[k] = v;
        render();
      },
    });
    paint();
  }

  function validateAll(groups: Group[]): string | null {
    for (const g of groups) for (const f of g.fields) if (f.type !== 'info') {
      const e = fieldError(f, draft[f.key]);
      if (e) return `${f.label}: ${e}`;
    }
    return spec.validate?.(draft, bf()) ?? null;
  }

  /** Updates row highlights and the save bar without re-rendering (keeps input focus). */
  function paint(): void {
    if (!lastReady) return;
    const groups = spec.groups(bf(), draft);
    const changed = changedKeys(draft, base);
    el.querySelectorAll<HTMLElement>('.bf-row[data-row]').forEach((row) => {
      const k = row.dataset.row as string;
      const f = groups.flatMap((g) => g.fields).find((x) => x.key === k);
      row.classList.toggle('chg', changed.includes(k));
      const err = f && f.type !== 'info' ? fieldError(f, draft[k]) : null;
      row.classList.toggle('bad', !!err);
      const e = row.querySelector('.bf-err');
      if (e) e.textContent = err ?? '';
      const sw = row.querySelector('.bf-sw');
      if (sw && f) {
        sw.classList.toggle('on', !!draft[k]);
        const sp = sw.querySelector('span');
        if (sp) sp.textContent = fmtVal(f, draft[k]);
      }
    });
    const reboot = changed.length > 0 && (spec.needsReboot?.(changed, draft, bf()) ?? false);
    const err = validateAll(groups);
    const armed = ctx.bf.isArmed();
    const saveBtn = el.querySelector<HTMLButtonElement>('[data-bf="save"]');
    const revBtn = el.querySelector<HTMLButtonElement>('[data-bf="revert"]');
    const msg = el.querySelector<HTMLElement>('.bf-save-msg');
    const count = el.querySelector<HTMLElement>('.bf-count');
    if (saveBtn) {
      saveBtn.textContent = reboot ? t('bfCore.saveReboot') : t('bfCore.save');
      saveBtn.disabled = saving || changed.length === 0 || !!err || armed;
    }
    if (revBtn) revBtn.disabled = saving || changed.length === 0;
    if (count) count.textContent = changed.length ? t('bfCore.changes', { n: changed.length }) : '';
    if (msg) {
      msg.textContent = saving ? t('bfCore.saving') : armed ? t('bfCore.armedBlock') : err ? err : reboot && changed.length ? t('bfCore.rebootNote') : changed.length ? t('bfCore.unsaved') : t('bfCore.inSync');
      msg.classList.toggle('bad', !saving && (armed || !!err));
    }
    el.querySelector('.bf-save')?.classList.toggle('dirty', changed.length > 0);
  }

  function reload(): void {
    base = spec.toDraft(bf());
    draft = { ...base };
  }

  async function save(): Promise<void> {
    if (saving) return;
    const d = bf();
    const changed = changedKeys(draft, base);
    if (!changed.length) return;
    const writes = spec.toWrites(draft, d);
    if (!writes.length) return;
    const reboot = spec.needsReboot?.(changed, draft, d) ?? false;
    saving = true;
    paint();
    const res = await ctx.bf.saveSettings(writes, { reboot, areas: spec.areas });
    saving = false;
    if (res.ok) {
      ctx.toast(res.rebooted ? t('bfCore.savedReboot') : t('bfCore.saved'), 'ok');
      reload();
      render();
    } else {
      ctx.toast(res.error ?? t('bfCore.saveFail'), 'error');
      paint();
    }
  }

  el.addEventListener('input', (e) => {
    const tg = e.target as HTMLInputElement;
    const k = tg.dataset?.k;
    if (!k || tg.dataset.t === 'b' || tg.dataset.t === 'o') return;
    draft[k] = tg.dataset.t === 'n' ? (tg.value === '' ? NaN : Number(tg.value)) : tg.value;
    paint();
  });
  el.addEventListener('change', (e) => {
    const tg = e.target as HTMLInputElement | HTMLSelectElement;
    const k = tg.dataset?.k;
    if (!k) return;
    const kind = tg.dataset.t;
    if (kind === 'b') draft[k] = (tg as HTMLInputElement).checked;
    else if (kind === 'o') {
      const f = spec.groups(bf(), draft).flatMap((g) => g.fields).find((x) => x.key === k);
      const raw = tg.value;
      draft[k] = typeof f?.options?.[0]?.value === 'number' ? Number(raw) : raw;
    } else return;
    const dyn = typeof spec.dynamic === 'function' ? spec.dynamic(k) : spec.dynamic?.includes(k);
    if (dyn) render();
    else paint();
  });
  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-bf]')?.dataset.bf;
    if (act === 'save') void save();
    else if (act === 'revert') {
      reload();
      render();
    } else if (act === 'ask') {
      const groups = spec.groups(bf(), draft);
      ctx.askAi(`${t('bfCore.askPrompt', { tab: spec.title })}\n${summarize(groups, draft, base)}`);
    } else if (act === 'demo') void ctx.connectDemo();
  });

  let first = true;
  const onChange = () => {
    if (saving) return;
    const dirty = lastReady && changedKeys(draft, base).length > 0;
    if (dirty) {
      paint();
      return;
    }
    const ok = connected() && ctx.bf.store.isReady() && bf().supported && spec.ready(bf());
    if (ok) reload();
    render();
    if (first && ok) {
      first = false;
      void ctx.bf.refresh(spec.areas); // fresh values when the tab opens
    }
  };
  const offA = ctx.state.subscribe(onChange);
  const offB = ctx.bf.subscribe(onChange);
  let lastArmed = false;
  const offT = ctx.state.subscribeTelemetry(() => {
    // the armed state changes the save bar
    const a = ctx.bf.isArmed();
    if (lastReady && a !== lastArmed) paint();
    lastArmed = a;
  });
  onChange();

  return () => {
    offA();
    offB();
    offT();
    liveOff?.();
  };
}

export type { Key };
