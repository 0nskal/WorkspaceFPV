/** Ports tab: one row per UART (function chips, MSP switch, baud) plus a board schematic; writes MSP2_COMMON_SET_SERIAL_CONFIG. */
import './bf-ports.css';
import { C } from '../bf/codes';
import * as D from '../bf/decode';
import { bareHtml, fieldHtml, mountFormTab, type Draft, type FieldDef, type Group, type TabSpec, type Val } from '../bf/form';
import type { BfData, MspWrite } from '../bf/store';
import type { ScreenMount } from '../context';
import { t, type Key } from '../i18n';
import { escapeHtml } from '../ui/dom';
import { intro, tip, type TipKey } from '../ui/tip';
import { currentMode } from '../ui/mode';

const K = (k: string) => `bfPorts.${k}` as Key;
const F = D.SERIAL_FN;

const opt = (value: number, label: string) => ({ value, label });
const telemOpts = () => [opt(0, t(K('none'))), opt(F.TELEMETRY_FRSKY, t(K('tFrsky'))), opt(F.TELEMETRY_HOTT, t(K('tHott'))), opt(F.TELEMETRY_LTM, t(K('tLtm'))), opt(F.TELEMETRY_SMARTPORT, t(K('tSmartport'))), opt(F.TELEMETRY_MAVLINK, t(K('tMavlink'))), opt(F.TELEMETRY_IBUS, t(K('tIbus')))];
const sensorOpts = () => [opt(0, t(K('none'))), opt(F.GPS, t(K('sGps'))), opt(F.ESC_SENSOR, t(K('sEsc'))), opt(F.LIDAR_TF, t(K('sLidar')))];
const periphOpts = () => [opt(0, t(K('none'))), opt(F.BLACKBOX, t(K('pBlackbox'))), opt(F.VTX_SMARTAUDIO, t(K('pSmartaudio'))), opt(F.VTX_TRAMP, t(K('pTramp'))), opt(F.VTX_MSP, t(K('pVtxMsp'))), opt(F.RCDEVICE, t(K('pRcdevice'))), opt(F.FRSKY_OSD, t(K('pFrskyOsd'))), opt(F.GIMBAL, t(K('pGimbal')))];
const baudOpts = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => opt(from + i, D.baudLabel(from + i)));

const masks = () => ({
  telem: telemOpts().map((o) => Number(o.value)),
  sensor: sensorOpts().map((o) => Number(o.value)),
  periph: periphOpts().map((o) => Number(o.value)),
});
const knownBits = () => {
  const m = masks();
  return [...m.telem, ...m.sensor, ...m.periph, F.MSP, F.RX_SERIAL].reduce((a, b) => a | b, 0) >>> 0;
};
/** First option of a group present in the mask (a port normally has one). */
const pick = (mask: number, group: number[]) => group.find((b) => b !== 0 && (mask & b) !== 0) ?? 0;

function toDraft(bf: BfData): Draft {
  const d: Draft = {};
  (bf.serial?.ports ?? []).forEach((p, i) => {
    const m = masks();
    d[`p${i}.msp`] = (p.mask & F.MSP) !== 0;
    d[`p${i}.mspBaud`] = p.mspBaud;
    d[`p${i}.rx`] = (p.mask & F.RX_SERIAL) !== 0;
    d[`p${i}.telem`] = pick(p.mask, m.telem);
    d[`p${i}.telemBaud`] = p.telemetryBaud;
    d[`p${i}.sensor`] = pick(p.mask, m.sensor);
    d[`p${i}.sensorBaud`] = p.gpsBaud;
    d[`p${i}.periph`] = pick(p.mask, m.periph);
    d[`p${i}.periphBaud`] = p.blackboxBaud;
  });
  return d;
}

