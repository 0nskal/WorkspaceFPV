/** Auto-tune wizard: HTML of the stepper and the six step bodies (pure string builders; pid-wizard.ts owns state and events). */
import type { Recommendation } from '../analysis/recommend';
import type { LogQuality } from '../analysis/quality';
import type { AnalysisResult } from '../analysis/types';
import { fmtNum, t, type Key } from '../i18n';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { intro, tip } from '../ui/tip';
import { coachAt, scriptSeconds, type FlightStep } from '../wizard/flight-script';
import { PART_KEYS, prefillFromFc, ruleProfile, STYLES, typicalBuild, type FcFacts, type PartKey, type Pid3 } from '../wizard/parts';
import type { Check } from '../wizard/prepare';
import { blockFor, STEPS, stepIndex, type GateInput, type Iteration, type NamedBackup, type StepId, type WizardState } from '../wizard/state';

export interface ViewModel {
  st: WizardState;
  facts: FcFacts;
  gate: GateInput;
  backups: NamedBackup[];
  backupBusy: boolean;
  backupMsg: { kind: 'ok' | 'err' | 'info'; text: string } | null;
  checks: Check[];
  script: FlightStep[];
  coach: { elapsed: number; running: boolean; skipFlips: boolean };
  log: { res: AnalysisResult; sample: boolean; quality: LogQuality } | null;
  busy: { frac: number; label: string } | null;
  error: string | null;
  rec: Recommendation | null;
  pidSource: 'header' | 'fc' | 'demo' | null;
  mismatch: Array<'roll' | 'pitch' | 'yaw'>;
  usedPid: Pid3 | null;
  iterations: Iteration[];
  aiReady: boolean;
}

const k = (s: string) => s as Key;
const btn = (act: string, label: string, cls = 'ghost', opts: { icon?: string; disabled?: boolean; title?: string; arg?: string } = {}) =>
  `<button type="button" class="btn ${cls}" data-act="${act}"${opts.arg !== undefined ? ` data-arg="${escapeHtml(opts.arg)}"` : ''}${opts.disabled ? ' disabled' : ''}${opts.title ? ` title="${escapeHtml(opts.title)}"` : ''}>${opts.icon ? icon(opts.icon, 16) : ''}${label}</button>`;
const chip = (kind: 'ok' | 'warn' | 'hot' | 'info' | 'dim', text: string) => `<span class="pw-chip ${kind}">${escapeHtml(text)}</span>`;

/* ---------------- shell ---------------- */

export function stepStatus(vm: ViewModel, s: StepId): 'done' | 'now' | 'todo' | 'attention' {
  if (s === vm.st.step) return 'now';
  const blocked = blockFor(s, vm.gate);
  if (s === 'backup' && vm.st.backup) return 'done';
  if (s === 'prepare' && vm.checks.some((c) => c.status === 'block' || (c.status === 'fix' && !vm.st.fixed.includes(c.id)))) return stepIndex(vm.st.reached) >= stepIndex('prepare') ? 'attention' : 'todo';
  if (s === 'import' && vm.log) return vm.log.quality.label === 'poor' ? 'attention' : 'done';
  if (blocked) return 'todo';
  return stepIndex(s) < stepIndex(vm.st.reached) || (s === 'propose' && vm.st.reached === 'propose') ? 'done' : 'todo';
}

