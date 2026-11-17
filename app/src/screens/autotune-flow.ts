/**
 * Autotune PID: the guided flow (stepper, banners and the five preparation steps) as pure HTML builders.
 * Basic mode gets calm, one-button versions; Expert mode the detailed ones. screens/autotune.ts owns state and
 * events; the result step lives in autotune-basic.ts (Basic) and autotune-expert.ts (Expert).
 */
import type { AutotuneResult } from '../analysis/autotune';
import type { LogQuality } from '../analysis/quality';
import { fmtNum, t, type Key } from '../i18n';
import { escapeHtml } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import { intro, tip, type TipKey } from '../ui/tip';
import { coachAt, scriptSeconds, type FlightStep } from '../wizard/flight-script';
import { PART_KEYS, prefillFromFc, ruleProfile, STYLES, typicalBuild, type FcFacts, type PartKey } from '../wizard/parts';
import type { Check } from '../wizard/prepare';
import { blockFor, canJump, STEPS, stepIndex, type GateInput, type NamedBackup, type StepId, type WizardState } from '../wizard/state';
import type { RoundMetrics } from '../wizard/verdict';

export interface Run {
  res: AutotuneResult;
  /** The synthetic sample flight (never applied to a real FC). */
  sample: boolean;
  name: string;
}

export interface Round {
  n: number;
  at: number;
  name: string;
  metrics: RoundMetrics;
  /** Mean roll step response of the round (for the overlay). */
  curve: number[] | null;
  /** Commands applied after this flight. */
  applied: string[];
}

export type ExpertTab = 'overview' | 'step' | 'noise' | 'filters' | 'propwash' | 'pids' | 'series' | 'rounds';

export interface UiState {
  tab: ExpertTab;
  stepMode: 'all' | 'size' | 'throttle';
  stepAxis: 'roll' | 'pitch' | 'yaw';
  signal: 'gyro' | 'gyroUnfilt' | 'dterm';
  form: 'sliders' | 'raw';
  selected: Set<string>;
  hot: boolean;
  details: boolean;
  session: number | null;
}

export interface ViewModel {
  expert: boolean;
  st: WizardState;
  facts: FcFacts;
  gate: GateInput;
  backups: NamedBackup[];
  backupBusy: boolean;
  backupMsg: { kind: 'ok' | 'err' | 'info'; text: string } | null;
  eraseBusy: boolean;
  checks: Check[];
  script: FlightStep[];
  coach: { elapsed: number; running: boolean; skipFlips: boolean };
  run: Run | null;
  busy: { frac: number; label: string } | null;
  error: string | null;
  rounds: Round[];
  ui: UiState;
  aiReady: boolean;
  /** Axes whose PIDs in the log header differ from the FC (empty for the sample flight). */
  mismatch: Array<'roll' | 'pitch' | 'yaw'>;
}

export const k = (s: string) => s as Key;
export const btn = (act: string, label: string, cls = 'ghost', opts: { icon?: IconName; disabled?: boolean; title?: string; arg?: string; big?: boolean } = {}) =>
  `<button type="button" class="btn ${cls}${opts.big ? ' big' : ''}" data-act="${act}"${opts.arg !== undefined ? ` data-arg="${escapeHtml(opts.arg)}"` : ''}${opts.disabled ? ' disabled' : ''}${opts.title ? ` title="${escapeHtml(opts.title)}"` : ''}>${opts.icon ? icon(opts.icon, 16) : ''}${label}</button>`;
export const chip = (kind: 'ok' | 'warn' | 'hot' | 'info' | 'dim', text: string) => `<span class="pw-chip ${kind}">${escapeHtml(text)}</span>`;
export const h2 = (title: string, lead?: string, tipKey?: TipKey) => `<div class="pw-h"><h2 id="pw-h2">${title}${tipKey ? ` ${tip(tipKey)}` : ''}</h2>${lead ? `<p>${lead}</p>` : ''}</div>`;
const stepLabel = (vm: ViewModel, s: StepId) => t(k(`atFlow.${vm.expert ? 'steps' : 'stepsBasic'}.${s}`));

/* ---------------- shell ---------------- */

