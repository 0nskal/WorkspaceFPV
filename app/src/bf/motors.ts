/**
 * Motors: pure MSP decoders/encoders (no DOM, no I/O). Layouts follow design/BETAFLIGHT-PARITY.md 3.2/3.3.
 * Every decoder tolerates short or long payloads (older/newer firmware) and keeps the raw bytes so a write can
 * be a read-modify-write that round-trips fields we do not touch.
 */

export const MSPM = {
  ADVANCED_CONFIG: 90,
  SET_ADVANCED_CONFIG: 91,
  MIXER_CONFIG: 42,
  SET_MIXER_CONFIG: 43,
  MOTOR_CONFIG: 131,
  SET_MOTOR_CONFIG: 222,
  MOTOR_TELEMETRY: 139,
  ESC_SENSOR_DATA: 134,
  MOTOR: 104,
  FEATURE_CONFIG: 36,
  SET_FEATURE_CONFIG: 37,
  /** MSP_3D: deadband3d_low, deadband3d_high, neutral3d (u16 each). */
  MOTOR_3D_CONFIG: 124,
  SET_MOTOR_3D_CONFIG: 217,
  PID_ADVANCED: 94,
  SET_PID_ADVANCED: 95,
  EEPROM_WRITE: 250,
  REBOOT: 68,
} as const;

/** Motor protocol enum (identical on BF 4.3 .. 2026.6). */
export const MOTOR_PROTOCOLS: ReadonlyArray<{ id: number; name: string; dshot: boolean; digital: boolean }> = [
  { id: 0, name: 'PWM', dshot: false, digital: false },
  { id: 1, name: 'ONESHOT125', dshot: false, digital: false },
  { id: 2, name: 'ONESHOT42', dshot: false, digital: false },
  { id: 3, name: 'MULTISHOT', dshot: false, digital: false },
  { id: 4, name: 'BRUSHED', dshot: false, digital: false },
  { id: 5, name: 'DSHOT150', dshot: true, digital: true },
  { id: 6, name: 'DSHOT300', dshot: true, digital: true },
  { id: 7, name: 'DSHOT600', dshot: true, digital: true },
  { id: 8, name: 'PROSHOT1000', dshot: false, digital: true },
  { id: 9, name: 'DISABLED', dshot: false, digital: false },
];
export const protocolById = (id: number) => MOTOR_PROTOCOLS.find((p) => p.id === id);
/** Bidirectional DShot works on DShot150/300/600 only. */
export const supportsBidir = (id: number) => !!protocolById(id)?.dshot;

const dvOf = (p: Uint8Array) => new DataView(p.buffer, p.byteOffset, p.byteLength);
const padded = (p: Uint8Array, len: number): Uint8Array => {
  const out = new Uint8Array(Math.max(p.length, len));
  out.set(p);
  return out;
};

/* ---------------- MSP_ADVANCED_CONFIG (90) / SET (91) ---------------- */
export interface AdvancedConfig {
  raw: Uint8Array;
  pidProcessDenom: number;
  protocol: number;
  pwmRate: number;
  /** Digital idle offset in percent (wire value / 100). */
  idlePercent: number;
  /** Raw byte 9 (motor PWM inversion). Bidirectional DShot is in MOTOR_CONFIG, not here. */
  pwmInversion: number;
  debugMode: number;
  /** DEBUG_COUNT reported by the FC (0 when the field is missing). */
  debugCount: number;
}

export function decodeAdvancedConfig(p: Uint8Array): AdvancedConfig {
  const dv = dvOf(p);
  return {
    raw: p,
    pidProcessDenom: p[1] ?? 1,
    protocol: p[3] ?? 0,
    pwmRate: p.length >= 6 ? dv.getUint16(4, true) : 0,
    idlePercent: p.length >= 8 ? dv.getUint16(6, true) / 100 : 0,
    pwmInversion: p[9] ?? 0,
    debugMode: p[18] ?? 0,
    debugCount: p[19] ?? 0,
  };
}

export interface AdvancedPatch {
  protocol?: number;
  pwmRate?: number;
  idlePercent?: number;
  debugMode?: number;
  pidProcessDenom?: number;
}