const portFields = (i: number): Record<string, FieldDef> => ({
  msp: { key: `p${i}.msp`, type: 'check', label: t(K('colMsp')) },
  mspBaud: { key: `p${i}.mspBaud`, type: 'select', label: t(K('baud')), options: baudOpts(1, 15) },
  rx: { key: `p${i}.rx`, type: 'check', label: t(K('colRx')) },
  telem: { key: `p${i}.telem`, type: 'select', label: t(K('colTelem')), options: telemOpts() },
  telemBaud: { key: `p${i}.telemBaud`, type: 'select', label: t(K('baud')), options: baudOpts(0, 5) },
  sensor: { key: `p${i}.sensor`, type: 'select', label: t(K('colSensor')), options: sensorOpts() },
  sensorBaud: { key: `p${i}.sensorBaud`, type: 'select', label: t(K('baud')), options: baudOpts(0, 6) },
  periph: { key: `p${i}.periph`, type: 'select', label: t(K('colPeriph')), options: periphOpts() },
  periphBaud: { key: `p${i}.periphBaud`, type: 'select', label: t(K('baud')), options: baudOpts(1, 14) },
});

const labelOf = (list: Array<{ value: number | string; label: string }>, v: Val | undefined) => list.find((o) => Number(o.value) === Number(v))?.label ?? '';
/** What a port carries, for the board schematic. */
type Fn = 'none' | 'rx' | 'telem' | 'sensor' | 'periph' | 'mixed';

function fnOf(r: Draft, i: number): Fn {
  const a: Fn[] = [];
  if (r[`p${i}.rx`]) a.push('rx');
  if (Number(r[`p${i}.telem`])) a.push('telem');
  if (Number(r[`p${i}.sensor`])) a.push('sensor');
  if (Number(r[`p${i}.periph`])) a.push('periph');
  return a.length === 0 ? 'none' : a.length === 1 ? (a[0] as Fn) : 'mixed';
}

/** Duplicate-function message for a port (same rules as validate()). */
function dupOf(r: Draft, i: number, n: number): string {
  const count = (test: (j: number) => boolean) => Array.from({ length: n }, (_, j) => j).filter(test).length;
  if (r[`p${i}.rx`] && count((j) => !!r[`p${j}.rx`]) > 1) return t(K('errDup'), { fn: t(K('fnRx')) });
  const s = Number(r[`p${i}.sensor`]);
  if (s === F.GPS && count((j) => Number(r[`p${j}.sensor`]) === F.GPS) > 1) return t(K('errDup'), { fn: t(K('fnGps')) });
  if (s === F.ESC_SENSOR && count((j) => Number(r[`p${j}.sensor`]) === F.ESC_SENSOR) > 1) return t(K('errDup'), { fn: t(K('fnEsc')) });
  return '';
}

/** Short label for the board schematic: "UART2 Receiver", "UART5 GPS", "UART1 MSP". */
function boardLabel(r: Draft, i: number, name: string, bad: boolean): { cls: string; text: string } {
  const fn = fnOf(r, i);
  const msp = !!r[`p${i}.msp`];
  if (fn === 'none') return msp ? { cls: bad ? 'bad' : 'msp', text: `${name} MSP` } : { cls: 'off', text: name };
  if (fn === 'mixed') return { cls: 'mixed', text: `${name} ${t(K('mixed'))}${msp ? ' + MSP' : ''}` };
  const typ = fn === 'telem' ? labelOf(telemOpts(), r[`p${i}.telem`]) : fn === 'sensor' ? labelOf(sensorOpts(), r[`p${i}.sensor`]) : fn === 'periph' ? labelOf(periphOpts(), r[`p${i}.periph`]) : '';
  const head = fn === 'rx' ? t(K('chRx')) : fn === 'telem' ? `${t(K('chTelem'))} ${typ}` : typ;
  return { cls: bad ? 'bad' : fn, text: `${name} ${head}${msp ? ' + MSP' : ''}` };
}

