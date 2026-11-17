/**
 * Autotune PID, Expert mode analysis workspace: file / session bar, sub-tabs (overview, step response, noise, filters,
 * propwash, PIDs, series, rounds) and the apply bar. Pure HTML builders; the heatmap canvas is drawn by the screen
 * after render (drawHeatmap). Every recommendation shows reason, severity, confidence and CLI, and can be ticked.
 */
import type { Advice, Severity } from '../analysis/advice';
import type { AutotuneResult } from '../analysis/autotune';
import type { NoiseSignal, Spectrogram } from '../analysis/noise';
import type { AxisSteps, CurveMetrics, StepBucket } from '../analysis/step2';
import { fmtNum, t } from '../i18n';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { tip, type TipKey } from '../ui/tip';
import { AREAS, applyUnits, selectedCommands, verdicts, type ApplyUnit } from '../wizard/verdict';
import { AMBER, BLUE, eventsChart, gauge, heatCanvas, heatGradient, heatRange, HOT, INK, SERIES_STYLE, spectrumChart, stepChart, type StepLine } from './autotune-charts';
import { btn, busyBlock, chip, dropBlock, k, qualityBlock, type ExpertTab, type ViewModel } from './autotune-flow';

const TABS: ExpertTab[] = ['overview', 'step', 'noise', 'filters', 'propwash', 'pids', 'series', 'rounds'];
const AXES = ['roll', 'pitch', 'yaw'] as const;
const AXIS_NAME = { roll: 'Roll', pitch: 'Pitch', yaw: 'Yaw' } as const;
const SEV_RANK: Record<Severity, number> = { critical: 4, warn: 3, suggest: 2, info: 1, ok: 0 };
const SEV_CHIP: Record<Severity, 'ok' | 'dim' | 'info' | 'warn' | 'hot'> = { ok: 'ok', info: 'dim', suggest: 'info', warn: 'warn', critical: 'hot' };