export function shell(vm: ViewModel, body: string): string {
  const i = stepIndex(vm.st.step);
  const next = STEPS[i + 1];
  const block = next ? blockFor(next, vm.gate) : null;
  const banner = vm.facts.armed
    ? `<div class="pw-banner hot" role="alert">${icon('alert', 16)}<span>${t('pidWizard.armedBanner')}</span></div>`
    : !vm.facts.connected
      ? `<div class="pw-banner">${icon('plug', 16)}<span>${t('pidWizard.notConnected')}</span><span class="pw-banner-btns">${btn('connect', t('pidWizard.connect'), 'light')}${btn('demo', t('pidWizard.demo'))}</span></div>`
      : '';
  return `
    ${intro('tips.pidWizard.intro')}
    <header class="pw-head">
      <div><h1>${t('pidWizard.title')}</h1><p>${t('pidWizard.lead')}</p></div>
      <button type="button" class="at-link" data-act="reset">${icon('trash', 14)}${t('pidWizard.reset')}</button>
    </header>
    <ol class="pw-steps" aria-label="${escapeHtml(t('pidWizard.title'))}">${STEPS.map((s, n) => {
      const status = stepStatus(vm, s);
      const can = !blockFor(s, vm.gate) && stepIndex(s) <= stepIndex(vm.st.reached);
      return `<li class="${status}"><button type="button" data-act="goto" data-arg="${s}" ${can ? '' : 'disabled'} ${s === vm.st.step ? 'aria-current="step"' : ''}>
        <span class="pw-num">${status === 'done' ? icon('check', 14) : status === 'attention' ? '!' : n + 1}</span>
        <span class="pw-st"><b>${t(k(`pidWizard.steps.${s}`))}</b><small>${t(k(`pidWizard.status.${status}`))}</small></span></button></li>`;
    }).join('')}</ol>
    ${banner}
    <section class="pw-card" aria-labelledby="pw-h2">${body}</section>
    <footer class="pw-foot">
      ${i > 0 ? btn('prev', t('pidWizard.back'), 'ghost') : '<span></span>'}
      <span class="pw-foot-r">${block ? `<span class="pw-why">${t(k(`pidWizard.block.${block}`))}</span>` : ''}<span class="mono dim">${t('pidWizard.stepOf', { n: i + 1, total: STEPS.length })}</span>
      ${next ? btn('next', `${t('pidWizard.next')} ${icon('arrowRight', 16)}`, 'light', { disabled: !!block }) : ''}</span>
    </footer>`;
}

const h2 = (title: string, lead?: string) => `<div class="pw-h"><h2 id="pw-h2">${title}</h2>${lead ? `<p>${lead}</p>` : ''}</div>`;

/* ---------------- 1 parts ---------------- */

function factRows(f: FcFacts): string {
  const rows: Array<[string, string]> = [];
  const add = (key: string, v: string | null) => {
    if (v !== null && v !== '') rows.push([t(k(`pidWizard.parts.fact.${key}`)), v]);
  };
  add('firmware', f.firmware);
  add('board', f.board);
  add('protocol', f.protocol);
  add('bidir', f.bidir === null ? null : f.bidir ? t('common.on') : t('common.off'));
  add('rpm', f.rpmHarmonics === null ? null : f.rpmHarmonics ? t('pidWizard.parts.fact.rpmVal', { n: f.rpmHarmonics }) : t('common.off'));
  add('loop', f.pidLoopHz ? `${fmtNum(f.pidLoopHz / 1000, 1)} kHz` : null);
  const dev = f.bbDevice === null ? null : (['none', 'flash', 'sd', 'serial'][f.bbDevice] ?? 'none');
  add('blackbox', dev ? t('pidWizard.parts.fact.bbVal', { dev: t(k(`pidWizard.parts.dev.${dev}`)), hz: f.bbRateHz ? Math.round(f.bbRateHz) : '?' }) : null);
  add('debug', f.debugName ?? (f.debugIndex !== null ? `#${f.debugIndex}` : null));
  add('battery', f.cells ? t('pidWizard.parts.fact.batteryVal', { cells: f.cells, v: f.vbat !== null ? fmtNum(f.vbat, 1) : '?' }) : null);
  add('motors', f.motorCount ? t('pidWizard.parts.fact.motorsVal', { n: f.motorCount, poles: f.motorPoles ?? '?' }) : null);
  add('pid', f.pid ? `${f.pid.roll.join('/')} · ${f.pid.pitch.join('/')} · ${f.pid.yaw.join('/')}` : null);
  add('filters', f.gyroLpf1Hz !== null ? `${f.gyroLpf1Hz} / ${f.dtermLpf1Hz ?? '?'} Hz` : null);
  add('elrs', f.elrs);
  if (!rows.length) return `<p class="pw-empty">${t('pidWizard.parts.noFacts')}</p>`;
  return `<dl class="pw-facts">${rows.map(([l, v]) => `<div><dt>${escapeHtml(l)}</dt><dd class="mono">${escapeHtml(v)}</dd></div>`).join('')}</dl>`;
}

