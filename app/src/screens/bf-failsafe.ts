/** Failsafe tab: stage 1 / stage 2, procedure, delays, per-channel fallback values. */
import { C } from '../bf/codes';
import * as D from '../bf/decode';
import { bareHtml, mountFormTab, type Draft, type FieldDef, type Group, type TabSpec } from '../bf/form';
import type { BfData, MspWrite } from '../bf/store';
import type { ScreenMount } from '../context';
import { t, type Key } from '../i18n';
import { escapeHtml } from '../ui/dom';
import { intro, tip } from '../ui/tip';
import { decorateForm, type RowRule } from '../bf/form-decor';

const K = (k: string) => `bfFailsafe.${k}` as Key;
const s10 = (v: number) => Math.round(v) / 10;

function toDraft(bf: BfData): Draft {
  const d: Draft = {};
  const f = bf.failsafe;
  if (f) {
    d.delay = s10(f.delay);
    d.offDelay = s10(f.offDelay);
    d.throttle = f.throttle;
    d.switchMode = f.switchMode;
    d.throttleLow = s10(f.throttleLowDelay);
    d.procedure = f.procedure;
  }
  (bf.rxFail ?? []).forEach((c, i) => {
    d[`rf.${i}.mode`] = c.mode;
    d[`rf.${i}.value`] = c.value;
  });
  return d;
}

function channelName(i: number): string {
  return i < 4 ? t(K(['roll', 'pitch', 'yaw', 'thr'][i] as string)) : t(K('aux'), { n: i - 3 });
}

const flowHtml = () => `${intro('tips.failsafe.intro')}<section class="bf-panel wide bf-fs-flow">
  <header><span>${escapeHtml(t(K('tab')))} ${tip('tips.failsafe.flow')}</span></header>
  <div class="bf-fs-steps">
    ${[1, 2, 3].map((n) => `<div class="bf-fs-step"><i class="mono">${n}</i><b>${t(K(`flow${n}`))}</b><small>${t(K(`flow${n}Text`))}</small></div>`).join('<span class="bf-fs-arrow" aria-hidden="true">→</span>')}
  </div>
</section>`;

function groups(bf: BfData, draft: Draft): Group[] {
  const g: Group[] = [];
  if (bf.failsafe) {
    g.push({ title: t(K('gStage1')), fields: [{ key: 'delay', type: 'number', label: t(K('delay')), tip: t(K('delayTip')), unit: 's', min: 0, max: 20, step: 0.1, decimals: 1 }] });
    g.push({
      title: t(K('gStage2')),
      fields: [
        { key: 'procedure', type: 'select', label: t(K('procedure')), tip: t(K('procedureTip')), options: [{ value: 0, label: t(K('procAuto')) }, { value: 1, label: t(K('procDrop')) }, { value: 2, label: t(K('procGps')) }] },
        { key: 'offDelay', type: 'number', label: t(K('offDelay')), tip: t(K('offDelayTip')), unit: 's', min: 0, max: 20, step: 0.1, decimals: 1 },
        { key: 'throttle', type: 'number', label: t(K('throttle')), tip: t(K('throttleTip')), unit: 'µs', min: 1000, max: 2000 },
        { key: 'throttleLow', type: 'number', label: t(K('throttleLow')), tip: t(K('throttleLowTip')), unit: 's', min: 0, max: 30, step: 0.1, decimals: 1 },
      ],
    });
    g.push({ title: t(K('gSwitch')), fields: [{ key: 'switchMode', type: 'select', label: t(K('switchMode')), tip: t(K('switchTip')), options: [{ value: 0, label: t(K('swStage1')) }, { value: 1, label: t(K('swKill')) }, { value: 2, label: t(K('swStage2')) }] }] });
  }
  const n = bf.rxFail?.length ?? 0;
  if (n > 0) {
    const fields: FieldDef[] = [];
    for (let i = 0; i < n; i++) {
      fields.push(
        { key: `rf.${i}.mode`, type: 'select', label: `${channelName(i)} ${t(K('mode'))}`, options: [{ value: 0, label: t(K('modeAuto')) }, { value: 1, label: t(K('modeHold')) }, { value: 2, label: t(K('modeSet')) }] },
        { key: `rf.${i}.value`, type: 'number', label: `${channelName(i)} ${t(K('value'))}`, unit: 'µs', min: 750, max: 2250, disabled: draft[`rf.${i}.mode`] !== 2 },
      );
    }
    g.push({
      title: t(K('gChannels')),
      hint: t(K('gChannelsHint')),
      wide: true,
      fields,
      render: (dr, base) => {
        const rows: string[] = [`<div class="bf-fs-ch head mono"><span>${escapeHtml(t(K('channel')))}</span><span>${escapeHtml(t(K('mode')))} ${tip('tips.failsafe.chMode')}</span><span>${escapeHtml(t(K('value')))} ${tip('tips.failsafe.chValue')}</span></div>`];
        for (let i = 0; i < n; i++) {
          rows.push(`<div class="bf-fs-ch"><span class="bf-fs-chn mono">${i + 1} · ${escapeHtml(channelName(i))}</span>${bareHtml(fields[i * 2]!, dr, base)}${bareHtml(fields[i * 2 + 1]!, dr, base)}</div>`);
        }
        rows.push(`<p class="bf-fs-note">${escapeHtml(t(K('chNote')))}</p>`);
        return `<div class="bf-fs-chgrid">${rows.join('')}</div>`;
      },
    });
  }
  return g;
}

