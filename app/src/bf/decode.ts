/**
 * Typed decoders/encoders for the core MSP commands (identification, status, setup, ports, power, failsafe).
 * Rules (spec section 10): decoders never throw on short or long payloads and gate optional fields on the API minor
 * version; encoders are read-modify-write: they start from the fresh raw payload and patch only the known fields,
 * so legacy/reserved bytes round-trip untouched.
 */
import { Rd, Wr, patchBase } from './codec';
import { API } from './codes';

/* ---------------- identification ---------------- */

export interface BoardInfo {
  boardId: string;
  hwRevision: number;
  /** 0 = FC, 2 = FC with MAX7456 OSD chip. */
  boardType: number;
  /** Bitmask: 0 VCP, 1 softserial, 2 unified target, 3 flash bootloader, 4 supports custom defaults, 5 has custom defaults, 6 supports RX bind. */
  capabilities: number;
  targetName: string;
  boardName: string;
  manufacturer: string;
  mcuTypeId: number;
  /** 0 bare defaults, 1 custom defaults, 2 configured (API >= 1.42). */
  configState: number;
  /** Gyro sample rate in Hz (API >= 1.43), 0 when unknown. */
  gyroRateHz: number;
  /** Bit 0: ACC needs calibration, bit 1: motor protocol disabled. */
  problems: number;
}

export const CAP = { VCP: 1, SOFTSERIAL: 2, UNIFIED: 4, FLASH_BOOTLOADER: 8, SUPPORTS_CUSTOM_DEFAULTS: 16, HAS_CUSTOM_DEFAULTS: 32, SUPPORTS_BIND: 64 } as const;

export function decodeApiVersion(p: Uint8Array): { major: number; minor: number } {
  return { major: p[1] ?? 0, minor: p[2] ?? 0 };
}

/** Text of MSP_FC_VERSION: "4.5.1" or, for calendar versions (first byte >= 10), the human string or "2026.6.1". */
export function decodeFcVersion(p: Uint8Array): string {
  const r = new Rd(p);
  const a = r.u8();
  const b = r.u8();
  const c = r.u8();
  if (a >= 10) {
    const human = r.left > 0 ? r.pstr() : '';
    return human || `${2000 + a}.${b}.${c}`;
  }
  return `${a}.${b}.${c}`;
}

export interface BuildInfo {
  date: string;
  time: string;
  hash: string;
  /** Build-option ids (API >= 1.46); names need the cloud build API, so we only keep the ids. */
  options: number[];
}

export function decodeBuildInfo(p: Uint8Array, apiMinor: number): BuildInfo {
  const r = new Rd(p);
  const out: BuildInfo = { date: r.str(11), time: r.str(8), hash: r.str(7), options: [] };
  if (apiMinor >= API.BF45) {
    while (r.has(2)) {
      const id = r.u16();
      if (id === 0) break;
      out.options.push(id);
    }
  }
  return out;
}

export function decodeBoardInfo(p: Uint8Array, apiMinor: number): BoardInfo {
  const r = new Rd(p);
  const boardId = r.str(4);
  const hwRevision = r.u16();
  const boardType = r.u8();
  const capabilities = r.u8();
  const targetName = r.pstr();
  const boardName = r.pstr();
  const manufacturer = r.pstr();
  r.skip(32); // signature
  const mcuTypeId = r.u8();
  const out: BoardInfo = { boardId, hwRevision, boardType, capabilities, targetName, boardName, manufacturer, mcuTypeId, configState: 0, gyroRateHz: 0, problems: 0 };
  if (apiMinor >= 42 && r.has(1)) out.configState = r.u8();
  if (apiMinor >= 43 && r.has(2)) out.gyroRateHz = r.u16();
  if (apiMinor >= 43 && r.has(4)) out.problems = r.u32();
  return out;
}

/** Padded 8-digit hex words (the Configurator prints them unpadded). */
export function decodeUid(p: Uint8Array): string {
  const r = new Rd(p);
  return [r.u32(), r.u32(), r.u32()].map((w) => w.toString(16).toUpperCase().padStart(8, '0')).join('');
}

export function decodeText(p: Uint8Array): { type: number; text: string } {
  const r = new Rd(p);
  return { type: r.u8(), text: r.pstr() };
}

/** MSP2_SET_TEXT payload: u8 type, pstr text (ASCII only, the FC limits length: 16 for names, 8 for profile names). */
export const encodeText = (type: number, text: string): Uint8Array => new Wr().u8(type).pstr(text).done();