const num = (v: number | null | undefined, d = 0, unit = '') => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${fmtNum(v, d)}${unit}`);
const cap = (text: string, tipKey?: TipKey, right = '') => `<div class="pw-cap mono"><span>${text}${tipKey ? ` ${tip(tipKey)}` : ''}</span>${right ? `<span>${right}</span>` : ''}</div>`;
const seg = (act: string, items: Array<[string, string, boolean?]>, cur: string, label: string) =>
  `<div class="ax-seg" role="radiogroup" aria-label="${escapeHtml(label)}">${items.map(([v, l, dis]) => `<button type="button" role="radio" aria-checked="${v === cur}" class="${v === cur ? 'on' : ''}" data-act="${act}" data-arg="${v}"${dis ? ' disabled' : ''}>${l}</button>`).join('')}</div>`;

export function adviceText(a: Advice): string {
  return t(k(a.key), a.params);
}

/** One recommendation: tick (when it changes something), severity, text, confidence, CLI and slider form. */
function adviceRow(a: Advice, units: ApplyUnit[], vm: ViewModel): string {
  const u = units.find((x) => x.id === a.id);
  const sliders = a.sliders.length
    ? `<span class="ax-sl">${a.sliders.map((s) => `${escapeHtml(t(k(`autotune2.slider.${s.slider}`)))} ${s.from === null ? '?' : fmtNum(s.from, 2)} → <b>${fmtNum(s.to, 2)}</b>`).join(' · ')}</span>`
    : '';
  const cli = u ? u.commands : a.cli;
  return `<li class="ax-adv sev-${a.severity}">
      ${u ? `<label class="ax-tick"><input type="checkbox" data-sel="${escapeHtml(a.id)}" ${vm.ui.selected.has(a.id) ? 'checked' : ''} aria-label="${escapeHtml(t('atFlow.expert.select'))}"><span>${icon('check', 12)}</span></label>` : '<span class="ax-tick none"></span>'}
      <div class="ax-adv-b"><p>${chip(SEV_CHIP[a.severity], t(k(`autotune2.sev.${a.severity}`)))} ${escapeHtml(adviceText(a))}${a.approximate ? ` <span class="ax-approx" title="${escapeHtml(t('autotune2.approx'))}">≈</span>` : ''}</p>
        ${sliders}${cli.length ? `<code class="mono">${cli.map(escapeHtml).join('<br>')}</code>` : ''}</div>
      <span class="ax-conf mono" title="${escapeHtml(t('atFlow.expert.confTitle'))}">${Math.round(a.confidence * 100)}%</span>
    </li>`;
}

function adviceList(list: Advice[], units: ApplyUnit[], vm: ViewModel, empty: string): string {
  if (!list.length) return `<p class="pw-empty">${empty}</p>`;
  const sorted = [...list].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.confidence - a.confidence);
  return `<ul class="ax-advs">${sorted.map((a) => adviceRow(a, units, vm)).join('')}</ul>`;
}

/* ---------------- overview ---------------- */

function overview(vm: ViewModel, r: AutotuneResult, units: ApplyUnit[]): string {
  const vs = verdicts(r);
  const lights = `<ul class="ax-lights">${AREAS.map((id) => {
    const v = vs.find((x) => x.id === id)!;
    return `<li class="bz-light ${v.light}"><span class="bz-dot" aria-hidden="true"></span><div><b>${t(k(`atFlow.basic.areas.${id}`))}</b><span class="bz-word">${t(k(`atFlow.basic.light.${v.light}`))}</span><p>${escapeHtml(t(k(`atFlow.basic.v.${id}.${v.code}`), v.params))}</p></div></li>`;
  }).join('')}</ul>`;
  const all = [...r.pids.advice, ...r.filters.advice, ...(r.series?.advice ?? [])].filter((a) => SEV_RANK[a.severity] >= 2);
  const top = all.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.confidence - a.confidence).slice(0, 8);
  const pidUnit = units.find((u) => u.id === 'pid');
  return `<div class="ax-grid2">
      <div class="pw-panel">${cap(t('atFlow.expert.overview.verdict'), 'tips.autotune.overview')}${lights}</div>
      <div class="pw-panel">${cap(t('atFlow.expert.overview.needs'), 'tips.autotune.needs')}${adviceList(r.needs.advice, units, vm, t('atFlow.expert.overview.needsNone'))}</div>
    </div>
    ${qualityBlock(r.quality)}
    <div class="pw-panel ax-mt">${cap(t('atFlow.expert.overview.top'), 'tips.autotune.apply')}
      ${pidUnit ? pidRow(vm, r, pidUnit) : ''}
      ${top.length ? `<ul class="ax-advs">${top.map((a) => adviceRow(a, units, vm)).join('')}</ul>` : `<p class="pw-empty">${t('atFlow.expert.overview.none')}</p>`}</div>
    <p class="pw-hint mono">${t('atFlow.expert.overview.engine', { v: r.version, ms: r.ms, s: r.session + 1, n: r.sessions.length })}</p>`;
}

/** The PID change set as one tickable row. */
function pidRow(vm: ViewModel, r: AutotuneResult, u: ApplyUnit): string {
  const form = u.commands.some((c) => c.startsWith('set simplified_') && !c.includes('pids_mode')) ? 'sliders' : 'raw';
  return `<ul class="ax-advs"><li class="ax-adv sev-suggest">
      <label class="ax-tick"><input type="checkbox" data-sel="pid" ${vm.ui.selected.has('pid') ? 'checked' : ''} aria-label="${escapeHtml(t('atFlow.expert.select'))}"><span>${icon('check', 12)}</span></label>
      <div class="ax-adv-b"><p>${chip('info', t('autotune2.sev.suggest'))} ${t(form === 'sliders' ? 'atFlow.expert.pids.unitSliders' : 'atFlow.expert.pids.unitRaw', { n: Math.round(r.pids.scale * 100) })}</p>
        <code class="mono">${u.commands.map(escapeHtml).join('<br>')}</code></div>
      <span class="ax-conf mono">${Math.round(r.pids.scale * 100)}%</span></li></ul>`;
}

/* ---------------- step response ---------------- */

const curveOf = (s: AxisSteps | undefined) => s?.detected.curve ?? s?.wiener.curve ?? null;

function metricCells(m: CurveMetrics | null): string {
  if (!m) return '<td colspan="8" class="dim">—</td>';
  const os = m.overshoot;
  const osCls = os === null ? '' : os > 25 ? 'bad' : os > 12 ? 'warn' : os < 2 ? 'warn' : 'good';
  const riseCls = m.rise === null ? '' : m.rise > 80 ? 'warn' : 'good';
  return `<td class="${riseCls}">${num(m.rise, 0, ' ms')}</td><td>${num(m.latency50, 1, ' ms')}</td><td class="${osCls}">${num(os, 0, ' %')}</td><td>${m.settle2 === null ? '&gt;' : num(m.settle2, 0, ' ms')}</td><td>${m.settle5 === null ? '&gt;' : num(m.settle5, 0, ' ms')}</td><td class="${m.ringing >= 3 ? 'warn' : ''}">${m.ringing}</td><td>${num(m.ssError, 1, ' %')}</td><td class="${(m.bounceBack ?? 0) > 8 ? 'warn' : ''}">${num(m.bounceBack, 0, ' %')}</td>`;
}

const METRIC_HEAD = () =>
  ['rise', 'latency50', 'overshoot', 'settle2', 'settle5', 'ringing', 'ssError', 'bounceBack'].map((m) => `<th scope="col">${t(k(`autotune2.metric.${m}`))}</th>`).join('');

function stepSection(vm: ViewModel, r: AutotuneResult): string {
  const mode = vm.ui.stepMode;
  const axis = vm.ui.stepAxis;
  const st = r.steps.find((s) => s.axis === axis);
  let lines: StepLine[];
  let legend: Array<[string, string, string]>;
  if (mode === 'all') {
    const [ro, pi, ya] = AXES.map((a) => curveOf(r.steps.find((s) => s.axis === a)));
    lines = [
      { y: ya ?? null, color: INK, dash: '6 4', width: 1.4 },
      { y: pi ?? null, color: INK, glow: true },
      { y: ro ?? null, color: HOT, glow: true, width: 2.1, dim: true },
    ];
    legend = [
      ['Roll', HOT, ''],
      ['Pitch', INK, ''],
      ['Yaw', INK, '6 4'],
    ];
  } else {
    const buckets: StepBucket[] = (mode === 'size' ? st?.bySize : st?.byThrottle) ?? [];
    const styles = [{ color: BLUE, dash: '2 3' }, { color: INK, dash: '' }, { color: HOT, dash: '7 3' }];
    lines = buckets.map((b, i) => ({ y: b.curve, color: styles[i]!.color, dash: styles[i]!.dash, glow: i === 1 }));
    legend = buckets.map((b, i) => [`${t(k(`autotune2.bucket.${b.id}`))} · n=${b.n}`, styles[i]!.color, styles[i]!.dash] as [string, string, string]);
  }
  const chart = stepChart(lines, { aria: t('atFlow.expert.step.aria'), noData: t('at.stepNoData') });
  const leg = `<ul class="ax-legend">${legend.map(([l, c, d]) => `<li><svg width="28" height="8" aria-hidden="true"><line x1="0" x2="28" y1="4" y2="4" stroke="${c}" stroke-width="2"${d ? ` stroke-dasharray="${d}"` : ''}/></svg>${escapeHtml(l)}</li>`).join('')}</ul>`;
  const rows = r.steps
    .map((s) => {
      const src = s.source ? t(k(`atFlow.expert.step.src.${s.source}`)) : '—';
      return `<tr><th scope="row">${AXIS_NAME[s.axis]}</th><td>${src}</td><td>${s.source === 'steps' ? s.detected.n : s.wiener.windows}</td><td>${Math.round(s.confidence * 100)}%</td>${metricCells(s.best)}<td>${num(s.trackingDelayMs, 1, ' ms')}</td></tr>`;
    })
    .join('');
  const table = `<div class="pw-scroll"><table class="ax-tbl"><thead><tr><th scope="col">${t('atFlow.expert.step.axis')}</th><th scope="col">${t('atFlow.expert.step.source')}</th><th scope="col">n</th><th scope="col">${t('atFlow.expert.step.conf')}</th>${METRIC_HEAD()}<th scope="col">${t('atFlow.expert.step.track')}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const bucketRows = (list: StepBucket[]) => list.map((b) => `<tr><th scope="row">${t(k(`autotune2.bucket.${b.id}`))}</th><td>${b.n}</td>${metricCells(b.metrics)}</tr>`).join('');
  const ex = st?.detected.excluded;
  const buckets = st
    ? `<div class="pw-scroll"><table class="ax-tbl"><thead><tr><th scope="col">${t('atFlow.expert.step.bucket')}</th><th scope="col">n</th>${METRIC_HEAD()}</tr></thead><tbody>${bucketRows(st.bySize)}${bucketRows(st.byThrottle)}</tbody></table></div>
      ${ex ? `<p class="pw-hint">${t('atFlow.expert.step.excluded', { sat: ex.saturation, crash: ex.crash, idle: ex.idle })}</p>` : ''}`
    : '';
  return `<div class="pw-panel">${cap(t('atFlow.expert.step.cap'), 'tips.autotune.stepResponse')}
      <div class="ax-ctrl">${seg('step-mode', [['all', t('atFlow.expert.step.mode.all')], ['size', t('atFlow.expert.step.mode.size')], ['throttle', t('atFlow.expert.step.mode.throttle'), !r.needs.throttle]], mode, t('atFlow.expert.step.modeLabel'))}
        ${mode !== 'all' ? seg('step-axis', AXES.map((a) => [a, AXIS_NAME[a]] as [string, string]), axis, t('atFlow.expert.step.axis')) : ''}</div>
      <div class="at-plot">${chart}</div>${leg}</div>
    <div class="pw-panel ax-mt">${cap(t('atFlow.expert.step.metrics'), 'tips.autotune.stepMetrics')}${table}</div>
    <div class="pw-panel ax-mt">${cap(t('atFlow.expert.step.buckets', { axis: AXIS_NAME[axis] }), 'tips.autotune.buckets')}
      ${mode === 'all' ? seg('step-axis', AXES.map((a) => [a, AXIS_NAME[a]] as [string, string]), axis, t('atFlow.expert.step.axis')) : ''}${buckets}</div>`;
}

