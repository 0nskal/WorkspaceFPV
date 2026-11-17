/** Power & Battery tab: meter sources and scales, cell voltage limits, capacity, live voltage/current/mAh and a voltage calibration helper. */
import { C } from '../bf/codes';
import * as D from '../bf/decode';
import './bf-power.css';
import { fieldHtml, mountFormTab, type Draft, type FieldDef, type Group, type TabSpec } from '../bf/form';
import type { BfCommand, BfData, MspWrite } from '../bf/store';
import type { ScreenMount } from '../context';
import { fmtNum, t, type Key } from '../i18n';
import { intro, tip } from '../ui/tip';
import { decorateForm, type RowRule } from '../bf/form-decor';

const K = (k: string) => `bfPower.${k}` as Key;

const voltMeter = (bf: BfData) => bf.voltageMeters?.find((m) => m.sensorType === 1) ?? bf.voltageMeters?.[0];
const curMeter = (bf: BfData) => bf.currentMeters?.find((m) => m.type === 1) ?? bf.currentMeters?.[0];

function toDraft(bf: BfData): Draft {
  const d: Draft = {};
  const b = bf.battery;
  if (b) {
    d.voltSrc = b.voltageSource;
    d.curSrc = b.currentSource;
    d.minCell = b.minCell;
    d.warnCell = b.warnCell;
    d.maxCell = b.maxCell;
    d.capacity = b.capacityMah;
  }
  const v = voltMeter(bf);
  if (v) {
    d.vScale = v.scale;
    d.vDiv = v.divVal;
    d.vMult = v.divMultiplier;
  }
  const c = curMeter(bf);
  if (c) {
    d.cScale = c.scale;
    d.cOffset = c.offset;
  }
  return d;
}

function groups(bf: BfData): Group[] {
  const g: Group[] = [];
  const num = (key: string, tipKey: string, min: number, max: number, extra: Partial<FieldDef> = {}): FieldDef => ({ key, type: 'number', label: t(K(key === 'capacity' ? 'capacity' : key)), tip: t(K(`${tipKey}Tip`)), min, max, ...extra });
  const rows = (fs: FieldDef[], d: Draft, b: Draft) => fs.map((f) => fieldHtml(f, d, b)).join('');
  if (bf.battery) {
    g.push({
      title: t(K('gBattery')),
      fields: [
        { key: 'voltSrc', type: 'select', label: t(K('voltSrc')), tip: t(K('voltSrcTip')), options: [{ value: 0, label: t(K('srcNone')) }, { value: 1, label: t(K('srcAdc')) }, { value: 2, label: t(K('srcEsc')) }] },
        { key: 'curSrc', type: 'select', label: t(K('curSrc')), tip: t(K('curSrcTip')), options: [{ value: 0, label: t(K('srcNone')) }, { value: 1, label: t(K('srcAdc')) }, { value: 2, label: t(K('srcVirtual')) }, { value: 3, label: t(K('srcEsc')) }, { value: 4, label: t(K('srcMsp')) }] },
        num('minCell', 'minCell', 1, 5, { unit: 'V', step: 0.01, decimals: 2 }),
        num('maxCell', 'maxCell', 1, 5, { unit: 'V', step: 0.01, decimals: 2 }),
        num('warnCell', 'warnCell', 1, 5, { unit: 'V', step: 0.01, decimals: 2 }),
        num('capacity', 'capacity', 0, 20000, { unit: 'mAh' }),
      ],
    });
    g.push({
      title: t(K('gState')),
      fields: [],
      render: () => `<dl class="v1-kv pw-state">
        <dt>${t(K('connected'))}</dt><dd data-live="state">—</dd>
        <dt>${t(K('pack'))}</dt><dd data-live="v">—</dd>
        <dt>${t(K('cell'))}</dt><dd data-live="cell">—</dd>
        <dt>${t(K('used'))}</dt><dd data-live="mah">—</dd>
        <dt>${t(K('current'))}</dt><dd data-live="a">—</dd>
        <dt>${t(K('power'))}</dt><dd data-live="w">—</dd>
      </dl>`,
    });
  }
  const vm = voltMeter(bf);
  if (vm) {
    const fs = [num('vScale', 'vScale', 1, 255), num('vDiv', 'vDiv', 1, 255), num('vMult', 'vMult', 1, 255)];
    g.push({
      title: t(K('gVoltmeter')),
      fields: fs,
      render: (d, b) => `${rows(fs, d, b)}<div class="pw-live"><span>${t(K('pack'))}</span><b class="mono" data-live="v2">—</b></div>
        <div class="pw-cal"><div class="pw-cal-h"><b>${t(K('calHead'))}</b> ${tip('tips.power.calibrate')}<span>${t(K('calText'))}</span></div>
          <div class="pw-cal-r"><input type="number" step="0.01" min="1" max="60" data-cal="measured" aria-label="${t(K('calMeasured'))}" /><span class="bf-unit mono">V</span><label>${t(K('calMeasured'))}</label><button class="btn amber" data-cal="apply">${t(K('calApply'))}</button></div></div>`,
    });
  }
  const cm = curMeter(bf);
  if (cm) g.push({ title: t(K('gAmmeter')), fields: [num('cScale', 'cScale', -32768, 32767), num('cOffset', 'cOffset', -32768, 32767)] });
  return g;
}

const same = (a: Draft, b: Draft, ks: string[]) => ks.every((k) => a[k] === b[k]);

