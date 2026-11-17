/**
 * Autotune PID tab (both modes): one guided flow (drone -> safety copy -> get ready -> fly -> load the log -> result)
 * on top of the auto-tune engine v2 (analysis/autotune.ts, run in a Web Worker).
 * - Basic: calm one-button steps, traffic lights and ONE automatically chosen change set (wizard/verdict.ts).
 * - Expert: compact stepper, offline log analysis with charts, every recommendation tickable (autotune-expert.ts).
 * Reads the FC only through ctx.state / ctx.bf; every FC change goes through ctx.applyCommands (confirmation, diff-all
 * backup, save) after a click, never while armed. The flash erase asks first, like the Blackbox tab. The app never
 * controls the drone. State survives tab and mode switches (module scope), the flow state also reloads.
 */
import type { AutotuneOptions } from '../analysis/autotune';
import { chirpSetupCli } from '../analysis/chirp';
import { RunError, runAutotune } from '../analysis/run';
import type { Source } from '../analysis/run-core';
import { publishSuggestion } from '../bf/autotune-link';
import { MSPB } from '../bf/blackbox';
import { takePendingLog } from '../bf/log-handoff';
import { fmtNum, t, type Key } from '../i18n';
import { copyText, downloadText, escapeHtml } from '../ui/dom';
import { currentMode } from '../ui/mode';
import { readFacts } from '../wizard/fc-facts';
import { SCRIPTS, coachAt, startOf } from '../wizard/flight-script';
import { aiFacts, emptyParts, mergeDetected, typicalBuild, type FcFacts, type Parts, type Style } from '../wizard/parts';
import { allFixes, prepareChecks, type CheckId } from '../wizard/prepare';
import {
  STEPS,
  addBackup,
  backupName,
  blockFor,
  canJump,
  go,
  initialState,
  loadBackups,
  loadState,
  parseSet,
  pidMismatch,
  pidOld,
  recordUndo,
  restoreCommands,
  saveBackups,
  saveState,
  stepIndex,
  type GateInput,
  type StepId,
  type WizardState,
} from '../wizard/state';
import { applyUnits, basicPlan, roundMetrics, selectedCommands, verdicts } from '../wizard/verdict';
import type { AppContext, ScreenMount } from '../context';
import type { AutotuneResult } from '../analysis/autotune';
import { drawHeatmap } from './autotune-charts';
import { basicApplyBlock, basicResult } from './autotune-basic';
import { adviceText, currentSpectrogram, expertApplyBlock, expertWorkspace } from './autotune-expert';
import { backupView, flightView, importView, partsView, prepareView, shell, type ExpertTab, type Round, type Run, type UiState, type ViewModel } from './autotune-flow';
import './autotune.css';

/** Survives tab and mode switches (not persisted: logs and rounds are big and belong to this session). */
const mem: {
  run: Run | null;
  src: Source | null;
  rounds: Round[];
  busy: { frac: number; label: string } | null;
  error: string | null;
  coach: { elapsed: number; running: boolean; skipFlips: boolean; startedAt: number; base: number };
  ui: UiState;
} = {
  run: null,
  src: null,
  rounds: [],
  busy: null,
  error: null,
  coach: { elapsed: 0, running: false, skipFlips: false, startedAt: 0, base: 0 },
  ui: { tab: 'overview', stepMode: 'all', stepAxis: 'roll', chirpAxis: 'roll', signal: 'gyro', form: 'sliders', selected: new Set(), hot: false, details: false, session: null },
};
/** Render function of the mounted screen (an analysis started before a tab / mode switch ends in the new one). */
let live: (() => void) | null = null;
let st: WizardState = loadState();

const SCRIPT = SCRIPTS.basic;

const save = () => saveState(st);
const set = (patch: Partial<WizardState>) => {
  st = { ...st, ...patch };
  save();
};

function engineOpts(): AutotuneOptions {
  const o: AutotuneOptions = {};
  if (st.parts.frameIn) o.frameInches = st.parts.frameIn;
  if (st.parts.propIn) o.propInches = st.parts.propIn;
  if (mem.ui.hot) o.hotMotors = true;
  if (mem.ui.session !== null) o.session = mem.ui.session;
  return o;
}