export function decodeMcuInfo(p: Uint8Array): { id: number; name: string } {
  const r = new Rd(p);
  return { id: r.u8(), name: r.pstr() };
}

/** MSP2_SENSOR_CONFIG_ACTIVE: active hardware id per sensor, 255 = n/a. */
export interface SensorActive {
  gyro: number;
  acc: number;
  baro: number;
  mag: number;
  rangefinder: number;
}
export function decodeSensorActive(p: Uint8Array): SensorActive {
  const r = new Rd(p);
  return { gyro: r.u8(), acc: r.u8(), baro: r.u8(), mag: r.u8(), rangefinder: r.has(1) ? r.u8() : 255 };
}

/* ---------------- status ---------------- */

export interface StatusEx {
  cycleTimeUs: number;
  i2cErrors: number;
  /** Bit 0 ACC, 1 BARO, 2 MAG, 3 GPS, 4 RANGEFINDER, 5 GYRO. */
  sensors: number;
  modeFlags: number;
  /** Every flight-mode bit (first 32 boxes plus the extra bytes): bit k = k-th box of MSP_BOXIDS is active. */
  modeBits: boolean[];
  pidProfile: number;
  /** Percent as reported by the FC (scaling UNVERIFIED on hardware, see spec section 11). */
  cpuLoad: number;
  pidProfileCount: number;
  rateProfile: number;
  /** Number of arming-disable flags the firmware knows (selects the flag table). */
  armingFlagCount: number;
  armingFlags: number;
  /** Config state bit 0: a reboot is required for pending changes. */
  rebootRequired: boolean;
  cpuTempC: number | null;
  rateProfileCount: number | null;
}

export function decodeStatusEx(p: Uint8Array, apiMinor: number): StatusEx {
  const r = new Rd(p);
  const cycleTimeUs = r.u16();
  const i2cErrors = r.u16();
  const sensors = r.u16();
  const modeFlags = r.u32();
  const pidProfile = r.u8();
  const cpuLoad = r.u16();
  const pidProfileCount = r.u8();
  const rateProfile = r.u8();
  const extra = r.u8();
  const modeBits: boolean[] = [];
  for (let i = 0; i < 32; i++) modeBits.push(((modeFlags >>> i) & 1) === 1);
  for (let i = 0; i < extra; i++) {
    const b = r.u8();
    for (let k = 0; k < 8; k++) modeBits.push(((b >>> k) & 1) === 1);
  }
  const armingFlagCount = r.u8();
  const armingFlags = r.u32();
  const cfgState = r.u8();
  const out: StatusEx = { cycleTimeUs, i2cErrors, sensors, modeFlags, modeBits, pidProfile, cpuLoad, pidProfileCount, rateProfile, armingFlagCount, armingFlags, rebootRequired: (cfgState & 1) === 1, cpuTempC: null, rateProfileCount: null };
  if (apiMinor >= API.BF45 && r.has(2)) out.cpuTempC = r.u16();
  if (apiMinor >= API.BF2025_12 && r.has(1)) out.rateProfileCount = r.u8();
  return out;
}

export interface AnalogData {
  /** Volts. */
  vbat: number;
  mah: number;
  rssi: number;
  /** Amps. */
  amperage: number;
}

export function decodeAnalog(p: Uint8Array, apiMinor: number): AnalogData {
  const r = new Rd(p);
  let vbat = r.u8() / 10;
  const mah = r.u16();
  const rssi = r.u16();
  const amperage = r.s16() / 100;
  if (apiMinor >= 40 && r.has(2)) vbat = r.u16() / 100;
  return { vbat, mah, rssi, amperage };
}

export interface BatteryState {
  /** 0 = no battery detected. */
  cells: number;
  capacityMah: number;
  volts: number;
  mahDrawn: number;
  amps: number;
  /** 0 OK, 1 warning, 2 critical, 3 not present, 4 init. */
  state: number;
}

export function decodeBatteryState(p: Uint8Array): BatteryState {
  const r = new Rd(p);
  const cells = r.u8();
  const capacityMah = r.u16();
  let volts = r.u8() / 10;
  const mahDrawn = r.u16();
  const amps = r.s16() / 100;
  const state = r.u8();
  if (r.has(2)) volts = r.u16() / 100;
  return { cells, capacityMah, volts, mahDrawn, amps, state };
}

export interface Attitude {
  rollDeg: number;
  pitchDeg: number;
  headingDeg: number;
}

export function decodeAttitude(p: Uint8Array): Attitude {
  const r = new Rd(p);
  return { rollDeg: r.s16() / 10, pitchDeg: r.s16() / 10, headingDeg: r.s16() };
}

