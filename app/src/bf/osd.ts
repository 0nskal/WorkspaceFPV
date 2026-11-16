/**
 * OSD: pure MSP decoders/encoders (design/BETAFLIGHT-PARITY.md 3.9). No DOM, no I/O.
 * The config is parsed by the embedded counts (items, stats, timers, warnings), never by a fixed table, so unknown
 * newer items are kept (and written back untouched) instead of misparsing the rest of the payload.
 */

export const MSPO = {
  OSD_CONFIG: 84,
  SET_OSD_CONFIG: 85,
  OSD_CANVAS: 189,
  EEPROM_WRITE: 250,
} as const;

const dvOf = (p: Uint8Array) => new DataView(p.buffer, p.byteOffset, p.byteLength);

export type VideoSystem = 0 | 1 | 2 | 3; // auto, PAL, NTSC, HD
export interface OsdGrid {
  cols: number;
  rows: number;
}
/** Character grid per video system. HD uses the canvas reported by MSP_OSD_CANVAS (default 53 x 20). */
export function gridFor(video: number, canvas?: OsdGrid | null): OsdGrid {
  if (video === 3) return canvas && canvas.cols > 0 && canvas.rows > 0 ? canvas : { cols: 53, rows: 20 };
  if (video === 2) return { cols: 30, rows: 13 };
  return { cols: 30, rows: 16 };
}
export const decodeCanvas = (p: Uint8Array): OsdGrid | null => (p.length >= 2 && p[0]! > 0 && p[1]! > 0 ? { cols: p[0]!, rows: p[1]! } : null);

export interface OsdConfig {
  flags: number;
  video: number;
  /** 0 imperial, 1 metric. */
  units: number;
  rssiAlarm: number;
  capAlarm: number;
  altAlarm: number;
  /** Raw position words, one per item (visibility flags for profiles 1-3 in bits 11-13). */
  items: number[];
  stats: number[];
  timers: number[];
  warnings: number;
  warningCount: number;
  profileCount: number;
  profile: number;
  overlay: number;
  camW: number;
  camH: number;
  /** Link quality alarm (API >= 1.46), null when absent. */
  lqAlarm: number | null;
}

/** Hardware flags of MSP_OSD_CONFIG. */
export const OSD_FLAG = { supported: 1, frsky: 8, max7456: 16, detected: 32, displayport: 64 } as const;

export function decodeOsdConfig(p: Uint8Array): OsdConfig | null {
  if (p.length < 12) return null;
  const dv = dvOf(p);
  let o = 0;
  const u8 = () => p[o++] ?? 0;
  const u16 = () => {
    const v = o + 2 <= p.length ? dv.getUint16(o, true) : 0;
    o += 2;
    return v;
  };
  const u32 = () => {
    const v = o + 4 <= p.length ? dv.getUint32(o, true) : 0;
    o += 4;
    return v;
  };
  const flags = u8();
  const video = u8();
  const units = u8();
  const rssiAlarm = u8();
  const capAlarm = u16();
  u8(); // old timer alarm
  const itemCount = u8();
  const altAlarm = u16();
  const items: number[] = [];
  for (let i = 0; i < itemCount; i++) items.push(u16());
  const statCount = u8();
  const stats: number[] = [];
  for (let i = 0; i < statCount; i++) stats.push(u8());
  const timerCount = u8();
  const timers: number[] = [];
  for (let i = 0; i < timerCount; i++) timers.push(u16());
  let warnings = u16();
  const warningCount = u8();
  if (o + 4 <= p.length) warnings = u32();
  else o += 4;
  const profileCount = u8();
  const profile = u8();
  const overlay = u8();
  const camW = u8();
  const camH = u8();
  const lqAlarm = o + 2 <= p.length ? u16() : null;
  return { flags, video, units, rssiAlarm, capAlarm, altAlarm, items, stats, timers, warnings, warningCount, profileCount, profile, overlay, camW, camH, lqAlarm };
}

