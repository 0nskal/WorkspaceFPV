/**
 * Typed flight-controller settings from a Blackbox log header ("H key:value" lines of a .bbl, or the key/value rows a
 * Blackbox Explorer CSV export may carry above the column names). Pure, no DOM, runs in the analysis worker.
 *
 * Header key names changed between Betaflight versions, so every field is optional and looked up under several
 * aliases (first hit wins). The aliases below are written from memory of Betaflight 3.5-4.5 / 2025.x headers and were
 * NOT all verified against real logs; the raw header map is always kept in `raw` so nothing is lost.
 *
 * Assumed key names (field <- keys tried, in order):
 * - firmware: "Firmware revision" ("Betaflight 4.5.1 (hash) MCU"), "Firmware type", "Firmware date", "Board information", "Craft name"
 * - looptimeUs <- looptime (gyro sample period in us); pidDenom <- pid_process_denom
 * - blackbox: "I interval", "P interval" ("1/2" in old logs = num/denom, a plain integer in 4.x), "P ratio"
 * - debugMode <- debug_mode (number, or a name such as GYRO_SCALED)
 * - PIDs <- rollPID / pitchPID / yawPID ("P,I,D"); FF <- ff_weight | feedforward_weight | f_weight ("r,p,y")
 * - D limits <- d_min ("r,p,y", Betaflight <= 4.5: D is the upper value) | d_max ("r,p,y", 2025.x: D is the base value)
 * - sliders <- simplified_pids_mode, simplified_master_multiplier, simplified_pi_gain, simplified_i_gain, simplified_d_gain,
 *   simplified_dmax_gain | simplified_d_max_gain, simplified_feedforward_gain, simplified_pitch_d_gain,
 *   simplified_pitch_pi_gain, simplified_dterm_filter, simplified_dterm_filter_multiplier, simplified_gyro_filter,
 *   simplified_gyro_filter_multiplier (all x100 integers, 100 = 1.0)
 * - gyro LPF <- gyro_lpf1_type | gyro_lowpass_type, gyro_lpf1_static_hz | gyro_lowpass_hz, gyro_lpf1_dyn_hz ("min,max")
 *   | dyn_lpf_gyro_min_hz + dyn_lpf_gyro_max_hz, gyro_lpf2_static_hz | gyro_lowpass2_hz, gyro_lpf2_type | gyro_lowpass2_type
 * - D-term LPF <- dterm_lpf1_type | dterm_filter_type, dterm_lpf1_static_hz | dterm_lowpass_hz, dterm_lpf1_dyn_hz ("min,max")
 *   | dyn_lpf_dterm_min_hz + dyn_lpf_dterm_max_hz, dterm_lpf2_static_hz | dterm_lowpass2_hz, dterm_lpf2_type | dterm_filter2_type
 * - dyn notch <- dyn_notch_count, dyn_notch_q, dyn_notch_min_hz, dyn_notch_max_hz
 * - RPM <- rpm_filter_harmonics, rpm_filter_min_hz, rpm_filter_q; dshot_bidir; motor_poles | motor_pole_count
 * - tpa_rate, tpa_breakpoint, anti_gravity_gain, iterm_relax, iterm_relax_type, iterm_relax_cutoff, dyn_idle_min_rpm
 * - feedforward_transition | ff_transition, feedforward_averaging | ff_averaging, feedforward_smooth_factor | ff_smooth_factor,
 *   feedforward_jitter_factor | ff_jitter_factor, feedforward_boost | ff_boost, feedforward_max_rate_limit | ff_max_rate_limit
 * - motorOutput ("min,max")
 */
import type { PidTriple } from './types';

export type Axis3 = [roll: number, pitch: number, yaw: number];
export type SimplifiedMode = 'off' | 'rp' | 'rpy';
/** 'dmin': Betaflight <= 4.5 (D = upper value, d_min = lower); 'dmax': 2025.x (D = base value, d_max = upper). */
export type DScheme = 'dmin' | 'dmax';