function boardSvg(bf: BfData, r: Draft): string {
  const all = bf.serial?.ports ?? [];
  const ports = all.map((p, i) => ({ p, i })).filter((x) => x.p.id !== 20);
  const bx = 360;
  const by = 24;
  const bw = 220;
  const rightN = Math.ceil(ports.length / 2);
  const side = (list: typeof ports, right: boolean) => {
    const sp = Math.min(44, 160 / Math.max(list.length, 1));
    return list
      .map(({ p, i }, k) => {
        const y = by + bw / 2 + (k - (list.length - 1) / 2) * sp;
        const lb = boardLabel(r, i, D.serialPortName(p.id), !!dupOf(r, i, all.length));
        const px = right ? bx + bw - 26 : bx + 18;
        const edge = right ? bx + bw + 36 : bx - 36;
        const tx = right ? edge + 8 : edge - 8;
        const from = right ? px + 11 : px - 3;
        // invisible hit area over the pad, its lead and its label (a click picks the port in Basic mode)
        const hx = right ? px - 6 : edge - 150;
        return `<g class="pt-pad pt-c-${lb.cls}" data-pad="${i}"><rect class="pt-hit" x="${hx}" y="${y - 16}" width="${right ? edge + 150 - hx : px + 14 - hx}" height="32" fill="transparent"/><line class="pt-lead" x1="${from}" y1="${y}" x2="${edge}" y2="${y}"/><rect class="pt-frame" x="${px - 3}" y="${y - 13}" width="14" height="26"/><rect class="pt-pin" x="${px}" y="${y - 10}" width="8" height="8"/><rect class="pt-pin" x="${px}" y="${y + 2}" width="8" height="8"/><text class="pt-lbl" x="${tx}" y="${y + 4}" text-anchor="${right ? 'start' : 'end'}">${escapeHtml(lb.text)}</text></g>`;
      })
      .join('');
  };
  const holes = [[bx + 18, by + 18], [bx + bw - 18, by + 18], [bx + 18, by + bw - 18], [bx + bw - 18, by + bw - 18]].map(([x, y]) => `<circle class="pt-hole" cx="${x}" cy="${y}" r="7"/>`).join('');
  const cx = bx + bw / 2;
  const cy = by + bw / 2;
  const ticks = Array.from({ length: 8 }, (_, k) => {
    const o = -26 + k * 7.4;
    return `M${cx + o} ${cy - 40}v8M${cx + o} ${cy + 32}v8M${cx - 40} ${cy + o}h8M${cx + 32} ${cy + o}h8`;
  }).join('');
  const traces = `M${cx - 40} ${cy - 12}H${bx + 58}V${by + 70}M${cx + 40} ${cy + 8}H${bx + bw - 60}V${by + bw - 70}M${cx - 12} ${cy + 40}V${by + bw - 40}H${bx + 70}M${cx + 12} ${cy - 40}V${by + 34}H${bx + bw - 80}`;
  return `<svg class="pt-svg" viewBox="150 0 640 ${bw + by * 2 + 16}" role="img" aria-label="${escapeHtml(t(K('boardAria')))}"><rect class="pt-board-bg" x="${bx}" y="${by}" width="${bw}" height="${bw}"/><path class="pt-trace" d="${traces}"/>${holes}<rect class="pt-usbc" x="${cx - 22}" y="${by + bw - 4}" width="44" height="14"/><text class="pt-usbt" x="${cx}" y="${by + bw + 26}" text-anchor="middle">USB</text><rect class="pt-mcu" x="${cx - 32}" y="${cy - 32}" width="64" height="64"/><path class="pt-ticks" d="${ticks}"/><circle class="pt-dot" cx="${cx - 24}" cy="${cy - 24}" r="2.5"/>${side(ports.slice(0, rightN), true)}${side(ports.slice(rightN), false)}</svg>`;
}

function boardBody(bf: BfData, r: Draft): string {
  const leg = (c: string, k: string) => `<span class="pt-key pt-c-${c}"><i></i>${escapeHtml(t(K(k)))}</span>`;
  return `<div class="pt-screen pt-boardbox">${boardSvg(bf, r)}<div class="pt-legend">${leg('rx', 'chRx')}${leg('msp', 'legMsp')}${leg('telem', 'chTelem')}${leg('sensor', 'chSensor')}${leg('periph', 'chPeriph')}${leg('off', 'fnUnused')}</div></div>`;
}