/* ---------------- noise ---------------- */

export function currentSpectrogram(vm: ViewModel, r: AutotuneResult): Spectrogram | null {
  const n = r.noise;
  return n[vm.ui.signal] ?? n.gyro ?? n.gyroUnfilt ?? n.dterm;
}

function noiseSection(vm: ViewModel, r: AutotuneResult): string {
  const n = r.noise;
  const s = currentSpectrogram(vm, r);
  const sigs: NoiseSignal[] = ['gyro', 'gyroUnfilt', 'dterm'];
  const control = seg('signal', sigs.map((x) => [x, t(k(`autotune2.signal.${x}`)), !n[x]] as [string, string, boolean]), s?.signal ?? vm.ui.signal, t('atFlow.expert.noise.signal'));
  if (!s) return `<div class="pw-panel">${control}<p class="pw-empty">${t('atFlow.expert.noise.none')}</p></div>`;
  const kind = { motor: t('atFlow.expert.noise.kind.motor'), frame: t('atFlow.expert.noise.kind.frame'), low: t('atFlow.expert.noise.kind.low'), unknown: t('atFlow.expert.noise.kind.unknown') };
  const sig = t(k(`autotune2.signal.${s.signal}`));
  const spec = spectrumChart(s, { aria: t('atFlow.expert.noise.specAria', { sig }), bands: n.bands, kind, bandLabels: { propwash: t('atFlow.expert.noise.bandPw'), frame: t('atFlow.expert.noise.bandFrame') } });
  const hasThr = s.counts.some((c) => c > 0);
  const [lo, hi] = heatRange(s);
  const heat = hasThr
    ? `${heatCanvas(t('atFlow.expert.noise.heatAria', { sig }))}
      <div class="ax-scale"><span class="mono">${lo} dB</span><i style="background:${heatGradient()}"></i><span class="mono">${hi} dB</span>
        <span class="ax-key"><svg width="24" height="8" aria-hidden="true"><line x1="0" x2="24" y1="4" y2="4" stroke="#fff" stroke-width="2" stroke-dasharray="5 4"/></svg>${kind.motor}</span>
        <span class="ax-key"><svg width="24" height="8" aria-hidden="true"><line x1="0" x2="24" y1="4" y2="4" stroke="${AMBER}" stroke-width="2"/></svg>${kind.frame}</span>
        <span class="ax-key"><i class="hatch"></i>${t('atFlow.expert.noise.noBin')}</span></div>`
    : `<p class="pw-empty">${t('atFlow.expert.noise.noThrottle')}</p>`;
  const peaks = s.peaks.length
    ? `<table class="ax-tbl"><thead><tr><th scope="col">Hz</th><th scope="col">${t('atFlow.expert.noise.prom')}</th><th scope="col">${t('atFlow.expert.noise.kindCol')}</th></tr></thead><tbody>${s.peaks
        .map((p) => `<tr><td>${num(p.hz, 0)}</td><td class="${p.resonance ? 'bad' : ''}">+${num(p.prom, 1)} dB${p.resonance ? ` · ${t('atFlow.expert.noise.resonance')}` : ''}</td><td>${kind[p.kind]}</td></tr>`)
        .join('')}</tbody></table>`
    : `<p class="pw-empty">${t('atFlow.expert.noise.noPeaks')}</p>`;
  const ridges = s.ridges.length
    ? `<table class="ax-tbl"><thead><tr><th scope="col">${t('atFlow.expert.noise.kindCol')}</th><th scope="col">${t('atFlow.expert.noise.ridgeHz')}</th><th scope="col">${t('atFlow.expert.noise.ridgeThr')}</th><th scope="col">${t('atFlow.expert.noise.prom')}</th></tr></thead><tbody>${s.ridges
        .slice(0, 6)
        .map((rd) => `<tr><td>${kind[rd.kind]}</td><td>${num(rd.hzAtLow, 0)} → ${num(rd.hzAtHigh, 0)}</td><td>${num(rd.thrLow, 0)}-${num(rd.thrHigh, 0)} %</td><td>+${num(rd.maxProm, 1)} dB</td></tr>`)
        .join('')}</tbody></table>`
    : `<p class="pw-empty">${t('atFlow.expert.noise.noRidges')}</p>`;
  return `<div class="ax-ctrl">${control}<span class="pw-hint mono">${t('atFlow.expert.noise.stats', { floor: num(s.floorDb, 0), hf: num(s.hfRms, 2), lf: num(s.lfRms, 1) })}</span></div>
    <div class="pw-panel">${cap(t('atFlow.expert.noise.spec', { sig, max: Math.round(s.maxHz) }), 'tips.autotune.spectrum')}<div class="at-plot">${spec}</div>
      <p class="pw-hint">${t('atFlow.expert.noise.floorKey')} · ${t('atFlow.expert.noise.bands', { a: n.bands.propwash[0], b: n.bands.propwash[1], c: n.bands.frame[0], d: n.bands.frame[1] })}</p></div>
    <div class="pw-panel ax-mt">${cap(t('atFlow.expert.noise.heat', { sig }), 'tips.autotune.spectrogram')}${heat}</div>
    <div class="ax-grid2 ax-mt"><div class="pw-panel">${cap(t('atFlow.expert.noise.peaks'), 'tips.autotune.peaks')}${peaks}</div><div class="pw-panel">${cap(t('atFlow.expert.noise.ridges'))}${ridges}</div></div>`;
}