export function stepStatus(vm: ViewModel, s: StepId): 'done' | 'now' | 'todo' | 'attention' {
  if (s === vm.st.step) return 'now';
  if (s === 'backup' && vm.st.backup) return 'done';
  if (s === 'prepare' && vm.checks.some((c) => c.status === 'block' || (c.status === 'fix' && !vm.st.fixed.includes(c.id)))) return stepIndex(vm.st.reached) >= stepIndex('prepare') ? 'attention' : 'todo';
  if (s === 'import' && vm.run) return vm.run.res.quality.label === 'poor' ? 'attention' : 'done';
  if (s === 'propose' && vm.run) return 'done';
  if (blockFor(s, vm.gate)) return 'todo';
  return stepIndex(s) < stepIndex(vm.st.reached) ? 'done' : 'todo';
}

function banner(vm: ViewModel): string {
  if (vm.facts.armed) return `<div class="pw-banner hot" role="alert">${icon('alert', 16)}<span>${t('atFlow.armedBanner')}</span></div>`;
  if (!vm.facts.connected && vm.st.step !== 'propose' && vm.st.step !== 'import')
    return `<div class="pw-banner">${icon('plug', 16)}<span>${t(vm.expert ? 'atFlow.notConnected' : 'atFlow.basic.notConnected')}</span><span class="pw-banner-btns">${btn('connect', t('atFlow.connect'), 'light')}${btn('demo', t('atFlow.demo'))}</span></div>`;
  return '';
}

function stepper(vm: ViewModel): string {
  if (vm.expert && vm.st.folded) {
    const i = stepIndex(vm.st.step);
    return `<div class="pw-fold"><span class="mono dim">${t('atFlow.stepOf', { n: i + 1, total: STEPS.length })}</span><b>${stepLabel(vm, vm.st.step)}</b>${btn('fold', t('atFlow.stepper.show'), 'ghost')}</div>`;
  }
  return `<ol class="pw-steps${vm.expert ? ' compact' : ''}" aria-label="${escapeHtml(t('atFlow.stepper.aria'))}">${STEPS.map((s, n) => {
    const status = stepStatus(vm, s);
    const can = canJump(vm.st, s, vm.gate, vm.expert) || (s === 'propose' && !!vm.run);
    return `<li class="${status}"><button type="button" data-act="goto" data-arg="${s}" ${can ? '' : 'disabled'} ${s === vm.st.step ? 'aria-current="step"' : ''}>
        <span class="pw-num">${status === 'done' ? icon('check', 14) : status === 'attention' ? '!' : n + 1}</span>
        <span class="pw-st"><b>${stepLabel(vm, s)}</b><small>${t(k(`atFlow.status.${status}`))}</small></span></button></li>`;
  }).join('')}${vm.expert ? `<li class="pw-fold-li">${btn('fold', t('atFlow.stepper.hide'), 'ghost')}</li>` : ''}</ol>`;
}

/** Page frame: header, explainer, stepper, banners, then the step body (in a card unless `bare`). */
export function shell(vm: ViewModel, body: string, o: { bare?: boolean; footer?: boolean } = {}): string {
  const i = stepIndex(vm.st.step);
  const next = STEPS[i + 1];
  const block = next ? blockFor(next, vm.gate) : null;
  const head = vm.expert
    ? `<header class="pw-head">
        <div><h1>${t('atFlow.title')}</h1>
          <details class="pw-how"><summary>${t('atFlow.how.summary')}</summary><p>${t('atFlow.how.expert')}</p></details></div>
        <div class="pw-head-r">${btn('pick', t('atFlow.openLog'), 'ghost', { icon: 'download' })}${btn('sample', t('at.sample'), 'ghost', { icon: 'play' })}<button type="button" class="at-link" data-act="reset">${icon('trash', 14)}${t('atFlow.reset')}</button></div>
      </header>`
    : `${intro('tips.autotune.intro')}
      <header class="pw-head"><div><h1>${t('atFlow.title')}</h1><p>${t('atFlow.basic.lead')}</p></div>
        <button type="button" class="at-link" data-act="reset">${icon('trash', 14)}${t('atFlow.reset')}</button></header>`;
  const foot =
    o.footer === false
      ? ''
      : `<footer class="pw-foot">
      ${i > 0 ? btn('prev', t('atFlow.back'), 'ghost') : '<span></span>'}
      <span class="pw-foot-r">${block ? `<span class="pw-why">${t(k(`atFlow.block.${block}`))}</span>` : ''}<span class="mono dim">${t('atFlow.stepOf', { n: i + 1, total: STEPS.length })}</span>
      ${next ? btn('next', `${t('atFlow.next')} ${icon('arrowRight', 16)}`, 'light', { disabled: !!block }) : ''}</span>
    </footer>`;
  return `${head}${stepper(vm)}${banner(vm)}${o.bare ? body : `<section class="pw-card" aria-labelledby="pw-h2">${body}</section>`}${foot}<input type="file" accept=".csv,.txt,.bbl,.bfl,.log,text/csv" hidden data-file>`;
}

