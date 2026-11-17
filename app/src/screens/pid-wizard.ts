/**
 * Auto-tune wizard tab: parts -> backup -> prepare -> test flight -> log -> new PIDs, then "fly again" rounds.
 * Reads FC data from ctx.state / ctx.bf only; every FC change goes through ctx.applyCommands (confirmation, diff-all
 * backup, save) after a button press, never while armed. The app never controls the drone.
 */
import type { AppContext, ScreenMount } from '../context';
import { scoreQuality } from '../analysis/quality';
import { recommend, summarize } from '../analysis/recommend';
import { DEMO_HEADER_PID } from '../analysis/run-core';
import { RunError, runAnalysis } from '../analysis/run';
import type { AnalysisResult } from '../analysis/types';
import { setHandoffTarget, takePendingLog } from '../bf/log-handoff';
import { t, type Key } from '../i18n';
import { copyText, downloadText, escapeHtml } from '../ui/dom';
import { readFacts } from '../wizard/fc-facts';
import { SCRIPTS, coachAt, startOf } from '../wizard/flight-script';
import { aiFacts, emptyParts, mergeDetected, typicalBuild, type FcFacts, type Parts, type Pid3 } from '../wizard/parts';
import { allFixes, prepareChecks, type CheckId } from '../wizard/prepare';
import {
  STEPS,
  addBackup,
  backupName,
  blockFor,
  go,
  initialState,
  loadBackups,
  loadState,
  pidMismatch,
  pidOld,
  recordUndo,
  restoreCommands,
  saveBackups,
  saveState,
  stepIndex,
  type GateInput,
  type Iteration,
  type StepId,
  type WizardState,
} from '../wizard/state';
import { backupView, flightView, importView, metricOf, partsView, prepareView, proposeView, shell, type ViewModel } from './pid-wizard-views';
import './pid-wizard.css';

/** Survives tab changes (not persisted: logs and rounds are big and belong to this session). */
const mem: {
  log: { res: AnalysisResult; sample: boolean } | null;
  iterations: Iteration[];
  coach: { elapsed: number; running: boolean; skipFlips: boolean; startedAt: number; base: number };
} = { log: null, iterations: [], coach: { elapsed: 0, running: false, skipFlips: false, startedAt: 0, base: 0 } };

let st: WizardState = loadState();