/* ---------------- filters ---------------- */

function filtersSection(vm: ViewModel, r: AutotuneResult, units: ApplyUnit[]): string {
  const f = r.filters;
  const s = r.settings;
  const yes = (v: boolean | null) => (v === null ? '—' : v ? t('common.on') : t('common.off'));
  const delay = f.delay;
  const state = `<dl class="pw-facts">
      <div><dt>${t('atFlow.expert.filters.rpm')}</dt><dd class="mono">${yes(f.rpm.active)}${f.rpm.harmonicsNeeded !== null ? ` · ${t('atFlow.expert.filters.harm', { n: f.rpm.harmonicsNeeded })}` : ''}${f.rpm.minHz !== null ? ` · min ${f.rpm.minHz} Hz` : ''}</dd></div>
      <div><dt>${t('atFlow.expert.filters.notch')}</dt><dd class="mono">${f.dynNotch.countNeeded ?? '—'}${f.dynNotch.minHz !== null ? ` · ${f.dynNotch.minHz}-${f.dynNotch.maxHz ?? '?'} Hz` : ''}</dd></div>
      <div><dt>${t('atFlow.expert.filters.gyro')}</dt><dd class="mono">${f.gyroNoise ? t(k(`atFlow.expert.filters.g.${f.gyroNoise}`)) : '—'}${r.noise.gyro ? ` · ${num(r.noise.gyro.hfRms, 2)} °/s` : ''}</dd></div>
      <div><dt>${t('atFlow.expert.filters.dterm')}</dt><dd class="mono">${num(f.dtermNoiseDb, 1, ' dB')}</dd></div>
      <div><dt>${t('atFlow.expert.filters.delay')} ${tip('tips.autotune.filterDelay')}</dt><dd class="mono">${delay ? `${num(delay.ms, 2)} ms ${gauge(delay.ms, 5, 2)}` : '—'}</dd></div>
    </dl>`;
  const hz = (v: number | undefined) => (v === undefined ? '—' : `${v}`);
  const cur = s
    ? `<dl class="pw-facts">
      <div><dt>gyro_lpf1</dt><dd class="mono">${hz(s.gyroLpf1StaticHz)} · dyn ${hz(s.gyroLpf1DynMinHz)}-${hz(s.gyroLpf1DynMaxHz)} Hz</dd></div>
      <div><dt>gyro_lpf2</dt><dd class="mono">${hz(s.gyroLpf2StaticHz)} Hz</dd></div>
      <div><dt>dterm_lpf1</dt><dd class="mono">${hz(s.dtermLpf1StaticHz)} · dyn ${hz(s.dtermLpf1DynMinHz)}-${hz(s.dtermLpf1DynMaxHz)} Hz</dd></div>
      <div><dt>dterm_lpf2</dt><dd class="mono">${hz(s.dtermLpf2StaticHz)} Hz</dd></div>
      <div><dt>dyn_notch</dt><dd class="mono">${hz(s.dynNotchCount)} × Q${hz(s.dynNotchQ)} · ${hz(s.dynNotchMinHz)}-${hz(s.dynNotchMaxHz)} Hz</dd></div>
      <div><dt>rpm_filter</dt><dd class="mono">${hz(s.rpmHarmonics)} harm · min ${hz(s.rpmMinHz)} Hz · Q${hz(s.rpmQ)} · bidir ${s.dshotBidir === undefined ? '—' : s.dshotBidir ? 'ON' : 'OFF'}</dd></div>
      <div><dt>${t('autotune2.slider.gyroMultiplier')}</dt><dd class="mono">${num(s.simplified?.gyroMultiplier, 2)}</dd></div>
      <div><dt>${t('autotune2.slider.dtermMultiplier')}</dt><dd class="mono">${num(s.simplified?.dtermMultiplier, 2)}</dd></div>
    </dl>`
    : `<p class="pw-empty">${t('autotune2.needs.header')}</p>`;
  return `<div class="ax-grid2"><div class="pw-panel">${cap(t('atFlow.expert.filters.state'), 'tips.autotune.filters')}${state}</div><div class="pw-panel">${cap(t('atFlow.expert.filters.current'))}${cur}</div></div>
    <div class="pw-panel ax-mt">${cap(t('atFlow.expert.filters.advice'), 'tips.autotune.apply')}${adviceList(f.advice, units, vm, t('atFlow.expert.none'))}</div>`;
}