/* ---------------- 1 parts ---------------- */

function factRows(f: FcFacts): string {
  const rows: Array<[string, string]> = [];
  const add = (key: string, v: string | null) => {
    if (v !== null && v !== '') rows.push([t(k(`atFlow.parts.fact.${key}`)), v]);
  };
  add('firmware', f.firmware);
  add('board', f.board);
  add('protocol', f.protocol);
  add('bidir', f.bidir === null ? null : f.bidir ? t('common.on') : t('common.off'));
  add('rpm', f.rpmHarmonics === null ? null : f.rpmHarmonics ? t('atFlow.parts.fact.rpmVal', { n: f.rpmHarmonics }) : t('common.off'));
  add('loop', f.pidLoopHz ? `${fmtNum(f.pidLoopHz / 1000, 1)} kHz` : null);
  const dev = f.bbDevice === null ? null : (['none', 'flash', 'sd', 'serial'][f.bbDevice] ?? 'none');
  add('blackbox', dev ? t('atFlow.parts.fact.bbVal', { dev: t(k(`atFlow.parts.dev.${dev}`)), hz: f.bbRateHz ? Math.round(f.bbRateHz) : '?' }) : null);
  add('debug', f.debugName ?? (f.debugIndex !== null ? `#${f.debugIndex}` : null));
  add('battery', f.cells ? t('atFlow.parts.fact.batteryVal', { cells: f.cells, v: f.vbat !== null ? fmtNum(f.vbat, 1) : '?' }) : null);
  add('motors', f.motorCount ? t('atFlow.parts.fact.motorsVal', { n: f.motorCount, poles: f.motorPoles ?? '?' }) : null);
  add('pid', f.pid ? `${f.pid.roll.join('/')} · ${f.pid.pitch.join('/')} · ${f.pid.yaw.join('/')}` : null);
  add('filters', f.gyroLpf1Hz !== null ? `${f.gyroLpf1Hz} / ${f.dtermLpf1Hz ?? '?'} Hz` : null);
  add('elrs', f.elrs);
  if (!rows.length) return `<p class="pw-empty">${t('atFlow.parts.noFacts')}</p>`;
  return `<dl class="pw-facts">${rows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd class="mono">${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
}

function field(vm: ViewModel, key: PartKey): string {
  const p = vm.st.parts;
  const v = p[key];
  const pre = prefillFromFc(vm.facts);
  const empty = v === null || v === '';
  const state = !empty && pre[key] !== undefined && pre[key] === v ? 'detected' : empty ? 'ask' : 'typed';
  const label = t(k(`atFlow.parts.f.${key}`));
  const id = `pw-f-${key}`;
  const unit: Partial<Record<PartKey, string>> = { frameIn: t('atFlow.parts.unit.in'), propIn: t('atFlow.parts.unit.in'), capacityMah: t('atFlow.parts.unit.mah'), weightG: t('atFlow.parts.unit.g'), vtxMw: t('atFlow.parts.unit.mw'), motorKv: t('atFlow.parts.unit.kv') };
  let input: string;
  const val = empty ? '' : escapeHtml(String(v));
  const opts = (vals: Array<string | number>, fmt: (x: string | number) => string) => `<option value="">${t('atFlow.parts.ph.choose')}</option>${vals.map((c) => `<option value="${c}" ${v === c ? 'selected' : ''}>${fmt(c)}</option>`).join('')}`;
  if (key === 'style') input = `<select id="${id}" data-part="style">${opts(STYLES, (s) => t(k(`atFlow.parts.style.${s}`)))}</select>`;
  else if (key === 'cells') input = `<select id="${id}" data-part="cells">${opts([1, 2, 3, 4, 5, 6, 7, 8], (c) => `${c}S`)}</select>`;
  else if (key === 'propBlades') input = `<select id="${id}" data-part="propBlades">${opts([2, 3, 4, 5, 6], String)}</select>`;
  else if (key === 'motorStator' || key === 'escProtocol') input = `<input id="${id}" type="text" data-part="${key}" value="${val}" maxlength="24" ${key === 'motorStator' ? `placeholder="${t('atFlow.parts.ph.stator')}"` : ''} autocomplete="off">`;
  else input = `<input id="${id}" type="number" inputmode="decimal" min="0" step="any" data-part="${key}" value="${val}">`;
  return `<div class="pw-field ${state}"><label for="${id}">${label}${chip(state === 'detected' ? 'ok' : state === 'ask' ? 'warn' : 'dim', t(k(`atFlow.chip.${state}`)))}</label>
    <div class="pw-in">${input}${unit[key] ? `<em>${unit[key]}</em>` : ''}</div></div>`;
}

export const FRAME_SIZES = [2, 3, 3.5, 4, 5, 6, 7];

function basicParts(vm: ViewModel): string {
  const p = vm.st.parts;
  const f = vm.facts;
  const det: string[] = [];
  if (f.firmware) det.push(f.firmware);
  if (f.cells) det.push(`${f.cells}S`);
  if (f.protocol) det.push(f.bidir ? `${f.protocol} + RPM` : f.protocol);
  if (f.motorCount) det.push(t('atFlow.parts.fact.motorsVal', { n: f.motorCount, poles: f.motorPoles ?? '?' }));
  const typ = typicalBuild(p.frameIn);
  const sizeBtn = (s: number) => `<button type="button" class="pw-pick${p.frameIn === s ? ' on' : ''}" data-act="frame" data-arg="${s}" aria-pressed="${p.frameIn === s}">${fmtNum(s, s % 1 ? 1 : 0)}"</button>`;
  const styleBtn = (s: (typeof STYLES)[number]) => `<button type="button" class="pw-pick wide${p.style === s ? ' on' : ''}" data-act="style" data-arg="${s}" aria-pressed="${p.style === s}">${t(k(`atFlow.parts.style.${s}`))}</button>`;
  return `${h2(t('atFlow.basic.drone.title'), t('atFlow.basic.drone.lead'), 'tips.autotune.bDrone')}
    ${det.length ? `<div class="pw-detected">${icon('check', 16)}<span>${t('atFlow.basic.drone.detected')}</span>${det.map((d) => chip('ok', d)).join('')}</div>` : ''}
    <div class="pw-q2"><h3>${t('atFlow.basic.drone.frameQ')}</h3><div class="pw-picks">${FRAME_SIZES.map(sizeBtn).join('')}</div>
      ${typ ? `<p class="pw-hint">${t('atFlow.basic.drone.typical', { size: fmtNum(p.frameIn ?? 0, p.frameIn && p.frameIn % 1 ? 1 : 0), prop: fmtNum(typ.prop, typ.prop % 1 ? 1 : 0), stator: typ.stator })}</p>` : `<p class="pw-hint">${t('atFlow.basic.drone.frameHint')}</p>`}</div>
    <div class="pw-q2"><h3>${t('atFlow.basic.drone.styleQ')}</h3><div class="pw-picks">${STYLES.map(styleBtn).join('')}</div></div>
    ${p.frameIn ? `<p class="pw-msg ok">${t('atFlow.basic.drone.allSet')}</p>` : ''}
    <p class="pw-hint">${btn('goto', t('atFlow.haveLog'), 'linkish', { arg: 'import', icon: 'download' })}</p>`;
}