/* ---------------- features, mixer, motors, arming, sensors ---------------- */

/** Feature bit numbers (Betaflight `config/feature.h`, 4.3 to 2026.6; verify per release). */
export const FEATURE = {
  RX_PPM: 0,
  INFLIGHT_ACC_CAL: 2,
  RX_SERIAL: 3,
  MOTOR_STOP: 4,
  SERVO_TILT: 5,
  SOFTSERIAL: 6,
  GPS: 7,
  RANGEFINDER: 9,
  TELEMETRY: 10,
  THREE_D: 12,
  RX_PARALLEL_PWM: 13,
  RX_MSP: 14,
  RSSI_ADC: 15,
  LED_STRIP: 16,
  DASHBOARD: 17,
  OSD: 18,
  CHANNEL_FORWARDING: 20,
  TRANSPONDER: 21,
  AIRMODE: 22,
  RX_SPI: 25,
  ESC_SENSOR: 27,
  ANTI_GRAVITY: 28,
} as const;

export const decodeFeatures = (p: Uint8Array): number => new Rd(p).u32();
export const encodeFeatures = (mask: number): Uint8Array => new Wr().u32(mask >>> 0).done();
export const hasFeature = (mask: number, bit: number): boolean => ((mask >>> bit) & 1) === 1;
export const withFeature = (mask: number, bit: number, on: boolean): number => (on ? (mask | (1 << bit)) >>> 0 : (mask & ~(1 << bit)) >>> 0);

export interface MixerConfig {
  mixer: number;
  /** "Reversed motor direction" / props-out (yaw_motors_reversed). */
  reversed: boolean;
}
export const MIXERS: Array<[id: number, name: string]> = [
  [1, 'Tricopter'],
  [2, 'Quad +'],
  [3, 'Quad X'],
  [4, 'Bicopter'],
  [5, 'Gimbal'],
  [6, 'Y6'],
  [7, 'Hex +'],
  [8, 'Flying wing'],
  [9, 'Y4'],
  [10, 'Hex X'],
  [11, 'Octo X8'],
  [12, 'Octo flat +'],
  [13, 'Octo flat X'],
  [14, 'Airplane'],
  [17, 'V-tail quad'],
  [18, 'Hex H'],
  [20, 'Dualcopter'],
  [21, 'Singlecopter'],
  [22, 'A-tail quad'],
  [26, 'Quad X 1234'],
  [27, 'Octo X8 +'],
];
export function decodeMixer(p: Uint8Array): MixerConfig {
  const r = new Rd(p);
  return { mixer: r.u8(), reversed: r.u8() === 1 };
}
export function encodeMixer(v: MixerConfig, raw?: Uint8Array): Uint8Array {
  const o = patchBase(raw, 2);
  o[0] = v.mixer;
  o[1] = v.reversed ? 1 : 0;
  return o;
}

export interface MotorConfig {
  minThrottle: number;
  maxThrottle: number;
  minCommand: number;
  motorCount: number;
  motorPoles: number;
  dshotTelemetry: boolean;
  escSensor: boolean;
}
export function decodeMotorConfig(p: Uint8Array): MotorConfig {
  const r = new Rd(p);
  return { minThrottle: r.u16(), maxThrottle: r.u16(), minCommand: r.u16(), motorCount: r.u8(), motorPoles: r.u8(), dshotTelemetry: r.u8() === 1, escSensor: r.u8() === 1 };
}

export interface AdvancedConfig {
  gyroSyncDenom: number;
  pidProcessDenom: number;
  /** 0 PWM .. 8 PROSHOT1000, 9 DISABLED. */
  motorProtocol: number;
  motorPwmRate: number;
  /** Digital idle offset in percent. */
  motorIdlePct: number;
  bidirDshot: boolean;
  debugMode: number;
}
export function decodeAdvanced(p: Uint8Array): AdvancedConfig {
  const r = new Rd(p);
  const gyroSyncDenom = r.u8();
  const pidProcessDenom = r.u8();
  r.skip(1);
  const motorProtocol = r.u8();
  const motorPwmRate = r.u16();
  const motorIdlePct = r.u16() / 100;
  r.skip(1);
  const bidirDshot = r.u8() === 1;
  r.o = 18;
  const debugMode = r.u8();
  return { gyroSyncDenom, pidProcessDenom, motorProtocol, motorPwmRate, motorIdlePct, bidirDshot, debugMode };
}
/** MSP_SET_ADVANCED_CONFIG writes the first 19 bytes of the read payload (no debug-mode count). */
export function encodeAdvanced(v: Pick<AdvancedConfig, 'pidProcessDenom'> & Partial<AdvancedConfig>, raw?: Uint8Array): Uint8Array {
  const o = patchBase(raw?.slice(0, 19), 19);
  o[1] = v.pidProcessDenom;
  if (v.motorProtocol !== undefined) o[3] = v.motorProtocol;
  if (v.motorPwmRate !== undefined) {
    o[4] = v.motorPwmRate & 0xff;
    o[5] = (v.motorPwmRate >> 8) & 0xff;
  }
  if (v.motorIdlePct !== undefined) {
    const idle = Math.round(v.motorIdlePct * 100);
    o[6] = idle & 0xff;
    o[7] = (idle >> 8) & 0xff;
  }
  if (v.bidirDshot !== undefined) o[9] = v.bidirDshot ? 1 : 0;
  return o;
}