/* ---------------- propwash ---------------- */

function propwashSection(vm: ViewModel, r: AutotuneResult, units: ApplyUnit[]): string {
  const p = r.propwash;
  const cls = p.level === 'severe' ? 'bad' : p.level === 'moderate' ? 'warn' : p.level === 'none' ? 'good' : '';
  const related = r.pids.advice.filter((a) => a.id.startsWith('pid.propwash') || a.id === 'pid.itermRelaxLow');
  return `<div class="ax-grid2"><div class="pw-panel">${cap(t('atFlow.expert.propwash.cap'), 'tips.autotune.propwash')}
      <div class="ax-big ${cls}"><b>${p.ratio === null ? '—' : `${fmtNum(p.ratio, 1)}×`}</b><span>${t(k(`autotune2.propwashLevel.${p.level}`))}</span></div>
      <dl class="pw-facts">
        <div><dt>${t('atFlow.expert.propwash.events')}</dt><dd class="mono">${p.events}</dd></div>
        <div><dt>${t('atFlow.expert.propwash.perAxis')}</dt><dd class="mono">Roll ${num(p.perAxis[0], 1, '×')} · Pitch ${num(p.perAxis[1], 1, '×')}</dd></div>
        <div><dt>${t('atFlow.expert.propwash.band')}</dt><dd class="mono">${p.band[0]}-${p.band[1]} Hz</dd></div>
        <div><dt>${t('atFlow.expert.propwash.baseline')}</dt><dd class="mono">${p.baselineWindows}</dd></div>
      </dl></div>
      <div class="pw-panel">${cap(t('atFlow.expert.propwash.advice'))}${adviceList(related, units, vm, t('atFlow.expert.none'))}</div></div>
    <div class="pw-panel ax-mt">${cap(t('atFlow.expert.propwash.timeline'))}${eventsChart(p.eventTimes, r.analysis.duration, { aria: t('atFlow.expert.propwash.timelineAria', { n: p.events }) })}</div>`;
}

/* ---------------- PIDs ---------------- */

