/**
 * PID Tuning tab (Betaflight Configurator parity): PID table per profile, rates with live curves, filters with a
 * frequency-response sketch. Reads over MSP when the tab opens, edits are local until "Save" (SET_* + EEPROM_WRITE).
 */
import type { AppContext, ScreenMount } from '../context';
import { createIo, CMD, type BfIo } from '../bf/io';
import { decodeFilterConfig, decodePid, decodePidAdvanced, decodeRcTuning, encodeFilterConfig, encodePid, encodePidAdvanced, encodeRcTuning, FILTER_TYPES, PID_AXES, RATES_TYPES } from '../bf/tuning';
import { getSuggestion } from '../bf/autotune-link';
import { decodeStatusEx, type StatusEx } from '../bf/statusex';
import type { Values } from '../bf/fieldtable';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { t, type Key } from '../i18n';
import { barHtml, bindForm, disconnectedHtml, errMsg, errorHtml, fieldHtml, Form, noticeHtml, sectionHtml, updateBar, type FieldSpec } from './bf-tuning-ui';
import { filterChart, maxRatesOf, ratesChart, ratesTypeOf, throttleChart } from './bf-tuning-charts';

type Sub = 'pid' | 'rates' | 'filters';
let lastSub: Sub = 'pid'; // survives tab switches

const AXIS_NAME: Record<(typeof PID_AXES)[number], string> = { roll: 'ROLL', pitch: 'PITCH', yaw: 'YAW' };
const ENUM = (labels: string[]) => labels.map((label, v) => ({ v, label }));
const dKey = (k: string) => `bfTuning.${k}` as Key;