export interface SimplifiedSliders {
  mode: SimplifiedMode | null;
  /** Slider values as multipliers (1.0 = 100 in the CLI). */
  master?: number;
  pi?: number;
  i?: number;
  d?: number;
  dmax?: number;
  ff?: number;
  pitchD?: number;
  pitchPi?: number;
  dtermFilter?: boolean;
  dtermMultiplier?: number;
  gyroFilter?: boolean;
  gyroMultiplier?: number;
  /** CLI name of the D-max slider as found in the header (default simplified_dmax_gain). */
  dmaxKey: string;
}

export interface LogSettings {
  /** Every header line, untouched. */
  raw: Record<string, string>;
  firmwareName?: string;
  /** e.g. [4, 5, 1] or [2025, 12, 0]. */
  firmwareVersion?: [number, number, number];
  firmwareRevision?: string;
  firmwareDate?: string;
  board?: string;
  craft?: string;
  looptimeUs?: number;
  gyroHz?: number;
  pidDenom?: number;
  pidHz?: number;
  bbIInterval?: number;
  /** Log every n-th PID loop (derived from "P interval"). */
  bbPDenom?: number;
  /** Blackbox logging rate [Hz] derived from the header (the measured rate is in LogData.fs). */
  bbRateHz?: number;
  debugMode?: number;
  debugModeName?: string;
  pid?: { roll: PidTriple; pitch: PidTriple; yaw: PidTriple };
  ff?: Axis3;
  dMin?: Axis3;
  dMax?: Axis3;
  dScheme?: DScheme;
  simplified?: SimplifiedSliders;
  gyroLpf1Type?: string;
  gyroLpf1StaticHz?: number;
  gyroLpf1DynMinHz?: number;
  gyroLpf1DynMaxHz?: number;
  gyroLpf2Type?: string;
  gyroLpf2StaticHz?: number;
  dtermLpf1Type?: string;
  dtermLpf1StaticHz?: number;
  dtermLpf1DynMinHz?: number;
  dtermLpf1DynMaxHz?: number;
  dtermLpf2Type?: string;
  dtermLpf2StaticHz?: number;
  dynNotchCount?: number;
  dynNotchQ?: number;
  dynNotchMinHz?: number;
  dynNotchMaxHz?: number;
  rpmHarmonics?: number;
  rpmMinHz?: number;
  rpmQ?: number;
  dshotBidir?: boolean;
  motorPoles?: number;
  tpaRate?: number;
  tpaBreakpoint?: number;
  antiGravityGain?: number;
  /** 0 OFF, 1 RP, 2 RPY, 3 RP_INC, 4 RPY_INC. */
  itermRelax?: number;
  itermRelaxType?: number;
  itermRelaxCutoff?: number;
  dynIdleMinRpm?: number;
  ffTransition?: number;
  ffAveraging?: number;
  ffSmoothFactor?: number;
  ffJitterFactor?: number;
  ffBoost?: number;
  ffMaxRateLimit?: number;
  motorOutput?: [number, number];
}

/** Betaflight debug mode names by index (only the stable first entries; later indices differ between versions). */
export const DEBUG_MODES = ['NONE', 'CYCLETIME', 'BATTERY', 'GYRO_FILTERED', 'ACCELEROMETER', 'PIDLOOP', 'GYRO_SCALED', 'RC_INTERPOLATION'] as const;
export const DEBUG_GYRO_SCALED = 6;

const nums = (v: string | undefined): number[] | null => {
  if (v === undefined) return null;
  const parts = v.split(',').map((x) => x.trim()).filter((x) => x !== '');
  if (!parts.length) return null;
  const n = parts.map((x) => (/^0x[0-9a-f]+$/i.test(x) ? parseInt(x, 16) : Number(x)));
  return n.every((x) => Number.isFinite(x)) ? n : null;
};

