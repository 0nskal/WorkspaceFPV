/**
 * OSD tab: element list with on/off per OSD profile, drag-to-place preview on a PAL / NTSC / HD character grid,
 * units, alarms, warnings and post-flight stats. Read with MSP_OSD_CONFIG, written with MSP_SET_OSD_CONFIG
 * (one command per changed item plus one general block) and EEPROM write.
 */
import type { AppContext, ScreenMount } from '../context';
import { t } from '../i18n';
import { intro, tip, type TipKey } from '../ui/tip';
import {
  MSPO,
  OSD_FLAG,
  OSD_ITEMS,
  OSD_STATS,
  OSD_WARNINGS,
  decodeCanvas,
  decodeOsdConfig,
  decodePos,
  diffOsd,
  encodePos,
  gridFor,
  type OsdConfig,
  type OsdGrid,
} from '../bf/osd';
import { AREA, rawOf, STEP } from '../bf/steps';
import type { MspWrite } from '../bf/store';
import { bindConnect, emptyHtml } from '../bf/ui-bits';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import './bf-osd.css';

type K = 'bfOsd.item.rssi';
const VIDEO = ['auto', 'pal', 'ntsc', 'hd'];

/** Lightbulb per element / warning key (the long tail has none; the Elements tip covers it). */
const ITEM_TIPS: Record<string, TipKey> = {
  battVoltage: 'tips.osd.itemBattery',
  avgCell: 'tips.osd.itemBattery',
  mah: 'tips.osd.itemMah',
  timer1: 'tips.osd.itemTimer',
  timer2: 'tips.osd.itemTimer',
  rssi: 'tips.osd.itemRssi',
  linkQuality: 'tips.osd.itemLink',
  crosshairs: 'tips.osd.itemCrosshair',
  warnings: 'tips.osd.itemWarnings',
  flymode: 'tips.osd.itemMode',
};
const WARN_TIPS: Record<string, TipKey> = {
  armingDisabled: 'tips.osd.warnArming',
  batteryWarning: 'tips.osd.warnBattery',
  batteryCritical: 'tips.osd.warnBattery',
  visualBeeper: 'tips.osd.warnBeeper',
  crashFlip: 'tips.osd.warnCrashFlip',
  escFail: 'tips.osd.warnEsc',
  coreTemp: 'tips.osd.warnCoreTemp',
  rcSmoothing: 'tips.osd.warnSmoothing',
  failsafe: 'tips.osd.warnFailsafe',
  rssi: 'tips.osd.warnLink',
  linkQuality: 'tips.osd.warnLink',
  rssiDbm: 'tips.osd.warnLink',
};