/** Display scale / unit / labels per rates type (raw bytes of MSP_RC_TUNING, see bf/tuning.ts rateAt). */
const RATE_UI: Record<(typeof RATES_TYPES)[number], { rc: { scale: number; unit: string; key: string }; sr: { scale: number; max: number; unit: string; key: string }; ex: string }> = {
  betaflight: { rc: { scale: 0.01, unit: '', key: 'rcRate' }, sr: { scale: 0.01, max: 99, unit: '', key: 'superRate' }, ex: 'expo' },
  raceflight: { rc: { scale: 10, unit: '°/s', key: 'rate' }, sr: { scale: 0.01, max: 255, unit: '', key: 'acroPlus' }, ex: 'expo' },
  kiss: { rc: { scale: 0.001, unit: '', key: 'rcRate' }, sr: { scale: 0.01, max: 99, unit: '', key: 'rate' }, ex: 'rcCurve' },
  actual: { rc: { scale: 10, unit: '°/s', key: 'center' }, sr: { scale: 10, max: 255, unit: '°/s', key: 'maxRate' }, ex: 'expo' },
  quick: { rc: { scale: 2, unit: '°/s', key: 'center' }, sr: { scale: 10, max: 255, unit: '°/s', key: 'maxRate' }, ex: 'expo' },
};

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  const io: BfIo = createIo(ctx);
  const form = new Form();
  const root = document.createElement('div');
  root.className = 'bf-tuning';
  el.appendChild(root);

  let disposed = false;
  let phase: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  let error = '';
  let busy = false;
  let status: StatusEx | null = null;
  let loadedLink: unknown = null;
  // ?bfsub=rates|filters opens a sub-tab directly (used for screenshots)
  const qSub = new URLSearchParams(location.search).get('bfsub');
  if (qSub === 'pid' || qSub === 'rates' || qSub === 'filters') lastSub = qSub;
  let sub: Sub = lastSub;
  const raws: { pid: Uint8Array; adv: Uint8Array | null; rc: Uint8Array; filter: Uint8Array | null } = { pid: new Uint8Array(0), adv: null, rc: new Uint8Array(0), filter: null };
  let hasAdv = false;
  let hasFilter = false;

  const api = () => io.apiMinor();

  /* ---------------- field specs ---------------- */
  /** Tooltip text for a key when the dictionary has one (axis digit stripped: p0 -> p). */
  const tipFor = (k: string): string | undefined => {
    const key = dKey(`tips.${k.replace(/\d$/, '')}`);
    const v = t(key);
    return v === key ? undefined : v;
  };
  const s = (g: string, k: string, label: string, min: number, max: number, extra: Partial<FieldSpec> = {}): FieldSpec => ({ g, k, label, min, max, tip: tipFor(k), ...extra });

  function pidSpecs(): FieldSpec[] {
    const out: FieldSpec[] = [];
    for (let a = 0; a < 3; a++) {
      const nm = AXIS_NAME[PID_AXES[a]!];
      out.push(s('pid', `p${a}`, `${nm} P`, 0, 250, { bare: true }), s('pid', `i${a}`, `${nm} I`, 0, 250, { bare: true }), s('pid', `d${a}`, `${nm} D`, 0, 250, { bare: true }));
      out.push(s('adv', `dMax${a}`, `${nm} D max`, 0, 250, { bare: true }), s('adv', `ff${a}`, `${nm} F`, 0, 2000, { bare: true }));
    }
    out.push(
      s('adv', 'tpaMode', t('bfTuning.pid.tpaMode'), 0, 1, { options: ENUM(['PD', 'D']) }),
      s('adv', 'tpaRate', t('bfTuning.pid.tpaRate'), 0, 100, { slider: true, unit: '%' }),
      s('adv', 'tpaBreakpoint', t('bfTuning.pid.tpaBreakpoint'), 700, 2000, { slider: true, unit: 'µs' }),
      s('adv', 'itermRelax', t('bfTuning.pid.itermRelax'), 0, 4, { options: ENUM([t('common.off'), 'RP', 'RPY', 'RP inc', 'RPY inc']) }),
      s('adv', 'itermRelaxType', t('bfTuning.pid.itermRelaxType'), 0, 1, { options: ENUM(['Gyro', 'Setpoint']) }),
      s('adv', 'itermRelaxCutoff', t('bfTuning.pid.itermRelaxCutoff'), 1, 50, { unit: 'Hz' }),
      s('adv', 'antiGravityGain', t('bfTuning.pid.antiGravity'), 1, 250),
      s('adv', 'dMaxGain', t('bfTuning.pid.dMaxGain'), 0, 100),
      s('adv', 'dMaxAdvance', t('bfTuning.pid.dMaxAdvance'), 0, 200),
      s('adv', 'ffTransition', t('bfTuning.pid.ffTransition'), 0, 100, { scale: 0.01 }),
      s('adv', 'ffAveraging', t('bfTuning.pid.ffAveraging'), 0, 3, { options: ENUM([t('common.off'), '2 pt', '3 pt', '4 pt']) }),
      s('adv', 'ffSmoothFactor', t('bfTuning.pid.ffSmooth'), 0, 75),
      s('adv', 'ffBoost', t('bfTuning.pid.ffBoost'), 0, 50),
      s('adv', 'ffMaxRateLimit', t('bfTuning.pid.ffMaxRate'), 0, 100),
      s('adv', 'ffJitterFactor', t('bfTuning.pid.ffJitter'), 0, 20),
      s('adv', 'throttleBoost', t('bfTuning.pid.throttleBoost'), 0, 100),
      s('adv', 'thrustLinearization', t('bfTuning.pid.thrustLin'), 0, 150),
      s('adv', 'vbatSagCompensation', t('bfTuning.pid.vbatSag'), 0, 150, { unit: '%' }),
      s('adv', 'motorOutputLimit', t('bfTuning.pid.motorLimit'), 1, 100, { unit: '%' }),
      s('adv', 'angleLimit', t('bfTuning.pid.angleLimit'), 10, 90, { unit: '°' }),
      s('adv', 'acroTrainerAngle', t('bfTuning.pid.acroTrainer'), 10, 80, { unit: '°' }),
      s('adv', 'dynIdleMinRpm', t('bfTuning.pid.dynIdle'), 0, 255, { scale: 100, unit: 'rpm' }),
      s('adv', 'itermRotation', t('bfTuning.pid.itermRotation'), 0, 1, { check: true }),
      s('adv', 'useIntegratedYaw', t('bfTuning.pid.integratedYaw'), 0, 1, { check: true }),
    );
    return out;
  }

  function rateSpecs(): FieldSpec[] {
    const ty = ratesTypeOf(form.cur.rc ?? {});
    const ui = RATE_UI[ty];
    const out: FieldSpec[] = [s('rc', 'ratesType', t('bfTuning.rates.type'), 0, RATES_TYPES.length - 1, { options: RATES_TYPES.map((k, v) => ({ v, label: t(dKey(`rates.types.${k}`)) })) })];
    for (let a = 0; a < 3; a++) {
      out.push(
        s('rc', `rcRate${a}`, t(dKey(`rates.f.${ui.rc.key}`)), 0, 255, { scale: ui.rc.scale, unit: ui.rc.unit, slider: true, tip: t(dKey(`rates.tip.${ui.rc.key}`)) }),
        s('rc', `superRate${a}`, t(dKey(`rates.f.${ui.sr.key}`)), 0, ui.sr.max, { scale: ui.sr.scale, unit: ui.sr.unit, slider: true, tip: t(dKey(`rates.tip.${ui.sr.key}`)) }),
        s('rc', `rcExpo${a}`, t(dKey(`rates.f.${ui.ex}`)), 0, 100, { scale: 0.01, slider: true, tip: t(dKey(`rates.tip.${ui.ex}`)) }),
        s('rc', `rateLimit${a}`, t('bfTuning.rates.limit'), 200, 1998, { unit: '°/s' }),
      );
    }
    out.push(
      s('rc', 'throttleMid', t('bfTuning.rates.thrMid'), 0, 100, { scale: 0.01, slider: true }),
      s('rc', 'throttleExpo', t('bfTuning.rates.thrExpo'), 0, 100, { scale: 0.01, slider: true }),
      s('rc', 'throttleHover', t('bfTuning.rates.thrHover'), 0, 100, { unit: '%', slider: true }),
      s('rc', 'throttleLimitType', t('bfTuning.rates.thrLimitType'), 0, 2, { options: ENUM([t('common.off'), t('bfTuning.rates.limScale'), t('bfTuning.rates.limClip')]) }),
      s('rc', 'throttleLimitPercent', t('bfTuning.rates.thrLimit'), 25, 100, { unit: '%' }),
    );
    return out;
  }

  function filterSpecs(): FieldSpec[] {
    const types = ENUM([...FILTER_TYPES]);
    const hz = (k: string, label: string, max = 1000) => s('filter', k, label, 0, max, { unit: 'Hz' });
    return [
      hz('gyroLpf1Hz', t('bfTuning.filters.lpf1Static')),
      s('filter', 'gyroLpf1Type', t('bfTuning.filters.lpfType'), 0, 3, { options: types }),
      hz('gyroLpf1DynMin', t('bfTuning.filters.dynMin')),
      hz('gyroLpf1DynMax', t('bfTuning.filters.dynMax')),
      hz('gyroLpf2Hz', t('bfTuning.filters.lpf2Static')),
      s('filter', 'gyroLpf2Type', t('bfTuning.filters.lpfType'), 0, 3, { options: types }),
      hz('dtermLpf1Hz', t('bfTuning.filters.lpf1Static')),
      s('filter', 'dtermLpf1Type', t('bfTuning.filters.lpfType'), 0, 3, { options: types }),
      hz('dtermLpf1DynMin', t('bfTuning.filters.dynMin')),
      hz('dtermLpf1DynMax', t('bfTuning.filters.dynMax')),
      hz('dtermLpf2Hz', t('bfTuning.filters.lpf2Static')),
      s('filter', 'dtermLpf2Type', t('bfTuning.filters.lpfType'), 0, 3, { options: types }),
      hz('yawLpfHz', t('bfTuning.filters.yawLpf')),
      s('filter', 'dynLpfCurveExpo', t('bfTuning.filters.curveExpo'), 0, 10),
      s('filter', 'dynNotchCount', t('bfTuning.filters.notchCount'), 0, 5),
      s('filter', 'dynNotchQ', t('bfTuning.filters.notchQ'), 1, 1000),
      hz('dynNotchMin', t('bfTuning.filters.notchMin'), 250),
      hz('dynNotchMax', t('bfTuning.filters.notchMax'), 1000),
      s('filter', 'rpmHarmonics', t('bfTuning.filters.rpmHarmonics'), 0, 3, { options: ENUM([t('common.off'), '1', '2', '3']) }),
      s('filter', 'rpmMinHz', t('bfTuning.filters.rpmMin'), 50, 255, { unit: 'Hz' }),
      hz('gyroNotch1Hz', t('bfTuning.filters.notchCenter')),
      hz('gyroNotch1Cutoff', t('bfTuning.filters.notchCutoff')),
      hz('gyroNotch2Hz', t('bfTuning.filters.notchCenter')),
      hz('gyroNotch2Cutoff', t('bfTuning.filters.notchCutoff')),
      hz('dtermNotchHz', t('bfTuning.filters.notchCenter')),
      hz('dtermNotchCutoff', t('bfTuning.filters.notchCutoff')),
    ];
  }

  const allSpecs = (): FieldSpec[] => (sub === 'pid' ? pidSpecs() : sub === 'rates' ? rateSpecs() : filterSpecs());
  const spec = (specs: FieldSpec[], g: string, k: string) => specs.find((x) => x.g === g && x.k === k)!;

  /* ---------------- load / save ---------------- */
  async function load(): Promise<void> {
    if (!io.connected()) {
      phase = 'idle';
      render();
      return;
    }
    phase = 'loading';
    render();
    const a = api();
    try {
      status = decodeStatusEx(await io.read(CMD.STATUS_EX), a);
      const pid = decodePid(await io.read(CMD.PID));
      raws.pid = pid.raw;
      const pv: Values = {};
      pid.items.slice(0, 3).forEach((it, i) => {
        pv[`p${i}`] = it[0];
        pv[`i${i}`] = it[1];
        pv[`d${i}`] = it[2];
      });
      form.load('pid', pv);
      const advBytes = await io.tryRead(CMD.PID_ADVANCED);
      hasAdv = !!advBytes;
      raws.adv = advBytes;
      form.load('adv', advBytes ? decodePidAdvanced(advBytes, a).values : {});
      const rc = decodeRcTuning(await io.read(CMD.RC_TUNING), a);
      raws.rc = rc.raw;
      form.load('rc', rc.values);
      const fb = await io.tryRead(CMD.FILTER_CONFIG);
      hasFilter = !!fb;
      raws.filter = fb;
      form.load('filter', fb ? decodeFilterConfig(fb, a).values : {});
      phase = 'ready';
    } catch (e) {
      phase = 'error';
      error = errMsg(e);
    }
    loadedLink = ctx.link();
    if (!disposed) render();
  }

  async function save(): Promise<void> {
    if (busy || !form.count()) return;
    busy = true;
    updateBar(root, form.count(), { busy });
    const a = api();
    try {
      if (form.groupChanged('pid')) {
        const items = [0, 1, 2].map((i) => [form.get('pid', `p${i}`), form.get('pid', `i${i}`), form.get('pid', `d${i}`)] as [number, number, number]);
        await io.write(CMD.SET_PID, encodePid(raws.pid, items));
      }
      if (hasAdv && raws.adv && form.groupChanged('adv')) await io.write(CMD.SET_PID_ADVANCED, encodePidAdvanced(raws.adv, form.cur.adv!, a));
      if (form.groupChanged('rc')) await io.write(CMD.SET_RC_TUNING, encodeRcTuning(raws.rc, form.cur.rc!, a));
      if (hasFilter && raws.filter && form.groupChanged('filter')) await io.write(CMD.SET_FILTER_CONFIG, encodeFilterConfig(raws.filter, form.cur.filter!, a));
      await io.save();
      ctx.toast(t('bfTuning.common.saved'), 'ok');
      busy = false;
      await load(); // re-read: what the FC reports is what is shown
    } catch (e) {
      busy = false;
      ctx.toast(t('bfTuning.common.saveFail', { msg: errMsg(e) }), 'error');
      updateBar(root, form.count(), { busy });
    }
  }

  async function selectProfile(kind: 'pid' | 'rate', idx: number): Promise<void> {
    if (busy || !status) return;
    if ((kind === 'pid' ? status.pidProfile : status.rateProfile) === idx) return;
    if (form.count() && !(await ctx.confirm({ title: t('bfTuning.common.discardTitle'), body: `<p>${escapeHtml(t('bfTuning.common.discardBody'))}</p>`, confirmText: t('bfTuning.common.discard') }))) return;
    try {
      await io.write(CMD.SELECT_SETTING, Uint8Array.from([kind === 'pid' ? idx : 0x80 | idx]));
      await load();
    } catch (e) {
      ctx.toast(t('bfTuning.common.selectFail', { msg: errMsg(e) }), 'error');
    }
  }

  /* ---------------- views ---------------- */
  function profileBar(): string {
    const st = status!;
    const seg = (kind: 'pid' | 'rate', n: number, cur: number) =>
      Array.from({ length: n }, (_, i) => `<button class="bf-tuning-seg${i === cur ? ' on' : ''}" data-act="profile" data-kind="${kind}" data-i="${i}" aria-pressed="${i === cur}">${i + 1}</button>`).join('');
    return `<div class="bf-tuning-profiles">
      <span class="bf-tuning-pl mono">${t('bfTuning.common.pidProfile')}</span><span class="bf-tuning-segs">${seg('pid', st.pidProfileCount, st.pidProfile)}</span>
      <span class="bf-tuning-pl mono">${t('bfTuning.common.rateProfile')}</span><span class="bf-tuning-segs">${seg('rate', st.rateProfileCount ?? 6, st.rateProfile)}</span>
      <span class="bf-tuning-pnote dim">${t('bfTuning.common.profileNote')}</span>
    </div>`;
  }

  function subnav(): string {
    return `<div class="bf-tuning-subnav" role="tablist">${(['pid', 'rates', 'filters'] as Sub[])
      .map((k) => `<button role="tab" class="${k === sub ? 'on' : ''}" aria-selected="${k === sub}" data-act="sub" data-sub="${k}">${t(dKey(`sub.${k}`))}</button>`)
      .join('')}</div>`;
  }

  function autotuneBanner(): string {
    const sug = getSuggestion();
    if (!sug || !form.has('pid', 'p0')) return '';
    const parts: string[] = [];
    sug.forEach((ax, a) => {
      if (!ax.suggested) return;
      const names = ['P', 'I', 'D'] as const;
      names.forEach((n, i) => {
        const cur = form.get('pid', `${n.toLowerCase()}${a}`);
        if (ax.suggested![i] !== cur) parts.push(`${AXIS_NAME[ax.axis]} ${n} ${cur}→${ax.suggested![i]}`);
      });
    });
    if (!parts.length) return '';
    return `<div class="bf-tuning-note info" data-at><i></i><span>${t('bfTuning.pid.autotune', { list: escapeHtml(parts.join(' · ')) })}</span><button class="btn ghost" data-act="applyAt">${icon('arrowUp', 14)}${t('bfTuning.pid.applyAt')}</button></div>`;
  }

  function pidView(): string {
    const sp = pidSpecs();
    const f = (g: string, k: string) => fieldHtml(form, spec(sp, g, k));
    const rows = [0, 1, 2]
      .map((a) => `<tr><th scope="row">${AXIS_NAME[PID_AXES[a]!]}</th><td>${f('pid', `p${a}`)}</td><td>${f('pid', `i${a}`)}</td><td>${f('pid', `d${a}`)}</td><td>${f('adv', `dMax${a}`)}</td><td>${f('adv', `ff${a}`)}</td></tr>`)
      .join('');
    const grp = (title: string, keys: string[]) => sectionHtml(title, `<div class="bf-tuning-grid">${keys.map((k) => f('adv', k)).join('')}</div>`);
    return `${autotuneBanner()}
      ${sectionHtml(t('bfTuning.pid.tableCap'), `<table class="bf-tuning-tbl"><thead><tr><th scope="col">${t('bfTuning.pid.axis')}</th><th scope="col" title="${escapeHtml(t('bfTuning.tips.p'))}">P</th><th scope="col" title="${escapeHtml(t('bfTuning.tips.i'))}">I</th><th scope="col" title="${escapeHtml(t('bfTuning.tips.d'))}">D</th><th scope="col" title="${escapeHtml(t('bfTuning.tips.dMax'))}">D max</th><th scope="col" title="${escapeHtml(t('bfTuning.tips.ff'))}">F</th></tr></thead><tbody>${rows}</tbody></table>`)}
      ${hasAdv ? `<div class="bf-tuning-cols">
        ${grp(t('bfTuning.pid.gTpa'), ['tpaMode', 'tpaRate', 'tpaBreakpoint'])}
        ${grp(t('bfTuning.pid.gIterm'), ['itermRelax', 'itermRelaxType', 'itermRelaxCutoff', 'antiGravityGain', 'itermRotation'])}
        ${grp(t('bfTuning.pid.gDmax'), ['dMaxGain', 'dMaxAdvance'])}
        ${grp(t('bfTuning.pid.gFf'), ['ffTransition', 'ffAveraging', 'ffSmoothFactor', 'ffBoost', 'ffMaxRateLimit', 'ffJitterFactor'])}
        ${grp(t('bfTuning.pid.gOther'), ['throttleBoost', 'thrustLinearization', 'vbatSagCompensation', 'motorOutputLimit', 'angleLimit', 'acroTrainerAngle', 'dynIdleMinRpm', 'useIntegratedYaw'])}
      </div>` : noticeHtml('warn', t('bfTuning.common.advUnsupported'))}`;
  }

  function ratesLegend(): string {
    const m = maxRatesOf(form.cur.rc ?? {});
    return `<div class="bf-tuning-legend">${(['roll', 'pitch', 'yaw'] as const).map((ax, a) => `<div class="bf-tuning-k"><div class="l mono"><i class="ln l${a}"></i>${AXIS_NAME[ax]}</div><div class="v">${m[a]}<small>°/s</small></div></div>`).join('')}</div>`;
  }

  function ratesView(): string {
    const sp = rateSpecs();
    const f = (k: string) => fieldHtml(form, spec(sp, 'rc', k));
    const axisBlock = (a: 0 | 1 | 2) =>
      `<div class="bf-tuning-axis"><div class="bf-tuning-axh mono">${AXIS_NAME[PID_AXES[a]!]}</div>${f(`rcRate${a}`)}${f(`superRate${a}`)}${f(`rcExpo${a}`)}${f(`rateLimit${a}`)}</div>`;
    return `<div class="bf-tuning-rates">
      <div class="bf-tuning-rcol">
        ${sectionHtml(t('bfTuning.rates.cap'), `<div class="bf-tuning-grid one">${f('ratesType')}</div><div class="bf-tuning-axes">${axisBlock(0)}${axisBlock(1)}${axisBlock(2)}</div>`)}
        ${sectionHtml(t('bfTuning.rates.thrCap'), `<div class="bf-tuning-grid">${f('throttleMid')}${f('throttleExpo')}${f('throttleHover')}${f('throttleLimitType')}${f('throttleLimitPercent')}</div>`)}
      </div>
      <div class="bf-tuning-rcol">
        ${sectionHtml(t('bfTuning.rates.curveCap'), `<div class="bf-tuning-plot" data-chart="rates">${ratesChart(form.cur.rc ?? {}, form.orig.rc ?? {})}</div><div data-legend>${ratesLegend()}</div>`, t('bfTuning.rates.curveNote'))}
        ${sectionHtml(t('bfTuning.rates.thrCurve'), `<div class="bf-tuning-plot narrow" data-chart="thr">${throttleChart(form.cur.rc ?? {}, form.orig.rc ?? {})}</div>`)}
      </div>
    </div>`;
  }

  function filtersView(): string {
    if (!hasFilter) return noticeHtml('warn', t('bfTuning.common.filtersUnsupported'));
    const sp = filterSpecs();
    const f = (k: string) => fieldHtml(form, spec(sp, 'filter', k));
    const fv = form.cur.filter ?? {};
    const bidir = ctx.state.get().config?.bidir;
    const rpmWarn = (fv.rpmHarmonics ?? 0) > 0 && bidir === false ? noticeHtml('warn', t('bfTuning.filters.rpmNeedsBidir')) : '';
    const grid = (keys: string[]) => `<div class="bf-tuning-grid two">${keys.map(f).join('')}</div>`;
    return `<div class="bf-tuning-rates">
      <div class="bf-tuning-rcol">
        ${sectionHtml(t('bfTuning.filters.gyro'), grid(['gyroLpf1Hz', 'gyroLpf1Type', 'gyroLpf1DynMin', 'gyroLpf1DynMax', 'gyroLpf2Hz', 'gyroLpf2Type']))}
        ${sectionHtml(t('bfTuning.filters.dterm'), grid(['dtermLpf1Hz', 'dtermLpf1Type', 'dtermLpf1DynMin', 'dtermLpf1DynMax', 'dtermLpf2Hz', 'dtermLpf2Type', 'yawLpfHz', 'dynLpfCurveExpo']))}
        ${sectionHtml(t('bfTuning.filters.dynNotch'), grid(['dynNotchCount', 'dynNotchQ', 'dynNotchMin', 'dynNotchMax']))}
        ${sectionHtml(t('bfTuning.filters.rpm'), `${rpmWarn}${grid(['rpmHarmonics', 'rpmMinHz'])}`)}
        <details class="bf-tuning-more"><summary>${t('bfTuning.filters.legacy')}</summary>${grid(['gyroNotch1Hz', 'gyroNotch1Cutoff', 'gyroNotch2Hz', 'gyroNotch2Cutoff', 'dtermNotchHz', 'dtermNotchCutoff'])}</details>
      </div>
      <div class="bf-tuning-rcol bf-tuning-sticky">
        ${sectionHtml(t('bfTuning.filters.sketchCap'), `<div class="bf-tuning-plot" data-chart="filters">${filterChart(fv)}</div>
          <div class="bf-tuning-keys mono"><span><i class="ln l0"></i>${t('bfTuning.filters.keyGyro')}</span><span><i class="ln dt"></i>${t('bfTuning.filters.keyDterm')}</span><span><i class="ln nb"></i>${t('bfTuning.filters.keyNotch')}</span><span><i class="ln rpm"></i>${t('bfTuning.filters.keyRpm')}</span></div>
          <p class="bf-tuning-hint">${t('bfTuning.filters.sketchNote')}</p>`)}
      </div>
    </div>`;
  }

  function render(): void {
    if (disposed) return;
    const top = root.scrollTop;
    if (!io.connected() || phase === 'idle') {
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
    const body = sub === 'pid' ? pidView() : sub === 'rates' ? ratesView() : filtersView();
    root.innerHTML = `<div class="bf-tuning-head"><div class="bf-tuning-title mono"><span class="bf-tuning-sq"></span>${t('bfTuning.tab')}</div>${profileBar()}</div>${subnav()}<div class="bf-tuning-body">${body}</div>${barHtml()}`;
    root.scrollTop = top;
    updateBar(root, form.count(), { busy });
  }

  function refreshLive(g: string): void {
    updateBar(root, form.count(), { busy });
    if (g === 'rc' && sub === 'rates') {
      const rc = form.cur.rc ?? {};
      const o = form.orig.rc ?? {};
      const a = root.querySelector('[data-chart="rates"]');
      if (a) a.innerHTML = ratesChart(rc, o);
      const tc = root.querySelector('[data-chart="thr"]');
      if (tc) tc.innerHTML = throttleChart(rc, o);
      const lg = root.querySelector('[data-legend]');
      if (lg) lg.innerHTML = ratesLegend();
    } else if (g === 'filter') {
      const c = root.querySelector('[data-chart="filters"]');
      if (c) c.innerHTML = filterChart(form.cur.filter ?? {});
      const rpm = (form.cur.filter?.rpmHarmonics ?? 0) > 0 && ctx.state.get().config?.bidir === false;
      if (rpm !== !!root.querySelector('.bf-tuning-note.warn')) render();
    } else if (g === 'pid' && sub === 'pid') {
      const banner = root.querySelector('[data-at]');
      const next = autotuneBanner();
      if (!!banner !== !!next) render();
    }
  }

  function summary(): string {
    const pv = form.cur.pid ?? {};
    const av = form.cur.adv ?? {};
    const rv = form.cur.rc ?? {};
    const fv = form.cur.filter ?? {};
    const mr = maxRatesOf(rv);
    const lines = [
      t('bfTuning.ai.intro', { pid: (status?.pidProfile ?? 0) + 1, rate: (status?.rateProfile ?? 0) + 1 }),
      ...(['roll', 'pitch', 'yaw'] as const).map((ax, a) => `${AXIS_NAME[ax]}: P ${pv[`p${a}`]} I ${pv[`i${a}`]} D ${pv[`d${a}`]}${av[`dMax${a}`] !== undefined ? ` Dmax ${av[`dMax${a}`]}` : ''}${av[`ff${a}`] !== undefined ? ` F ${av[`ff${a}`]}` : ''}`),
      `${t('bfTuning.rates.type')}: ${t(dKey(`rates.types.${ratesTypeOf(rv)}`))}; max °/s ${mr.join('/')}; throttle mid ${(rv.throttleMid ?? 0) / 100} expo ${(rv.throttleExpo ?? 0) / 100}`,
      `Gyro LPF1 ${fv.gyroLpf1Hz ?? 0} Hz (dyn ${fv.gyroLpf1DynMin ?? 0}-${fv.gyroLpf1DynMax ?? 0}), LPF2 ${fv.gyroLpf2Hz ?? 0}; D-term LPF1 ${fv.dtermLpf1Hz ?? 0} (dyn ${fv.dtermLpf1DynMin ?? 0}-${fv.dtermLpf1DynMax ?? 0}), LPF2 ${fv.dtermLpf2Hz ?? 0}; dyn notch x${fv.dynNotchCount ?? 0} Q${fv.dynNotchQ ?? 0} ${fv.dynNotchMin ?? 0}-${fv.dynNotchMax ?? 0} Hz; RPM harmonics ${fv.rpmHarmonics ?? 0}`,
      `TPA ${av.tpaRate ?? '?'}% @ ${av.tpaBreakpoint ?? '?'}, anti-gravity ${av.antiGravityGain ?? '?'}, iterm relax ${av.itermRelax ?? '?'}`,
    ];
    if (form.count()) lines.push(t('bfTuning.ai.unsaved', { n: form.count() }));
    return lines.join('\n');
  }

  /* ---------------- events ---------------- */
  const unbind = bindForm(root, form, allSpecs, (g, k) => {
    if (g === 'rc' && k === 'ratesType') render();
    else refreshLive(g);
  });

  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const act = b?.dataset.act;
    if (!b || !act) return;
    if (act === 'sub') {
      sub = lastSub = b.dataset.sub as Sub;
      render();
    } else if (act === 'profile') void selectProfile(b.dataset.kind as 'pid' | 'rate', Number(b.dataset.i));
    else if (act === 'save') void save();
    else if (act === 'revert') {
      form.revert();
      render();
    } else if (act === 'reload') void load();
    else if (act === 'ask') ctx.askAi(summary());
    else if (act === 'applyAt') {
      getSuggestion()?.forEach((ax, a) => {
        if (!ax.suggested) return;
        (['p', 'i', 'd'] as const).forEach((n, i) => form.set('pid', `${n}${a}`, ax.suggested![i]!));
      });
      render();
      ctx.toast(t('bfTuning.pid.appliedAt'), 'ok');
    }
  });

  const off = ctx.state.subscribe(() => {
    if (disposed || busy) return;
    const connected = io.connected();
    if (connected && ctx.link() !== loadedLink && phase !== 'loading') void load();
    else if (!connected && phase !== 'idle') {
      phase = 'idle';
      loadedLink = null;
      form.clear();
      render();
    }
  });

  void load();
  render();

  return () => {
    disposed = true;
    off();
    unbind();
    root.remove();
  };
};