export interface ArmingConfig {
  /** Seconds, 0 = off. */
  autoDisarmDelay: number;
  /** Degrees; 180 = disabled (arm at any angle). */
  smallAngle: number;
  /** API >= 1.47. */
  gyroCalOnFirstArm: boolean | null;
}
export function decodeArming(p: Uint8Array, apiMinor: number): ArmingConfig {
  const r = new Rd(p);
  const autoDisarmDelay = r.u8();
  r.skip(1);
  const smallAngle = r.u8();
  return { autoDisarmDelay, smallAngle, gyroCalOnFirstArm: apiMinor >= API.BF2025_12 && r.has(1) ? r.u8() === 1 : null };
}
export function encodeArming(v: ArmingConfig, raw?: Uint8Array): Uint8Array {
  const o = patchBase(raw, 3);
  o[0] = v.autoDisarmDelay;
  o[2] = v.smallAngle;
  if (v.gyroCalOnFirstArm !== null && o.length >= 4) o[3] = v.gyroCalOnFirstArm ? 1 : 0;
  return o;
}

/**
 * Beeper conditions as [disabled-mask bit, name] (beeperMode_e, io/beeper.h; mask bit = mode - 1, SILENCE has no bit,
 * bit 13 MULTI_BEEPS is internal). 4.5 (API 1.46): 22 RC_SMOOTHING_INIT_FAIL, 23 ARMING_GPS_NO_FIX.
 * 2025.12+ (API 1.47): RC_SMOOTHING_INIT_FAIL removed, ARMING_GPS_NO_FIX moved to 22.
 */
export function beeperTable(apiMinor: number): Array<[number, string]> {
  const base: Array<[number, string]> = [
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
  ];
  return apiMinor >= API.BF2025_12 ? [...base, [22, 'ARMING_GPS_NO_FIX']] : [...base, [22, 'RC_SMOOTHING_INIT_FAIL'], [23, 'ARMING_GPS_NO_FIX']];
}

export interface BeeperConfig {
  /** Bit n set = beeper condition n is DISABLED. */
  disabledMask: number;
  dshotBeaconTone: number;
}
export function decodeBeeper(p: Uint8Array): BeeperConfig {
  const r = new Rd(p);
  return { disabledMask: r.u32(), dshotBeaconTone: r.u8() };
}
export function encodeBeeper(v: BeeperConfig, raw?: Uint8Array): Uint8Array {
  const o = patchBase(raw, 5);
  const m = v.disabledMask >>> 0;
  o[0] = m & 0xff;
  o[1] = (m >>> 8) & 0xff;
  o[2] = (m >>> 16) & 0xff;
  o[3] = (m >>> 24) & 0xff;
  o[4] = v.dshotBeaconTone;
  return o;
}

/** Roll/pitch/yaw in degrees. */
export interface Rpy {
  roll: number;
  pitch: number;
  yaw: number;
}
export function decodeBoardAlignment(p: Uint8Array): Rpy {
  const r = new Rd(p);
  return { roll: r.s16(), pitch: r.s16(), yaw: r.s16() };
}
export function encodeBoardAlignment(v: Rpy, raw?: Uint8Array): Uint8Array {
  const o = patchBase(raw, 6);
  const w = new Wr().s16(v.roll).s16(v.pitch).s16(v.yaw).done();
  o.set(w, 0);
  return o;
}