export function partsView(vm: ViewModel): string {
  if (!vm.expert) return basicParts(vm);
  const p = vm.st.parts;
  const typ = typicalBuild(p.frameIn);
  const notes = ruleProfile(p, vm.facts);
  const aiBtn = btn('ai-parts', t('atFlow.parts.askAi'), 'light', { icon: 'chip', disabled: !vm.facts.connected || !vm.aiReady });
  const aiHint = !vm.aiReady ? `<p class="pw-hint">${t('atFlow.parts.aiNotReady')}</p>` : !vm.facts.connected ? `<p class="pw-hint">${t('atFlow.parts.aiNeedsFc')}</p>` : '';
  return `${h2(t('atFlow.parts.title'), t('atFlow.parts.lead'), 'tips.autotune.parts')}
    <div class="pw-grid2">
      <div class="pw-panel"><div class="pw-cap mono">${t('atFlow.parts.fromFc')}</div>${factRows(vm.facts)}</div>
      <div class="pw-panel"><div class="pw-cap mono">${t('atFlow.parts.yourBuild')}</div>
        <div class="pw-form">${PART_KEYS.map((key) => field(vm, key)).join('')}</div>
        ${typ ? `<div class="pw-typ"><span>${t('atFlow.parts.typical', { size: fmtNum(p.frameIn ?? 0, p.frameIn && p.frameIn % 1 ? 1 : 0), stator: typ.stator, kv1: typ.kv[0], kv2: typ.kv[1], cells: typ.kvCells, prop: fmtNum(typ.prop, typ.prop % 1 ? 1 : 0), blades: typ.blades })}</span>${btn('typical', t('atFlow.parts.useTypical'), 'ghost')}</div>` : ''}
      </div>
    </div>
    <div class="pw-panel"><div class="pw-cap mono">${t('atFlow.parts.profile')}</div>
      <ul class="pw-notes">${notes.map((n) => `<li class="${n.level}"><i></i>${escapeHtml(t(k(`atFlow.parts.rule.${n.code}`), n.params))}</li>`).join('')}</ul>
      <div class="pw-btns">${aiBtn}</div>${aiHint}
    </div>`;
}

