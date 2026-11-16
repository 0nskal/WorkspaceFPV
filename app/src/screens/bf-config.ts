/** Configuration tab: mixer/motor direction, board alignment, accelerometer trim, PID loop, features, beeper, arming, personalization. */
import { C, TEXT, API } from '../bf/codes';
import * as D from '../bf/decode';
import { mountFormTab, type Draft, type Group, type TabSpec } from '../bf/form';
import type { BfData, MspWrite } from '../bf/store';
import type { ScreenMount } from '../context';
import { t, type Key } from '../i18n';
import { protocolName } from '../fc/state';

/** Features shown here (receiver features belong to the Receiver tab). Order = display order. */
const FEATURES: Array<keyof typeof D.FEATURE> = ['MOTOR_STOP', 'AIRMODE', 'ANTI_GRAVITY', 'TELEMETRY', 'ESC_SENSOR', 'LED_STRIP', 'OSD', 'SOFTSERIAL', 'GPS', 'RANGEFINDER', 'THREE_D', 'TRANSPONDER', 'CHANNEL_FORWARDING', 'RSSI_ADC', 'INFLIGHT_ACC_CAL', 'DASHBOARD'];

/** Beeper conditions: [disabled-mask bit, name]. Bit = condition number - 1 (silence has no bit). */
const BEEPERS: Array<[number, string]> = [
  [0, 'GYRO_CALIBRATED'],
  [1, 'RX_LOST'],
  [2, 'RX_LOST_LANDING'],
  [3, 'DISARMING'],
  [4, 'ARMING'],
  [5, 'ARMING_GPS_FIX'],
  [6, 'BAT_CRIT_LOW'],
  [7, 'BAT_LOW'],
  [8, 'GPS_STATUS'],
  [9, 'RX_SET'],
  [10, 'ACC_CALIBRATION'],
  [11, 'ACC_CALIBRATION_FAIL'],
  [12, 'READY_BEEP'],
  [14, 'DISARM_REPEAT'],
  [15, 'ARMED'],
  [16, 'SYSTEM_INIT'],
  [17, 'USB'],
  [18, 'BLACKBOX_ERASE'],
  [19, 'CRASH_FLIP_MODE'],
  [20, 'CAM_CONNECTION_OPEN'],
  [21, 'CAM_CONNECTION_CLOSE'],
  [22, 'RC_SMOOTHING_INIT_FAIL'],
];

const K = (k: string) => `bfConfig.${k}` as Key;

function toDraft(bf: BfData): Draft {
  const d: Draft = {};
  if (bf.mixer) {
    d.mixer = bf.mixer.mixer;
    d.reversed = bf.mixer.reversed;
  }
  if (bf.boardAlign) {
    d.boardRoll = bf.boardAlign.roll;
    d.boardPitch = bf.boardAlign.pitch;
    d.boardYaw = bf.boardAlign.yaw;
  }
  if (bf.accTrim) {
    d.trimRoll = bf.accTrim.roll;
    d.trimPitch = bf.accTrim.pitch;
  }
  if (bf.advanced) d.pidDenom = bf.advanced.pidProcessDenom;
  if (bf.features !== null) for (const f of FEATURES) d[`f.${f}`] = D.hasFeature(bf.features, D.FEATURE[f]);
  if (bf.beeper) for (const [bit, name] of BEEPERS) d[`b.${name}`] = ((bf.beeper.disabledMask >>> bit) & 1) === 0;
  if (bf.arming) {
    d.autoDisarm = bf.arming.autoDisarmDelay;
    d.smallAngle = bf.arming.smallAngle;
    if (bf.arming.gyroCalOnFirstArm !== null) d.gyroCal = bf.arming.gyroCalOnFirstArm;
  }
  d.craft = bf.craftName;
  if (bf.api >= API.BF44) d.pilot = bf.pilotName;
  return d;
}