/** ACC trim: pitch/roll in 0.1 degree units as the FC reports it (the range is +-300, i.e. +-30 deg). */
export interface AccTrim {
  pitch: number;
  roll: number;
}
export function decodeAccTrim(p: Uint8Array): AccTrim {
  const r = new Rd(p);
  return { pitch: r.s16(), roll: r.s16() };
}
export const encodeAccTrim = (v: AccTrim): Uint8Array => new Wr().s16(v.pitch).s16(v.roll).done();

export interface SensorAlignment {
  gyro: number;
  acc: number;
  mag: number;
}
export function decodeSensorAlignment(p: Uint8Array): SensorAlignment {
  const r = new Rd(p);
  return { gyro: r.u8(), acc: r.u8(), mag: r.u8() };
}

/** MSP_SENSOR_CONFIG hardware selections (ids are Betaflight hardware enums, shown as numbers). */
export interface SensorConfig {
  acc: number;
  baro: number;
  mag: number;
}
export function decodeSensorConfig(p: Uint8Array): SensorConfig {
  const r = new Rd(p);
  return { acc: r.u8(), baro: r.u8(), mag: r.u8() };
}

/** MSP_SET_SENSOR_CONFIG: acc/baro/mag hardware (1 = NONE, 0 = auto), then the extra bytes the API version expects, kept as the FC reported them. */
export function encodeSensorConfig(v: SensorConfig, raw: Uint8Array | undefined, api: number): Uint8Array {
  const o = [v.acc, v.baro, v.mag];
  if (api >= API.BF2025_12) o.push(raw?.[3] ?? 0, raw?.[4] ?? 0); // sonar, optical flow
  if (api >= API.MASTER) o.push(raw?.[5] ?? 0); // pitot
  return Uint8Array.from(o);
}
/** Hardware id that switches a sensor off in MSP_SENSOR_CONFIG (acc, baro and mag all use 1 = NONE). */
export const SENSOR_NONE = 1;

/* ---------------- live sensor data (Sensors tab) ---------------- */

/** MSP_RAW_IMU: accelerometer in g, gyro in deg/s, magnetometer raw (scalings as the Betaflight Configurator shows them). */
export interface RawImu {
  acc: [number, number, number];
  gyro: [number, number, number];
  mag: [number, number, number];
}
export function decodeRawImu(p: Uint8Array): RawImu {
  const r = new Rd(p);
  const acc: [number, number, number] = [r.s16() / 2048, r.s16() / 2048, r.s16() / 2048];
  const gyro: [number, number, number] = [r.s16() * (4 / 16.4), r.s16() * (4 / 16.4), r.s16() * (4 / 16.4)];
  const mag: [number, number, number] = [r.s16(), r.s16(), r.s16()];
  return { acc, gyro, mag };
}

/** MSP_ALTITUDE: estimated altitude in metres (s32 cm) and vertical speed in m/s (s16 cm/s, when sent). */
export function decodeAltitude(p: Uint8Array): { altM: number; varioMs: number } {
  const r = new Rd(p);
  const altM = (r.u32() | 0) / 100;
  return { altM, varioMs: r.has(2) ? r.s16() / 100 : 0 };
}

/** MSP_COMPASS_CONFIG (API 1.46+): magnetic declination in degrees. */
export const decodeCompassDeclination = (p: Uint8Array): number => new Rd(p).s16() / 10;

/* ---------------- GPS ---------------- */

/** MSP_GPS_CONFIG: provider (0 NMEA, 1 UBLOX, 2 MSP, 3 VIRTUAL), SBAS mode, auto config, auto baud, home point once, Galileo. */
export interface GpsConfig {
  provider: number;
  sbas: number;
  autoConfig: boolean;
  autoBaud: boolean;
  homePointOnce: boolean;
  useGalileo: boolean;
}
export function decodeGpsConfig(p: Uint8Array): GpsConfig {
  const r = new Rd(p);
  return { provider: r.u8(), sbas: r.u8(), autoConfig: r.u8() === 1, autoBaud: r.u8() === 1, homePointOnce: r.u8() === 1, useGalileo: r.u8() === 1 };
}
export function encodeGpsConfig(v: GpsConfig, raw?: Uint8Array): Uint8Array {
  const o = patchBase(raw, 6);
  o.set([v.provider, v.sbas, v.autoConfig ? 1 : 0, v.autoBaud ? 1 : 0, v.homePointOnce ? 1 : 0, v.useGalileo ? 1 : 0], 0);
  return o;
}

