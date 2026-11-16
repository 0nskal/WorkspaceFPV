import type { AppContext, ScreenMount } from '../context';
import { recommend, summarize, type AxisRec, type Pid3, type Recommendation } from '../analysis/recommend';
import { RunError, runAnalysis } from '../analysis/run';
import type { AnalysisResult } from '../analysis/types';
import { takePendingLog } from '../bf/log-handoff';
import { copyText, escapeHtml } from '../ui/dom';
import { fmtNum, t, tn, type Key } from '../i18n';
import { icon } from '../ui/icons';
import { spectrumChart, stepChart } from './autotune-charts';
import { publishSuggestion } from '../bf/autotune-link';

/** PID z trybu demo (te same wartosci, co symulowany FC), gdy brak polaczenia. */
const DEMO_PID: Pid3 = { roll: [48, 82, 38], pitch: [52, 88, 42], yaw: [45, 90, 3] };

type Phase = { k: 'empty' } | { k: 'busy'; frac: number; label: string } | { k: 'result' } | { k: 'binary'; name: string } | { k: 'error'; message: string };

// wynik przezywa zmiane zakladki
let cache: { res: AnalysisResult; sample: boolean } | null = null;

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  let phase: Phase = cache ? { k: 'result' } : { k: 'empty' };
  let dragging = false;
  let disposed = false;
  const root = document.createElement('div');
  root.className = 'at';
  el.appendChild(root);

  const num = (v: number | null, d = 0) => (v === null ? '—' : fmtNum(v, d));
  const film = `<div class="at-film mono">${t('at.film')}</div>`;

  function currentPid(): { pid: Pid3 | null; demo: boolean } {
    const s = ctx.state.get();
    if (s.pid) return { pid: s.pid as Pid3, demo: false };
    if (cache?.sample) return { pid: DEMO_PID, demo: true };
    return { pid: null, demo: false };
  }

  function recs(): Recommendation | null {
    if (!cache) {
      publishSuggestion(null);
      return null;
    }
    const s = ctx.state.get();
    const bidir = s.config ? s.config.bidir : cache.sample ? false : null;
    const r = recommend(cache.res, currentPid().pid, bidir);
    publishSuggestion(r.axes);
    return r;
  }

  /* ---------- widoki ---------- */
  function drop(): string {
    return `
      <div class="at-empty ${dragging ? 'drag' : ''}" data-drop>
        ${film}
        <h1>${t('at.dropTitle')}</h1>
        <p>${t('at.dropLead')}</p>
        <div class="at-btns">
          <button class="btn light" data-act="pick">${icon('download', 16)}${t('at.pick')}</button>
          <button class="btn ghost" data-act="sample">${icon('play', 16)}${t('at.sample')}</button>
        </div>
        <div class="at-how mono">${t('at.how')}</div>
      </div>`;
  }

  function busy(p: Extract<Phase, { k: 'busy' }>): string {
    return `<div class="at-empty">${film}<h1>${escapeHtml(p.label)}</h1>
      <div class="at-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.frac * 100)}"><i style="width:${Math.round(p.frac * 100)}%"></i></div>
      <div class="at-how mono">${t('at.busyNote')}</div></div>`;
  }

  function binary(p: Extract<Phase, { k: 'binary' }>): string {
    return `<div class="at-empty">${film}
      <h1>${t('at.binaryTitle')}</h1>
      <p>${t('at.binaryLead', { name: escapeHtml(p.name) })}</p>
      <ol class="at-steps">
        <li>${t('at.binaryStep1')}</li>
        <li>${t('at.binaryStep2')}</li>
      </ol>
      <div class="at-btns"><button class="btn light" data-act="pick">${icon('download', 16)}${t('at.pick')}</button><button class="btn ghost" data-act="sample">${icon('play', 16)}${t('at.sample')}</button></div></div>`;
  }

  function error(p: Extract<Phase, { k: 'error' }>): string {
    return `<div class="at-empty">${film}<h1>${t('at.errorTitle')}</h1>
      <p class="at-err" role="alert">${escapeHtml(p.message)}</p>
      <div class="at-btns"><button class="btn light" data-act="pick">${icon('download', 16)}${t('at.pickOther')}</button><button class="btn ghost" data-act="sample">${icon('play', 16)}${t('at.sample')}</button></div></div>`;
  }

  function cell(a: AxisRec, i: 0 | 1 | 2): string {
    const cur = a.current;
    const sug = a.suggested;
    if (!cur || !sug) {
      const f = i === 0 ? a.pF : i === 2 ? a.dF : 1;
      return f !== 1 ? `<span class="chg">×${f.toFixed(2)}</span>` : '<span class="dim">—</span>';
    }
    return cur[i] !== sug[i] ? `<span class="old">${cur[i]}</span><span class="arr">→</span><span class="chg">${sug[i]}</span>` : `${cur[i]}`;
  }

  function resultView(): string {
    const res = cache!.res;
    const rec = recs()!;
    const { pid, demo } = currentPid();
    const [roll, pitch, yaw] = res.axes as [AnalysisResult['axes'][0], AnalysisResult['axes'][0], AnalysisResult['axes'][0]];
    const { motor, frame } = res.peaks;
    const mins = Math.floor(res.duration / 60);
    const secs = Math.round(res.duration % 60);
    const changes = rec.axes.reduce((n, a) => n + (a.current && a.suggested ? Number(a.current[0] !== a.suggested[0]) + Number(a.current[2] !== a.suggested[2]) : 0), 0);
    const connected = ctx.state.get().conn === 'connected';
    const canApply = connected && rec.commands.length > 0;
    const cmdHtml = rec.commands.length
      ? rec.commands.map((c) => {
          const m = /^set (\S+) = (.+)$/.exec(c);
          return m ? `<div><span class="k">set</span> ${escapeHtml(m[1]!)} <span class="k">=</span> <span class="v">${escapeHtml(m[2]!)}</span></div>` : `<div>${escapeHtml(c)}</div>`;
        }).join('')
      : `<div class="k">${pid ? t('at.noChangesToApply') : t('at.connectForCmds')}</div>`;
    const ovsClass = (v: number | null) => (v !== null && v > 10 ? 'hot' : '');

    return `
      <div class="at-head">
        <div class="at-file"><span class="at-sq"></span><span class="mono">${escapeHtml(res.name || t('at.sampleName'))}</span><span class="mono dim">· ${mins}:${String(secs).padStart(2, '0')} ${t('at.unit.min')} · ${fmtNum(res.fs / 1000, 1)} kHz</span></div>
        <button class="at-link" data-act="reset">${icon('chart', 14)}${t('at.changeLog')}</button>
      </div>
      <section class="at-sec">
        <div class="at-cap mono"><span>${t('at.stepCap')}</span></div>
        <div class="at-row">
          <div class="at-plot">${stepChart(res)}</div>
          <div class="at-legend">
            <div class="at-k"><div class="l mono">${t('at.overshoot', { axis: 'ROLL' })}</div><div class="v ${ovsClass(roll.overshoot)}">${num(roll.overshoot)}%<i class="sw roll"></i></div></div>
            <div class="at-k"><div class="l mono">${t('at.overshoot', { axis: 'PITCH' })}</div><div class="v">${num(pitch.overshoot)}%<i class="sw pitch"></i></div></div>
            <div class="at-k"><div class="l mono">${t('at.overshoot', { axis: 'YAW' })}</div><div class="v">${num(yaw.overshoot)}%<i class="sw yaw"></i></div></div>
            <div class="at-k"><div class="l mono">${t('at.riseSettle')}</div><div class="v sm">${num(roll.rise)} / ${roll.settle === null ? '&gt;500' : num(roll.settle)} ms</div></div>
          </div>
        </div>
      </section>
      <section class="at-sec">
        <div class="at-cap mono"><span>${t('at.spectrumCap', { max: res.spectrum.maxHz })}</span></div>
        <div class="at-row">
          <div class="at-plot">${spectrumChart(res)}</div>
          <div class="at-legend">
            <div class="at-k"><div class="l mono">${t('at.motorPeak')}</div><div class="v ${motor && rec.motorNoiseHigh ? 'hot' : ''}">${motor ? motor.hz.toFixed(0) + ' Hz' : '—'}</div></div>
            <div class="at-k"><div class="l mono">${t('at.framePeak')}</div><div class="v">${frame ? frame.hz.toFixed(0) + ' Hz' : '—'}</div></div>
            <div class="at-k"><div class="l mono">BIDIR DSHOT · RPM FILTER</div><div class="v sm">${ctx.state.get().config ? (ctx.state.get().config!.bidir ? t('common.on') : t('common.off')) : demo || cache!.sample ? t('at.bidirDemo') : t('common.noData')}</div></div>
          </div>
        </div>
      </section>
      <section class="at-sec at-bottom">
        <div class="at-tbl-wrap">
          <div class="at-cap mono"><span>${t('at.currentSuggested')}${demo ? t('at.pidFromDemo') : ''}</span><span>${tn('at.changes', changes)}</span></div>
          <table class="at-tbl">
            <thead><tr><th scope="col">${t('at.axis')}</th><th scope="col">P</th><th scope="col">I</th><th scope="col">D</th><th scope="col" title="${t('at.ffTitle')}">FF</th></tr></thead>
            <tbody>${rec.axes
              .map(
                (a) => `<tr><th scope="row"><i class="sw ${a.axis}"></i>${a.name}</th><td>${cell(a, 0)}</td><td>${cell(a, 1)}</td><td>${a.axis === 'yaw' ? (a.current ? a.current[2] : '<span class="dim">—</span>') : cell(a, 2)}</td><td>${a.ffUp ? '<span class="chg">↑ FF</span>' : '<span class="dim">—</span>'}</td></tr>`,
              )
              .join('')}</tbody>
          </table>
          <ul class="at-notes">${rec.notes.map((n) => `<li class="${n.level}"><i></i>${escapeHtml(n.text)}</li>`).join('')}</ul>
        </div>
        <div class="at-cmd-wrap">
          <div class="at-cap mono"><span>${t('at.cliCmds')}</span><span>${rec.commands.length}</span></div>
          <div class="at-cmd mono">${cmdHtml}</div>
          <div class="at-btns">
            <button class="btn light" data-act="apply" ${canApply ? '' : 'disabled'} title="${canApply ? '' : connected ? t('at.applyNoChanges') : t('at.applyNeedFc')}">${icon('arrowUp', 16)}${t('at.apply')}</button>
            <button class="btn ghost" data-act="ask">${icon('chip', 16)}${t('at.askAi')}</button>
            <button class="btn ghost" data-act="copy" ${rec.commands.length ? '' : 'disabled'}>${icon('copy', 16)}${t('at.copy')}</button>
          </div>
        </div>
      </section>`;
  }

  function render(): void {
    if (disposed) return;
    let body = '';
    if (phase.k === 'empty') body = drop();
    else if (phase.k === 'busy') body = busy(phase);
    else if (phase.k === 'binary') body = binary(phase);
    else if (phase.k === 'error') body = error(phase);
    else body = cache ? resultView() : drop();
    root.innerHTML = `${body}<input type="file" accept=".csv,.txt,.bbl,.bfl,.log,text/csv" hidden data-file>`;
  }

  /* ---------- akcje ---------- */
  async function load(src: { kind: 'demo' } | { kind: 'file'; file: File }, label: string): Promise<void> {
    phase = { k: 'busy', frac: 0, label };
    render();
    let last = 0;
    try {
      const res = await runAnalysis(src, (frac) => {
        if (disposed || frac - last < 0.03) return;
        last = frac;
        phase = { k: 'busy', frac, label };
        const i = root.querySelector<HTMLElement>('.at-bar i');
        if (i) i.style.width = `${Math.round(frac * 100)}%`;
      });
      cache = { res, sample: src.kind === 'demo' };
      phase = { k: 'result' };
    } catch (e) {
      const err = e as RunError;
      phase = err.code === 'binary' && src.kind === 'file' ? { k: 'binary', name: src.file.name } : { k: 'error', message: t((err.key ?? 'at.err.generic') as Key, err.params) };
    }
    render();
  }

  function pickFile(f: File | undefined): void {
    if (!f) return;
    void load({ kind: 'file', file: f }, t('at.analysing', { name: f.name }));
  }

  async function act(name: string): Promise<void> {
    const rec = recs();
    if (name === 'pick') root.querySelector<HTMLInputElement>('[data-file]')?.click();
    else if (name === 'sample') await load({ kind: 'demo' }, t('at.generating'));
    else if (name === 'reset') {
      cache = null;
      phase = { k: 'empty' };
      render();
    } else if (name === 'copy' && rec) {
      const ok = await copyText(rec.commands.join('\n'));
      ctx.toast(ok ? t('at.copied') : t('at.copyFail'), ok ? 'ok' : 'error');
    } else if (name === 'apply' && rec && rec.commands.length) {
      await ctx.applyCommands(rec.commands, {
        title: t('at.applyTitle'),
        note: t('at.applyNote'),
      });
    } else if (name === 'ask' && rec && cache) ctx.askAi(summarize(cache.res, rec));
  }

  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (a?.dataset.act) void act(a.dataset.act);
  });
  root.addEventListener('change', (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.matches('[data-file]')) pickFile(inp.files?.[0]);
  });
  const setDrag = (v: boolean) => {
    if (dragging === v) return;
    dragging = v;
    root.classList.toggle('at-dragging', v);
  };
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    setDrag(true);
  });
  root.addEventListener('dragleave', (e) => {
    if (e.target === root || !root.contains(e.relatedTarget as Node | null)) setDrag(false);
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    setDrag(false);
    pickFile(e.dataTransfer?.files?.[0]);
  });

  const off = ctx.state.subscribe(() => {
    if (phase.k === 'result') render();
  });

  render();
  // a log downloaded in the Blackbox tab ("Analyse in Autotune") starts analysing right away
  const handed = takePendingLog();
  if (handed) pickFile(handed);
  // ?demo=1#autotune od razu pokazuje przykladowa analize
  if (!cache && new URLSearchParams(location.search).get('demo') === '1') void load({ kind: 'demo' }, t('at.generating'));

  return () => {
    disposed = true;
    off();
    root.remove();
  };
};