function pidsSection(vm: ViewModel, r: AutotuneResult, units: ApplyUnit[]): string {
  const p = r.pids;
  const s = r.settings;
  const scheme = s?.dScheme === 'dmax' ? 'D max' : 'D min';
  const cell = (a: number | null | undefined, b: number | null | undefined) =>
    a === null || a === undefined ? '<span class="dim">—</span>' : b !== null && b !== undefined && a !== b ? `<span class="old">${a}</span><span class="arr">→</span><span class="chg">${b}</span>` : String(a);
  const raw = `<table class="at-tbl pw-pid"><thead><tr><th scope="col">${t('atFlow.propose.axis')}</th><th scope="col">P</th><th scope="col">I</th><th scope="col">D</th><th scope="col">${scheme}</th><th scope="col">FF</th></tr></thead><tbody>${p.axes
    .map((a) => `<tr><th scope="row">${AXIS_NAME[a.axis]}</th><td>${cell(a.current?.p, a.suggested?.p)}</td><td>${cell(a.current?.i, a.suggested?.i)}</td><td>${cell(a.current?.d, a.suggested?.d)}</td><td>${cell(a.current?.dLimit, a.suggested?.dLimit)}</td><td>${cell(a.current?.f, a.suggested?.f)}</td></tr>`)
    .join('')}</tbody></table>`;
  const sliders = p.sliders.length
    ? `<table class="ax-tbl"><thead><tr><th scope="col">${t('atFlow.expert.pids.slider')}</th><th scope="col">${t('atFlow.expert.pids.now')}</th><th scope="col">${t('atFlow.expert.pids.new')}</th></tr></thead><tbody>${p.sliders
        .map((x) => `<tr><th scope="row">${t(k(`autotune2.slider.${x.slider}`))}</th><td>${num(x.from, 2)}</td><td class="chg">${num(x.to, 2)}</td></tr>`)
        .join('')}</tbody></table>`
    : `<p class="pw-empty">${s?.simplified ? t('atFlow.expert.pids.noSliderChange') : t('atFlow.expert.pids.noSliders')}</p>`;
  const fc = vm.facts.pid;
  const header = s?.pid ? `${s.pid.roll.join('/')} · ${s.pid.pitch.join('/')} · ${s.pid.yaw.join('/')}` : '—';
  const pidUnit = units.find((u) => u.id === 'pid');
  return `${vm.mismatch.length ? `<div class="pw-banner warn">${icon('alert', 16)}<span>${t('atFlow.propose.headerMismatch', { axes: vm.mismatch.join(', ') })} ${tip('tips.autotune.headerPid')}</span></div>` : ''}
    <dl class="pw-facts ax-inline"><div><dt>${t('atFlow.expert.pids.fromLog')}</dt><dd class="mono">${header}</dd></div><div><dt>${t('atFlow.expert.pids.fromFc')}</dt><dd class="mono">${fc ? `${fc.roll.join('/')} · ${fc.pitch.join('/')} · ${fc.yaw.join('/')}` : '—'}</dd></div>
      <div><dt>${t('atFlow.expert.pids.mode')}</dt><dd class="mono">${s?.simplified?.mode ?? '—'} · ${t('atFlow.expert.pids.scale', { n: Math.round(p.scale * 100) })}</dd></div></dl>
    <div class="ax-grid2"><div class="pw-panel">${cap(t('atFlow.expert.pids.raw'), 'tips.autotune.pids')}${raw}</div><div class="pw-panel">${cap(t('atFlow.expert.pids.sliders'), 'tips.autotune.sliders')}${sliders}</div></div>
    <div class="pw-panel ax-mt">${cap(t('atFlow.expert.pids.why'), 'tips.autotune.apply')}${pidUnit ? pidRow(vm, r, pidUnit) : ''}${adviceList(p.advice, units, vm, t('atFlow.expert.none'))}</div>`;
}

/* ---------------- series ---------------- */

function procedure(r: AutotuneResult): string {
  return `<ol class="ax-proc">${r.procedure
    .map((p) => {
      const on = r.nextStep === p.id;
      return `<li class="${on ? 'on' : ''}"><div><b>${t(k(`atFlow.expert.series.proc.${p.id}`))}</b>${on ? chip('warn', t('atFlow.expert.series.next')) : ''}${p.acroOnly ? chip('dim', 'ACRO') : ''}
        <p>${t(k(p.key))}</p>${p.prepare ? `<code class="mono">${p.prepare.map(escapeHtml).join('<br>')}</code><div class="pw-btns">${btn('proc-apply', t('atFlow.expert.series.prepareApply'), 'ghost', { arg: p.id, icon: 'arrowUp' })}${btn('proc-copy', t('atFlow.propose.copy'), 'ghost', { arg: p.id, icon: 'copy' })}</div>` : ''}</div></li>`;
    })
    .join('')}</ol>`;
}

function seriesSection(vm: ViewModel, r: AutotuneResult, units: ApplyUnit[]): string {
  const se = r.series;
  if (!se || !se.sessions.length)
    return `<div class="pw-panel">${cap(t('atFlow.expert.series.cap'), 'tips.autotune.series')}<p class="pw-empty">${t('atFlow.expert.series.none')}</p>${se ? adviceList(se.advice, units, vm, '') : ''}</div>
      <div class="pw-panel ax-mt">${cap(t('atFlow.expert.series.procedure'), 'tips.autotune.procedure')}${procedure(r)}</div>`;
  const param = se.param ?? '';
  const pname = ['p', 'dRaw', 'fRaw'].includes(param) ? t(k(`atFlow.expert.series.raw.${param}`)) : t(k(`autotune2.slider.${param}`));
  const rows = se.sessions
    .map((s) => `<tr class="${s.index === se.best ? 'best' : ''}"><th scope="row">#${s.index + 1}${s.index === se.best ? ` ${chip('ok', t('atFlow.expert.series.best'))}` : ''}</th><td>${num(s.value, 2)}</td><td><b>${num(s.score, 1)}</b></td><td>${num(s.overshoot, 0, ' %')}</td><td>${num(s.rise, 0, ' ms')}</td><td>${num(s.ringing, 1)}</td><td>${num(s.settle, 0, ' ms')}</td><td>${num(s.trackingDelayMs, 1, ' ms')}</td><td>${num(s.trackingCorr, 2)}</td><td>${s.steps}</td></tr>`)
    .join('');
  const members = se.sessions.map((s) => s.index);
  const curves = r.seriesCurves.filter((c) => members.includes(c.index)).sort((a, b) => (se.sessions.find((s) => s.index === a.index)?.value ?? 0) - (se.sessions.find((s) => s.index === b.index)?.value ?? 0));
  const lines: StepLine[] = curves.map((c, i) => ({ y: c.roll, color: c.index === se.best ? HOT : SERIES_STYLE[i % SERIES_STYLE.length]!.color, dash: c.index === se.best ? '' : SERIES_STYLE[i % SERIES_STYLE.length]!.dash, width: c.index === se.best ? 2.4 : 1.5, glow: c.index === se.best }));
  const legend = curves.map((c, i) => {
    const v = se.sessions.find((s) => s.index === c.index)?.value;
    const best = c.index === se.best;
    const st = SERIES_STYLE[i % SERIES_STYLE.length]!;
    return `<li><svg width="28" height="8" aria-hidden="true"><line x1="0" x2="28" y1="4" y2="4" stroke="${best ? HOT : st.color}" stroke-width="2"${!best && st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/></svg>#${c.index + 1} · ${num(v ?? null, 2)}${best ? ` (${t('atFlow.expert.series.best')})` : ''}</li>`;
  });
  return `<div class="pw-panel">${cap(t('atFlow.expert.series.cap'), 'tips.autotune.series', t('atFlow.expert.series.param', { param: pname }))}
      <div class="pw-scroll"><table class="ax-tbl ax-series"><thead><tr><th scope="col">${t('atFlow.expert.series.flight')}</th><th scope="col">${t('atFlow.expert.series.value')}</th><th scope="col">${t('atFlow.expert.series.score')}</th><th scope="col">${t('autotune2.metric.overshoot')}</th><th scope="col">${t('autotune2.metric.rise')}</th><th scope="col">${t('autotune2.metric.ringing')}</th><th scope="col">${t('autotune2.metric.settle5')}</th><th scope="col">${t('atFlow.expert.step.track')}</th><th scope="col">${t('atFlow.expert.series.corr')}</th><th scope="col">${t('atFlow.expert.series.steps')}</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${se.excluded.length ? `<p class="pw-hint">${t('atFlow.expert.series.excluded', { list: se.excluded.map((i) => `#${i + 1}`).join(', ') })}</p>` : ''}</div>
    <div class="pw-panel ax-mt">${cap(t('atFlow.expert.series.overlay'))}<div class="at-plot">${stepChart(lines, { aria: t('atFlow.expert.series.overlayAria'), noData: t('at.stepNoData') })}</div><ul class="ax-legend">${legend.join('')}</ul></div>
    <div class="ax-grid2 ax-mt"><div class="pw-panel">${cap(t('atFlow.expert.series.advice'), 'tips.autotune.apply')}${adviceList(se.advice, units, vm, t('atFlow.expert.none'))}</div>
      <div class="pw-panel">${cap(t('atFlow.expert.series.procedure'), 'tips.autotune.procedure')}${procedure(r)}</div></div>`;
}