/** Inverse of decodeOsdConfig (used by the demo FC and the tests). */
export function encodeOsdConfig(c: OsdConfig): Uint8Array {
  const size = 1 + 3 + 2 + 1 + 1 + 2 + c.items.length * 2 + 1 + c.stats.length + 1 + c.timers.length * 2 + 2 + 1 + 4 + 5 + (c.lqAlarm === null ? 0 : 2);
  const o = new Uint8Array(size);
  const dv = dvOf(o);
  let p = 0;
  o[p++] = c.flags;
  o[p++] = c.video;
  o[p++] = c.units;
  o[p++] = c.rssiAlarm;
  dv.setUint16(p, c.capAlarm, true);
  p += 2;
  o[p++] = 0;
  o[p++] = c.items.length;
  dv.setUint16(p, c.altAlarm, true);
  p += 2;
  for (const w of c.items) {
    dv.setUint16(p, w, true);
    p += 2;
  }
  o[p++] = c.stats.length;
  for (const s of c.stats) o[p++] = s;
  o[p++] = c.timers.length;
  for (const tm of c.timers) {
    dv.setUint16(p, tm, true);
    p += 2;
  }
  dv.setUint16(p, c.warnings & 0xffff, true);
  p += 2;
  o[p++] = c.warningCount;
  dv.setUint32(p, c.warnings >>> 0, true);
  p += 4;
  o[p++] = c.profileCount;
  o[p++] = c.profile;
  o[p++] = c.overlay;
  o[p++] = c.camW;
  o[p++] = c.camH;
  if (c.lqAlarm !== null) {
    dv.setUint16(p, c.lqAlarm, true);
    p += 2;
  }
  return o;
}

/* ---------------- position words ---------------- */
export interface ItemPos {
  x: number;
  y: number;
  /** Visible in profile 1, 2, 3. */
  vis: [boolean, boolean, boolean];
  /** Bits 14-15, preserved on write. */
  type: number;
}
export function decodePos(w: number): ItemPos {
  return {
    x: (w & 0x1f) | (((w >> 10) & 1) << 5),
    y: (w >> 5) & 0x1f,
    vis: [(w & 0x0800) !== 0, (w & 0x1000) !== 0, (w & 0x2000) !== 0],
    type: (w >> 14) & 3,
  };
}
export function encodePos(p: ItemPos): number {
  return (p.x & 0x1f) | ((p.y & 0x1f) << 5) | (((p.x >> 5) & 1) << 10) | (p.vis[0] ? 0x0800 : 0) | (p.vis[1] ? 0x1000 : 0) | (p.vis[2] ? 0x2000 : 0) | ((p.type & 3) << 14);
}

/* ---------------- SET encoders ---------------- */
/** Item position: [index, u16 word]. */
export function encodeSetItem(index: number, word: number): Uint8Array {
  return Uint8Array.from([index, word & 0xff, (word >> 8) & 0xff]);
}
/** Post-flight stat toggle: [index, u16 enabled, u8 screen = 0]. */
export function encodeSetStat(index: number, enabled: boolean): Uint8Array {
  return Uint8Array.from([index, enabled ? 1 : 0, 0, 0]);
}
/** General settings (first byte 0xFF). Includes the optional trailing block, so every field is written back. */
export function encodeSetGeneral(c: OsdConfig): Uint8Array {
  const o = new Uint8Array(1 + 1 + 1 + 1 + 2 + 2 + 2 + 2 + 4 + 4 + (c.lqAlarm === null ? 0 : 2));
  const dv = dvOf(o);
  let p = 0;
  o[p++] = 0xff;
  o[p++] = c.video;
  o[p++] = c.units;
  o[p++] = c.rssiAlarm;
  dv.setUint16(p, c.capAlarm, true);
  p += 2;
  dv.setUint16(p, 0, true);
  p += 2;
  dv.setUint16(p, c.altAlarm, true);
  p += 2;
  dv.setUint16(p, c.warnings & 0xffff, true);
  p += 2;
  dv.setUint32(p, c.warnings >>> 0, true);
  p += 4;
  o[p++] = c.profile;
  o[p++] = c.overlay;
  o[p++] = c.camW;
  o[p++] = c.camH;
  if (c.lqAlarm !== null) dv.setUint16(p, c.lqAlarm, true);
  return o;
}

/** Ordered list of SET payloads that turn `from` into `to` (only what changed). */
export function diffOsd(from: OsdConfig, to: OsdConfig): Uint8Array[] {
  const out: Uint8Array[] = [];
  to.items.forEach((w, i) => {
    if (w !== from.items[i]) out.push(encodeSetItem(i, w));
  });
  to.stats.forEach((s, i) => {
    if (s !== from.stats[i]) out.push(encodeSetStat(i, s !== 0));
  });
  const g = (c: OsdConfig) => [c.video, c.units, c.rssiAlarm, c.capAlarm, c.altAlarm, c.warnings, c.profile, c.overlay, c.camW, c.camH, c.lqAlarm].join();
  if (g(from) !== g(to)) out.push(encodeSetGeneral(to));
  return out;
}