function groups(bf: BfData, draft: Draft): Group[] {
  const g: Group[] = [];
  if (bf.mixer) {
    g.push({
      title: t(K('gMixer')),
      fields: [
        { key: 'mixer', type: 'select', label: t(K('mixer')), tip: t(K('mixerTip')), options: D.MIXERS.map(([value, label]) => ({ value, label })) },
        { key: 'reversed', type: 'check', label: t(K('reversed')), tip: t(K('reversedTip')) },
        ...(bf.advanced ? [{ key: 'protocol', type: 'info' as const, label: t(K('protocol')), tip: t(K('protocolTip')), text: protocolName(bf.advanced.motorProtocol) }] : []),
      ],
    });
  }
  if (bf.boardAlign || bf.accTrim) {
    const f = [];
    if (bf.boardAlign) {
      f.push(
        { key: 'boardRoll', type: 'number' as const, label: t(K('boardRoll')), tip: t(K('boardTip')), unit: '°', min: -180, max: 360 },
        { key: 'boardPitch', type: 'number' as const, label: t(K('boardPitch')), unit: '°', min: -180, max: 360 },
        { key: 'boardYaw', type: 'number' as const, label: t(K('boardYaw')), unit: '°', min: -180, max: 360 },
      );
    }
    if (bf.accTrim) {
      f.push(
        { key: 'trimRoll', type: 'number' as const, label: t(K('trimRoll')), tip: t(K('trimTip')), unit: '0.1°', min: -300, max: 300 },
        { key: 'trimPitch', type: 'number' as const, label: t(K('trimPitch')), unit: '0.1°', min: -300, max: 300 },
      );
    }
    g.push({ title: t(K('gAlign')), hint: t(K('gAlignHint')), fields: f });
  }
  if (bf.advanced) {
    const rate = bf.board?.gyroRateHz || 0;
    const sync = bf.advanced.gyroSyncDenom || 1;
    const denoms = [1, 2, 3, 4, 6, 8];
    const cur = Number(draft.pidDenom ?? bf.advanced.pidProcessDenom);
    if (!denoms.includes(cur) && cur > 0) denoms.push(cur);
    denoms.sort((a, b) => a - b);
    const label = (n: number) => (rate ? t(K('pidOpt'), { khz: (rate / sync / n / 1000).toFixed(2).replace(/\.?0+$/, ''), n }) : `÷ ${n}`);
    g.push({
      title: t(K('gLoop')),
      fields: [
        ...(rate ? [{ key: 'gyroRate', type: 'info' as const, label: t(K('gyroRate')), text: `${(rate / 1000).toFixed(rate % 1000 ? 2 : 0)} kHz` }] : []),
        { key: 'pidDenom', type: 'select', label: t(K('pidLoop')), tip: t(K('pidLoopTip')), options: denoms.map((value) => ({ value, label: label(value) })) },
      ],
    });
  }
  if (bf.features !== null) {
    g.push({
      title: t(K('gFeatures')),
      hint: t(K('gFeaturesHint')),
      wide: true,
      fields: FEATURES.map((f) => ({ key: `f.${f}`, type: 'check' as const, label: t(K(`features.${f}`)), tip: t(K(`featureTips.${f}`)) })),
    });
  }
  if (bf.beeper) {
    g.push({
      title: t(K('gBeeper')),
      hint: t(K('gBeeperHint')),
      wide: true,
      fields: BEEPERS.map(([, name]) => ({ key: `b.${name}`, type: 'check' as const, label: t(K(`beeper.${name}`)) })),
    });
  }
  if (bf.arming) {
    g.push({
      title: t(K('gArming')),
      fields: [
        { key: 'autoDisarm', type: 'number', label: t(K('autoDisarm')), tip: t(K('autoDisarmTip')), unit: 's', min: 0, max: 60 },
        { key: 'smallAngle', type: 'number', label: t(K('smallAngle')), tip: t(K('smallAngleTip')), unit: '°', min: 0, max: 180 },
        ...(bf.arming.gyroCalOnFirstArm !== null ? [{ key: 'gyroCal', type: 'check' as const, label: t(K('gyroCal')), tip: t(K('gyroCalTip')) }] : []),
      ],
    });
  }
  g.push({
    title: t(K('gPers')),
    fields: [
      { key: 'craft', type: 'text', label: t(K('craft')), tip: t(K('craftTip')), maxLen: 16 },
      ...(bf.api >= API.BF44 ? [{ key: 'pilot', type: 'text' as const, label: t(K('pilot')), tip: t(K('pilotTip')), maxLen: 16 }] : []),
    ],
  });
  return g;
}

const sameKeys = (a: Draft, b: Draft, keys: (k: string) => boolean) => Object.keys(a).filter(keys).every((k) => a[k] === b[k]);
const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '?');