/** MSP_RAW_GPS. Latitude/longitude in degrees, altitude in m, speed in cm/s, course in degrees, positional DOP (API 1.46+, 0 when absent). */
export interface RawGps {
  fix: number;
  numSat: number;
  lat: number;
  lon: number;
  altM: number;
  speedCms: number;
  courseDeg: number;
  pdop: number;
}
export function decodeRawGps(p: Uint8Array): RawGps {
  const r = new Rd(p);
  const fix = r.u8();
  const numSat = r.u8();
  const lat = (r.u32() | 0) / 1e7;
  const lon = (r.u32() | 0) / 1e7;
  const altM = r.u16();
  const speedCms = r.u16();
  const courseDeg = r.u16() / 10;
  const pdop = r.has(2) ? r.u16() / 100 : 0;
  return { fix, numSat, lat, lon, altM, speedCms, courseDeg, pdop };
}

/** MSP_COMP_GPS: distance (m) and direction (deg) from the aircraft to the home point. */
export interface CompGps {
  distanceM: number;
  directionDeg: number;
  update: number;
}
export function decodeCompGps(p: Uint8Array): CompGps {
  const r = new Rd(p);
  return { distanceM: r.u16(), directionDeg: r.u16(), update: r.u8() };
}

/** One channel of MSP_GPS_SV_INFO: `gnss` is the constellation id (more than 16 channels) or the channel number (older firmware). */
export interface SvChannel {
  gnss: number;
  svid: number;
  quality: number;
  cno: number;
}
export function decodeGpsSvInfo(p: Uint8Array): SvChannel[] {
  const r = new Rd(p);
  const n = p.length > 0 ? r.u8() : 0;
  const out: SvChannel[] = [];
  for (let i = 0; i < n && r.has(4); i++) out.push({ gnss: r.u8(), svid: r.u8(), quality: r.u8(), cno: r.u8() });
  return out;
}
export const GNSS_NAMES = ['GPS', 'SBAS', 'Galileo', 'BeiDou', 'IMES', 'QZSS', 'Glonass'] as const;

/** Receiver position: the quad's offset from home in metres (east, north), from MSP_COMP_GPS (direction TO home). */
export function offsetFromHome(c: CompGps): { east: number; north: number } {
  const b = ((c.directionDeg + 180) * Math.PI) / 180;
  return { east: Math.sin(b) * c.distanceM, north: Math.cos(b) * c.distanceM };
}

/** Receiver config: only what the core tabs need (the Receiver tab owns the rest). */
export interface RxConfigLite {
  serialRxProvider: number;
  minCheck: number;
  midRc: number;
  maxCheck: number;
}
export const RX_PROVIDERS = ['', 'SPEKTRUM2048', 'SBUS', 'SUMD', 'SUMH', 'XBUS_B', 'XBUS_B_RJ01', 'IBUS', 'JETIEXBUS', 'CRSF', 'SRXL', 'CUSTOM', 'FPORT', 'SRXL2', 'GHST', 'SPEKTRUM1024'];

export function decodeRxConfigLite(p: Uint8Array): RxConfigLite {
  const r = new Rd(p);
  const serialRxProvider = r.u8();
  const maxCheck = r.u16();
  const midRc = r.u16();
  const minCheck = r.u16();
  return { serialRxProvider, minCheck, midRc, maxCheck };
}

/* ---------------- serial ports ---------------- */

export interface SerialPortCfg {
  /** 0..9 = UART1..UART10, 20 = USB VCP, 30/31 = soft serial, 40 = LPUART1. */
  id: number;
  /** Function bitmask (see SERIAL_FN). */
  mask: number;
  mspBaud: number;
  gpsBaud: number;
  telemetryBaud: number;
  blackboxBaud: number;
  /** Bytes after the known fields (future growth), re-sent as read. */
  tail: number[];
}

export interface SerialConfig {
  /** v2 = MSP2_COMMON_SERIAL_CONFIG (u32 masks), legacy = MSP_CF_SERIAL_CONFIG (u16 masks). */
  source: 'v2' | 'legacy';
  ports: SerialPortCfg[];
}

/** Function mask bits (`io/serial.h`). */
export const SERIAL_FN = {
  MSP: 1 << 0,
  GPS: 1 << 1,
  TELEMETRY_FRSKY: 1 << 2,
  TELEMETRY_HOTT: 1 << 3,
  TELEMETRY_LTM: 1 << 4,
  TELEMETRY_SMARTPORT: 1 << 5,
  RX_SERIAL: 1 << 6,
  BLACKBOX: 1 << 7,
  TELEMETRY_MAVLINK: 1 << 9,
  ESC_SENSOR: 1 << 10,
  VTX_SMARTAUDIO: 1 << 11,
  TELEMETRY_IBUS: 1 << 12,
  VTX_TRAMP: 1 << 13,
  RCDEVICE: 1 << 14,
  LIDAR_TF: 1 << 15,
  FRSKY_OSD: 1 << 16,
  VTX_MSP: 1 << 17,
  GIMBAL: 1 << 18,
} as const;