function toWrites(d: Draft, bf: BfData): MspWrite[] {
  const base = toDraft(bf);
  const w: MspWrite[] = [];
  if (bf.battery && !same(d, base, ['voltSrc', 'curSrc', 'minCell', 'warnCell', 'maxCell', 'capacity'])) {
    w.push({
      code: C.SET_BATTERY_CONFIG,
      label: 'SET_BATTERY_CONFIG',
      payload: D.encodeBatteryConfig({ minCell: Number(d.minCell), warnCell: Number(d.warnCell), maxCell: Number(d.maxCell), capacityMah: Number(d.capacity), voltageSource: Number(d.voltSrc), currentSource: Number(d.curSrc) }, bf.raw.get('battery')),
    });
  }
  const v = voltMeter(bf);
  if (v && !same(d, base, ['vScale', 'vDiv', 'vMult'])) {
    w.push({ code: C.SET_VOLTAGE_METER_CONFIG, label: 'SET_VOLTAGE_METER_CONFIG', payload: D.encodeVoltageMeter({ ...v, scale: Number(d.vScale), divVal: Number(d.vDiv), divMultiplier: Number(d.vMult) }) });
  }
  const c = curMeter(bf);
  if (c && !same(d, base, ['cScale', 'cOffset'])) {
    w.push({ code: C.SET_CURRENT_METER_CONFIG, label: 'SET_CURRENT_METER_CONFIG', payload: D.encodeCurrentMeter({ ...c, scale: Number(d.cScale), offset: Number(d.cOffset) }) });
  }
  return w;
}

const BAT_STATE: BfCommand<D.BatteryState> = { code: C.BATTERY_STATE, decode: (p) => D.decodeBatteryState(p) };

const spec: TabSpec = {
  id: 'power',
  title: '',
  areas: ['battery'],
  ready: (bf) => !!bf.battery,
  toDraft,
  groups,
  toWrites,
  needsReboot: (changed) => changed.includes('voltSrc') || changed.includes('curSrc'),
  validate: (d) => (Number(d.minCell) < Number(d.warnCell) && Number(d.warnCell) < Number(d.maxCell) ? null : t(K('errOrder'))),
  top: () => intro('tips.power.intro'),
  live(el, ctx, api) {
    const q = (k: string) => el.querySelector<HTMLElement>(`[data-live="${k}"]`);
    let cells = 0;
    let state = 4;
    const stateKey = (s: number) => K(`state${Math.min(4, Math.max(0, s))}`);
    const paint = () => {
      const tel = ctx.state.get().telemetry;
      const v = tel?.vbat ?? 0;
      const usb = v < 5;
      const set = (k: string, txt: string) => {
        const e = q(k);
        if (e) e.textContent = txt;
      };
      set('v', usb ? '—' : `${fmtNum(v, 2)} V`);
      set('v2', usb ? '—' : `${fmtNum(v, 2)} V`);
      set('w', usb || !tel ? '—' : `${fmtNum(v * tel.amperage, 1)} W`);
      set('cell', usb || !cells ? '—' : `${fmtNum(v / cells, 2)} V`);
      set('a', tel ? `${fmtNum(tel.amperage, 2)} A` : '—');
      set('mah', tel ? `${Math.round(tel.mah)} mAh` : '—');
      const st = q('state');
      if (st) {
        const txt = usb ? t(K('state3')) : t(stateKey(state));
        st.textContent = !usb && cells ? `${txt} (${t(K('cells'), { n: cells })})` : txt;
        st.className = usb ? 'dim' : state === 1 ? 'warn' : state === 2 ? 'bad' : 'ok';
      }
    };
    const poll = async () => {
      const b = await ctx.bf.read(BAT_STATE);
      if (b) {
        cells = b.cells;
        state = b.state;
      }
      paint();
    };
    void poll();
    const iv = setInterval(() => void poll(), 1500);
    const off = ctx.state.subscribeTelemetry(paint);
    const onClick = (e: Event) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-cal]')?.dataset.cal;
      if (act !== 'apply') return;
      const measured = Number(el.querySelector<HTMLInputElement>('[data-cal="measured"]')?.value);
      const shown = ctx.state.get().telemetry?.vbat ?? 0;
      const scale = Number(api.draft().vScale);
      if (!Number.isFinite(measured) || measured <= 0 || shown < 5 || ctx.bf.get().battery?.voltageSource !== 1 || !Number.isFinite(scale)) {
        ctx.toast(t(K('calNeedBattery')), 'info');
        return;
      }
      api.set('vScale', Math.max(1, Math.min(255, Math.round((scale * measured) / shown))));
    };
    el.addEventListener('click', onClick);
    return () => {
      clearInterval(iv);
      off();
      el.removeEventListener('click', onClick);
    };
  },
};

/** vScale stays visible in Basic because the calibration helper above writes to it. */
const ROWS: RowRule[] = [
  { key: 'voltSrc', tip: 'tips.power.voltSrc' },
  { key: 'vScale', tip: 'tips.power.vScale' },
  { key: 'vDiv', tip: 'tips.power.vDiv', expert: true },
  { key: 'vMult', tip: 'tips.power.vMult', expert: true },
  { key: 'curSrc', tip: 'tips.power.curSrc' },
  { key: 'cScale', tip: 'tips.power.cScale', expert: true },
  { key: 'cOffset', tip: 'tips.power.cOffset', expert: true },
  { key: 'minCell', tip: 'tips.power.minCell' },
  { key: 'warnCell', tip: 'tips.power.warnCell' },
  { key: 'maxCell', tip: 'tips.power.maxCell' },
  { key: 'capacity', tip: 'tips.power.capacity' },
];

export const mount: ScreenMount = (el, ctx) => {
  const off = mountFormTab(el, ctx, { ...spec, title: t(K('title')) });
  const stop = decorateForm(el, ROWS);
  return () => {
    stop();
    off();
  };
};