function toWrites(draft: Draft, bf: BfData): MspWrite[] {
  const base = toDraft(bf);
  const w: MspWrite[] = [];
  const only = (...ks: string[]) => sameKeys(draft, base, (k) => ks.includes(k));
  if (bf.mixer && !only('mixer', 'reversed')) w.push({ code: C.SET_MIXER_CONFIG, label: 'SET_MIXER_CONFIG', payload: D.encodeMixer({ mixer: Number(draft.mixer), reversed: !!draft.reversed }, bf.raw.get('mixer')) });
  if (bf.boardAlign && !only('boardRoll', 'boardPitch', 'boardYaw')) {
    w.push({ code: C.SET_BOARD_ALIGNMENT_CONFIG, label: 'SET_BOARD_ALIGNMENT_CONFIG', payload: D.encodeBoardAlignment({ roll: Number(draft.boardRoll), pitch: Number(draft.boardPitch), yaw: Number(draft.boardYaw) }, bf.raw.get('boardAlign')) });
  }
  if (bf.accTrim && !only('trimRoll', 'trimPitch')) w.push({ code: C.SET_ACC_TRIM, label: 'SET_ACC_TRIM', payload: D.encodeAccTrim({ roll: Number(draft.trimRoll), pitch: Number(draft.trimPitch) }) });
  if (bf.advanced && !only('pidDenom')) w.push({ code: C.SET_ADVANCED_CONFIG, label: 'SET_ADVANCED_CONFIG', payload: D.encodeAdvanced({ pidProcessDenom: Number(draft.pidDenom) }, bf.raw.get('advanced')) });
  if (bf.features !== null && !sameKeys(draft, base, (k) => k.startsWith('f.'))) {
    let mask = bf.features;
    for (const f of FEATURES) mask = D.withFeature(mask, D.FEATURE[f], !!draft[`f.${f}`]);
    w.push({ code: C.SET_FEATURE_CONFIG, label: 'SET_FEATURE_CONFIG', payload: D.encodeFeatures(mask) });
  }
  if (bf.beeper && !sameKeys(draft, base, (k) => k.startsWith('b.'))) {
    let mask = bf.beeper.disabledMask >>> 0;
    for (const [bit, name] of BEEPERS) mask = draft[`b.${name}`] ? (mask & ~(1 << bit)) >>> 0 : (mask | (1 << bit)) >>> 0;
    w.push({ code: C.SET_BEEPER_CONFIG, label: 'SET_BEEPER_CONFIG', payload: D.encodeBeeper({ disabledMask: mask, dshotBeaconTone: bf.beeper.dshotBeaconTone }, bf.raw.get('beeper')) });
  }
  if (bf.arming && !only('autoDisarm', 'smallAngle', 'gyroCal')) {
    w.push({ code: C.SET_ARMING_CONFIG, label: 'SET_ARMING_CONFIG', payload: D.encodeArming({ autoDisarmDelay: Number(draft.autoDisarm), smallAngle: Number(draft.smallAngle), gyroCalOnFirstArm: bf.arming.gyroCalOnFirstArm === null ? null : !!draft.gyroCal }, bf.raw.get('arming')) });
  }
  const textW = (type: number, text: string, label: string): MspWrite => ({ code: C.SET_TEXT, label, payload: D.encodeText(type, ascii(text).slice(0, 16)) });
  if (!only('craft')) {
    w.push(bf.api >= API.BF44 ? textW(TEXT.CRAFT, String(draft.craft), 'SET_TEXT craft') : { code: C.SET_NAME, label: 'SET_NAME', payload: Uint8Array.from([...ascii(String(draft.craft)).slice(0, 16)].map((c) => c.charCodeAt(0))) });
  }
  if (bf.api >= API.BF44 && !only('pilot')) w.push(textW(TEXT.PILOT, String(draft.pilot), 'SET_TEXT pilot'));
  return w;
}

const spec: TabSpec = {
  id: 'config',
  title: '',
  areas: ['mixer', 'alignment', 'advanced', 'features', 'beeper', 'arming', 'names', 'sensors'],
  ready: (bf) => !!(bf.mixer || bf.features !== null || bf.arming || bf.advanced),
  toDraft,
  groups,
  toWrites,
  needsReboot: (changed) => changed.some((k) => k === 'mixer' || k === 'reversed' || k === 'pidDenom' || k.startsWith('f.')),
};

export const mount: ScreenMount = (el, ctx) => mountFormTab(el, ctx, { ...spec, title: t(K('title')) });