/* ---------------- rounds ---------------- */

function roundsSection(vm: ViewModel): string {
  const rs = vm.rounds;
  if (!rs.length) return `<div class="pw-panel"><p class="pw-empty">${t('atFlow.expert.rounds.none')}</p></div>`;
  const tr = (cur: number | null, prev: number | null, lowerBetter = true, tol = 1) => {
    if (cur === null || prev === null || Math.abs(cur - prev) <= tol) return '';
    return (cur < prev) === lowerBetter ? 'good' : 'warn';
  };
  const rows = rs
    .map((r, i) => {
      const p = i > 0 ? rs[i - 1]!.metrics : null;
      const m = r.metrics;
      return `<tr><th scope="row">${t('atFlow.propose.iter', { n: r.n })}</th><td class="mono">${escapeHtml(r.name)}</td><td>${m.quality}</td><td class="${tr(m.overshoot === null ? null : Math.abs(m.overshoot - 8), p?.overshoot == null ? null : Math.abs(p.overshoot - 8), true, 2)}">${num(m.overshoot, 0, ' %')}</td><td class="${tr(m.rise, p?.rise ?? null, true, 3)}">${num(m.rise, 0, ' ms')}</td><td>${num(m.ringing, 0)}</td><td class="${tr(m.noise, p?.noise ?? null, true, 0.2)}">${num(m.noise, 2)}</td><td class="${tr(m.propwash, p?.propwash ?? null, true, 0.3)}">${num(m.propwash, 1, '×')}</td><td>${r.applied.length ? chip('ok', t('atFlow.propose.appliedMark')) : '—'}</td></tr>`;
    })
    .join('');
  const shown = rs.slice(-5);
  const lines: StepLine[] = shown.map((r, i) => {
    const last = i === shown.length - 1;
    const st = SERIES_STYLE[i % SERIES_STYLE.length]!;
    return { y: r.curve, color: last ? HOT : st.color, dash: last ? '' : st.dash, width: last ? 2.3 : 1.5, glow: last };
  });
  const legend = shown.map((r, i) => {
    const last = i === shown.length - 1;
    const st = SERIES_STYLE[i % SERIES_STYLE.length]!;
    return `<li><svg width="28" height="8" aria-hidden="true"><line x1="0" x2="28" y1="4" y2="4" stroke="${last ? HOT : st.color}" stroke-width="2"${!last && st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/></svg>${t('atFlow.propose.iter', { n: r.n })}</li>`;
  });
  return `<div class="pw-panel">${cap(t('atFlow.expert.rounds.cap'), 'tips.autotune.rounds')}
      <div class="pw-scroll"><table class="ax-tbl"><thead><tr><th scope="col">${t('atFlow.expert.rounds.round')}</th><th scope="col">${t('atFlow.expert.rounds.log')}</th><th scope="col">${t('atFlow.expert.rounds.quality')}</th><th scope="col">${t('autotune2.metric.overshoot')}</th><th scope="col">${t('autotune2.metric.rise')}</th><th scope="col">${t('autotune2.metric.ringing')}</th><th scope="col">${t('atFlow.expert.rounds.noise')}</th><th scope="col">${t('atFlow.expert.rounds.propwash')}</th><th scope="col">${t('atFlow.expert.rounds.applied')}</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${rs.length < 2 ? `<p class="pw-hint">${t('atFlow.propose.oneRound')}</p>` : ''}</div>
    <div class="pw-panel ax-mt">${cap(t('atFlow.expert.rounds.overlay'))}<div class="at-plot">${stepChart(lines, { aria: t('atFlow.expert.rounds.overlayAria'), noData: t('at.stepNoData') })}</div><ul class="ax-legend">${legend.join('')}</ul></div>
    <div class="pw-btns">${btn('fly-again', t('atFlow.propose.flyAgain'), 'light', { icon: 'play' })}</div>`;
}

