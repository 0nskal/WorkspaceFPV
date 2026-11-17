/**
 * Modes (Auxiliary) tab: every flight mode with its AUX channel ranges, a live channel marker, and the FC's own
 * active-mode flags (MSP_STATUS_EX). Ranges can be added, moved and removed; nothing is written until "Save".
 */
import type { AppContext, ScreenMount } from '../context';
import { AREA, CMD, rawKey, rawOf, STEP } from '../bf/steps';
import { C } from '../bf/codes';
import { decodeStatusEx } from '../bf/decode';
import type { MspWrite } from '../bf/store';
import { decodeBoxIds, decodeBoxNames, decodeModeRanges, emptyRange, encodeSetModeRange, FALLBACK_BOXES, isEmptyRange, MODE_SLOTS, STEP_COUNT, stepToUs, usToStep, activeIdsFromFlags, type ModeRange } from '../bf/modes';
import { decodeRc } from '../bf/receiver';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { t } from '../i18n';
import { intro, tip, type TipKey } from '../ui/tip';
import { barHtml, disconnectedHtml, errorHtml, noticeHtml, updateBar } from './bf-tuning-ui';

const US_MIN = 900;
const US_MAX = 2100;
const pct = (us: number) => ((Math.max(US_MIN, Math.min(US_MAX, us)) - US_MIN) / (US_MAX - US_MIN)) * 100;

interface Box {
  id: number;
  name: string;
}

let onlyConfigured = false;

const norm1 = (n: string) => n.toUpperCase().replace(/[\s_]+/g, ' ').trim();