/** SET payload = the first 19 bytes of the read payload with the edited fields patched (the count byte is not sent). */
export function encodeAdvancedConfig(cur: AdvancedConfig, patch: AdvancedPatch): Uint8Array {
  const o = padded(cur.raw.subarray(0, 19), 19).slice(0, 19);
  const dv = dvOf(o);
  if (patch.pidProcessDenom !== undefined) o[1] = patch.pidProcessDenom & 0xff;
  if (patch.protocol !== undefined) o[3] = patch.protocol & 0xff;
  if (patch.pwmRate !== undefined) dv.setUint16(4, patch.pwmRate, true);
  if (patch.idlePercent !== undefined) dv.setUint16(6, Math.round(patch.idlePercent * 100), true);
  if (patch.debugMode !== undefined) o[18] = patch.debugMode & 0xff;
  return o;
}

/* ---------------- MSP_MOTOR_CONFIG (131) / SET (222) ---------------- */
export interface MotorConfig {
  raw: Uint8Array;
  minThrottle: number;
  maxThrottle: number;
  minCommand: number;
  motorCount: number;
  poles: number;
  /** dshot_bidir (DShot telemetry enabled). */
  bidir: boolean;
  /** ESC sensor (telemetry wire) enabled. */
  escSensor: boolean;
  /** Motor kV (API >= 1.49 only, otherwise null). */
  kv: number | null;
}

export function decodeMotorConfig(p: Uint8Array, apiMinor: number): MotorConfig {
  const dv = dvOf(p);
  return {
    raw: p,
    minThrottle: p.length >= 2 ? dv.getUint16(0, true) : 0,
    maxThrottle: p.length >= 4 ? dv.getUint16(2, true) : 0,
    minCommand: p.length >= 6 ? dv.getUint16(4, true) : 0,
    motorCount: p[6] ?? 4,
    poles: p[7] ?? 14,
    bidir: (p[8] ?? 0) === 1,
    escSensor: (p[9] ?? 0) === 1,
    kv: apiMinor >= 49 && p.length >= 12 ? dv.getUint16(10, true) : null,
  };
}

export interface MotorPatch {
  poles?: number;
  bidir?: boolean;
  kv?: number;
}

/** SET payload: u16 min, u16 max, u16 mincommand, u8 poles, u8 dshot telemetry, (API>=1.49) u16 kv. */
export function encodeMotorConfig(cur: MotorConfig, patch: MotorPatch, apiMinor: number): Uint8Array {
  const withKv = apiMinor >= 49;
  const o = new Uint8Array(withKv ? 10 : 8);
  const dv = dvOf(o);
  dv.setUint16(0, cur.minThrottle, true);
  dv.setUint16(2, cur.maxThrottle, true);
  dv.setUint16(4, cur.minCommand, true);
  o[6] = (patch.poles ?? cur.poles) & 0xff;
  o[7] = (patch.bidir ?? cur.bidir) ? 1 : 0;
  if (withKv) dv.setUint16(8, patch.kv ?? cur.kv ?? 0, true);
  return o;
}

/* ---------------- MSP_MIXER_CONFIG (42) / SET (43) ---------------- */
export interface MixerConfig {
  mixer: number;
  /** yaw_motors_reversed: true = props out (reversed motor direction). */
  reversed: boolean;
}
export const decodeMixerConfig = (p: Uint8Array): MixerConfig => ({ mixer: p[0] ?? 3, reversed: (p[1] ?? 0) === 1 });
export const encodeMixerConfig = (m: MixerConfig): Uint8Array => Uint8Array.from([m.mixer, m.reversed ? 1 : 0]);

/* ---------------- MSP_3D (124) / MSP_SET_3D (217) ---------------- */
export interface Motor3dConfig {
  /** deadband3d_low: top of the reverse range (1000..1499). */
  low: number;
  /** deadband3d_high: bottom of the forward range (1501..2000). */
  high: number;
  /** neutral3d: motor stop point (1400..1600). */
  neutral: number;
}
/** Betaflight defaults (deadband3d_low 1406, deadband3d_high 1514, neutral3d 1460). */
export const MOTOR_3D_DEFAULTS: Motor3dConfig = { low: 1406, high: 1514, neutral: 1460 };

export function decodeMotor3d(p: Uint8Array): Motor3dConfig | null {
  if (p.length < 6) return null;
  const dv = dvOf(p);
  return { low: dv.getUint16(0, true), high: dv.getUint16(2, true), neutral: dv.getUint16(4, true) };
}