/* ---------------- 2 backup ---------------- */

function backupList(vm: ViewModel): string {
  const fmt = (at: number) => new Date(at).toLocaleString();
  return vm.backups.length
    ? `<ul class="pw-blist">${vm.backups.map((b) => `<li><span class="mono">${escapeHtml(b.name)}</span><span class="dim">${escapeHtml(fmt(b.at))} · ${fmtNum(b.text.length / 1024, 1)} kB</span>
        <span class="pw-btns">${btn('dl-backup', t('atFlow.backup.download'), 'ghost', { arg: b.name, icon: 'download' })}${btn('restore', t('atFlow.backup.restore'), 'ghost', { arg: b.name, disabled: !vm.facts.connected || vm.facts.armed })}</span></li>`).join('')}</ul>`
    : `<p class="pw-empty">${t('atFlow.backup.none')}</p>`;
}

export function backupView(vm: ViewModel): string {
  const can = vm.facts.connected && !vm.facts.armed && !vm.backupBusy;
  const msg = vm.backupMsg ? `<p class="pw-msg ${vm.backupMsg.kind}" role="status">${escapeHtml(vm.backupMsg.text)}</p>` : '';
  const label = vm.backupBusy ? t('atFlow.backup.creating') : vm.expert ? t('atFlow.backup.create') : t('atFlow.basic.backup.button');
  const main = `<div class="pw-big">
      <div class="pw-big-ico">${icon('shield', 34)}</div>
      <div class="pw-big-body">
        ${vm.st.backup ? `<div class="pw-done">${icon('check', 18)}<span>${vm.expert ? `<span class="mono">${escapeHtml(vm.st.backup)}</span>` : t('atFlow.basic.backup.done', { name: escapeHtml(vm.st.backup) })}</span></div>` : ''}
        <div class="pw-btns">${btn('backup', label, vm.st.backup ? 'ghost' : 'light', { icon: 'download', disabled: !can, big: !vm.expert && !vm.st.backup })}</div>
        <p class="pw-hint">${vm.facts.connected ? t('atFlow.backup.rebootNote') : t('atFlow.backup.needFc')}</p>
        ${msg}
      </div>
    </div>`;
  if (!vm.expert)
    return `${h2(t('atFlow.basic.backup.title'), t('atFlow.basic.backup.lead'), 'tips.autotune.bBackup')}${main}
      ${vm.backups.length ? `<details class="pw-more"><summary>${t('atFlow.basic.backup.older', { n: vm.backups.length })}</summary>${backupList(vm)}</details>` : ''}`;
  return `${h2(t('atFlow.backup.title'), t('atFlow.backup.lead'), 'tips.autotune.backup')}${main}
    <div class="pw-panel"><div class="pw-cap mono">${t('atFlow.backup.list')}</div>${backupList(vm)}</div>`;
}