/** Hands the raw-PID proposal to the PID Tuning tab, only when it was computed from the PIDs the FC has now. */
function publish(res: AutotuneResult | null, facts: FcFacts): void {
  if (!res || pidMismatch(res.settings?.pid, facts.pid).length || mem.run?.sample) return publishSuggestion(null);
  publishSuggestion(res.pids.axes.map((a) => ({ axis: a.axis, current: a.current ? [a.current.p, a.current.i, a.current.d] : null, suggested: a.suggested ? [a.suggested.p, a.suggested.i, a.suggested.d] : null })));
}

/** Old values of the keys a command list changes (header of the log, FC PIDs), so Undo can put them back. */
function oldValues(cmds: string[], res: AutotuneResult | null, facts: FcFacts): Record<string, string> {
  const old: Record<string, string> = { ...pidOld(facts.pid) };
  const raw = res?.settings?.raw ?? {};
  const ENUM: Record<string, string[]> = { simplified_pids_mode: ['OFF', 'RP', 'RPY'], dshot_bidir: ['OFF', 'ON'] };
  for (const c of cmds) {
    const s = parseSet(c);
    if (!s || old[s.key] !== undefined) continue;
    const v = raw[s.key];
    if (v === undefined || v.includes(',')) continue;
    old[s.key] = ENUM[s.key]?.[Number(v)] ?? v.trim();
  }
  if (facts.bidir !== null) old['dshot_bidir'] ??= facts.bidir ? 'ON' : 'OFF';
  if (facts.rpmHarmonics !== null) old['rpm_filter_harmonics'] ??= String(facts.rpmHarmonics);
  return old;
}

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  const root = document.createElement('div');
  root.className = 'pw';
  el.appendChild(root);
  let disposed = false;
  let backupBusy = false;
  let eraseBusy = false;
  let backupMsg: ViewModel['backupMsg'] = null;
  let backups = loadBackups();
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastIndex = -1;
  let audio: AudioContext | null = null;
  const expert = () => currentMode(ctx.settings) === 'expert';

  /** Fills empty fields from the FC once per connection (the user's own entries are never overwritten). */
  let factsKey = '';
  function facts(): FcFacts {
    const f = readFacts(ctx);
    const key = JSON.stringify([f.connected, f.cells, f.capacityMah, f.protocol, f.bidir]);
    if (f.connected && key !== factsKey) {
      factsKey = key;
      const m = mergeDetected(st.parts, f);
      if (JSON.stringify(m.parts) !== JSON.stringify(st.parts)) set({ parts: m.parts });
    }
    return f;
  }
  const gate = (f: FcFacts): GateInput => ({ backup: st.backup, armed: f.armed, ticks: st.ticks, hasLog: !!mem.run });

  function model(): ViewModel {
    const f = facts();
    return {
      expert: expert(),
      st,
      facts: f,
      gate: gate(f),
      backups,
      backupBusy,
      backupMsg,
      eraseBusy,
      checks: prepareChecks(f),
      script: SCRIPT,
      coach: mem.coach,
      run: mem.run,
      busy: mem.busy,
      error: mem.error,
      rounds: mem.rounds,
      ui: mem.ui,
      aiReady: ctx.ai.ready(),
      mismatch: mem.run && !mem.run.sample ? pidMismatch(mem.run.res.settings?.pid, f.pid) : [],
    };
  }

  function render(): void {
    if (disposed) return;
    const vm = model();
    let html: string;
    if (st.step === 'propose' && vm.expert) html = shell(vm, expertWorkspace(vm), { bare: true, footer: false });
    else {
      const views: Record<StepId, () => string> = {
        parts: () => partsView(vm),
        backup: () => backupView(vm),
        prepare: () => prepareView(vm),
        flight: () => flightView(vm),
        import: () => importView(vm),
        propose: () => basicResult(vm),
      };
      html = shell(vm, views[st.step]());
    }
    const scroll = root.scrollTop;
    const focusId = (document.activeElement as HTMLElement | null)?.id;
    root.innerHTML = html;
    root.scrollTop = scroll;
    if (focusId) root.querySelector<HTMLElement>(`#${CSS.escape(focusId)}`)?.focus();
    // heatmap canvas is drawn after layout
    const cv = root.querySelector<HTMLCanvasElement>('canvas[data-heat]');
    if (cv && mem.run) {
      const s = currentSpectrogram(vm, mem.run.res);
      if (s) drawHeatmap(cv, s, { thrLabel: t('atFlow.expert.noise.thrAxis') });
    }
  }
  live = render;

  function goTo(to: StepId): void {
    const g = gate(readFacts(ctx));
    if (!canJump(st, to, g, expert()) && !(to === 'propose' && mem.run)) {
      // "Next" may still advance one step in Basic mode
      const next = go(st, to, g);
      if (next === st) return;
      st = next;
    } else st = { ...st, step: to, reached: stepIndex(to) > stepIndex(st.reached) ? to : st.reached };
    save();
    root.scrollTop = 0;
    render();
  }

  /* ---------- coach (timer only; nothing is sent anywhere) ---------- */
  function beep(): void {
    if (!st.beep) return;
    try {
      audio ??= new AudioContext();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + 0.15);
    } catch {
      /* no audio: the cards still change */
    }
  }
  function tick(): void {
    const c = mem.coach;
    if (c.running) c.elapsed = c.base + (Date.now() - c.startedAt) / 1000;
    const pos = coachAt(SCRIPT, c.elapsed, c.skipFlips);
    if (pos.done && c.running) {
      c.running = false;
      c.base = c.elapsed;
      stopTimer();
    }
    if (st.step !== 'flight') return;
    if (pos.index !== lastIndex || !c.running) {
      if (lastIndex >= 0 && pos.index !== lastIndex) beep();
      lastIndex = pos.index;
      render();
      return;
    }
    const count = root.querySelector<HTMLElement>('[data-count]');
    if (count && SCRIPT[pos.index]!.seconds) count.innerHTML = `${pos.left}<small>${t('atFlow.flight.sec')}</small>`;
    const bar = root.querySelector<HTMLElement>('[data-prog]');
    if (bar) bar.style.width = `${Math.round(pos.frac * 100)}%`;
  }
  function startTimer(): void {
    stopTimer();
    timer = setInterval(tick, 250);
  }
  function stopTimer(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }
  function coachJump(index: number): void {
    const c = mem.coach;
    c.elapsed = c.base = startOf(SCRIPT, Math.max(0, Math.min(SCRIPT.length - 1, index)), c.skipFlips);
    c.startedAt = Date.now();
    lastIndex = -1;
    tick();
  }
  function coachReset(): void {
    stopTimer();
    mem.coach = { elapsed: 0, running: false, skipFlips: mem.coach.skipFlips, startedAt: 0, base: 0 };
    lastIndex = -1;
  }

  /* ---------- analysis ---------- */
  async function analyse(src: Source, label: string, newRound: boolean, jump = newRound): Promise<void> {
    mem.busy = { frac: 0, label };
    mem.error = null;
    live?.();
    let last = 0;
    try {
      const res = await runAutotune(src, engineOpts(), (frac) => {
        if (frac - last < 0.03 || !mem.busy) return;
        last = frac;
        mem.busy = { frac, label };
        const i = document.querySelector<HTMLElement>('.pw .at-bar i');
        if (i) i.style.width = `${Math.round(frac * 100)}%`;
      });
      const sample = src.kind === 'demo';
      const name = src.kind === 'file' ? src.file.name : t('at.sampleName');
      mem.run = { res, sample, name };
      mem.src = src;
      if (newRound) {
        mem.rounds = [...mem.rounds, { n: mem.rounds.length + 1, at: Date.now(), name, metrics: roundMetrics(res), curve: res.steps[0]?.detected.curve ?? res.steps[0]?.wiener.curve ?? null, applied: [] }];
        mem.ui.form = res.pids.preferred;
        mem.ui.session = null;
      }
      // default ticks: what the engine is confident about
      mem.ui.selected = new Set(applyUnits(res, mem.ui.form).filter((u) => u.on).map((u) => u.id));
      if (jump) {
        st = { ...st, step: 'propose', reached: 'propose' };
        save();
      }
    } catch (e) {
      const err = e as RunError;
      mem.error = err.code === 'binary' ? t('at.binaryTitle') : t((err.key ?? 'at.err.generic') as Key, err.params);
      if (newRound && st.step === 'propose' && !mem.run) st = { ...st, step: 'import' };
    }
    mem.busy = null;
    publish(mem.run?.res ?? null, readFacts(ctx));
    live?.();
  }
  const loadFile = (f: File) => analyse({ kind: 'file', file: f }, t('at.analysing', { name: f.name }), true);
  const loadSample = (jump = true) => analyse({ kind: 'demo' }, t('at.generating'), true, jump);
  /** Same file again with other engine options (session, hot motors). */
  const rerun = () => (mem.src && !mem.busy ? analyse(mem.src, t('atFlow.expert.rerun'), false) : undefined);

  /* ---------- actions that touch the FC (each one after a click and a confirmation) ---------- */
  async function createBackup(): Promise<void> {
    const f = readFacts(ctx);
    if (!f.connected || f.armed || backupBusy) return;
    backupBusy = true;
    backupMsg = null;
    render();
    const text = await ctx.fetchDiff();
    backupBusy = false;
    if (disposed) return;
    if (!text) backupMsg = { kind: 'err', text: t('atFlow.backup.failed') };
    else {
      const name = backupName();
      backups = addBackup(loadBackups(), { name, at: Date.now(), text });
      const stored = saveBackups(backups);
      if (!stored) backups = loadBackups();
      downloadText(`${name}.txt`, text);
      set({ backup: name });
      backupMsg = { kind: stored ? 'ok' : 'info', text: `${t('atFlow.backup.done', { name })} ${t('atFlow.backup.doneFile', { name })}${stored ? '' : ' ' + t('atFlow.backup.storageFull')}` };
    }
    render();
  }

  async function restore(name: string): Promise<void> {
    const f = readFacts(ctx);
    if (f.armed) return ctx.toast(t('atFlow.block.armed'), 'error');
    const b = backups.find((x) => x.name === name);
    if (!b) return ctx.toast(t('atFlow.propose.noBackup'), 'error');
    const cmds = restoreCommands(b.text, st.undo);
    if (!cmds.length) return ctx.toast(t('atFlow.restore.nothing'), 'info');
    const ok = await ctx.applyCommands(cmds, { title: t('atFlow.restore.title', { name }), note: escapeHtml(t('atFlow.restore.note')) });
    if (ok) set({ fixed: [], undo: {} });
    render();
  }

  async function fix(ids: CheckId[] | 'all'): Promise<void> {
    const f = readFacts(ctx);
    if (f.armed) return ctx.toast(t('atFlow.block.armed'), 'error');
    const checks = prepareChecks(f).filter((c) => (ids === 'all' ? true : ids.includes(c.id)));
    const { commands, old } = allFixes(checks, new Set(st.fixed as CheckId[]));
    if (!commands.length) return;
    const ok = await ctx.applyCommands(commands, { title: t('atFlow.prepare.fixTitle'), note: escapeHtml(t('atFlow.prepare.fixNote')) });
    if (ok) set({ fixed: [...new Set([...st.fixed, ...checks.filter((c) => c.status === 'fix').map((c) => c.id)])], undo: recordUndo(st.undo, commands, old) });
    render();
  }

  async function erase(): Promise<void> {
    const f = readFacts(ctx);
    if (!f.connected || eraseBusy) return;
    if (f.armed) return ctx.toast(t('atFlow.block.armed'), 'error');
    const used = f.flash ? `${fmtNum(f.flash.used / 1048576, 1)} MB` : '?';
    const ok = await ctx.confirm({ title: t('atFlow.basic.prepare.eraseTitle'), danger: true, confirmText: t('atFlow.basic.prepare.erase'), body: `<p>${escapeHtml(t('atFlow.basic.prepare.eraseBody', { used }))}</p>` });
    if (!ok) return;
    eraseBusy = true;
    render();
    try {
      await ctx.bf.send(MSPB.DATAFLASH_ERASE, new Uint8Array(0), 5000);
      // the FC answers slowly while erasing; wait until the summary says empty (or give up after a while)
      const until = Date.now() + 3 * 60_000;
      while (!disposed && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1000));
        await ctx.bf.refresh('blackbox').catch(() => undefined);
        const fl = readFacts(ctx).flash;
        if (fl && fl.used === 0) break;
      }
      ctx.toast(t('atFlow.basic.prepare.eraseDone'), 'ok');
    } catch (e) {
      ctx.toast(t('atFlow.basic.prepare.eraseFail', { msg: e instanceof Error ? e.message : String(e) }), 'error');
    }
    eraseBusy = false;
    render();
  }

  async function applyCmds(cmds: string[], title: string, note: string): Promise<void> {
    const f = readFacts(ctx);
    if (!cmds.length || f.armed || !f.connected) return;
    if (mem.run?.sample && !f.demo) return ctx.toast(t('atFlow.expert.block.sample'), 'error');
    const old = oldValues(cmds, mem.run?.res ?? null, f);
    const ok = await ctx.applyCommands(cmds, { title, note });
    if (!ok) return;
    set({ undo: recordUndo(st.undo, cmds, old) });
    const lastRound = mem.rounds[mem.rounds.length - 1];
    if (lastRound) lastRound.applied = [...lastRound.applied, ...cmds];
    render();
  }

  async function applyBasic(): Promise<void> {
    if (!mem.run) return;
    const vm = model();
    const plan = basicPlan(mem.run.res);
    if (basicApplyBlock(vm, plan)) return;
    await applyCmds(plan.commands, t('atFlow.basic.result.applyTitle'), escapeHtml(t('atFlow.basic.result.applyNote')));
  }

  async function applyExpert(): Promise<void> {
    if (!mem.run) return;
    const units = applyUnits(mem.run.res, mem.ui.form);
    const cmds = selectedCommands(units, mem.ui.selected);
    if (expertApplyBlock(model(), cmds.length)) return;
    const q = mem.run.res.quality;
    const note = `${escapeHtml(t('atFlow.propose.applyNote'))}${q.label === 'poor' ? `<br>${t('atFlow.propose.applyPoor')}` : ''}`;
    await applyCmds(cmds, t('atFlow.propose.applyTitle'), note);
  }

  /** Metrics only (no raw data, no personal data) for the assistant. */
  function askReview(): void {
    if (!mem.run) return;
    const r = mem.run.res;
    const L: string[] = [t('atFlow.ai.head', { name: mem.run.sample ? t('at.sampleName') : 'log', s: Math.round(r.analysis.duration), fs: Math.round(r.analysis.fs), q: r.quality.score })];
    if (r.settings?.firmwareRevision) L.push(`Firmware: ${r.settings.firmwareRevision.split('(')[0]!.trim()}`);
    for (const s of r.steps) {
      const m = s.best;
      L.push(`${s.axis}: ${m ? `overshoot ${fmtNum(m.overshoot ?? 0, 0)} %, rise ${m.rise === null ? '?' : fmtNum(m.rise, 0)} ms, settle5 ${m.settle5 === null ? '>300' : fmtNum(m.settle5, 0)} ms, ringing ${m.ringing}, bounce-back ${m.bounceBack === null ? '-' : fmtNum(m.bounceBack, 0)} %` : 'no data'} (${s.source ?? '-'}, n=${s.detected.n})`);
    }
    for (const v of verdicts(r)) L.push(`${t(`atFlow.basic.areas.${v.id}` as Key)}: ${t(`atFlow.basic.light.${v.light}` as Key)}`);
    if (r.noise.gyro) L.push(`Gyro noise > 100 Hz: ${fmtNum(r.noise.gyro.hfRms, 2)} deg/s; peaks: ${r.noise.gyro.peaks.slice(0, 4).map((p) => `${Math.round(p.hz)} Hz ${p.kind}`).join(', ') || 'none'}`);
    if (r.filters.delay) L.push(`Filter delay: ${fmtNum(r.filters.delay.ms, 2)} ms`);
    L.push(`Propwash: ${r.propwash.level}${r.propwash.ratio !== null ? ` (${fmtNum(r.propwash.ratio, 1)}x, ${r.propwash.events} chops)` : ''}`);
    for (const c of r.chirp?.axes ?? []) {
      if (c) L.push(`CHIRP ${['roll', 'pitch', 'yaw'][c.axis]}: bandwidth ${c.bandwidthHz === null ? '?' : fmtNum(c.bandwidthHz, 0)} Hz, crossover ${c.crossoverHz === null ? '?' : fmtNum(c.crossoverHz, 0)} Hz, phase margin ${c.phaseMarginDeg === null ? '?' : fmtNum(c.phaseMarginDeg, 0)} deg, max sensitivity ${fmtNum(c.sMaxDb, 1)} dB at ${fmtNum(c.sMaxHz, 0)} Hz, tracking peak ${fmtNum(c.tPeakDb, 1)} dB, coherence ${Math.round(c.coherence * 100)} %`);
    }
    if (r.settings?.pid) L.push(`PIDs in the log (P/I/D): roll ${r.settings.pid.roll.join('/')}, pitch ${r.settings.pid.pitch.join('/')}, yaw ${r.settings.pid.yaw.join('/')}`);
    if (r.settings?.simplified) L.push(`Sliders: mode ${r.settings.simplified.mode}, master ${r.settings.simplified.master ?? '?'}, PI ${r.settings.simplified.pi ?? '?'}, D ${r.settings.simplified.d ?? '?'}, FF ${r.settings.simplified.ff ?? '?'}`);
    if (mem.ui.hot) L.push('The pilot says the motors came down hot.');
    const adv = [...r.pids.advice, ...r.filters.advice, ...(r.chirp?.advice ?? [])].filter((a) => a.severity !== 'ok').slice(0, 12);
    if (adv.length) L.push(`${t('atFlow.ai.rules')}\n- ${adv.map(adviceText).join('\n- ')}`);
    const cmds = expert() ? selectedCommands(applyUnits(r, mem.ui.form), mem.ui.selected) : basicPlan(r).commands;
    L.push(cmds.length ? `${t('atFlow.ai.cmds')}\n${cmds.join('\n')}` : t('atFlow.ai.noCmds'));
    L.push(t('atFlow.ai.ask'));
    ctx.askAi(L.join('\n'));
  }

  function askParts(): void {
    ctx.askAi(`${t('atFlow.parts.aiAsk')}\n\n${aiFacts(st.parts, readFacts(ctx)).join('\n')}`);
  }

  function fillTypical(p: Parts): Parts {
    const typ = typicalBuild(p.frameIn);
    if (!typ) return p;
    const next: Parts = { ...p };
    if (!next.motorStator) next.motorStator = typ.stator;
    if (next.motorKv === null) next.motorKv = Math.round((typ.kv[0] + typ.kv[1]) / 2);
    if (next.propIn === null) next.propIn = typ.prop;
    if (next.propBlades === null) next.propBlades = typ.blades;
    return next;
  }

  async function act(name: string, arg: string): Promise<void> {
    const c = mem.coach;
    switch (name) {
      case 'connect':
        return void ctx.connect();
      case 'demo':
        return void ctx.connectDemo();
      case 'goto':
        return goTo(arg as StepId);
      case 'next': {
        const n = STEPS[stepIndex(st.step) + 1];
        return n ? goTo(n) : undefined;
      }
      case 'prev': {
        const p = STEPS[stepIndex(st.step) - 1];
        if (p) {
          st = { ...st, step: p };
          save();
          render();
        }
        return;
      }
      case 'fold':
        set({ folded: !st.folded });
        return render();
      case 'reset': {
        const ok = await ctx.confirm({ title: t('atFlow.reset'), body: `<p>${escapeHtml(t('atFlow.resetConfirm'))}</p>` });
        if (!ok) return;
        coachReset();
        mem.run = null;
        mem.src = null;
        mem.rounds = [];
        mem.error = null;
        mem.ui.selected = new Set();
        publishSuggestion(null);
        st = { ...initialState(), parts: st.parts.style || st.parts.frameIn ? st.parts : emptyParts(), beep: st.beep, folded: st.folded };
        save();
        return render();
      }
      case 'frame': {
        const n = Number(arg);
        // a new size replaces the typical parts guessed for the old one
        const base: Parts = st.parts.frameIn !== n ? { ...st.parts, frameIn: n, motorStator: '', motorKv: null, propIn: null, propBlades: null } : st.parts;
        set({ parts: fillTypical(base) });
        return render();
      }
      case 'style':
        set({ parts: { ...st.parts, style: arg as Style } });
        return render();
      case 'typical':
        set({ parts: fillTypical(st.parts) });
        return render();
      case 'ai-parts':
        return askParts();
      case 'backup':
        return createBackup();
      case 'dl-backup': {
        const b = backups.find((x) => x.name === arg);
        if (b) downloadText(`${b.name}.txt`, b.text);
        return;
      }
      case 'restore':
        return restore(arg);
      case 'fix':
        return fix([arg as CheckId]);
      case 'fix-all':
        return fix('all');
      case 'erase':
        return erase();
      case 'coach-toggle':
        if (c.running) {
          c.elapsed = c.base + (Date.now() - c.startedAt) / 1000;
          c.base = c.elapsed;
          c.running = false;
          stopTimer();
        } else {
          c.startedAt = Date.now();
          c.running = true;
          if (lastIndex < 0) beep();
          startTimer();
        }
        lastIndex = -1;
        return tick();
      case 'coach-prev': {
        let i = coachAt(SCRIPT, c.elapsed, c.skipFlips).index - 1;
        if (c.skipFlips && SCRIPT[i]?.optional) i--;
        return coachJump(i);
      }
      case 'coach-next': {
        let i = coachAt(SCRIPT, c.elapsed, c.skipFlips).index + 1;
        if (c.skipFlips && SCRIPT[i]?.optional) i++;
        return coachJump(i);
      }
      case 'coach-reset':
        coachReset();
        return render();
      case 'pick':
        return root.querySelector<HTMLInputElement>('[data-file]')?.click();
      case 'sample':
        return loadSample(true);
      case 'basic-apply':
        return applyBasic();
      case 'expert-apply':
        return applyExpert();
      case 'copy-basic':
      case 'copy-sel': {
        if (!mem.run) return;
        const cmds = name === 'copy-basic' ? basicPlan(mem.run.res).commands : selectedCommands(applyUnits(mem.run.res, mem.ui.form), mem.ui.selected);
        if (!cmds.length) return;
        const ok = await copyText(cmds.join('\n'));
        return ctx.toast(ok ? t('atFlow.propose.copied') : t('atFlow.propose.copyFail'), ok ? 'ok' : 'error');
      }
      case 'proc-apply':
      case 'proc-copy': {
        const p = mem.run?.res.procedure.find((x) => x.id === arg);
        if (!p?.prepare) return;
        if (name === 'proc-copy') {
          const ok = await copyText(p.prepare.join('\n'));
          return ctx.toast(ok ? t('atFlow.propose.copied') : t('atFlow.propose.copyFail'), ok ? 'ok' : 'error');
        }
        return applyCmds(p.prepare, t('atFlow.expert.series.prepareTitle'), escapeHtml(t('atFlow.expert.series.prepareNote')));
      }
      case 'ai-review':
        return askReview();
      case 'fly-again':
        coachReset();
        return goTo('flight');
      case 'tab':
        mem.ui.tab = arg as ExpertTab;
        root.scrollTop = 0;
        return render();
      case 'step-mode':
        mem.ui.stepMode = arg as UiState['stepMode'];
        return render();
      case 'step-axis':
        mem.ui.stepAxis = arg as UiState['stepAxis'];
        return render();
      case 'chirp-axis':
        mem.ui.chirpAxis = arg as UiState['chirpAxis'];
        return render();
      case 'chirp-setup':
        return applyCmds(chirpSetupCli(), t('atFlow.expert.chirp.setupTitle'), escapeHtml(t('atFlow.expert.chirp.setupNote')));
      case 'signal':
        mem.ui.signal = arg as UiState['signal'];
        return render();
      case 'form':
        mem.ui.form = arg as UiState['form'];
        return render();
    }
  }

  /* ---------- events ---------- */
  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (a?.dataset.act && !(a as HTMLButtonElement).disabled) void act(a.dataset.act, a.dataset.arg ?? '');
  });
  root.addEventListener(
    'toggle',
    (e) => {
      const d = e.target as HTMLDetailsElement;
      if (d.matches?.('[data-details]')) mem.ui.details = d.open;
    },
    true,
  );

  function readPart(inp: HTMLInputElement | HTMLSelectElement): void {
    const key = inp.dataset.part as keyof Parts;
    const raw = inp.value.trim();
    const p: Parts = { ...st.parts };
    if (key === 'motorStator' || key === 'escProtocol') p[key] = raw.slice(0, 24);
    else if (key === 'style') p.style = (raw || null) as Parts['style'];
    else {
      const n = Number(raw.replace(',', '.'));
      p[key] = raw && Number.isFinite(n) && n >= 0 ? n : null;
    }
    set({ parts: p });
  }

  root.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.dataset.part && inp.tagName === 'INPUT') readPart(inp); // typing: store only, re-render on change
  });
  root.addEventListener('change', (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.matches('[data-file]')) {
      const f = inp.files?.[0];
      if (f) void loadFile(f);
      inp.value = '';
      return;
    }
    if (inp.dataset.part) {
      readPart(inp);
      render();
      root.querySelector<HTMLElement>(`#pw-f-${inp.dataset.part}`)?.focus();
    } else if (inp.dataset.tick === 'battery' || inp.dataset.tick === 'space') {
      set({ ticks: { ...st.ticks, [inp.dataset.tick]: inp.checked } });
      render();
    } else if (inp.dataset.opt === 'beep') {
      set({ beep: inp.checked });
    } else if (inp.dataset.opt === 'skipFlips') {
      mem.coach.skipFlips = inp.checked;
      lastIndex = -1;
      tick();
      render();
    } else if (inp.dataset.sel !== undefined) {
      const id = inp.dataset.sel;
      const s = new Set(mem.ui.selected);
      if (inp.checked) s.add(id);
      else s.delete(id);
      mem.ui.selected = s;
      render();
    } else if (inp.matches('[data-hot]')) {
      mem.ui.hot = inp.checked;
      void rerun();
    } else if (inp.matches('[data-session]')) {
      mem.ui.session = Number((inp as unknown as HTMLSelectElement).value);
      void rerun();
    }
  });

  const setDrag = (v: boolean) => root.querySelector('.pw-drop')?.classList.toggle('drag', v);
  root.addEventListener('dragover', (e) => {
    if (!root.querySelector('[data-drop]')) return;
    e.preventDefault();
    setDrag(true);
  });
  root.addEventListener('dragleave', (e) => {
    if (e.target === root || !root.contains(e.relatedTarget as Node | null)) setDrag(false);
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  });

  // re-render on connection / config / arming changes (not while the user types in a field)
  const refresh = () => {
    if (root.contains(document.activeElement) && (document.activeElement as HTMLElement).matches('input[type=text], input[type=number], select')) return;
    render();
  };
  const offState = ctx.state.subscribe(refresh);
  const offBf = ctx.bf.subscribe(refresh);
  const offAi = ctx.ai.subscribe(() => {
    if (st.step === 'parts' || st.step === 'propose') refresh();
  });
  // the heatmap follows the panel width
  let rz: ReturnType<typeof setTimeout> | null = null;
  const onResize = () => {
    if (rz) clearTimeout(rz);
    rz = setTimeout(() => {
      const cv = root.querySelector<HTMLCanvasElement>('canvas[data-heat]');
      if (cv && mem.run) {
        const s = currentSpectrogram(model(), mem.run.res);
        if (s) drawHeatmap(cv, s, { thrLabel: t('atFlow.expert.noise.thrAxis') });
      }
    }, 150);
  };
  window.addEventListener('resize', onResize);

  // a flow saved in a place that is no longer allowed (backup removed, armed) falls back to the furthest allowed step
  if (st.step === 'propose' && !mem.run) st = { ...st, step: 'import' };
  if (blockFor(st.step, gate(readFacts(ctx)))) {
    const ok = [...STEPS].reverse().find((s) => stepIndex(s) <= stepIndex(st.step) && !blockFor(s, gate(readFacts(ctx))));
    st = { ...st, step: ok ?? 'parts' };
  }
  // Expert lands on the analysis when a log is loaded
  if (expert() && mem.run && st.step === 'import') st = { ...st, step: 'propose' };
  render();
  if (mem.coach.running) startTimer();
  const handed = takePendingLog();
  if (handed) void loadFile(handed);
  // ?demo=1#autotune loads the sample right away; Expert opens the analysis, Basic keeps its place in the flow
  else if (!mem.run && !mem.busy && new URLSearchParams(location.search).get('demo') === '1') void loadSample(expert());

  return () => {
    disposed = true;
    if (live === render) live = null;
    stopTimer(); // the coach clock keeps its start time, so it continues when the tab opens again
    offState();
    offBf();
    offAi();
    window.removeEventListener('resize', onResize);
    void audio?.close().catch(() => undefined);
    root.remove();
  };
};
