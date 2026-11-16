/** Ports tab: UART table (MSP, serial RX, telemetry, sensors, peripherals) with baud rates; writes MSP2_COMMON_SET_SERIAL_CONFIG. */
import { C } from '../bf/codes';
import * as D from '../bf/decode';
import { bareHtml, mountFormTab, type Draft, type FieldDef, type Group, type TabSpec } from '../bf/form';
import type { BfData, MspWrite } from '../bf/store';
import type { ScreenMount } from '../context';
import { t, type Key } from '../i18n';
import { escapeHtml } from '../ui/dom';

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

function groups(bf: BfData, draft: Draft): Group[] {
  const ports = bf.serial?.ports ?? [];
  const all: FieldDef[] = [];
  const rows = ports.map((p, i) => {
    const f = portFields(i);
    const usb = p.id === 20;
    const fl = usb ? [] : Object.values(f);
    all.push(...(usb ? [] : fl));
    const cell = (main: FieldDef, baud?: FieldDef, showBaud = true) => (r: Draft, b: Draft) => `<td>${bareHtml(main, r, b)}${baud && showBaud ? bareHtml(baud, r, b) : ''}</td>`;
    const cells = usb
      ? `<td class="bf-pt-usb" colspan="5"><span class="mono">${escapeHtml(t(K('usbNote')))}</span></td>`
      : [
          (r: Draft, b: Draft) => `<td>${bareHtml(f.msp!, r, b)}${r[`p${i}.msp`] ? bareHtml(f.mspBaud!, r, b) : ''}</td>`,
          cell(f.rx!),
          (r: Draft, b: Draft) => `<td>${bareHtml(f.telem!, r, b)}${r[`p${i}.telem`] ? bareHtml(f.telemBaud!, r, b) : ''}</td>`,
          (r: Draft, b: Draft) => `<td>${bareHtml(f.sensor!, r, b)}${r[`p${i}.sensor`] === F.GPS ? bareHtml(f.sensorBaud!, r, b) : ''}</td>`,
          (r: Draft, b: Draft) => `<td>${bareHtml(f.periph!, r, b)}${r[`p${i}.periph`] === F.BLACKBOX ? bareHtml(f.periphBaud!, r, b) : ''}</td>`,
        ];
    return (r: Draft, b: Draft) => `<tr><th class="mono" scope="row">${escapeHtml(D.serialPortName(p.id))}</th>${typeof cells === 'string' ? cells : cells.map((c) => c(r, b)).join('')}</tr>`;
  });
  const hint = ports.some((_, i) => draft[`p${i}.rx`]) && bf.features !== null && !D.hasFeature(bf.features, D.FEATURE.RX_SERIAL) ? t(K('featNote')) : '';
  const telemOff = ports.some((_, i) => draft[`p${i}.telem`]) && bf.features !== null && !D.hasFeature(bf.features, D.FEATURE.TELEMETRY) ? t(K('telemNote')) : '';
  return [
    {
      title: t(K('gPorts')),
      hint: t(K('gPortsHint')),
      wide: true,
      fields: all,
      render: (r, b) => `<table class="bf-ports"><thead><tr><th>${escapeHtml(t(K('colPort')))}</th><th>${escapeHtml(t(K('colMsp')))}</th><th>${escapeHtml(t(K('colRx')))}</th><th>${escapeHtml(t(K('colTelem')))}</th><th>${escapeHtml(t(K('colSensor')))}</th><th>${escapeHtml(t(K('colPeriph')))}</th></tr></thead><tbody>${rows.map((row) => row(r, b)).join('')}</tbody></table>${hint ? `<p class="bf-note">${escapeHtml(hint)}</p>` : ''}${telemOff ? `<p class="bf-note">${escapeHtml(telemOff)}</p>` : ''}`,
    },
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

export const mount: ScreenMount = (el, ctx) => mountFormTab(el, ctx, { ...spec, title: t(K('title')) });