/** Modes a beginner needs; the rest is Expert-only unless the mode already has a range. Tip per known mode. */
const BASIC_MODES: Record<string, TipKey> = {
  ARM: 'tips.modes.arm',
  ANGLE: 'tips.modes.angle',
  HORIZON: 'tips.modes.horizon',
  'AIR MODE': 'tips.modes.airmode',
  AIRMODE: 'tips.modes.airmode',
  BEEPER: 'tips.modes.beeper',
  'BEEPER ON': 'tips.modes.beeper',
  'FLIP OVER AFTER CRASH': 'tips.modes.turtle',
  TURTLE: 'tips.modes.turtle',
  PREARM: 'tips.modes.prearm',
  FAILSAFE: 'tips.modes.failsafe',
};

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  const root = document.createElement('div');
  root.className = 'bf-tuning bf-modes';
  el.appendChild(root);

  let disposed = false;
  let phase: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  let error = '';
  let busy = false;
  let loadedLink: unknown = null;
  let boxes: Box[] = [];
  let ranges: ModeRange[] = [];
  let orig: ModeRange[] = [];
  let rc: number[] = [];
  let active = new Set<number>();
  let tick = 0;
  let inflight = false;
  let poll: ReturnType<typeof setInterval> | null = null;
  let shownKey = '';
  const IDS = [STEP.boxNames, STEP.boxIds, STEP.modeRanges, STEP.modeRangesExtra];
  const connected = () => ctx.state.get().conn === 'connected' && ctx.link() !== null;

  const boxName = (id: number) => boxes.find((b) => b.id === id)?.name ?? FALLBACK_BOXES[id] ?? `#${id}`;
  const live = () => ranges.filter((r) => !isEmptyRange(r));
  const changedSlots = (): number[] =>
    ranges.map((r, i) => i).filter((i) => JSON.stringify(norm(ranges[i]!)) !== JSON.stringify(norm(orig[i]!)));
  const norm = (r: ModeRange) => (isEmptyRange(r) ? { empty: true } : r);

  /* ---------------- load / save ---------------- */
  /** Fills boxes and ranges from the Betaflight store; false when the FC did not answer BOXNAMES / MODE_RANGES. */
  function fromStore(): boolean {
    const d = ctx.bf.get();
    const namesRaw = rawOf(d, STEP.boxNames);
    const base = rawOf(d, STEP.modeRanges);
    if (!namesRaw || !base) return false;
    const names = decodeBoxNames(namesRaw);
    const idsRaw = rawOf(d, STEP.boxIds);
    const ids = idsRaw ? decodeBoxIds(idsRaw) : [];
    boxes = names.map((name, i) => ({ id: ids[i] ?? i, name }));
    if (ids.length && ids.length !== names.length) boxes = ids.map((id, i) => ({ id, name: names[i] ?? FALLBACK_BOXES[id] ?? `#${id}` }));
    const dec = decodeModeRanges(base, rawOf(d, STEP.modeRangesExtra) ?? undefined);
    ranges = Array.from({ length: MODE_SLOTS }, (_, i) => dec[i] ?? emptyRange(i));
    orig = ranges.map((r) => ({ ...r }));
    shownKey = rawKey(d, IDS);
    return true;
  }

  /** Shows what the connect-time read stored, then re-reads the tab's commands. Channels and active modes are polled live. */
  async function load(): Promise<void> {
    if (!connected()) {
      phase = 'idle';
      render();
      return;
    }
    loadedLink = ctx.link();
    phase = fromStore() ? 'ready' : 'loading';
    render();
    await ctx.bf.refresh(AREA.modes);
    if (disposed || busy || (phase === 'ready' && changedSlots().length)) return;
    const changed = phase !== 'ready' || rawKey(ctx.bf.get(), IDS) !== shownKey;
    if (fromStore()) phase = 'ready';
    else {
      phase = 'error';
      error = t('bfTuning.common.unsupported');
    }
    if (changed) render();
  }

  async function save(): Promise<void> {
    const slots = changedSlots();
    if (busy || !slots.length) return;
    busy = true;
    updateBar(root, slots.length, { busy });
    const writes: MspWrite[] = slots.map((i) => ({ code: CMD.SET_MODE_RANGE, payload: encodeSetModeRange(isEmptyRange(ranges[i]!) ? emptyRange(i) : ranges[i]!), label: `SET_MODE_RANGE ${i}` }));
    const res = await ctx.bf.saveSettings(writes, { areas: AREA.modes });
    busy = false;
    if (!res.ok) {
      ctx.toast(t('bfTuning.common.saveFail', { msg: res.error ?? '' }), 'error');
      updateBar(root, changedSlots().length, { busy });
      return;
    }
    ctx.toast(t('bfTuning.common.saved'), 'ok');
    if (!disposed && fromStore()) render();
  }

  /* ---------------- view ---------------- */
  const auxCount = () => Math.max(4, Math.min(14, rc.length - 4));

  function rangeHtml(r: ModeRange): string {
    const chg = JSON.stringify(norm(r)) !== JSON.stringify(norm(orig[r.slot]!));
    const aux = Array.from({ length: auxCount() }, (_, i) => `<option value="${i}"${i === r.aux ? ' selected' : ''}>AUX${i + 1}</option>`).join('');
    const linkOpts = `<option value="0"${r.linkedTo === 0 ? ' selected' : ''}>${t('bfModes.noLink')}</option>${boxes.filter((b) => b.id !== r.id).map((b) => `<option value="${b.id}"${r.linkedTo === b.id ? ' selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}`;
    const lo = pct(stepToUs(r.start));
    const hi = pct(stepToUs(r.end));
    return `<div class="bf-modes-range${chg ? ' chg' : ''}" data-slot="${r.slot}">
      <select data-f="aux" aria-label="${t('bfModes.aux')}">${aux}</select>
      <div class="bf-modes-track"><span class="bf-modes-fill" style="left:${lo}%;width:${hi - lo}%"></span><span class="bf-modes-mark" data-mark></span>
        <input type="range" data-f="start" min="0" max="${STEP_COUNT}" step="1" value="${r.start}" aria-label="${t('bfModes.from')}">
        <input type="range" data-f="end" min="0" max="${STEP_COUNT}" step="1" value="${r.end}" aria-label="${t('bfModes.to')}"></div>
      <span class="bf-modes-us"><input type="number" class="bf-tuning-num mono" data-f="startUs" min="${US_MIN}" max="${US_MAX}" step="25" value="${stepToUs(r.start)}" aria-label="${t('bfModes.from')}"><i>–</i><input type="number" class="bf-tuning-num mono" data-f="endUs" min="${US_MIN}" max="${US_MAX}" step="25" value="${stepToUs(r.end)}" aria-label="${t('bfModes.to')}"></span>
      <span class="bf-modes-logic"><select data-f="logic" aria-label="${t('bfModes.logic')}"><option value="0"${r.logic === 0 ? ' selected' : ''}>OR</option><option value="1"${r.logic === 1 ? ' selected' : ''}>AND</option></select>${r.logic === 1 ? `<select data-f="link" aria-label="${t('bfModes.linked')}">${linkOpts}</select>` : ''}</span>
      <button class="bf-modes-x" data-act="remove" data-slot="${r.slot}" aria-label="${t('bfModes.remove')}" title="${t('bfModes.remove')}">${icon('x', 14)}</button>
    </div>`;
  }

  function modeHtml(b: Box): string {
    const rs = live().filter((r) => r.id === b.id);
    if (onlyConfigured && !rs.length) return '';
    const on = active.has(b.id);
    const free = live().length < MODE_SLOTS;
    const tk = BASIC_MODES[norm1(b.name)];
    const hide = !tk && !rs.length ? ' data-level="expert"' : '';
    return `<div class="bf-modes-mode${on ? ' on' : ''}${rs.length ? '' : ' empty'}" data-box="${b.id}"${hide}>
      <div class="bf-modes-mh"><i class="bf-modes-dot" aria-hidden="true"></i><span class="bf-modes-name">${escapeHtml(b.name)}</span>${tk ? tip(tk) : ''}${on ? `<em class="mono">${t('bfModes.active')}</em>` : ''}<span class="bf-modes-sp"></span><button class="bf-modes-add" data-act="add" data-id="${b.id}" ${free ? '' : 'disabled'} title="${free ? '' : escapeHtml(t('bfModes.noSlots'))}">${icon('check', 12)}${t('bfModes.add')}</button></div>
      ${rs.map(rangeHtml).join('')}
    </div>`;
  }

  function render(): void {
    if (disposed) return;
    const top = root.scrollTop;
    if (!connected() || phase === 'idle') {
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
    const scale = [900, 1200, 1500, 1800, 2100].map((u) => `<span style="left:${pct(u)}%">${u}</span>`).join('');
    const arm = boxes.find((b) => b.id === 0);
    const noArm = arm && !live().some((r) => r.id === 0);
    root.innerHTML = `${intro('tips.modes.intro')}<div class="bf-tuning-head"><div class="bf-tuning-title mono"><span class="bf-tuning-sq"></span>${t('bfModes.tab')}</div>
        <label class="bf-tuning-pl bf-modes-only"><input type="checkbox" data-only ${onlyConfigured ? 'checked' : ''}> ${t('bfModes.onlyConfigured')}</label>
        <span class="bf-tuning-pnote dim">${t('bfModes.note', { used: live().length, max: MODE_SLOTS })}</span></div>
      <div class="bf-tuning-body">
        ${noArm ? noticeHtml('warn', t('bfModes.noArm')) : ''}
        <div class="bf-modes-scale"><span class="bf-modes-scalelabel mono">${t('bfModes.pulse')}${tip('tips.modes.ranges')}${tip('tips.modes.logic')}</span><div class="bf-modes-scaleax mono">${scale}</div></div>
        <div class="bf-modes-list">${boxes.map(modeHtml).join('')}</div>
      </div>${barHtml()}`;
    root.scrollTop = top;
    updateBar(root, changedSlots().length, { busy });
    updateLive();
  }

  /** Marker positions + active highlights without re-rendering (10 Hz). */
  function updateLive(): void {
    root.querySelectorAll<HTMLElement>('.bf-modes-range').forEach((row) => {
      const r = ranges[Number(row.dataset.slot)];
      if (!r) return;
      const us = rc[4 + r.aux];
      const mark = row.querySelector<HTMLElement>('[data-mark]');
      if (mark) {
        mark.style.display = us === undefined ? 'none' : '';
        if (us !== undefined) mark.style.left = `${pct(us)}%`;
      }
      row.classList.toggle('in', us !== undefined && us >= stepToUs(r.start) && us < stepToUs(r.end));
    });
    root.querySelectorAll<HTMLElement>('.bf-modes-mode').forEach((m) => {
      const on = active.has(Number(m.dataset.box));
      if (m.classList.contains('on') !== on) {
        m.classList.toggle('on', on);
        m.querySelector('.bf-modes-mh em')?.remove();
        if (on) m.querySelector('.bf-modes-sp')?.insertAdjacentHTML('beforebegin', `<em class="mono">${t('bfModes.active')}</em>`);
      }
    });
  }

  function startPoll(): void {
    if (poll) return;
    poll = setInterval(() => {
      if (inflight || disposed || phase !== 'ready' || !connected() || ctx.link()?.busy) return;
      inflight = true;
      tick++;
      (async () => {
        const p = await ctx.bf.send(C.RC);
        rc = decodeRc(p);
        if (tick % 3 === 0) {
          const st = decodeStatusEx(await ctx.bf.send(C.STATUS_EX), ctx.bf.get().api);
          active = activeIdsFromFlags(boxes.map((b) => b.id), st.modeBits);
        }
      })()
        .catch(() => undefined)
        .finally(() => {
          inflight = false;
          if (!disposed) updateLive();
        });
    }, 100);
  }

  function summary(): string {
    const lines = boxes
      .map((b) => {
        const rs = live().filter((r) => r.id === b.id);
        return rs.length ? `${b.name}: ${rs.map((r) => `AUX${r.aux + 1} ${stepToUs(r.start)}-${stepToUs(r.end)}${r.logic ? ` AND ${boxName(r.linkedTo)}` : ''}`).join(', ')}` : null;
      })
      .filter(Boolean);
    return [t('bfModes.ai.intro', { n: live().length }), ...lines, active.size ? t('bfModes.ai.active', { list: [...active].map(boxName).join(', ') }) : '', changedSlots().length ? t('bfTuning.ai.unsaved', { n: changedSlots().length }) : '']
      .filter(Boolean)
      .join('\n');
  }

  /* ---------------- editing ---------------- */
  function updateRow(row: HTMLElement, r: ModeRange): void {
    const lo = pct(stepToUs(r.start));
    const hi = pct(stepToUs(r.end));
    const fill = row.querySelector<HTMLElement>('.bf-modes-fill');
    if (fill) {
      fill.style.left = `${lo}%`;
      fill.style.width = `${hi - lo}%`;
    }
    const set = (f: string, v: number) => {
      const i = row.querySelector<HTMLInputElement>(`[data-f="${f}"]`);
      if (i && document.activeElement !== i) i.value = String(v);
    };
    set('start', r.start);
    set('end', r.end);
    set('startUs', stepToUs(r.start));
    set('endUs', stepToUs(r.end));
    row.classList.toggle('chg', JSON.stringify(norm(r)) !== JSON.stringify(norm(orig[r.slot]!)));
    updateBar(root, changedSlots().length, { busy });
    updateLive();
  }

  const onInput = (e: Event) => {
    const inp = e.target as HTMLInputElement | HTMLSelectElement;
    if (inp.matches('[data-only]')) {
      onlyConfigured = (inp as HTMLInputElement).checked;
      render();
      return;
    }
    const f = inp.dataset.f;
    const row = inp.closest<HTMLElement>('.bf-modes-range');
    if (!f || !row) return;
    const r = ranges[Number(row.dataset.slot)]!;
    const v = Number(inp.value);
    if (f === 'aux') r.aux = v;
    else if (f === 'logic') {
      r.logic = v;
      if (!v) r.linkedTo = 0;
      render();
      return;
    } else if (f === 'link') r.linkedTo = v;
    else {
      if (inp.value === '' || !Number.isFinite(v)) return;
      const step = f === 'startUs' || f === 'endUs' ? usToStep(v) : Math.round(v);
      if ((f === 'startUs' || f === 'endUs') && (v < US_MIN || v > US_MAX)) {
        inp.classList.add('bad');
        return;
      }
      inp.classList.remove('bad');
      if (f === 'start' || f === 'startUs') {
        r.start = Math.min(step, Math.max(0, r.end - 1));
        if (e.type === 'change' || f === 'start') updateRow(row, r);
      } else {
        r.end = Math.max(step, Math.min(STEP_COUNT, r.start + 1));
        if (e.type === 'change' || f === 'end') updateRow(row, r);
      }
      updateBar(root, changedSlots().length, { busy });
      return;
    }
    updateRow(row, r);
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const act = b?.dataset.act;
    if (!b || !act) return;
    if (act === 'add') {
      const free = ranges.find((r) => isEmptyRange(r));
      if (!free) return;
      Object.assign(free, { id: Number(b.dataset.id), aux: 0, start: usToStep(1700), end: STEP_COUNT, logic: 0, linkedTo: 0 });
      render();
    } else if (act === 'remove') {
      const r = ranges[Number(b.dataset.slot)];
      if (r) Object.assign(r, emptyRange(r.slot));
      render();
    } else if (act === 'save') void save();
    else if (act === 'revert') {
      ranges = orig.map((r) => ({ ...r }));
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
      render();
    }
  });

  startPoll();
  void load();

  return () => {
    disposed = true;
    if (poll) clearInterval(poll);
    off();
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onInput);
    root.remove();
  };
};