const clone = (c: OsdConfig): OsdConfig => ({ ...c, items: [...c.items], stats: [...c.stats], timers: [...c.timers] });

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  const root = document.createElement('div');
  root.className = 'bf-osd';
  el.appendChild(root);
  let disposed = false;
  let cfg: OsdConfig | null = null;
  let edit: OsdConfig | null = null;
  let canvas: OsdGrid | null = null;
  let status: 'idle' | 'loading' | 'ready' | 'unsupported' = 'idle';
  let prof = 0;
  let sel = -1;
  let filter = '';
  let saving = false;
  let connKey = '';
  const offConn = bindConnect(root, ctx);

  const itemName = (i: number) => (OSD_ITEMS[i] ? t(`bfOsd.item.${OSD_ITEMS[i]!.key}` as K) : t('bfOsd.itemN', { n: i }));
  const grid = (): OsdGrid => gridFor(edit?.video ?? 1, canvas);
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));

  /** Decodes the OSD layout the Betaflight store read; false when the FC has no OSD (or did not answer). */
  function fromStore(): boolean {
    const d = ctx.bf.get();
    const p = rawOf(d, STEP.osd);
    const c = p ? decodeOsdConfig(p) : null;
    if (!c || !(c.flags & OSD_FLAG.supported)) return false;
    cfg = c;
    edit = clone(c);
    prof = Math.min(c.profile, 2);
    const cv = c.video === 3 || c.flags & OSD_FLAG.displayport ? rawOf(d, STEP.osdCanvas) : null;
    canvas = cv ? decodeCanvas(cv) : null;
    return true;
  }

  /** Shows the connect-time layout at once, then re-reads it (it may have changed in the goggles' OSD menu or the CLI). */
  async function load(): Promise<void> {
    status = fromStore() ? 'ready' : 'loading';
    paint();
    await ctx.bf.refresh(AREA.osd);
    if (disposed || saving || nChanges()) return;
    status = fromStore() ? 'ready' : 'unsupported';
    paint();
  }

  const changedItem = (i: number) => !!cfg && !!edit && cfg.items[i] !== edit.items[i];
  const nChanges = () => (cfg && edit ? diffOsd(cfg, edit).length : 0);

  function chips(): string {
    if (!edit) return '';
    const g = grid();
    const out: string[] = [];
    edit.items.forEach((w, i) => {
      const p = decodePos(w);
      if (!p.vis[prof]) return;
      const x = Math.min(p.x, g.cols - 1);
      const y = Math.min(p.y, g.rows - 1);
      const sample = OSD_ITEMS[i]?.sample ?? `#${i}`;
      const off = p.x >= g.cols || p.y >= g.rows;
      out.push(`<div class="bf-osd-chip mono${sel === i ? ' sel' : ''}${changedItem(i) ? ' chg' : ''}${off ? ' off' : ''}" data-i="${i}" style="left:${((x / g.cols) * 100).toFixed(3)}%;top:${((y / g.rows) * 100).toFixed(3)}%" title="${escapeHtml(itemName(i))} (${p.x},${p.y})">${escapeHtml(sample)}</div>`);
    });
    return out.join('');
  }

  const sw = (attr: string, idx: number | string, on: boolean, label: string) =>
    `<label class="bf-sw${on ? ' on' : ''}"><input type="checkbox" data-${attr}="${idx}" ${on ? 'checked' : ''} aria-label="${escapeHtml(label)}"><i></i></label>`;

  function elementsPanel(): string {
    const e = edit!;
    const f = filter.toLowerCase();
    const rows = e.items
      .map((w, i) => ({ i, p: decodePos(w), name: itemName(i) }))
      .filter((r) => !f || r.name.toLowerCase().includes(f))
      .map((r) => {
        const tk = ITEM_TIPS[OSD_ITEMS[r.i]?.key ?? ''];
        return `<div class="bf-row bf-osd-el${sel === r.i ? ' sel' : ''}${changedItem(r.i) ? ' chg' : ''}" data-row="${r.i}">
          <div class="bf-ctl">${sw('vis', r.i, !!r.p.vis[prof], r.name)}</div>
          <span class="bf-lbl"><span>${escapeHtml(r.name)}</span><small class="mono bf-osd-xy">${r.p.x},${r.p.y}</small></span>${tk ? tip(tk) : '<span class="bf-tip-gap"></span>'}
        </div>`;
      })
      .join('');
    const profs = Array.from({ length: Math.min(e.profileCount || 3, 3) }, (_, k) => `<button type="button" data-prof="${k}" class="${k === prof ? 'on' : ''}" aria-pressed="${k === prof}">${k + 1}${k === e.profile ? ' ●' : ''}</button>`).join('');
    return `<section class="bf-panel bf-osd-elements"><header><span class="bf-legend">${t('bfOsd.sub.elements')} ${tip('tips.osd.elements')}</span></header>
      <div class="bf-osd-profile" data-level="expert"><span>${t('bfOsd.profile')}</span>${tip('tips.osd.profile')}<div class="bf-osd-seg">${profs}</div><button type="button" class="btn ghost" data-act="activate" ${prof === e.profile ? 'disabled' : ''}>${t('bfOsd.makeActive')}</button></div>
      <input class="bf-osd-search" type="search" placeholder="${escapeHtml(t('bfOsd.search'))}" value="${escapeHtml(filter)}" data-search aria-label="${t('bfOsd.search')}">
      <div class="bf-osd-list">${rows || `<p class="bf-osd-empty">${t('bfOsd.noMatch')}</p>`}</div></section>`;
  }

  function warningsPanel(): string {
    const e = edit!;
    const n = Math.min(Math.max(e.warningCount, 0), 32);
    const rows = OSD_WARNINGS.slice(0, n || OSD_WARNINGS.length)
      .map((k, b) => {
        const on = ((e.warnings >>> b) & 1) === 1;
        const was = ((cfg!.warnings >>> b) & 1) === 1;
        const name = t(`bfOsd.warn.${k}` as 'bfOsd.warn.rssi');
        return `<div class="bf-row${on !== was ? ' chg' : ''}"><div class="bf-ctl">${sw('warn', b, on, name)}</div><label class="bf-lbl">${name}</label>${WARN_TIPS[k] ? tip(WARN_TIPS[k]!) : '<span class="bf-tip-gap"></span>'}</div>`;
      })
      .join('');
    return `<section class="bf-panel"><header><span class="bf-legend">${t('bfOsd.sub.warnings')} ${tip('tips.osd.warnings')}</span></header><div class="bf-osd-sw">${rows}</div></section>`;
  }

  function statsPanel(): string {
    const e = edit!;
    const rows = e.stats
      .map((st, i) => {
        const key = OSD_STATS[i];
        const name = key ? t(`bfOsd.stat.${key}` as 'bfOsd.stat.timer1') : t('bfOsd.itemN', { n: i });
        return `<div class="bf-row${st !== cfg!.stats[i] ? ' chg' : ''}"><div class="bf-ctl">${sw('stat', i, !!st, name)}</div><label class="bf-lbl">${escapeHtml(name)}</label><span class="bf-tip-gap"></span></div>`;
      })
      .join('');
    return `<section class="bf-panel" data-level="expert"><header><span class="bf-legend">${t('bfOsd.sub.stats')} ${tip('tips.osd.stats')}</span></header><div class="bf-osd-sw">${rows}</div></section>`;
  }

  function settingsPanels(): string {
    const e = edit!;
    const c = cfg!;
    const num1 = (key: string, label: string, val: number, was: number, unit: string, max: number, tk: TipKey, expert = false) =>
      `<div class="bf-row${val !== was ? ' chg' : ''}"${expert ? ' data-level="expert"' : ''}><div class="bf-ctl"><input type="number" min="0" max="${max}" step="1" value="${val}" data-num="${key}" aria-label="${escapeHtml(label)}"><span class="bf-unit">${unit}</span></div><label class="bf-lbl">${label}</label>${tip(tk)}</div>`;
    const video = [0, 1, 2, 3].map((v) => `<option value="${v}" ${e.video === v ? 'selected' : ''}>${t(`bfOsd.video.${VIDEO[v] ?? 'pal'}` as 'bfOsd.video.pal')}</option>`).join('');
    return `<section class="bf-panel"><header><span class="bf-legend">${t('bfOsd.videoHead')}</span></header>
        <div class="bf-row${e.video !== c.video ? ' chg' : ''}"><div class="bf-ctl"><select data-sel="video" aria-label="${t('bfOsd.videoSystem')}">${video}</select></div><label class="bf-lbl">${t('bfOsd.videoSystem')}</label>${tip('tips.osd.video')}</div>
      </section>
      <section class="bf-panel"><header><span class="bf-legend">${t('bfOsd.alarmsHead')}</span></header>
        ${num1('rssiAlarm', t('bfOsd.rssiAlarm'), e.rssiAlarm, c.rssiAlarm, '%', 100, 'tips.osd.rssiAlarm')}
        ${num1('capAlarm', t('bfOsd.capAlarm'), e.capAlarm, c.capAlarm, 'mAh', 65535, 'tips.osd.capAlarm')}
        ${num1('altAlarm', t('bfOsd.altAlarm'), e.altAlarm, c.altAlarm, 'm', 65535, 'tips.osd.altAlarm', true)}
        ${e.lqAlarm !== null ? num1('lqAlarm', t('bfOsd.lqAlarm'), e.lqAlarm, c.lqAlarm ?? 0, '%', 100, 'tips.osd.lqAlarm') : ''}
      </section>
      <section class="bf-panel"><header><span class="bf-legend">${t('bfOsd.units')}</span></header>
        <div class="bf-row${e.units !== c.units ? ' chg' : ''}"><div class="bf-ctl"><select data-sel="units" aria-label="${t('bfOsd.units')}"><option value="1" ${e.units === 1 ? 'selected' : ''}>${t('bfOsd.metric')}</option><option value="0" ${e.units === 0 ? 'selected' : ''}>${t('bfOsd.imperial')}</option></select></div><label class="bf-lbl">${t('bfOsd.units')}</label>${tip('tips.osd.units')}</div>
      </section>`;
  }

  function paint(): void {
    if (disposed) return;
    const s = ctx.state.get();
    if (s.conn !== 'connected') {
      root.innerHTML = emptyHtml(ctx, t('bfOsd.emptyTag'), t('bfOsd.emptyTitle'), t('bfOsd.emptyLead'));
      return;
    }
    if (status !== 'ready' || !edit || !cfg) {
      root.innerHTML = `<p class="bf-osd-msg">${status === 'unsupported' ? t('bfOsd.unsupported') : t('bfOsd.loading')}</p>`;
      return;
    }
    const g = grid();
    const hd = edit.video === 3;
    const n = nChanges();
    const keep = root.querySelector<HTMLElement>('.bf-osd-list')?.scrollTop ?? 0;
    const keepSide = root.querySelector<HTMLElement>('.bf-osd-scroll')?.scrollTop ?? 0;
    root.innerHTML = `<div class="bf-osd-wrap">
      <header class="bf-head"><h2>${t('bfOsd.title')}</h2><span class="bf-osd-sub">${t(`bfOsd.video.${VIDEO[edit.video] ?? 'pal'}` as 'bfOsd.video.pal')} · ${g.cols} × ${g.rows}${hd && !canvas ? ' · ' + t('bfOsd.defaultCanvas') : ''}</span></header>
      <div class="bf-osd-scroll">
        ${intro('tips.osd.intro')}
        <div class="bf-osd-cols">
          <div class="bf-osd-colL">${elementsPanel()}</div>
          <div class="bf-osd-stage"><section class="bf-panel"><header><span class="bf-legend">${t('bfOsd.previewHead')}</span></header>
            <div class="bf-osd-frame"><div class="bf-osd-grid" style="aspect-ratio:${g.cols * 12} / ${g.rows * 18};--cols:${g.cols};--rows:${g.rows}">${chips()}</div></div>
            <p class="bf-osd-note">${t('bfOsd.dragNote')}</p></section></div>
          <div class="bf-osd-colR">${settingsPanels()}${warningsPanel()}${statsPanel()}</div>
        </div>
      </div>
      <footer class="bf-osd-save">
        <span class="bf-osd-pending${n ? ' has' : ''}">${n ? escapeHtml(t('bfOsd.pending', { n })) : t('esc.noChanges')}</span>
        <button type="button" class="btn ghost" data-act="ask">${icon('chip', 16)}${t('bfOsd.askAi')}</button>
        <button type="button" class="btn ghost" data-act="revert" ${n === 0 || saving ? 'disabled' : ''}>${t('bfMotors.revert')}</button>
        <button type="button" class="btn amber" data-act="save" ${n === 0 || saving ? 'disabled' : ''}>${icon('check', 16)}${t('bfOsd.save')}</button>
      </footer></div>`;
    const list = root.querySelector<HTMLElement>('.bf-osd-list');
    if (list) list.scrollTop = keep;
    const side = root.querySelector<HTMLElement>('.bf-osd-scroll');
    if (side) side.scrollTop = keepSide;
  }

  async function save(): Promise<void> {
    if (!cfg || !edit || saving) return;
    const payloads = diffOsd(cfg, edit);
    if (!payloads.length) return;
    saving = true;
    paint();
    const writes: MspWrite[] = payloads.map((payload) => ({ code: MSPO.SET_OSD_CONFIG, payload, label: 'SET_OSD_CONFIG' }));
    const res = await ctx.bf.saveSettings(writes, { areas: AREA.osd });
    saving = false;
    if (res.ok) ctx.toast(t('bfOsd.saved'), 'ok');
    else ctx.toast(t('bfOsd.saveFail', { msg: res.error ?? '' }), 'error');
    if (disposed) return;
    status = fromStore() ? 'ready' : 'unsupported';
    paint();
  }

  function summary(): string {
    if (!edit) return '';
    const on = edit.items.map((w, i) => ({ i, p: decodePos(w) })).filter((x) => x.p.vis[edit!.profile]);
    return t('bfOsd.aiSummary', { video: t(`bfOsd.video.${VIDEO[edit.video] ?? 'pal'}` as 'bfOsd.video.pal'), units: edit.units ? t('bfOsd.metric') : t('bfOsd.imperial'), n: on.length, names: on.map((x) => itemName(x.i)).join(', ') });
  }

  /* ---------- drag ---------- */
  let drag: { i: number; dx: number; dy: number } | null = null;
  function cellAt(ev: PointerEvent): { x: number; y: number } | null {
    const gEl = root.querySelector<HTMLElement>('.bf-osd-grid');
    if (!gEl) return null;
    const r = gEl.getBoundingClientRect();
    const g = grid();
    return { x: ((ev.clientX - r.left) / r.width) * g.cols, y: ((ev.clientY - r.top) / r.height) * g.rows };
  }
  root.addEventListener('pointerdown', (ev) => {
    const chip = (ev.target as HTMLElement).closest<HTMLElement>('.bf-osd-chip');
    if (!chip || !edit) return;
    const i = Number(chip.dataset.i);
    const c = cellAt(ev);
    const p = decodePos(edit.items[i]!);
    if (!c) return;
    drag = { i, dx: c.x - p.x, dy: c.y - p.y };
    sel = i;
    chip.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    root.querySelectorAll('.bf-osd-chip.sel,.bf-osd-el.sel').forEach((n) => n.classList.remove('sel'));
    chip.classList.add('sel');
    root.querySelector(`[data-row="${i}"]`)?.classList.add('sel');
  });
  root.addEventListener('pointermove', (ev) => {
    if (!drag || !edit) return;
    const c = cellAt(ev);
    if (!c) return;
    const g = grid();
    const x = Math.max(0, Math.min(g.cols - 1, Math.round(c.x - drag.dx)));
    const y = Math.max(0, Math.min(g.rows - 1, Math.round(c.y - drag.dy)));
    const p = decodePos(edit.items[drag.i]!);
    if (p.x === x && p.y === y) return;
    edit.items[drag.i] = encodePos({ ...p, x, y });
    const chip = root.querySelector<HTMLElement>(`.bf-osd-chip[data-i="${drag.i}"]`);
    if (chip) {
      chip.style.left = `${((x / g.cols) * 100).toFixed(3)}%`;
      chip.style.top = `${((y / g.rows) * 100).toFixed(3)}%`;
      chip.classList.add('chg');
    }
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    paint();
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  root.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    if (tg.closest('.tip')) return;
    const pf = tg.closest<HTMLElement>('[data-prof]');
    if (pf) {
      prof = Number(pf.dataset.prof);
      return paint();
    }
    const row = tg.closest<HTMLElement>('[data-row]');
    if (row && !tg.closest('.bf-sw,.tip')) {
      sel = Number(row.dataset.row);
      return paint();
    }
    const act = tg.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'save') void save();
    else if (act === 'revert' && cfg) {
      edit = clone(cfg);
      paint();
    } else if (act === 'ask') ctx.askAi(summary());
    else if (act === 'activate' && edit) {
      edit.profile = prof;
      paint();
    }
  });
  root.addEventListener('input', (e) => {
    const i = e.target as HTMLInputElement;
    if (i.matches('[data-search]')) {
      filter = i.value;
      const pos = i.selectionStart;
      paint();
      const again = root.querySelector<HTMLInputElement>('[data-search]');
      again?.focus();
      if (pos !== null) again?.setSelectionRange(pos, pos);
    }
  });
  root.addEventListener('change', (e) => {
    const i = e.target as HTMLInputElement | HTMLSelectElement;
    if (!edit) return;
    const d = (i as HTMLInputElement).dataset;
    if (d.vis !== undefined) {
      const idx = Number(d.vis);
      const p = decodePos(edit.items[idx]!);
      p.vis[prof] = (i as HTMLInputElement).checked;
      edit.items[idx] = encodePos(p);
      if (p.vis[prof] && (p.x === 0 && p.y === 0)) {
        const g = grid();
        edit.items[idx] = encodePos({ ...p, x: Math.floor(g.cols / 2) - 2, y: Math.floor(g.rows / 2) });
      }
      sel = idx;
    } else if (d.warn !== undefined) {
      const b = Number(d.warn);
      edit.warnings = ((i as HTMLInputElement).checked ? edit.warnings | (1 << b) : edit.warnings & ~(1 << b)) >>> 0;
    } else if (d.stat !== undefined) edit.stats[Number(d.stat)] = (i as HTMLInputElement).checked ? 1 : 0;
    else if (d.sel === 'video') edit.video = Number(i.value);
    else if (d.sel === 'units') edit.units = Number(i.value);
    else if (d.num) {
      const key = d.num as 'rssiAlarm' | 'capAlarm' | 'altAlarm' | 'lqAlarm';
      (edit as unknown as Record<string, number | null>)[key] = num(i.value);
    } else return;
    paint();
  });

  const off = ctx.state.subscribe(() => {
    const k = ctx.state.get().conn;
    if (k === connKey) return;
    connKey = k;
    if (k === 'connected') void load();
    else {
      status = 'idle';
      paint();
    }
  });
  connKey = ctx.state.get().conn;
  if (connKey === 'connected') void load();
  else paint();

  return () => {
    disposed = true;
    off();
    offConn();
    root.remove();
  };
};