const SCRIPT = SCRIPTS.basic;

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  const root = document.createElement('div');
  root.className = 'pw';
  el.appendChild(root);
  let disposed = false;
  let busy: { frac: number; label: string } | null = null;
  let error: string | null = null;
  let dragging = false;
  let backupBusy = false;
  let backupMsg: ViewModel['backupMsg'] = null;
  let backups = loadBackups();
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastIndex = -1;
  let audio: AudioContext | null = null;

  const save = () => saveState(st);
  const set = (patch: Partial<WizardState>) => {
    st = { ...st, ...patch };
    save();
  };

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

  function gate(f: FcFacts): GateInput {
    return { backup: st.backup, armed: f.armed, ticks: st.ticks, hasLog: !!mem.log };
  }

  function usedPid(f: FcFacts): { pid: Pid3 | null; source: ViewModel['pidSource'] } {
    const res = mem.log?.res;
    if (res?.headerPid) return { pid: res.headerPid, source: 'header' };
    if (f.pid) return { pid: f.pid, source: 'fc' };
    if (mem.log?.sample) return { pid: DEMO_HEADER_PID, source: 'demo' };
    return { pid: null, source: null };
  }

  function model(): ViewModel {
    const f = facts();
    const log = mem.log ? { ...mem.log, quality: scoreQuality(mem.log.res) } : null;
    const used = usedPid(f);
    const rec = mem.log ? recommend(mem.log.res, used.pid, f.connected ? f.bidir : mem.log.sample ? false : null) : null;
    return {
      st,
      facts: f,
      gate: gate(f),
      backups,
      backupBusy,
      backupMsg,
      checks: prepareChecks(f),
      script: SCRIPT,
      coach: mem.coach,
      log,
      busy,
      error,
      rec,
      pidSource: used.source,
      mismatch: pidMismatch(mem.log?.res.headerPid, f.pid),
      usedPid: used.pid,
      iterations: mem.iterations,
      aiReady: ctx.ai.ready(),
    };
  }

  function render(): void {
    if (disposed) return;
    const vm = model();
    const views: Record<StepId, () => string> = {
      parts: () => partsView(vm),
      backup: () => backupView(vm),
      prepare: () => prepareView(vm),
      flight: () => flightView(vm),
      import: () => importView(vm, dragging),
      propose: () => proposeView(vm),
    };
    const scroll = root.scrollTop;
    root.innerHTML = shell(vm, views[st.step]());
    root.scrollTop = scroll;
    // the Blackbox tab's "Analyse" button hands the log to this tab while it waits for one
    setHandoffTarget(st.step === 'import' ? 'pid-wizard' : null);
  }

  function goTo(to: StepId): void {
    const next = go(st, to, gate(readFacts(ctx)));
    if (next === st) return;
    st = next;
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
    if (count && SCRIPT[pos.index]!.seconds) count.innerHTML = `${pos.left}<small>${t('pidWizard.flight.sec')}</small>`;
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

  /* ---------- log ---------- */
  async function load(src: { kind: 'demo' } | { kind: 'file'; file: File }, label: string): Promise<void> {
    busy = { frac: 0, label };
    error = null;
    render();
    let last = 0;
    try {
      const res = await runAnalysis(src, (frac) => {
        if (disposed || frac - last < 0.03 || !busy) return;
        last = frac;
        busy = { frac, label };
        const i = root.querySelector<HTMLElement>('.at-bar i');
        if (i) i.style.width = `${Math.round(frac * 100)}%`;
      });
      mem.log = { res, sample: src.kind === 'demo' };
      const q = scoreQuality(res);
      mem.iterations = [...mem.iterations, { n: mem.iterations.length + 1, at: Date.now(), name: res.name || t('at.sampleName'), score: q.score, axes: metricOf(res), applied: [] }];
      setHandoffTarget(null);
    } catch (e) {
      const err = e as RunError;
      error = err.code === 'binary' ? t('at.binaryTitle') : t((err.key ?? 'at.err.generic') as Key, err.params);
    }
    busy = null;
    render();
  }

  /* ---------- actions ---------- */
  async function createBackup(): Promise<void> {
    const f = readFacts(ctx);
    if (!f.connected || f.armed || backupBusy) return;
    backupBusy = true;
    backupMsg = null;
    render();
    const text = await ctx.fetchDiff();
    backupBusy = false;
    if (disposed) return;
    if (!text) {
      backupMsg = { kind: 'err', text: t('pidWizard.backup.failed') };
    } else {
      const name = backupName();
      backups = addBackup(loadBackups(), { name, at: Date.now(), text });
      const stored = saveBackups(backups);
      if (!stored) backups = loadBackups();
      downloadText(`${name}.txt`, text);
      set({ backup: name });
      backupMsg = { kind: stored ? 'ok' : 'info', text: `${t('pidWizard.backup.done', { name })} ${t('pidWizard.backup.doneFile', { name })}${stored ? '' : ' ' + t('pidWizard.backup.storageFull')}` };
    }
    render();
  }

  async function restore(name: string): Promise<void> {
    const f = readFacts(ctx);
    if (f.armed) return ctx.toast(t('pidWizard.block.armed'), 'error');
    const b = backups.find((x) => x.name === name);
    if (!b) return ctx.toast(t('pidWizard.propose.noBackup'), 'error');
    const cmds = restoreCommands(b.text, st.undo);
    if (!cmds.length) return ctx.toast(t('pidWizard.restore.nothing'), 'info');
    const ok = await ctx.applyCommands(cmds, { title: t('pidWizard.restore.title', { name }), note: escapeHtml(t('pidWizard.restore.note')) });
    if (ok) set({ fixed: [], undo: {} });
    render();
  }

  async function fix(ids: CheckId[] | 'all'): Promise<void> {
    const f = readFacts(ctx);
    if (f.armed) return ctx.toast(t('pidWizard.block.armed'), 'error');
    const checks = prepareChecks(f).filter((c) => (ids === 'all' ? true : ids.includes(c.id)));
    const { commands, old } = allFixes(checks, new Set(st.fixed as CheckId[]));
    if (!commands.length) return;
    const ok = await ctx.applyCommands(commands, { title: t('pidWizard.prepare.fixTitle'), note: escapeHtml(t('pidWizard.prepare.fixNote')) });
    if (ok) set({ fixed: [...new Set([...st.fixed, ...checks.filter((c) => c.status === 'fix').map((c) => c.id)])], undo: recordUndo(st.undo, commands, old) });
    render();
  }

  async function apply(): Promise<void> {
    const vm = model();
    if (!vm.rec || !vm.rec.commands.length || vm.facts.armed) return;
    const q = vm.log!.quality;
    const note = `${escapeHtml(t('pidWizard.propose.applyNote'))}${q.label === 'poor' ? `<br>${t('pidWizard.propose.applyPoor')}` : ''}`;
    const old: Record<string, string> = { ...pidOld(vm.facts.pid) };
    if (vm.facts.bidir !== null) old['dshot_bidir'] = vm.facts.bidir ? 'ON' : 'OFF';
    if (vm.facts.rpmHarmonics !== null) old['rpm_filter_harmonics'] = String(vm.facts.rpmHarmonics);
    const ok = await ctx.applyCommands(vm.rec.commands, { title: t('pidWizard.propose.applyTitle'), note });
    if (!ok) return;
    set({ undo: recordUndo(st.undo, vm.rec.commands, old) });
    const last = mem.iterations[mem.iterations.length - 1];
    if (last) last.applied = [...vm.rec.commands];
    render();
  }

  function askParts(): void {
    const f = readFacts(ctx);
    ctx.askAi(`${t('pidWizard.parts.aiAsk')}\n\n${aiFacts(st.parts, f).join('\n')}`);
  }

  function askReview(): void {
    const vm = model();
    if (!vm.rec || !vm.log) return;
    const q = vm.log.quality;
    const pid = vm.usedPid ? `${vm.usedPid.roll.join('/')} ${vm.usedPid.pitch.join('/')} ${vm.usedPid.yaw.join('/')}` : '?';
    ctx.askAi(`${summarize(vm.log.res, vm.rec)}\n${t('pidWizard.propose.aiExtra', { score: q.score, label: t(`pidWizard.import.label.${q.label}` as Key), pid })}`);
  }

  function fillTypical(): void {
    const p = st.parts;
    const typ = typicalBuild(p.frameIn);
    if (!typ) return;
    const next: Parts = { ...p };
    if (!next.motorStator) next.motorStator = typ.stator;
    if (next.motorKv === null) next.motorKv = Math.round((typ.kv[0] + typ.kv[1]) / 2);
    if (next.propIn === null) next.propIn = typ.prop;
    if (next.propBlades === null) next.propBlades = typ.blades;
    set({ parts: next });
    render();
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
      case 'reset': {
        const ok = await ctx.confirm({ title: t('pidWizard.reset'), body: `<p>${escapeHtml(t('pidWizard.resetConfirm'))}</p>` });
        if (!ok) return;
        stopTimer();
        mem.log = null;
        mem.iterations = [];
        mem.coach = { elapsed: 0, running: false, skipFlips: c.skipFlips, startedAt: 0, base: 0 };
        st = { ...initialState(), parts: st.parts.style || st.parts.frameIn ? st.parts : emptyParts(), beep: st.beep };
        save();
        return render();
      }
      case 'typical':
        return fillTypical();
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
        stopTimer();
        mem.coach = { elapsed: 0, running: false, skipFlips: c.skipFlips, startedAt: 0, base: 0 };
        lastIndex = -1;
        return render();
      case 'pick':
        return root.querySelector<HTMLInputElement>('[data-file]')?.click();
      case 'sample':
        return load({ kind: 'demo' }, t('at.generating'));
      case 'apply':
        return apply();
      case 'copy': {
        const rec = model().rec;
        if (!rec) return;
        const ok = await copyText(rec.commands.join('\n'));
        return ctx.toast(ok ? t('pidWizard.propose.copied') : t('pidWizard.propose.copyFail'), ok ? 'ok' : 'error');
      }
      case 'ai-review':
        return askReview();
      case 'fly-again':
        stopTimer();
        mem.coach = { elapsed: 0, running: false, skipFlips: c.skipFlips, startedAt: 0, base: 0 };
        lastIndex = -1;
        return goTo('flight');
    }
  }

  /* ---------- events ---------- */
  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (a?.dataset.act && !(a as HTMLButtonElement).disabled) void act(a.dataset.act, a.dataset.arg ?? '');
  });

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
      if (f) void load({ kind: 'file', file: f }, t('at.analysing', { name: f.name }));
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
    }
  });

  const setDrag = (v: boolean) => {
    if (dragging === v || st.step !== 'import') return;
    dragging = v;
    root.querySelector('.pw-drop')?.classList.toggle('drag', v);
  };
  root.addEventListener('dragover', (e) => {
    if (st.step !== 'import') return;
    e.preventDefault();
    setDrag(true);
  });
  root.addEventListener('dragleave', (e) => {
    if (e.target === root || !root.contains(e.relatedTarget as Node | null)) setDrag(false);
  });
  root.addEventListener('drop', (e) => {
    if (st.step !== 'import') return;
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) void load({ kind: 'file', file: f }, t('at.analysing', { name: f.name }));
  });

  // re-render on connection / config / arming changes (not while the user types in a field)
  const refresh = () => {
    if (root.contains(document.activeElement) && (document.activeElement as HTMLElement).matches('input[type=text], input[type=number]')) return;
    render();
  };
  const offState = ctx.state.subscribe(refresh);
  const offBf = ctx.bf.subscribe(refresh);
  const offAi = ctx.ai.subscribe(() => {
    if (st.step === 'parts' || st.step === 'propose') refresh();
  });

  // a wizard saved in an invalid place (backup removed, armed) falls back to the furthest allowed step
  if (blockFor(st.step, gate(readFacts(ctx)))) {
    const ok = [...STEPS].reverse().find((s) => stepIndex(s) <= stepIndex(st.step) && !blockFor(s, gate(readFacts(ctx))));
    st = { ...st, step: ok ?? 'parts' };
  }
  render();
  if (mem.coach.running) startTimer();
  const handed = takePendingLog();
  if (handed) {
    // the log is always analysed; the wizard only jumps to the log step when the earlier steps allow it
    if (!blockFor('import', gate(readFacts(ctx)))) {
      st = { ...st, step: 'import', reached: stepIndex(st.reached) < stepIndex('import') ? 'import' : st.reached };
      save();
    }
    void load({ kind: 'file', file: handed }, t('at.analysing', { name: handed.name }));
  }

  return () => {
    disposed = true;
    stopTimer(); // the coach clock keeps its start time, so it continues when the tab opens again
    offState();
    offBf();
    offAi();
    void audio?.close().catch(() => undefined);
    root.remove();
  };
};