/* ---------------- 3 prepare ---------------- */

function checkRow(vm: ViewModel, c: Check, canFix: boolean): string {
  const base = `atFlow.prepare.c.${c.id}`;
  const applied = c.status === 'fix' && vm.st.fixed.includes(c.id);
  const kind = c.status === 'ok' ? 'ok' : c.status === 'block' ? 'hot' : c.status === 'fix' ? (applied ? 'ok' : 'warn') : c.status === 'warn' ? 'warn' : 'info';
  const textKey = c.status === 'manual' ? `${base}.manual` : `${base}.${c.status === 'block' ? 'block' : c.status}`;
  let right = '';
  if (c.status === 'manual') {
    const id = c.id as 'battery' | 'space';
    right = `<label class="pw-tick"><input type="checkbox" data-tick="${id}" ${vm.st.ticks[id] ? 'checked' : ''} aria-label="${escapeHtml(t(k(`${base}.title`)))}"><span>${icon('check', 14)}</span></label>`;
  } else if (c.status === 'fix') right = applied ? chip('ok', t('atFlow.prepare.applied')) : btn('fix', t('atFlow.prepare.fix'), 'ghost', { arg: c.id, disabled: !canFix });
  const cmds = c.fix && !applied && vm.expert ? `<code class="mono">${escapeHtml(c.fix.join('  ·  '))}</code>` : '';
  return `<li class="pw-check ${kind}"><i class="pw-dot"></i><div><b>${t(k(`${base}.title`))}</b><p>${escapeHtml(t(k(textKey), c.params))}</p>${cmds}</div><div class="pw-check-r">${right}</div></li>`;
}

export function prepareView(vm: ViewModel): string {
  const open = vm.checks.filter((c) => c.status === 'fix' && !vm.st.fixed.includes(c.id));
  const nFix = open.reduce((n, c) => n + (c.fix?.length ?? 0), 0);
  const canFix = vm.facts.connected && !vm.facts.armed;
  const flash = vm.checks.find((c) => c.id === 'flash');
  const flashFull = flash?.status === 'warn';
  const erase = vm.facts.flash?.supported && (vm.facts.flash.used ?? 0) > 0
    ? `<div class="pw-erase"><p>${t(flashFull ? 'atFlow.basic.prepare.eraseLead' : 'atFlow.basic.prepare.eraseOpt', { pct: flash?.params?.['pct'] ?? '?' })}</p>${btn('erase', vm.eraseBusy ? t('atFlow.basic.prepare.erasing') : t('atFlow.basic.prepare.erase'), flashFull ? 'light' : 'ghost', { icon: 'trash', disabled: !canFix || vm.eraseBusy })}</div>`
    : '';
  if (!vm.expert) {
    const manual = vm.checks.filter((c) => c.status === 'manual');
    const rest = vm.checks.filter((c) => c.status !== 'manual');
    const status = !vm.facts.connected ? t('atFlow.basic.prepare.noFc') : nFix ? t('atFlow.basic.prepare.needs', { n: open.length }) : t('atFlow.basic.prepare.ready');
    return `${h2(t('atFlow.basic.prepare.title'), t('atFlow.basic.prepare.lead'), 'tips.autotune.bPrepare')}
      <div class="pw-big">
        <div class="pw-big-ico">${icon(nFix ? 'sliders' : 'check', 34)}</div>
        <div class="pw-big-body"><p class="pw-lead2">${status}</p>
          <div class="pw-btns">${btn('fix-all', t('atFlow.basic.prepare.button'), nFix ? 'light' : 'ghost', { icon: 'arrowUp', disabled: !canFix || !nFix, big: !!nFix })}</div>
          ${erase}</div>
      </div>
      <div class="pw-cap mono">${t('atFlow.basic.prepare.checklist')}</div>
      <ul class="pw-checks">${manual.map((c) => checkRow(vm, c, canFix)).join('')}</ul>
      <details class="pw-more"><summary>${t('atFlow.basic.details')}</summary><ul class="pw-checks">${rest.map((c) => checkRow(vm, c, canFix)).join('')}</ul></details>`;
  }
  return `${h2(t('atFlow.prepare.title'), t('atFlow.prepare.lead'), 'tips.autotune.prepare')}
    <ul class="pw-checks">${vm.checks.map((c) => checkRow(vm, c, canFix)).join('')}</ul>
    <div class="pw-btns">${btn('fix-all', t('atFlow.prepare.fixAll', { n: nFix }), 'light', { icon: 'arrowUp', disabled: !canFix || !nFix })}</div>
    ${erase}`;
}