/** Baud index table (identical on all versions). */
export const BAUD_RATES = [0, 9600, 19200, 38400, 57600, 115200, 230400, 250000, 400000, 460800, 500000, 921600, 1000000, 1500000, 2000000, 2470000];
export const baudLabel = (idx: number): string => (idx === 0 ? 'AUTO' : String(BAUD_RATES[idx] ?? `#${idx}`));

export function decodeSerialConfig(p: Uint8Array, source: 'v2' | 'legacy'): SerialConfig {
  const r = new Rd(p);
  const count = r.u8();
  // Defensive record size (spec 3.7): bytes per port = remaining / count, so future growth does not break us.
  const bpp = count > 0 ? Math.floor(r.left / count) : 0;
  const ports: SerialPortCfg[] = [];
  for (let i = 0; i < count && r.has(bpp) && bpp >= 7; i++) {
    const start = r.o;
    const id = r.u8();
    const mask = source === 'v2' ? r.u32() : r.u16();
    const port: SerialPortCfg = { id, mask, mspBaud: r.u8(), gpsBaud: r.u8(), telemetryBaud: r.u8(), blackboxBaud: r.u8(), tail: [] };
    while (r.o - start < bpp) port.tail.push(r.u8());
    ports.push(port);
  }
  return { source, ports };
}

export function encodeSerialConfig(cfg: SerialConfig): Uint8Array {
  const w = new Wr().u8(cfg.ports.length);
  for (const pt of cfg.ports) {
    w.u8(pt.id);
    if (cfg.source === 'v2') w.u32(pt.mask);
    else w.u16(pt.mask & 0xffff);
    w.u8(pt.mspBaud).u8(pt.gpsBaud).u8(pt.telemetryBaud).u8(pt.blackboxBaud).bytes(pt.tail);
  }
  return w.done();
}

/** Human name of a serial port identifier (4.3 to 2026.6 numbering). */
/**
 * serialPortIdentifier_e (io/serial.h). Up to 4.5: UART1..10 = 0..9. From 2025.12 (API 1.47): UART0/UART1..15 = 50/51..65,
 * PIOUART0..9 = 70..79. VCP 20, SOFTSERIAL1/2 30/31 and LPUART1 40 never changed. The ranges do not overlap.
 */
export function serialPortName(id: number): string {
  if (id >= 0 && id <= 9) return `UART${id + 1}`;
  if (id >= 50 && id <= 65) return `UART${id - 50}`;
  if (id >= 70 && id <= 79) return `PIOUART${id - 70}`;
  if (id === 20) return 'USB VCP';
  if (id === 30 || id === 31) return `SOFTSERIAL${id - 29}`;
  if (id === 40) return 'LPUART1';
  return `PORT ${id}`;
}

/* ---------------- power ---------------- */

export interface BatteryConfig {
  /** Volts per cell. */
  minCell: number;
  maxCell: number;
  warnCell: number;
  capacityMah: number;
  /** 0 none, 1 ADC, 2 ESC. */
  voltageSource: number;
  /** 0 none, 1 ADC, 2 virtual, 3 ESC, 4 MSP. */
  currentSource: number;
}
export function decodeBatteryConfig(p: Uint8Array): BatteryConfig {
  const r = new Rd(p);
  let minCell = r.u8() / 10;
  let maxCell = r.u8() / 10;
  let warnCell = r.u8() / 10;
  const capacityMah = r.u16();
  const voltageSource = r.u8();
  const currentSource = r.u8();
  if (r.has(6)) {
    minCell = r.u16() / 100;
    maxCell = r.u16() / 100;
    warnCell = r.u16() / 100;
  }
  return { minCell, maxCell, warnCell, capacityMah, voltageSource, currentSource };
}
export function encodeBatteryConfig(v: BatteryConfig, raw?: Uint8Array): Uint8Array {
  const o = patchBase(raw, 13);
  const c = (x: number) => Math.round(x * 100);
  const w = new Wr()
    .u8(Math.round(v.minCell * 10))
    .u8(Math.round(v.maxCell * 10))
    .u8(Math.round(v.warnCell * 10))
    .u16(v.capacityMah)
    .u8(v.voltageSource)
    .u8(v.currentSource)
    .u16(c(v.minCell))
    .u16(c(v.maxCell))
    .u16(c(v.warnCell))
    .done();
  o.set(w, 0);
  return o;
}