export function encodeMotor3d(c: Motor3dConfig): Uint8Array {
  const o = new Uint8Array(6);
  const dv = dvOf(o);
  dv.setUint16(0, Math.round(c.low), true);
  dv.setUint16(2, Math.round(c.high), true);
  dv.setUint16(4, Math.round(c.neutral), true);
  return o;
}

/** Ranges as in the Betaflight CLI (deadband3d_low 1000-1500, deadband3d_high 1500-2000, neutral3d 1000-2000) plus low < neutral < high. */
export function validateMotor3d(c: Motor3dConfig): boolean {
  const int = (n: number) => Number.isInteger(n);
  return int(c.low) && int(c.high) && int(c.neutral) && c.low >= 1000 && c.low <= 1500 && c.high >= 1500 && c.high <= 2000 && c.neutral >= 1000 && c.neutral <= 2000 && c.low < c.neutral && c.neutral < c.high;
}

/* ---------------- feature bits used on the Motors tab ---------------- */
/** Betaflight `config/feature.h` bit numbers (same as bf/decode.ts FEATURE). */
export const MOTOR_FEATURE = { MOTOR_STOP: 4, THREE_D: 12, AIRMODE: 22, ESC_SENSOR: 27 } as const;
export const featureOn = (mask: number, bit: number): boolean => ((mask >>> bit) & 1) === 1;
export const setFeature = (mask: number, bit: number, on: boolean): number => (on ? (mask | (1 << bit)) >>> 0 : (mask & ~(1 << bit)) >>> 0);

/* ---------------- motor test values ---------------- */
/** Motor test slider percent (0..100) to the MSP_SET_MOTOR value (1000..2000), like the Betaflight sliders. */
export const pctToMotor = (pct: number): number => 1000 + Math.round(Math.max(0, Math.min(100, pct)) * 10);

/* ---------------- MSP_MOTOR_TELEMETRY (139) ---------------- */
export interface MotorTel {
  /** Real RPM (the FC already applies the pole count). */
  rpm: number;
  /** Telemetry frames lost, percent (wire 10000 = 100.00 %). */
  invalidPct: number;
  tempC: number;
  voltage: number;
  current: number;
  mah: number;
}

/** 1 count byte + 13 bytes per motor. Returns [] for an empty or malformed payload. */
export function decodeMotorTelemetry(p: Uint8Array): MotorTel[] {
  if (p.length < 1) return [];
  const dv = dvOf(p);
  const n = Math.min(p[0]!, Math.floor((p.length - 1) / 13), 8);
  const out: MotorTel[] = [];
  for (let i = 0; i < n; i++) {
    const o = 1 + i * 13;
    out.push({
      rpm: dv.getUint32(o, true),
      invalidPct: dv.getUint16(o + 4, true) / 100,
      tempC: p[o + 6]!,
      voltage: dv.getUint16(o + 7, true) / 100,
      current: dv.getUint16(o + 9, true) / 100,
      mah: dv.getUint16(o + 11, true),
    });
  }
  return out;
}

export function encodeMotorTelemetry(list: MotorTel[]): Uint8Array {
  const o = new Uint8Array(1 + list.length * 13);
  const dv = dvOf(o);
  o[0] = list.length;
  list.forEach((m, i) => {
    const b = 1 + i * 13;
    dv.setUint32(b, Math.round(m.rpm), true);
    dv.setUint16(b + 4, Math.round(m.invalidPct * 100), true);
    o[b + 6] = m.tempC & 0xff;
    dv.setUint16(b + 7, Math.round(m.voltage * 100), true);
    dv.setUint16(b + 9, Math.round(m.current * 100), true);
    dv.setUint16(b + 11, m.mah, true);
  });
  return o;
}

/** Legacy MSP_ESC_SENSOR_DATA (134): count, then per motor u8 temp + u16 rpm. */
export function decodeEscSensor(p: Uint8Array): MotorTel[] {
  if (p.length < 1) return [];
  const dv = dvOf(p);
  const n = Math.min(p[0]!, Math.floor((p.length - 1) / 3), 8);
  return Array.from({ length: n }, (_, i) => ({ rpm: dv.getUint16(2 + i * 3, true), invalidPct: 0, tempC: p[1 + i * 3]!, voltage: 0, current: 0, mah: 0 }));
}

/** True when any motor reports something (all-zero frames mean the telemetry source is off). */
export const telemetryActive = (m: MotorTel[]) => m.some((x) => x.rpm > 0 || x.tempC > 0 || x.voltage > 0);