/* ---------------- 4 flight ---------------- */

export function flightView(vm: ViewModel): string {
  const steps = vm.script;
  const pos = coachAt(steps, vm.coach.elapsed, vm.coach.skipFlips);
  const cur = steps[pos.index]!;
  const style = vm.st.parts.style;
  const total = scriptSeconds(steps, !vm.coach.skipFlips);
  const started = vm.coach.elapsed > 0;
  const title = vm.expert ? h2(t('atFlow.flight.title'), t('atFlow.flight.lead'), 'tips.autotune.flight') : h2(t('atFlow.basic.flight.title'), t('atFlow.basic.flight.lead'), 'tips.autotune.bFly');
  return `${title}
    <p class="pw-rules mono">${vm.expert ? t('atFlow.flight.rules') : t('atFlow.basic.flight.single')} · ${t('atFlow.flight.total', { s: total })}</p>
    <div class="pw-coach">
      <div class="pw-move" aria-live="polite">
        <div class="pw-move-n mono">${pos.index + 1} / ${steps.length}${cur.optional ? ` · ${t('atFlow.flight.optional')}` : ''}</div>
        <h3>${t(k(`atFlow.flight.steps.${cur.id}.title`))}</h3>
        <p>${t(k(`atFlow.flight.steps.${cur.id}.body`))}</p>
        <div class="pw-count mono" data-count>${cur.seconds ? `${pos.left}<small>${t('atFlow.flight.sec')}</small>` : icon('check', 40)}</div>
        <div class="pw-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pos.frac * 100)}"><i data-prog style="width:${Math.round(pos.frac * 100)}%"></i></div>
        <div class="pw-btns">
          ${btn('coach-toggle', vm.coach.running ? t('atFlow.flight.pause') : started ? t('atFlow.flight.resume') : t('atFlow.flight.start'), 'light', { icon: vm.coach.running ? 'stop' : 'play', disabled: pos.done && !vm.coach.running })}
          ${btn('coach-prev', t('atFlow.flight.prevStep'), 'ghost', { disabled: pos.index === 0 })}
          ${btn('coach-next', t('atFlow.flight.nextStep'), 'ghost', { disabled: pos.index >= steps.length - 1 })}
          ${btn('coach-reset', t('atFlow.flight.restart'), 'ghost')}
        </div>
        ${pos.done ? `<p class="pw-msg ok">${t('atFlow.flight.landed')}</p>` : ''}
      </div>
      <div class="pw-side">
        <ol class="pw-script">${steps.map((s, i) => `<li class="${i === pos.index ? 'on' : i < pos.index ? 'past' : ''}${s.optional && vm.coach.skipFlips ? ' skip' : ''}"><span class="mono">${s.seconds ? `${s.seconds}s` : '—'}</span>${t(k(`atFlow.flight.steps.${s.id}.title`))}</li>`).join('')}</ol>
        <label class="pw-toggle"><input type="checkbox" data-opt="skipFlips" ${vm.coach.skipFlips ? 'checked' : ''}>${t('atFlow.flight.skipFlips')}</label>
        <label class="pw-toggle"><input type="checkbox" data-opt="beep" ${vm.st.beep ? 'checked' : ''}>${t('atFlow.flight.beep')}</label>
        ${style ? `<div class="pw-tips"><div class="pw-cap mono">${t('atFlow.flight.tipsTitle', { style: t(k(`atFlow.parts.style.${style}`)).toUpperCase() })}</div><ul>${['a', 'b', 'c'].map((x) => `<li>${t(k(`atFlow.flight.style.${style}.${x}`))}</li>`).join('')}</ul></div>` : vm.expert ? `<p class="pw-hint">${t('atFlow.flight.noStyle')}</p>` : ''}
      </div>
    </div>`;
}