function rowHtml(f: Record<string, FieldDef>, bf: BfData, i: number, r: Draft, b: Draft): string {
  const ports = bf.serial?.ports ?? [];
  const p = ports[i] as D.SerialPortCfg;
  const name = escapeHtml(D.serialPortName(p.id));
  if (p.id === 20) return `<div class="pt-row pt-usbrow"><div class="pt-name mono">${name}</div><div class="pt-usbnote">${escapeHtml(t(K('usbNote')))}</div></div>`;
  const dup = dupOf(r, i, ports.length);
  const changed = Object.keys(b).some((k) => k.startsWith(`p${i}.`) && r[k] !== b[k]);
  const sw = (field: string, label: string) => bareHtml(f[field]!, r, b).replace('<input ', `<input aria-label="${escapeHtml(label)} ${name}" `);
  const sel = (field: string, label: string) => bareHtml(f[field]!, r, b).replace('<select ', `<select aria-label="${escapeHtml(label)} ${name}" `);
  const baud = (field: string, label: string) => bareHtml({ ...f[field]!, label }, r, b).replace('<select ', `<select aria-label="${escapeHtml(label)} ${name}" `);
  const msp = !!r[`p${i}.msp`];
  const cells = [
    `<div class="pt-cell pt-c-msp" data-col="${escapeHtml(t(K('colMsp')))}"><div class="pt-line">${sw('msp', 'MSP')}${msp ? baud('mspBaud', t(K('baud'))) : ''}</div></div>`,
    `<div class="pt-cell pt-c-rx" data-col="${escapeHtml(t(K('colRx')))}"><div class="pt-line">${sw('rx', t(K('colRx')))}</div></div>`,
    `<div class="pt-cell" data-col="${escapeHtml(t(K('colTelem')))}"><div class="pt-line">${sel('telem', t(K('colTelem')))}</div>${r[`p${i}.telem`] ? `<div class="pt-line">${baud('telemBaud', t(K('baud')))}</div>` : ''}</div>`,
    `<div class="pt-cell" data-col="${escapeHtml(t(K('colSensor')))}"><div class="pt-line">${sel('sensor', t(K('colSensor')))}</div>${r[`p${i}.sensor`] === F.GPS ? `<div class="pt-line">${baud('sensorBaud', t(K('baud')))}</div>` : ''}</div>`,
    `<div class="pt-cell" data-col="${escapeHtml(t(K('colPeriph')))}"><div class="pt-line">${sel('periph', t(K('colPeriph')))}</div>${r[`p${i}.periph`] === F.BLACKBOX ? `<div class="pt-line">${baud('periphBaud', t(K('baud')))}</div>` : ''}</div>`,
  ].join('');
  return `<div class="pt-row${dup ? ' bad' : ''}${changed ? ' chg' : ''}" data-port="${i}"><div class="pt-name mono">${name}</div>${cells}${dup ? `<div class="pt-msg" role="alert">${escapeHtml(dup)}</div>` : ''}</div>`;
}

function groups(bf: BfData, draft: Draft): Group[] {
  const ports = bf.serial?.ports ?? [];
  const all: FieldDef[] = [];
  const fieldsOf = ports.map((p, i) => {
    const f = portFields(i);
    if (p.id !== 20) all.push(...Object.values(f));
    return f;
  });
  const hint = ports.some((_, i) => draft[`p${i}.rx`]) && bf.features !== null && !D.hasFeature(bf.features, D.FEATURE.RX_SERIAL) ? t(K('featNote')) : '';
  const telemOff = ports.some((_, i) => draft[`p${i}.telem`]) && bf.features !== null && !D.hasFeature(bf.features, D.FEATURE.TELEMETRY) ? t(K('telemNote')) : '';
  const noMsp = !ports.some((_, i) => draft[`p${i}.msp`]);
  const th = (k: string, key: TipKey) => `<span>${escapeHtml(t(K(k)))} ${tip(key)}</span>`;
  return [
    {
      title: t(K('gPorts')),
      hint: t(K('gPortsHint')),
      wide: true,
      fields: all,
      render: (r, b) =>
        `<div class="pt-screen pt-list"><div class="pt-head"><span>${escapeHtml(t(K('colPort')))} ${tip('tips.ports.uart')}</span>${th('colMsp', 'tips.ports.msp')}${th('colRx', 'tips.ports.rx')}${th('colTelem', 'tips.ports.telem')}${th('colSensor', 'tips.ports.sensor')}${th('colPeriph', 'tips.ports.periph')}</div>` +
        ports.map((_, i) => rowHtml(fieldsOf[i]!, bf, i, r, b)).join('') +
        (noMsp ? `<p class="pt-note bad">${escapeHtml(t(K('errMsp')))}</p>` : '') +
        (hint ? `<p class="pt-note">${escapeHtml(hint)}</p>` : '') +
        (telemOff ? `<p class="pt-note">${escapeHtml(telemOff)}</p>` : '') +
        '</div>',
    },
    { title: t(K('boardTitle')), hint: t(K('boardHint')), wide: true, fields: [], render: (r) => boardBody(bf, r) },
  ];
}