export interface VoltageMeterCfg {
  id: number;
  sensorType: number;
  scale: number;
  divVal: number;
  divMultiplier: number;
}
export function decodeVoltageMeterConfig(p: Uint8Array): VoltageMeterCfg[] {
  const r = new Rd(p);
  const n = r.u8();
  const out: VoltageMeterCfg[] = [];
  for (let i = 0; i < n && r.has(1); i++) {
    const len = r.u8();
    const start = r.o;
    out.push({ id: r.u8(), sensorType: r.u8(), scale: r.u8(), divVal: r.u8(), divMultiplier: r.u8() });
    r.o = start + len;
  }
  return out;
}
export const encodeVoltageMeter = (m: VoltageMeterCfg): Uint8Array => new Wr().u8(m.id).u8(m.scale).u8(m.divVal).u8(m.divMultiplier).done();

export interface CurrentMeterCfg {
  id: number;
  type: number;
  scale: number;
  offset: number;
}
export function decodeCurrentMeterConfig(p: Uint8Array): CurrentMeterCfg[] {
  const r = new Rd(p);
  const n = r.u8();
  const out: CurrentMeterCfg[] = [];
  for (let i = 0; i < n && r.has(1); i++) {
    const len = r.u8();
    const start = r.o;
    out.push({ id: r.u8(), type: r.u8(), scale: r.s16(), offset: r.s16() });
    r.o = start + len;
  }
  return out;
}
export const encodeCurrentMeter = (m: CurrentMeterCfg): Uint8Array => new Wr().u8(m.id).u16(m.scale & 0xffff).u16(m.offset & 0xffff).done();

/** MSP_VOLTAGE_METERS: (id, 0.1 V) pairs; MSP_CURRENT_METERS: (id, mAh, mA) triples. */
export function decodeVoltageMeters(p: Uint8Array): Array<{ id: number; volts: number }> {
  const r = new Rd(p);
  const out: Array<{ id: number; volts: number }> = [];
  while (r.has(2)) out.push({ id: r.u8(), volts: r.u8() / 10 });
  return out;
}
export function decodeCurrentMeters(p: Uint8Array): Array<{ id: number; mah: number; amps: number }> {
  const r = new Rd(p);
  const out: Array<{ id: number; mah: number; amps: number }> = [];
  while (r.has(5)) out.push({ id: r.u8(), mah: r.u16(), amps: r.u16() / 1000 });
  return out;
}

/* ---------------- failsafe ---------------- */

export interface FailsafeConfig {
  /** Stage 1 guard time, 0.1 s units. */
  delay: number;
  /** Stage 2 landing time before disarm, 0.1 s units. */
  offDelay: number;
  /** Stage 2 throttle in us. */
  throttle: number;
  /** 0 stage 1, 1 kill, 2 stage 2 (what the failsafe switch does). */
  switchMode: number;
  /** Throttle-low delay, 0.1 s units. */
  throttleLowDelay: number;
  /** 0 auto-landing, 1 drop, 2 GPS rescue. */
  procedure: number;
}
export function decodeFailsafe(p: Uint8Array): FailsafeConfig {
  const r = new Rd(p);
  return { delay: r.u8(), offDelay: r.u8(), throttle: r.u16(), switchMode: r.u8(), throttleLowDelay: r.u16(), procedure: r.u8() };
}
/** The spec counts 10 bytes; the firmware layout we decode is 8. We patch the read payload so any trailing bytes round-trip. */
export function encodeFailsafe(v: FailsafeConfig, raw?: Uint8Array): Uint8Array {
  const o = patchBase(raw, 8);
  const w = new Wr().u8(v.delay).u8(v.offDelay).u16(v.throttle).u8(v.switchMode).u16(v.throttleLowDelay).u8(v.procedure).done();
  o.set(w, 0);
  return o;
}

export interface RxFailChannel {
  /** 0 auto, 1 hold, 2 set. */
  mode: number;
  /** Fallback pulse in us (used by mode 2). */
  value: number;
}
export function decodeRxFail(p: Uint8Array): RxFailChannel[] {
  const r = new Rd(p);
  const out: RxFailChannel[] = [];
  while (r.has(3)) out.push({ mode: r.u8(), value: r.u16() });
  return out;
}
export const encodeRxFailChannel = (index: number, c: RxFailChannel): Uint8Array => new Wr().u8(index).u8(c.mode).u16(c.value).done();