function pick(raw: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) if (raw[k] !== undefined) return raw[k];
  // case-insensitive fallback (CSV exports sometimes change case)
  const lower = new Map(Object.keys(raw).map((k) => [k.toLowerCase(), k] as const));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (real !== undefined) return raw[real];
  }
  return undefined;
}

const ON_WORDS = new Set(['on', 'true', 'yes']);
const OFF_WORDS = new Set(['off', 'false', 'no']);

function bool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  const s = v.trim().toLowerCase();
  if (ON_WORDS.has(s)) return true;
  if (OFF_WORDS.has(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) ? n !== 0 : undefined;
}

function enumNum(v: string | undefined, names: readonly string[]): number | undefined {
  if (v === undefined) return undefined;
  const s = v.trim();
  const n = Number(s);
  if (s !== '' && Number.isFinite(n)) return n;
  const i = names.indexOf(s.toUpperCase());
  return i >= 0 ? i : undefined;
}

/** Parses a raw header map into typed settings. Never throws; unknown or malformed values are left out. */
export function parseLogSettings(raw: Record<string, string>): LogSettings {
  const s: LogSettings = { raw };
  const one = (keys: string[]): number | undefined => nums(pick(raw, keys))?.[0];
  const triple = (keys: string[]): Axis3 | undefined => {
    const n = nums(pick(raw, keys));
    return n && n.length >= 3 ? [n[0]!, n[1]!, n[2]!] : undefined;
  };
  const pair = (keys: string[]): [number, number] | undefined => {
    const n = nums(pick(raw, keys));
    return n && n.length >= 2 ? [n[0]!, n[1]!] : undefined;
  };
  const str = (keys: string[]): string | undefined => {
    const v = pick(raw, keys);
    return v === undefined ? undefined : v.trim();
  };
  const set = <K extends keyof LogSettings>(k: K, v: LogSettings[K] | undefined) => {
    if (v !== undefined) s[k] = v;
  };

  // firmware
  const rev = str(['Firmware revision']);
  set('firmwareRevision', rev);
  const fm = rev ? /([A-Za-z]+)\s+(\d+)\.(\d+)(?:\.(\d+))?/.exec(rev) : null;
  if (fm) {
    s.firmwareName = fm[1]!;
    s.firmwareVersion = [Number(fm[2]), Number(fm[3]), Number(fm[4] ?? 0)];
  } else set('firmwareName', str(['Firmware type']));
  set('firmwareDate', str(['Firmware date']));
  set('board', str(['Board information']));
  set('craft', str(['Craft name']));

  // loop rates
  const looptime = one(['looptime']);
  if (looptime && looptime > 0) {
    s.looptimeUs = looptime;
    s.gyroHz = 1e6 / looptime;
  }
  const denom = one(['pid_process_denom']);
  if (denom && denom > 0) s.pidDenom = denom;
  if (s.gyroHz) s.pidHz = s.gyroHz / (s.pidDenom ?? 1);

  // blackbox rate
  set('bbIInterval', one(['I interval']));
  const pInt = pick(raw, ['P interval']);
  if (pInt !== undefined) {
    const frac = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(pInt);
    if (frac) {
      const num = Number(frac[1]);
      const den = Number(frac[2]);
      if (num > 0 && den > 0) s.bbPDenom = den / num;
    } else {
      const v = Number(pInt);
      if (Number.isFinite(v) && v > 0) s.bbPDenom = v;
    }
  }
  if (s.pidHz && s.bbPDenom) s.bbRateHz = s.pidHz / s.bbPDenom;

  // debug mode
  const dm = enumNum(pick(raw, ['debug_mode']), DEBUG_MODES);
  if (dm !== undefined) {
    s.debugMode = dm;
    const nm = DEBUG_MODES[dm];
    if (nm) s.debugModeName = nm;
    else {
      const rawName = str(['debug_mode']);
      if (rawName && !/^\d+$/.test(rawName)) s.debugModeName = rawName.toUpperCase();
    }
  }

  // PIDs
  const pt = (k: string): PidTriple | undefined => {
    const n = nums(pick(raw, [k]));
    return n && n.length >= 3 ? [n[0]!, n[1]!, n[2]!] : undefined;
  };
  const rp = pt('rollPID');
  const pp = pt('pitchPID');
  const yp = pt('yawPID');
  if (rp && pp && yp) s.pid = { roll: rp, pitch: pp, yaw: yp };
  set('ff', triple(['ff_weight', 'feedforward_weight', 'f_weight']));
  const dMax = triple(['d_max']);
  const dMin = triple(['d_min']);
  if (dMax) {
    s.dMax = dMax;
    s.dScheme = 'dmax';
  } else if (dMin) {
    s.dMin = dMin;
    s.dScheme = 'dmin';
  } else if (s.firmwareVersion) {
    s.dScheme = s.firmwareVersion[0] >= 2025 ? 'dmax' : 'dmin';
  }

  // simplified sliders
  const modeRaw = pick(raw, ['simplified_pids_mode']);
  const sl = (k: string[]): number | undefined => {
    const v = one(k);
    return v === undefined ? undefined : v / 100;
  };
  const dmaxKeyHit = ['simplified_dmax_gain', 'simplified_d_max_gain'].find((k) => raw[k] !== undefined);
  const simp: SimplifiedSliders = { mode: null, dmaxKey: dmaxKeyHit ?? (s.dScheme === 'dmax' ? 'simplified_d_max_gain' : 'simplified_dmax_gain') };
  if (modeRaw !== undefined) {
    const m = enumNum(modeRaw, ['OFF', 'RP', 'RPY']);
    simp.mode = m === 0 ? 'off' : m === 1 ? 'rp' : m === 2 ? 'rpy' : null;
  }
  const sv: [keyof SimplifiedSliders, string[]][] = [
    ['master', ['simplified_master_multiplier']],
    ['pi', ['simplified_pi_gain']],
    ['i', ['simplified_i_gain']],
    ['d', ['simplified_d_gain']],
    ['dmax', ['simplified_dmax_gain', 'simplified_d_max_gain']],
    ['ff', ['simplified_feedforward_gain']],
    ['pitchD', ['simplified_pitch_d_gain']],
    ['pitchPi', ['simplified_pitch_pi_gain']],
    ['dtermMultiplier', ['simplified_dterm_filter_multiplier']],
    ['gyroMultiplier', ['simplified_gyro_filter_multiplier']],
  ];
  let anySlider = modeRaw !== undefined;
  for (const [k, keys] of sv) {
    const v = sl(keys);
    if (v !== undefined) {
      (simp as unknown as Record<string, number>)[k] = v;
      anySlider = true;
    }
  }
  const df = bool(pick(raw, ['simplified_dterm_filter']));
  if (df !== undefined) {
    simp.dtermFilter = df;
    anySlider = true;
  }
  const gf = bool(pick(raw, ['simplified_gyro_filter']));
  if (gf !== undefined) {
    simp.gyroFilter = gf;
    anySlider = true;
  }
  if (anySlider) s.simplified = simp;

  // gyro filters
  set('gyroLpf1Type', str(['gyro_lpf1_type', 'gyro_lowpass_type']));
  set('gyroLpf1StaticHz', one(['gyro_lpf1_static_hz', 'gyro_lowpass_hz']));
  const gDyn = pair(['gyro_lpf1_dyn_hz', 'gyro_lowpass_dyn_hz']);
  if (gDyn) {
    s.gyroLpf1DynMinHz = gDyn[0];
    s.gyroLpf1DynMaxHz = gDyn[1];
  } else {
    set('gyroLpf1DynMinHz', one(['gyro_lpf1_dyn_min_hz', 'dyn_lpf_gyro_min_hz']));
    set('gyroLpf1DynMaxHz', one(['gyro_lpf1_dyn_max_hz', 'dyn_lpf_gyro_max_hz']));
  }
  set('gyroLpf2Type', str(['gyro_lpf2_type', 'gyro_lowpass2_type']));
  set('gyroLpf2StaticHz', one(['gyro_lpf2_static_hz', 'gyro_lowpass2_hz']));

  // D-term filters
  set('dtermLpf1Type', str(['dterm_lpf1_type', 'dterm_filter_type']));
  set('dtermLpf1StaticHz', one(['dterm_lpf1_static_hz', 'dterm_lowpass_hz']));
  const dDyn = pair(['dterm_lpf1_dyn_hz', 'dterm_lowpass_dyn_hz']);
  if (dDyn) {
    s.dtermLpf1DynMinHz = dDyn[0];
    s.dtermLpf1DynMaxHz = dDyn[1];
  } else {
    set('dtermLpf1DynMinHz', one(['dterm_lpf1_dyn_min_hz', 'dyn_lpf_dterm_min_hz']));
    set('dtermLpf1DynMaxHz', one(['dterm_lpf1_dyn_max_hz', 'dyn_lpf_dterm_max_hz']));
  }
  set('dtermLpf2Type', str(['dterm_lpf2_type', 'dterm_filter2_type']));
  set('dtermLpf2StaticHz', one(['dterm_lpf2_static_hz', 'dterm_lowpass2_hz']));

  // notches, RPM, motors
  set('dynNotchCount', one(['dyn_notch_count']));
  set('dynNotchQ', one(['dyn_notch_q']));
  set('dynNotchMinHz', one(['dyn_notch_min_hz']));
  set('dynNotchMaxHz', one(['dyn_notch_max_hz']));
  set('rpmHarmonics', one(['rpm_filter_harmonics']));
  set('rpmMinHz', one(['rpm_filter_min_hz']));
  set('rpmQ', one(['rpm_filter_q']));
  set('dshotBidir', bool(pick(raw, ['dshot_bidir'])));
  set('motorPoles', one(['motor_poles', 'motor_pole_count']));

  // PID controller extras
  set('tpaRate', one(['tpa_rate']));
  set('tpaBreakpoint', one(['tpa_breakpoint']));
  set('antiGravityGain', one(['anti_gravity_gain']));
  set('itermRelax', enumNum(pick(raw, ['iterm_relax']), ['OFF', 'RP', 'RPY', 'RP_INC', 'RPY_INC']));
  set('itermRelaxType', enumNum(pick(raw, ['iterm_relax_type']), ['GYRO', 'SETPOINT']));
  set('itermRelaxCutoff', one(['iterm_relax_cutoff']));
  set('dynIdleMinRpm', one(['dyn_idle_min_rpm']));
  set('ffTransition', one(['feedforward_transition', 'ff_transition']));
  set('ffAveraging', enumNum(pick(raw, ['feedforward_averaging', 'ff_averaging']), ['OFF', '2_POINT', '3_POINT', '4_POINT']));
  set('ffSmoothFactor', one(['feedforward_smooth_factor', 'ff_smooth_factor']));
  set('ffJitterFactor', one(['feedforward_jitter_factor', 'ff_jitter_factor']));
  set('ffBoost', one(['feedforward_boost', 'ff_boost']));
  set('ffMaxRateLimit', one(['feedforward_max_rate_limit', 'ff_max_rate_limit']));
  const mo = pair(['motorOutput']);
  if (mo && mo[1] > mo[0]) s.motorOutput = mo;
  return s;
}

/** True when the log carries the unfiltered gyro in debug[0..2] (debug_mode = GYRO_SCALED). */
export function hasGyroScaledDebug(s: LogSettings | undefined): boolean {
  return !!s && (s.debugMode === DEBUG_GYRO_SCALED || s.debugModeName === 'GYRO_SCALED');
}

/** RPM filter active: bidirectional DShot on and at least one harmonic. Null when the header does not say. */
export function rpmFilterActive(s: LogSettings | undefined): boolean | null {
  if (!s || (s.dshotBidir === undefined && s.rpmHarmonics === undefined)) return null;
  return !!s.dshotBidir && (s.rpmHarmonics ?? 3) > 0;
}