/* ---------------- 5 load ---------------- */

export function qualityBlock(q: LogQuality): string {
  const kind = q.label === 'good' ? 'ok' : q.label === 'ok' ? 'warn' : 'hot';
  return `<div class="pw-q">
      <div class="pw-q-score ${kind}"><span class="mono">${t('atFlow.import.quality')} ${tip('tips.autotune.quality')}</span><b>${q.score}</b>${chip(kind, t(k(`atFlow.import.label.${q.label}`)))}</div>
      <div class="pw-q-parts">${q.parts
        .map((p) => `<div class="pw-q-row"><span>${t(k(`atFlow.import.part.${p.id}`))}</span><span class="pw-q-bar ${p.value === null ? 'na' : ''}"><i style="width:${Math.round((p.value ?? 0) * 100)}%"></i></span><span class="mono">${p.value === null ? t('atFlow.import.noData') : `${Math.round(p.value * 100)}%`}</span></div>`)
        .join('')}</div>
      <ul class="pw-notes">${q.advice.length ? q.advice.map((a) => `<li class="${a === 'noThrottle' || a === 'rcFallback' ? 'info' : 'warn'}"><i></i>${t(k(`atFlow.import.advice.${a}`))}</li>`).join('') : `<li class="ok"><i></i>${t('atFlow.import.allGood')}</li>`}</ul>
    </div>`;
}

export function busyBlock(b: { frac: number; label: string }): string {
  return `<div class="pw-drop"><h3>${escapeHtml(b.label)}</h3><div class="at-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(b.frac * 100)}"><i style="width:${Math.round(b.frac * 100)}%"></i></div><p class="pw-hint">${t('at.busyNote')}</p></div>`;
}

export function dropBlock(vm: ViewModel): string {
  return `<div class="pw-drop" data-drop>
      <h3>${vm.expert ? t('at.dropTitle') : t('atFlow.basic.import.drop')}</h3><p>${vm.expert ? t('at.dropLead') : t('atFlow.basic.import.dropLead')}</p>
      <div class="pw-btns">${btn('pick', t('at.pick'), 'light', { icon: 'download', big: !vm.expert })}${btn('sample', t('at.sample'), 'ghost', { icon: 'play' })}</div>
      <p class="pw-hint">${vm.expert ? t('at.how') : t('atFlow.basic.import.where')}</p>
      ${vm.error ? `<p class="pw-msg err" role="alert">${escapeHtml(vm.error)}</p>` : ''}
    </div>`;
}

export function importView(vm: ViewModel): string {
  const title = vm.expert ? h2(t('atFlow.import.title'), t('atFlow.import.lead'), 'tips.autotune.drop') : h2(t('atFlow.basic.import.title'), t('atFlow.basic.import.lead'), 'tips.autotune.bLoad');
  if (vm.busy) return title + busyBlock(vm.busy);
  if (!vm.run) return title + dropBlock(vm);
  const r = vm.run.res;
  const a = r.analysis;
  const dur = `${Math.floor(a.duration / 60)}:${String(Math.round(a.duration % 60)).padStart(2, '0')} ${t('at.unit.min')}`;
  const file = `<div class="pw-file"><span class="at-sq"></span><span class="mono">${escapeHtml(t('atFlow.import.summary', { name: vm.run.name, dur, khz: fmtNum(a.fs / 1000, 1) }))}</span>
      <span class="pw-btns">${btn('pick', t('at.pickOther'), 'ghost', { icon: 'download' })}${btn('sample', t('at.sample'), 'ghost', { icon: 'play' })}</span></div>`;
  if (!vm.expert) {
    const q = r.quality;
    const kind = q.label === 'good' ? 'ok' : q.label === 'ok' ? 'warn' : 'err';
    return `${title}${file}<p class="pw-msg ${kind}">${t(k(`atFlow.basic.import.q.${q.label}`))}</p>
      <div class="pw-btns">${btn('goto', `${t('atFlow.basic.import.see')} ${icon('arrowRight', 16)}`, 'light', { arg: 'propose', big: true })}</div>`;
  }
  return `${title}${file}${qualityBlock(r.quality)}`;
}