const same = (a: Draft, b: Draft, ks: string[]) => ks.every((k) => a[k] === b[k]);

function toWrites(d: Draft, bf: BfData): MspWrite[] {
  const base = toDraft(bf);
  const w: MspWrite[] = [];
  if (bf.failsafe && !same(d, base, ['delay', 'offDelay', 'throttle', 'switchMode', 'throttleLow', 'procedure'])) {
    w.push({
      code: C.SET_FAILSAFE_CONFIG,
      label: 'SET_FAILSAFE_CONFIG',
      payload: D.encodeFailsafe({ delay: Math.round(Number(d.delay) * 10), offDelay: Math.round(Number(d.offDelay) * 10), throttle: Number(d.throttle), switchMode: Number(d.switchMode), throttleLowDelay: Math.round(Number(d.throttleLow) * 10), procedure: Number(d.procedure) }, bf.raw.get('failsafe')),
    });
  }
  (bf.rxFail ?? []).forEach((_, i) => {
    if (!same(d, base, [`rf.${i}.mode`, `rf.${i}.value`])) {
      w.push({ code: C.SET_RXFAIL_CONFIG, label: `SET_RXFAIL_CONFIG ch${i + 1}`, payload: D.encodeRxFailChannel(i, { mode: Number(d[`rf.${i}.mode`]), value: Number(d[`rf.${i}.value`]) }) });
    }
  });
  return w;
}

const spec: TabSpec = {
  id: 'failsafe',
  title: '',
  areas: ['failsafe', 'rx'],
  ready: (bf) => !!bf.failsafe || !!bf.rxFail?.length,
  toDraft,
  groups,
  toWrites,
  dynamic: (k) => k.startsWith('rf.') && k.endsWith('.mode'),
  top: () => flowHtml(),
};

const ROWS: RowRule[] = [
  { key: 'delay', tip: 'tips.failsafe.delay' },
  { key: 'procedure', tip: 'tips.failsafe.procedure' },
  { key: 'offDelay', tip: 'tips.failsafe.offDelay' },
  { key: 'throttle', tip: 'tips.failsafe.throttle' },
  { key: 'throttleLow', tip: 'tips.failsafe.throttleLow' },
  { key: 'switchMode', tip: 'tips.failsafe.switchMode' },
];

export const mount: ScreenMount = (el, ctx) => {
  const off = mountFormTab(el, ctx, { ...spec, title: t(K('title')) });
  const stop = decorateForm(el, ROWS);
  return () => {
    stop();
    off();
  };
};