function field(vm: ViewModel, key: PartKey): string {
  const p = vm.st.parts;
  const v = p[key];
  const pre = prefillFromFc(vm.facts);
  const empty = v === null || v === '';
  const state = !empty && pre[key] !== undefined && pre[key] === v ? 'detected' : empty ? 'ask' : 'typed';
  const label = t(k(`pidWizard.parts.f.${key}`));
  const id = `pw-f-${key}`;
  const unit: Partial<Record<PartKey, string>> = { frameIn: t('pidWizard.parts.unit.in'), propIn: t('pidWizard.parts.unit.in'), capacityMah: t('pidWizard.parts.unit.mah'), weightG: t('pidWizard.parts.unit.g'), vtxMw: t('pidWizard.parts.unit.mw'), motorKv: t('pidWizard.parts.unit.kv') };
  let input: string;
  const val = empty ? '' : escapeHtml(String(v));
  if (key === 'style') {
    input = `<select id="${id}" data-part="style"><option value="">${t('pidWizard.parts.ph.choose')}</option>${STYLES.map((s) => `<option value="${s}" ${v === s ? 'selected' : ''}>${t(k(`pidWizard.parts.style.${s}`))}</option>`).join('')}</select>`;
  } else if (key === 'cells') {
    input = `<select id="${id}" data-part="cells"><option value="">${t('pidWizard.parts.ph.choose')}</option>${[1, 2, 3, 4, 5, 6, 7, 8].map((c) => `<option value="${c}" ${v === c ? 'selected' : ''}>${c}S</option>`).join('')}</select>`;
  } else if (key === 'propBlades') {
    input = `<select id="${id}" data-part="propBlades"><option value="">${t('pidWizard.parts.ph.choose')}</option>${[2, 3, 4, 5, 6].map((c) => `<option value="${c}" ${v === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
  } else if (key === 'motorStator' || key === 'escProtocol') {
    input = `<input id="${id}" type="text" data-part="${key}" value="${val}" maxlength="24" ${key === 'motorStator' ? `placeholder="${t('pidWizard.parts.ph.stator')}"` : ''} autocomplete="off">`;
  } else {
    input = `<input id="${id}" type="number" inputmode="decimal" min="0" step="any" data-part="${key}" value="${val}">`;
  }
  return `<div class="pw-field ${state}"><label for="${id}">${label}${chip(state === 'detected' ? 'ok' : state === 'ask' ? 'warn' : 'dim', t(k(`pidWizard.chip.${state}`)))}</label>
    <div class="pw-in">${input}${unit[key] ? `<em>${unit[key]}</em>` : ''}</div></div>`;
}

export function partsView(vm: ViewModel): string {
  const p = vm.st.parts;
  const typ = typicalBuild(p.frameIn);
  const notes = ruleProfile(p, vm.facts);
  const aiBtn = btn('ai-parts', t('pidWizard.parts.askAi'), 'light', { icon: 'chip', disabled: !vm.facts.connected || !vm.aiReady });
  const aiHint = !vm.aiReady ? `<p class="pw-hint">${t('pidWizard.parts.aiNotReady')}</p>` : !vm.facts.connected ? `<p class="pw-hint">${t('pidWizard.parts.aiNeedsFc')}</p>` : '';
  return `${h2(t('pidWizard.parts.title'), t('pidWizard.parts.lead'))}
    <div class="pw-grid2">
      <div class="pw-panel"><div class="pw-cap mono">${t('pidWizard.parts.fromFc')}</div>${factRows(vm.facts)}</div>
      <div class="pw-panel"><div class="pw-cap mono">${t('pidWizard.parts.yourBuild')}</div>
        <div class="pw-form">${PART_KEYS.map((key) => field(vm, key)).join('')}</div>
        ${typ ? `<div class="pw-typ"><span>${t('pidWizard.parts.typical', { size: fmtNum(p.frameIn ?? 0, p.frameIn && p.frameIn % 1 ? 1 : 0), stator: typ.stator, kv1: typ.kv[0], kv2: typ.kv[1], cells: typ.kvCells, prop: fmtNum(typ.prop, typ.prop % 1 ? 1 : 0), blades: typ.blades })}</span>${btn('typical', t('pidWizard.parts.useTypical'), 'ghost')}</div>` : ''}
      </div>
    </div>
    <div class="pw-panel"><div class="pw-cap mono">${t('pidWizard.parts.profile')}</div>
      <ul class="pw-notes">${notes.map((n) => `<li class="${n.level}"><i></i>${escapeHtml(t(k(`pidWizard.parts.rule.${n.code}`), n.params))}</li>`).join('')}</ul>
      <div class="pw-btns">${aiBtn}</div>${aiHint}
    </div>`;
}

/* ---------------- 2 backup ---------------- */

export function backupView(vm: ViewModel): string {
  const can = vm.facts.connected && !vm.facts.armed && !vm.backupBusy;
  const fmt = (at: number) => new Date(at).toLocaleString();
  const msg = vm.backupMsg ? `<p class="pw-msg ${vm.backupMsg.kind}" role="status">${escapeHtml(vm.backupMsg.text)}</p>` : '';
  return `${h2(t('pidWizard.backup.title'), t('pidWizard.backup.lead'))}
    <div class="pw-big">
      <div class="pw-big-ico">${icon('shield', 34)}</div>
      <div class="pw-big-body">
        ${vm.st.backup ? `<div class="pw-done">${icon('check', 18)}<span class="mono">${escapeHtml(vm.st.backup)}</span></div>` : ''}
        <div class="pw-btns">${btn('backup', vm.backupBusy ? t('pidWizard.backup.creating') : t('pidWizard.backup.create'), vm.st.backup ? 'ghost' : 'light', { icon: 'download', disabled: !can })}</div>
        <p class="pw-hint">${vm.facts.connected ? t('pidWizard.backup.rebootNote') : t('pidWizard.backup.needFc')}</p>
        ${msg}
      </div>
    </div>
    <div class="pw-panel"><div class="pw-cap mono">${t('pidWizard.backup.list')}</div>
      ${vm.backups.length
        ? `<ul class="pw-blist">${vm.backups.map((b) => `<li><span class="mono">${escapeHtml(b.name)}</span><span class="dim">${escapeHtml(fmt(b.at))} · ${fmtNum(b.text.length / 1024, 1)} kB</span>
            <span class="pw-btns">${btn('dl-backup', t('pidWizard.backup.download'), 'ghost', { arg: b.name, icon: 'download' })}${btn('restore', t('pidWizard.backup.restore'), 'ghost', { arg: b.name, disabled: !vm.facts.connected || vm.facts.armed })}</span></li>`).join('')}</ul>`
        : `<p class="pw-empty">${t('pidWizard.backup.none')}</p>`}
    </div>`;
}

/* ---------------- 3 prepare ---------------- */

export function prepareView(vm: ViewModel): string {
  const open = vm.checks.filter((c) => c.status === 'fix' && !vm.st.fixed.includes(c.id));
  const nFix = open.reduce((n, c) => n + (c.fix?.length ?? 0), 0);
  const canFix = vm.facts.connected && !vm.facts.armed;
  const row = (c: Check) => {
    const base = `pidWizard.prepare.c.${c.id}`;
    const applied = c.status === 'fix' && vm.st.fixed.includes(c.id);
    const kind = c.status === 'ok' ? 'ok' : c.status === 'block' ? 'hot' : c.status === 'fix' ? (applied ? 'ok' : 'warn') : c.status === 'warn' ? 'warn' : 'info';
    const textKey = c.status === 'manual' ? `${base}.manual` : `${base}.${c.status === 'block' ? 'block' : c.status}`;
    let right = '';
    if (c.status === 'manual') {
      const id = c.id as 'battery' | 'space';
      right = `<label class="pw-tick"><input type="checkbox" data-tick="${id}" ${vm.st.ticks[id] ? 'checked' : ''}><span>${icon('check', 14)}</span></label>`;
    } else if (c.status === 'fix') {
      right = applied ? chip('ok', t('pidWizard.prepare.applied')) : btn('fix', t('pidWizard.prepare.fix'), 'ghost', { arg: c.id, disabled: !canFix });
    }
    const cmds = c.fix && !applied ? `<code class="mono">${escapeHtml(c.fix.join('  ·  '))}</code>` : '';
    return `<li class="pw-check ${kind}"><i class="pw-dot"></i><div><b>${t(k(`${base}.title`))}</b><p>${escapeHtml(t(k(textKey), c.params))}</p>${cmds}</div><div class="pw-check-r">${right}</div></li>`;
  };
  return `${h2(t('pidWizard.prepare.title'), t('pidWizard.prepare.lead'))}
    <ul class="pw-checks">${vm.checks.map(row).join('')}</ul>
    <div class="pw-btns">${btn('fix-all', t('pidWizard.prepare.fixAll', { n: nFix }), 'light', { icon: 'arrowUp', disabled: !canFix || !nFix })}</div>`;
}

/* ---------------- 4 flight ---------------- */

export function coachState(vm: ViewModel) {
  return coachAt(vm.script, vm.coach.elapsed, vm.coach.skipFlips);
}

export function flightView(vm: ViewModel): string {
  const steps = vm.script;
  const pos = coachState(vm);
  const cur = steps[pos.index]!;
  const style = vm.st.parts.style;
  const total = scriptSeconds(steps, !vm.coach.skipFlips);
  const started = vm.coach.elapsed > 0;
  return `${h2(t('pidWizard.flight.title'), t('pidWizard.flight.lead'))}
    <p class="pw-rules mono">${t('pidWizard.flight.rules')} · ${t('pidWizard.flight.total', { s: total })}</p>
    <div class="pw-coach">
      <div class="pw-move" aria-live="polite">
        <div class="pw-move-n mono">${pos.index + 1} / ${steps.length}${cur.optional ? ' · opt' : ''}</div>
        <h3>${t(k(`pidWizard.flight.steps.${cur.id}.title`))}</h3>
        <p>${t(k(`pidWizard.flight.steps.${cur.id}.body`))}</p>
        <div class="pw-count mono" data-count>${cur.seconds ? `${pos.left}<small>${t('pidWizard.flight.sec')}</small>` : icon('check', 40)}</div>
        <div class="pw-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pos.frac * 100)}"><i data-prog style="width:${Math.round(pos.frac * 100)}%"></i></div>
        <div class="pw-btns">
          ${btn('coach-toggle', vm.coach.running ? t('pidWizard.flight.pause') : started ? t('pidWizard.flight.resume') : t('pidWizard.flight.start'), 'light', { icon: vm.coach.running ? 'stop' : 'play', disabled: pos.done && !vm.coach.running })}
          ${btn('coach-prev', t('pidWizard.flight.prevStep'), 'ghost', { disabled: pos.index === 0 })}
          ${btn('coach-next', t('pidWizard.flight.nextStep'), 'ghost', { disabled: pos.index >= steps.length - 1 })}
          ${btn('coach-reset', t('pidWizard.flight.restart'), 'ghost')}
        </div>
        ${pos.done ? `<p class="pw-msg ok">${t('pidWizard.flight.landed')}</p>` : ''}
      </div>
      <div class="pw-side">
        <ol class="pw-script">${steps.map((s, i) => `<li class="${i === pos.index ? 'on' : i < pos.index ? 'past' : ''}${s.optional && vm.coach.skipFlips ? ' skip' : ''}"><span class="mono">${s.seconds ? `${s.seconds}s` : '—'}</span>${t(k(`pidWizard.flight.steps.${s.id}.title`))}</li>`).join('')}</ol>
        <label class="pw-toggle"><input type="checkbox" data-opt="skipFlips" ${vm.coach.skipFlips ? 'checked' : ''}>${t('pidWizard.flight.skipFlips')}</label>
        <label class="pw-toggle"><input type="checkbox" data-opt="beep" ${vm.st.beep ? 'checked' : ''}>${t('pidWizard.flight.beep')}</label>
        <div class="pw-tips"><div class="pw-cap mono">${style ? t('pidWizard.flight.tipsTitle', { style: t(k(`pidWizard.parts.style.${style}`)).toUpperCase() }) : ''}</div>
          ${style ? `<ul>${['a', 'b', 'c'].map((x) => `<li>${t(k(`pidWizard.flight.style.${style}.${x}`))}</li>`).join('')}</ul>` : `<p class="pw-hint">${t('pidWizard.flight.noStyle')}</p>`}
        </div>
      </div>
    </div>`;
}

/* ---------------- 5 import ---------------- */

export function qualityBlock(q: LogQuality): string {
  const kind = q.label === 'good' ? 'ok' : q.label === 'ok' ? 'warn' : 'hot';
  return `<div class="pw-q">
      <div class="pw-q-score ${kind}"><span class="mono">${t('pidWizard.import.quality')} ${tip('tips.pidWizard.quality')}</span><b>${q.score}</b>${chip(kind, t(k(`pidWizard.import.label.${q.label}`)))}</div>
      <div class="pw-q-parts">${q.parts
        .map((p) => `<div class="pw-q-row"><span>${t(k(`pidWizard.import.part.${p.id}`))}</span><span class="pw-q-bar ${p.value === null ? 'na' : ''}"><i style="width:${Math.round((p.value ?? 0) * 100)}%"></i></span><span class="mono">${p.value === null ? t('pidWizard.import.noData') : `${Math.round(p.value * 100)}%`}</span></div>`)
        .join('')}</div>
      <ul class="pw-notes">${q.advice.length ? q.advice.map((a) => `<li class="${a === 'noThrottle' || a === 'rcFallback' ? 'info' : 'warn'}"><i></i>${t(k(`pidWizard.import.advice.${a}`))}</li>`).join('') : `<li class="ok"><i></i>${t('pidWizard.import.allGood')}</li>`}</ul>
    </div>`;
}

export function importView(vm: ViewModel, dragging: boolean): string {
  let body: string;
  if (vm.busy) {
    body = `<div class="pw-drop"><h3>${escapeHtml(vm.busy.label)}</h3><div class="at-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(vm.busy.frac * 100)}"><i style="width:${Math.round(vm.busy.frac * 100)}%"></i></div><p class="pw-hint">${t('at.busyNote')}</p></div>`;
  } else if (vm.log) {
    const r = vm.log.res;
    const dur = `${Math.floor(r.duration / 60)}:${String(Math.round(r.duration % 60)).padStart(2, '0')} ${t('at.unit.min')}`;
    body = `<div class="pw-file"><span class="at-sq"></span><span class="mono">${escapeHtml(t('pidWizard.import.summary', { name: r.name || t('at.sampleName'), dur, khz: fmtNum(r.fs / 1000, 1) }))}</span>
        <span class="pw-btns">${btn('pick', t('at.pickOther'), 'ghost', { icon: 'download' })}${btn('sample', t('at.sample'), 'ghost', { icon: 'play' })}</span></div>
      ${qualityBlock(vm.log.quality)}`;
  } else {
    body = `<div class="pw-drop ${dragging ? 'drag' : ''}" data-drop>
        <h3>${t('at.dropTitle')}</h3><p>${t('at.dropLead')}</p>
        <div class="pw-btns">${btn('pick', t('at.pick'), 'light', { icon: 'download' })}${btn('sample', t('at.sample'), 'ghost', { icon: 'play' })}</div>
        <p class="pw-hint">${t('at.how')}</p>
        ${vm.error ? `<p class="pw-msg err" role="alert">${escapeHtml(vm.error)}</p>` : ''}
      </div>`;
  }
  return `${h2(t('pidWizard.import.title'), t('pidWizard.import.lead'))}${body}<input type="file" accept=".csv,.txt,.bbl,.bfl,.log,text/csv" hidden data-file>`;
}

/* ---------------- 6 propose ---------------- */

function cell(cur: number | undefined, sug: number | undefined): string {
  if (cur === undefined || sug === undefined) return '<span class="dim">—</span>';
  return cur !== sug ? `<span class="old">${cur}</span><span class="arr">→</span><span class="chg">${sug}</span>` : String(cur);
}

function iterTable(its: Iteration[]): string {
  if (its.length < 2) return `<p class="pw-hint">${t('pidWizard.propose.oneRound')}</p>`;
  const shown = its.slice(-4);
  const axes = ['Roll', 'Pitch', 'Yaw'];
  const metrics = ['overshoot', 'rise', 'settle'] as const;
  const fmtM = (m: (typeof metrics)[number], v: number | null) => (v === null ? (m === 'settle' ? '>500' : '—') : m === 'overshoot' ? `${fmtNum(v, 0)}%` : `${fmtNum(v, 0)} ms`);
  return `<div class="pw-scroll"><table class="pw-iter"><thead><tr><th scope="col">${t('pidWizard.propose.axis')}</th><th scope="col"></th>${shown
    .map((it) => `<th scope="col">${t('pidWizard.propose.iter', { n: it.n })}<small>${it.score}/100${it.applied.length ? ` · ${t('pidWizard.propose.appliedMark')}` : ''}</small></th>`)
    .join('')}</tr></thead><tbody>${axes
    .map((ax, a) =>
      metrics
        .map((m, mi) => {
          const cells = shown.map((it, j) => {
            const v = it.axes[a]![m];
            const prev = j > 0 ? shown[j - 1]!.axes[a]![m] : null;
            const tr = j > 0 && v !== null && prev !== null ? (Math.abs(v - prev) <= 1 ? '' : v < prev ? 'better' : 'worse') : '';
            return `<td class="${tr}">${fmtM(m, v)}${tr ? `<small>${t(k(`pidWizard.propose.${tr}`))}</small>` : ''}</td>`;
          });
          return `<tr>${mi === 0 ? `<th scope="row" rowspan="3">${ax}</th>` : ''}<td class="dim">${t(k(`pidWizard.propose.metric.${m}`))}</td>${cells.join('')}</tr>`;
        })
        .join(''),
    )
    .join('')}</tbody></table></div>`;
}

export function proposeView(vm: ViewModel): string {
  const rec = vm.rec;
  const log = vm.log;
  if (!rec || !log) return h2(t('pidWizard.propose.title')) + `<p class="pw-empty">${t('pidWizard.block.needLog')}</p>`;
  const q = log.quality;
  const kind = q.label === 'good' ? 'ok' : q.label === 'ok' ? 'warn' : 'hot';
  const canApply = vm.facts.connected && !vm.facts.armed && rec.commands.length > 0;
  const backup = vm.st.backup;
  const src = vm.pidSource === 'header' ? t('pidWizard.propose.fromHeader') : vm.pidSource === 'fc' ? t('pidWizard.propose.fromFc') : vm.pidSource === 'demo' ? t('pidWizard.propose.fromDemo') : t('pidWizard.propose.noPid');
  const cmdHtml = rec.commands.length ? rec.commands.map((c) => `<div>${escapeHtml(c)}</div>`).join('') : `<div class="dim">${t('pidWizard.propose.nothing')}</div>`;
  return `${h2(t('pidWizard.propose.title'))}
    <div class="pw-conf"><span class="mono">${t('pidWizard.propose.confidence')}</span>${chip(kind, t(k(`pidWizard.propose.conf.${q.label}`)))}<span class="dim">${q.score}/100</span><span class="dim">· ${escapeHtml(src)}</span></div>
    ${q.label === 'poor' ? `<div class="pw-banner warn">${icon('alert', 16)}<span>${t('pidWizard.propose.poorLog')} ${q.advice.filter((a) => a !== 'noThrottle').map((a) => t(k(`pidWizard.import.advice.${a}`))).join(' ')}</span></div>` : ''}
    ${vm.mismatch.length ? `<div class="pw-banner warn">${icon('alert', 16)}<span>${t('pidWizard.propose.headerMismatch', { axes: vm.mismatch.join(', ') })} ${tip('tips.pidWizard.headerPid')}</span></div>` : ''}
    <div class="pw-grid2 wide">
      <div class="pw-panel">
        <table class="at-tbl pw-pid"><thead><tr><th scope="col">${t('pidWizard.propose.axis')}</th><th scope="col">P</th><th scope="col">I</th><th scope="col">D</th><th scope="col">FF</th></tr></thead>
        <tbody>${rec.axes
          .map((a) => `<tr><th scope="row">${a.name}</th><td>${cell(a.current?.[0], a.suggested?.[0])}</td><td>${cell(a.current?.[1], a.suggested?.[1])}</td><td>${cell(a.current?.[2], a.suggested?.[2])}</td><td>${a.ffUp ? '<span class="chg">↑</span>' : '<span class="dim">—</span>'}</td></tr>`)
          .join('')}</tbody></table>
        <div class="pw-cap mono">${t('pidWizard.propose.why')}</div>
        <ul class="pw-notes">${rec.notes.map((n) => `<li class="${n.level === 'hot' ? 'warn' : n.level}"><i></i>${escapeHtml(n.text)}</li>`).join('')}</ul>
        <p class="pw-hint">${t('pidWizard.propose.sliders')}</p>
      </div>
      <div class="pw-panel">
        <div class="pw-cap mono">${t('pidWizard.propose.cli')}<span>${rec.commands.length}</span></div>
        <div class="at-cmd mono">${cmdHtml}</div>
        <div class="pw-btns">
          ${btn('apply', t('pidWizard.propose.apply'), 'light', { icon: 'arrowUp', disabled: !canApply })}
          ${btn('copy', t('pidWizard.propose.copy'), 'ghost', { icon: 'copy', disabled: !rec.commands.length })}
          ${btn('restore', backup ? t('pidWizard.propose.restore', { name: backup }) : t('pidWizard.propose.noBackup'), 'ghost', { arg: backup ?? '', disabled: !backup || !vm.facts.connected || vm.facts.armed })}
          ${btn('ai-review', t('pidWizard.propose.askAi'), 'ghost', { icon: 'chip', disabled: !vm.facts.connected || !vm.aiReady })}
        </div>
        ${!vm.aiReady ? `<p class="pw-hint">${t('pidWizard.parts.aiNotReady')}</p>` : ''}
      </div>
    </div>
    <div class="pw-panel"><div class="pw-cap mono">${t('pidWizard.propose.iterations')}</div>${iterTable(vm.iterations)}
      <div class="pw-btns">${btn('fly-again', t('pidWizard.propose.flyAgain'), 'light', { icon: 'play' })}</div></div>`;
}

export const metricOf = (res: AnalysisResult): Iteration['axes'] => res.axes.slice(0, 3).map((a) => ({ overshoot: a.overshoot, rise: a.rise, settle: a.settle })) as Iteration['axes'];