/* ---------------- validation (ranges as in Betaflight) ---------------- */
export interface MotorEdit {
  idlePercent: number;
  poles: number;
  protocol: number;
  bidir: boolean;
}
export type MotorIssue = 'idle' | 'poles' | 'bidirProtocol' | 'dynIdle';
export function validateMotorEdit(e: MotorEdit & { dynIdle?: number }): MotorIssue[] {
  const bad: MotorIssue[] = [];
  if (!(e.idlePercent >= 0 && e.idlePercent <= 20)) bad.push('idle');
  if (!(Number.isInteger(e.poles) && e.poles >= 4 && e.poles <= 64)) bad.push('poles');
  if (e.bidir && !supportsBidir(e.protocol)) bad.push('bidirProtocol');
  if (e.dynIdle !== undefined && !(Number.isInteger(e.dynIdle) && e.dynIdle >= 0 && e.dynIdle <= 200)) bad.push('dynIdle');
  return bad;
}

/** DEBUG_xxx names for BF 4.5 (API 1.46) only; other releases renumber the enum, so no name is shown for them. */
export const DEBUG_MODES_45 = [
  'NONE', 'CYCLETIME', 'BATTERY', 'GYRO_FILTERED', 'ACCELEROMETER', 'PIDLOOP', 'GYRO_SCALED', 'RC_INTERPOLATION', 'ANGLERATE', 'ESC_SENSOR',
  'SCHEDULER', 'STACK', 'ESC_SENSOR_RPM', 'ESC_SENSOR_TMP', 'ALTITUDE', 'FFT', 'FFT_TIME', 'FFT_FREQ', 'RX_FRSKY_SPI', 'RX_SFHSS_SPI',
  'GYRO_RAW', 'DUAL_GYRO_RAW', 'DUAL_GYRO_DIFF', 'MAX7456_SIGNAL', 'MAX7456_SPICLOCK', 'SBUS', 'FPORT', 'RANGEFINDER', 'RANGEFINDER_QUALITY', 'LIDAR_TF',
  'ADC_INTERNAL', 'RUNAWAY_TAKEOFF', 'SDIO', 'CURRENT_SENSOR', 'USB', 'SMARTAUDIO', 'RTH', 'ITERM_RELAX', 'ACRO_TRAINER', 'RC_SMOOTHING',
  'RX_SIGNAL_LOSS', 'RC_SMOOTHING_RATE', 'ANTI_GRAVITY', 'DYN_LPF', 'RX_SPEKTRUM_SPI', 'DSHOT_RPM_TELEMETRY', 'RPM_FILTER', 'D_MIN', 'AC_CORRECTION', 'AC_ERROR',
  'DUAL_GYRO_SCALED', 'DSHOT_RPM_ERRORS', 'CRSF_LINK_STATISTICS_UPLINK', 'CRSF_LINK_STATISTICS_PWR', 'CRSF_LINK_STATISTICS_DOWN', 'BARO', 'GPS_RESCUE_THROTTLE_PID', 'DYN_IDLE', 'FF_LIMIT', 'FF_INTERPOLATED',
  'BLACKBOX_OUTPUT', 'GYRO_SAMPLE', 'RX_TIMING', 'D_LPF', 'VTX_TRAMP', 'GHST', 'GHST_MSP', 'SCHEDULER_DETERMINISM', 'TIMING_ACCURACY', 'RX_EXPRESSLRS_SPI',
  'RX_EXPRESSLRS_PHASELOCK', 'RX_STATE_TIME', 'GPS_RESCUE_VELOCITY', 'GPS_RESCUE_HEADING', 'GPS_RESCUE_TRACKING', 'GPS_CONNECTION', 'ATTITUDE', 'VTX_MSP', 'GPS_DOP', 'FAILSAFE',
  'GYRO_CALIBRATION', 'ANGLE_MODE', 'ANGLE_TARGET', 'CURRENT_ANGLE', 'DSHOT_TELEMETRY_COUNTS', 'RPM_LIMIT', 'RC_STATS', 'MAG_CALIB', 'MAG_TASK_RATE', 'EZLANDING',
] as const;
export const debugModeName = (idx: number, apiMinor: number): string => (apiMinor === 46 ? DEBUG_MODES_45[idx] : undefined) ?? `#${idx}`;