/* ---------------- workspace ---------------- */

/** Why "Apply selected" is not possible (null = it is). */
export function expertApplyBlock(vm: ViewModel, n: number): string | null {
  if (!n) return 'none';
  if (vm.run?.sample && !vm.facts.demo) return 'sample';
  if (!vm.facts.connected) return 'needFc';
  if (vm.facts.armed) return 'armed';
  return null;
}

export function expertWorkspace(vm: ViewModel): string {
  if (vm.busy) return busyBlock(vm.busy);
  if (!vm.run) return dropBlock(vm);
  const run = vm.run;
  const r = run.res;
  const a = r.analysis;
  const units = applyUnits(r, vm.ui.form);
  const cmds = selectedCommands(units, vm.ui.selected);
  const block = expertApplyBlock(vm, cmds.length);
  const sessions =
    r.sessions.length > 1
      ? `<label class="ax-sess"><span class="mono">${t('atFlow.expert.session')} ${tip('tips.autotune.session')}</span><select data-session>${r.sessions
          .map((s) => `<option value="${s.index}" ${s.index === r.session ? 'selected' : ''} ${s.usable ? '' : 'disabled'}>#${s.index + 1} · ${fmtNum(s.duration, 0)} s${s.usable ? '' : ` · ${t('atFlow.expert.unusable')}`}</option>`)
          .join('')}</select></label>`
      : '';
  const q = r.quality;
  const bar = `<div class="ax-bar">
      <span class="at-sq"></span><span class="mono ax-name">${escapeHtml(run.name)}</span>
      <span class="mono dim">${fmtNum(a.duration, 0)} s · ${fmtNum(a.fs / 1000, 1)} kHz${r.settings?.firmwareRevision ? ` · ${escapeHtml(r.settings.firmwareRevision.split('(')[0]!.trim())}` : ''}</span>
      ${chip(q.label === 'good' ? 'ok' : q.label === 'ok' ? 'warn' : 'hot', t('atFlow.expert.qualityChip', { n: q.score }))}
      ${run.sample ? chip('info', t('atFlow.basic.result.sampleChip')) : ''}
      ${sessions}
      <label class="pw-toggle ax-hot"><input type="checkbox" data-hot ${vm.ui.hot ? 'checked' : ''}>${t('atFlow.expert.hot')} ${tip('tips.autotune.hot')}</label>
      ${seg('form', [['sliders', t('atFlow.expert.form.sliders')], ['raw', t('atFlow.expert.form.raw')]], vm.ui.form, t('atFlow.expert.form.label'))}${tip('tips.autotune.form')}
    </div>`;
  const tabs = TABS.filter((x) => x !== 'rounds' || vm.rounds.length > 0);
  const nav = `<div class="ax-nav" role="tablist">${tabs
    .map((x) => {
      const badge = x === 'series' && r.series?.sessions.length ? ` <small>${r.series.sessions.length}</small>` : x === 'rounds' ? ` <small>${vm.rounds.length}</small>` : '';
      return `<button type="button" role="tab" aria-selected="${x === vm.ui.tab}" class="${x === vm.ui.tab ? 'on' : ''}" data-act="tab" data-arg="${x}">${t(k(`atFlow.expert.tabs.${x}`))}${badge}</button>`;
    })
    .join('')}</div>`;
  const tab = tabs.includes(vm.ui.tab) ? vm.ui.tab : 'overview';
  const body =
    tab === 'overview'
      ? overview(vm, r, units)
      : tab === 'step'
        ? stepSection(vm, r)
        : tab === 'noise'
          ? noiseSection(vm, r)
          : tab === 'filters'
            ? filtersSection(vm, r, units)
            : tab === 'propwash'
              ? propwashSection(vm, r, units)
              : tab === 'pids'
                ? pidsSection(vm, r, units)
                : tab === 'series'
                  ? seriesSection(vm, r, units)
                  : roundsSection(vm);
  const apply = `<div class="ax-apply">
      <span class="mono">${t('atFlow.expert.selected', { n: units.filter((u) => vm.ui.selected.has(u.id)).length, c: cmds.length })}</span>
      ${btn('expert-apply', t('atFlow.expert.apply'), 'light', { icon: 'arrowUp', disabled: !!block, title: block ? t(k(`atFlow.expert.block.${block}`)) : '' })}
      ${btn('copy-sel', t('atFlow.propose.copy'), 'ghost', { icon: 'copy', disabled: !cmds.length })}
      ${btn('ai-review', t('atFlow.propose.askAi'), 'ghost', { icon: 'chip', disabled: !vm.aiReady })}
      ${btn('restore', vm.st.backup ? t('atFlow.propose.restore', { name: vm.st.backup }) : t('atFlow.propose.noBackup'), 'ghost', { arg: vm.st.backup ?? '', disabled: !vm.st.backup || !vm.facts.connected || vm.facts.armed })}
      ${block && block !== 'none' ? `<span class="pw-why">${t(k(`atFlow.expert.block.${block}`))}</span>` : ''}
      <details class="ax-cli"><summary class="mono">${t('atFlow.expert.cliPreview', { n: cmds.length })}</summary><div class="at-cmd mono">${cmds.length ? cmds.map((c) => `<div>${escapeHtml(c)}</div>`).join('') : `<div class="dim">${t('atFlow.propose.nothing')}</div>`}</div></details>
    </div>`;
  return `${bar}${nav}<div class="ax-body" role="tabpanel">${body}</div>${apply}`;
}