/* ---------------- name tables (append-only enums from osd.h, BF 4.3 .. 4.5; unknown index -> "Item N") ---------------- */
/** key = i18n key suffix, sample = text drawn in the preview. */
export const OSD_ITEMS: ReadonlyArray<{ key: string; sample: string }> = [
  { key: 'rssi', sample: '● 87' },
  { key: 'battVoltage', sample: '▓ 24.9V' },
  { key: 'crosshairs', sample: '•' },
  { key: 'horizon', sample: '- - - - - -' },
  { key: 'horizonSidebars', sample: '|   |' },
  { key: 'timer1', sample: 'T 02:41' },
  { key: 'timer2', sample: 'F 03:12' },
  { key: 'flymode', sample: 'ANGL' },
  { key: 'craftName', sample: 'FREESTYLE' },
  { key: 'throttle', sample: 'T 62%' },
  { key: 'vtxChannel', sample: 'R:1:25' },
  { key: 'current', sample: '14.2A' },
  { key: 'mah', sample: '812⧨' },
  { key: 'gpsSpeed', sample: '48 kmh' },
  { key: 'gpsSats', sample: 'SAT 11' },
  { key: 'altitude', sample: '12.4m' },
  { key: 'rollPids', sample: 'ROL 48 82 38' },
  { key: 'pitchPids', sample: 'PIT 52 88 42' },
  { key: 'yawPids', sample: 'YAW 45 90 3' },
  { key: 'power', sample: '350W' },
  { key: 'pidRateProfile', sample: '1-1' },
  { key: 'warnings', sample: 'LOW BATTERY' },
  { key: 'avgCell', sample: '4.15V' },
  { key: 'gpsLon', sample: 'E018.5420' },
  { key: 'gpsLat', sample: 'N54.5189' },
  { key: 'debug', sample: 'DBG 0 0 0 0' },
  { key: 'pitchAngle', sample: 'P-04.2' },
  { key: 'rollAngle', sample: 'R+01.1' },
  { key: 'battUsage', sample: '▓▓▓░' },
  { key: 'disarmed', sample: 'DISARMED' },
  { key: 'homeDir', sample: '↑' },
  { key: 'homeDist', sample: '124m' },
  { key: 'heading', sample: '270' },
  { key: 'vario', sample: '0.0' },
  { key: 'compass', sample: '── N ──' },
  { key: 'escTemp', sample: '41°C' },
  { key: 'escRpm', sample: '24800' },
  { key: 'remainingTime', sample: '04:10' },
  { key: 'rtc', sample: '16:32' },
  { key: 'adjustment', sample: 'RC RATE 1.2' },
  { key: 'coreTemp', sample: '38°C' },
  { key: 'antiGravity', sample: 'AG' },
  { key: 'gForce', sample: '1.0G' },
  { key: 'motorDiag', sample: '▓▓▓▓' },
  { key: 'logStatus', sample: 'REC 3' },
  { key: 'flipArrow', sample: '↻' },
  { key: 'linkQuality', sample: 'LQ 100' },
  { key: 'flightDist', sample: '1.2km' },
  { key: 'stickLeft', sample: '+' },
  { key: 'stickRight', sample: '+' },
  { key: 'displayName', sample: 'PILOT' },
  { key: 'escRpmFreq', sample: '413' },
  { key: 'rateProfileName', sample: 'FREESTYLE' },
  { key: 'pidProfileName', sample: 'BASE' },
  { key: 'profileName', sample: 'PROFILE' },
  { key: 'rssiDbm', sample: '-62dBm' },
  { key: 'rcChannels', sample: 'CH 1500' },
  { key: 'cameraFrame', sample: '┌ ┐' },
  { key: 'efficiency', sample: '5.1' },
  { key: 'totalFlights', sample: 'TFL 31' },
  { key: 'upDownRef', sample: '──' },
  { key: 'txUplinkPower', sample: '100mW' },
];

export const OSD_STATS: ReadonlyArray<string> = ['rtcDateTime', 'timer1', 'timer2', 'maxSpeed', 'maxDistance', 'minBattery', 'endBattery', 'battery', 'minRssi', 'maxCurrent', 'usedMah', 'maxAltitude', 'blackbox', 'blackboxNumber', 'maxGForce', 'maxEscTemp', 'maxEscRpm', 'minLinkQuality', 'flightDistance', 'maxFft', 'totalFlights', 'totalTime', 'totalDist', 'minRssiDbm', 'minRsnr'];

/** Bit index -> key in the enabled-warnings mask. */
export const OSD_WARNINGS: ReadonlyArray<string> = ['armingDisabled', 'batteryNotFull', 'batteryWarning', 'batteryCritical', 'visualBeeper', 'crashFlip', 'escFail', 'coreTemp', 'rcSmoothing', 'failsafe', 'launchControl', 'gpsRescueUnavailable', 'gpsRescueDisabled', 'rssi', 'linkQuality', 'rssiDbm', 'overCap', 'rsnr'];