function buildPorts(d: Draft, bf: BfData): D.SerialPortCfg[] {
  const base = toDraft(bf);
  const known = knownBits();
  return (bf.serial?.ports ?? []).map((p, i) => {
    const keys = Object.keys(base).filter((k) => k.startsWith(`p${i}.`));
    if (keys.every((k) => d[k] === base[k])) return p; // untouched port: send exactly what was read
    let mask = (p.mask & ~known) >>> 0;
    if (d[`p${i}.msp`]) mask |= F.MSP;
    if (d[`p${i}.rx`]) mask |= F.RX_SERIAL;
    mask |= Number(d[`p${i}.telem`]) | Number(d[`p${i}.sensor`]) | Number(d[`p${i}.periph`]);
    return { ...p, mask: mask >>> 0, mspBaud: Number(d[`p${i}.mspBaud`]), telemetryBaud: Number(d[`p${i}.telemBaud`]), gpsBaud: Number(d[`p${i}.sensorBaud`]), blackboxBaud: Number(d[`p${i}.periphBaud`]) };
  });
}

function toWrites(d: Draft, bf: BfData): MspWrite[] {
  if (!bf.serial) return [];
  const ports = buildPorts(d, bf);
  const w: MspWrite[] = [];
  const cfg: D.SerialConfig = { source: bf.serial.source, ports };
  w.push(bf.serial.source === 'v2' ? { code: C.COMMON_SET_SERIAL_CONFIG, label: 'COMMON_SET_SERIAL_CONFIG', payload: D.encodeSerialConfig(cfg) } : { code: C.SET_CF_SERIAL_CONFIG, label: 'SET_CF_SERIAL_CONFIG', payload: D.encodeSerialConfig(cfg) });
  if (bf.features !== null && ports.some((p) => (p.mask & F.RX_SERIAL) !== 0) && !D.hasFeature(bf.features, D.FEATURE.RX_SERIAL)) {
    let m = D.withFeature(bf.features, D.FEATURE.RX_SERIAL, true);
    for (const b of [D.FEATURE.RX_PPM, D.FEATURE.RX_PARALLEL_PWM, D.FEATURE.RX_MSP, D.FEATURE.RX_SPI]) m = D.withFeature(m, b, false);
    w.push({ code: C.SET_FEATURE_CONFIG, label: 'SET_FEATURE_CONFIG', payload: D.encodeFeatures(m) });
  }
  return w;
}

const spec: TabSpec = {
  id: 'ports',
  title: '',
  areas: ['serial', 'features'],
  ready: (bf) => !!bf.serial?.ports.length,
  toDraft,
  groups,
  toWrites,
  top: () => intro('tips.ports.intro'),
  needsReboot: () => true,
  dynamic: (k) => /\.(msp|telem|sensor|periph|rx)$/.test(k),
  validate: (d, bf) => {
    const ports = buildPorts(d, bf);
    if (!ports.some((p) => (p.mask & F.MSP) !== 0)) return t(K('errMsp'));
    for (const [bit, fn] of [[F.RX_SERIAL, 'fnRx'], [F.GPS, 'fnGps'], [F.ESC_SENSOR, 'fnEsc']] as const) {
      if (ports.filter((p) => (p.mask & bit) !== 0).length > 1) return t(K('errDup'), { fn: t(K(fn)) });
    }
    return null;
  },
};

/* ---------------- Basic mode: one question, "which port is the receiver on?" ---------------- */
// The draft is the full Expert draft plus `rxPort`; writes expand rxPort back into the per-port RX flags, so every
// other function on every port is sent exactly as it was read.
const SK = (k: string) => `simple.ports.${k}` as Key;

function toDraftBasic(bf: BfData): Draft {
  const d = toDraft(bf);
  d.rxPort = (bf.serial?.ports ?? []).findIndex((p, i) => p.id !== 20 && d[`p${i}.rx`]);
  return d;
}
function expand(d: Draft, bf: BfData): Draft {
  const out: Draft = { ...d };
  const base = toDraft(bf);
  const rx = Number(d.rxPort);
  (bf.serial?.ports ?? []).forEach((p, i) => {
    if (p.id === 20) return;
    out[`p${i}.rx`] = rx === i;
    // a serial receiver needs the UART to itself: moving it onto a port switches that port's other functions off
    if (rx === i && !base[`p${i}.rx`]) {
      out[`p${i}.msp`] = false;
      out[`p${i}.telem`] = 0;
      out[`p${i}.sensor`] = 0;
      out[`p${i}.periph`] = 0;
    }
  });
  delete out.rxPort;
  return out;
}
/** What else a port carries, in a few words: "VTX (DisplayPort)", "GPS", "MSP". */
function usesOf(d: Draft, i: number): string {
  const a: string[] = [];
  if (Number(d[`p${i}.periph`])) a.push(labelOf(periphOpts(), d[`p${i}.periph`]));
  if (Number(d[`p${i}.sensor`])) a.push(labelOf(sensorOpts(), d[`p${i}.sensor`]));
  if (Number(d[`p${i}.telem`])) a.push(labelOf(telemOpts(), d[`p${i}.telem`]));
  return a.join(', ');
}
function groupsBasic(bf: BfData, draft: Draft): Group[] {
  const ports = (bf.serial?.ports ?? []).map((p, i) => ({ p, i })).filter((x) => x.p.id !== 20);
  const field: FieldDef = {
    key: 'rxPort',
    type: 'select',
    label: t(SK('rxField')),
    options: [opt(-1, t(SK('rxNone'))), ...ports.map(({ p, i }) => opt(i, `${D.serialPortName(p.id)}${usesOf(draft, i) ? ` (${usesOf(draft, i)})` : ''}`))],
  };
  const none = Number(draft.rxPort) < 0;
  const base = toDraft(bf);
  const rx = Number(draft.rxPort);
  const replaced = rx >= 0 && !base[`p${rx}.rx`] ? [base[`p${rx}.msp`] ? 'MSP' : '', usesOf(base, rx)].filter(Boolean).join(', ') : '';
  const used = ports.filter(({ i }) => usesOf(draft, i));
  return [
    {
      title: t(SK('rxTitle')),
      fields: [field],
      render: (r, b) =>
        `<div class="ptb">${fieldHtml(field, r, b)}
          <p class="ptb-help">${escapeHtml(t(SK('rxHelp')))}</p>
          ${none ? `<p class="w-note warn">${escapeHtml(t(SK('rxMissing')))}</p>` : ''}
          ${replaced ? `<p class="w-note warn">${escapeHtml(t(SK('replaces'), { what: replaced }))}</p>` : ''}
          ${used.length ? `<p class="ptb-used">${escapeHtml(t(SK('others')))} ${used.map(({ p, i }) => `<b>${escapeHtml(D.serialPortName(p.id))}</b> ${escapeHtml(usesOf(r, i))}`).join(' · ')}</p>` : ''}
        </div>`,
    },
    { title: t(SK('boardTitle')), hint: t(SK('boardHint')), wide: true, fields: [], render: (r) => boardBody(bf, expand(r, bf)) },
  ];
}
const specBasic: TabSpec = {
  ...spec,
  toDraft: toDraftBasic,
  groups: groupsBasic,
  toWrites: (d, bf) => toWrites(expand(d, bf), bf),
  validate: (d, bf) => spec.validate!(expand(d, bf), bf),
  dynamic: (k) => k === 'rxPort',
  top: () => '',
};

export const mount: ScreenMount = (el, ctx) => {
  if (currentMode(ctx.settings) !== 'basic') return mountFormTab(el, ctx, { ...spec, title: t(K('title')) });
  const off = mountFormTab(el, ctx, { ...specBasic, title: t(SK('title')) });
  // a pad on the board picks that port for the receiver (same as choosing it in the list)
  const onClick = (e: Event) => {
    const pad = (e.target as Element).closest<SVGGElement>('[data-pad]');
    const sel = el.querySelector<HTMLSelectElement>('select[data-k="rxPort"]');
    if (!pad || !sel) return;
    sel.value = pad.dataset.pad ?? '-1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
  el.addEventListener('click', onClick);
  return () => {
    el.removeEventListener('click', onClick);
    off();
  };
};
