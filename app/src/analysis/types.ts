/** Wspolne typy analizy logu blackbox. */
import type { LogSettings } from './settings';

export interface LogData {
  /** Czestotliwosc probkowania [Hz]. */
  fs: number;
  rows: number;
  duration: number; // s
  /** Setpoint [deg/s] roll/pitch/yaw. */
  setpoint: Float32Array[];
  /** Gyro [deg/s] roll/pitch/yaw. */
  gyro: Float32Array[];
  /** Silniki (0..4 kanalow, surowe wartosci z logu). */
  motor: Float32Array[];
  /** true, gdy setpoint przyblizono z rcCommand. */
  rcFallback: boolean;
  /** Throttle stick (rcCommand[3], 1000..2000) when the log has it; drives the throttle coverage of the log quality score. */
  throttle?: Float32Array;
  /** Motor output range from the log header (`motorOutput`), for the saturation share; absent for CSV. */
  motorRange?: [min: number, max: number];
  /** PIDs the quad flew with, from the log header (rollPID/pitchPID/yawPID); absent for CSV. */
  headerPid?: HeaderPid;
  /** Typed header settings (bbl header, or the key/value rows of a CSV export); absent when the log has no header. */
  settings?: LogSettings;
  /** Unfiltered gyro [deg/s] roll/pitch/yaw: gyroUnfilt[] columns, or debug[0..2] when debug_mode = GYRO_SCALED. */
  gyroUnfilt?: Float32Array[];
  /** D-term output (axisD[0..2]; yaw is often missing, then only roll/pitch). */
  axisD?: Float32Array[];
  /** debug[0..3] raw values, when logged. */
  debug?: Float32Array[];
}

/** P/I/D per axis as written in a Blackbox log header. */
export interface HeaderPid {
  roll: PidTriple;
  pitch: PidTriple;
  yaw: PidTriple;
}

/** Coverage statistics of a log, computed next to the analysis (inputs of analysis/quality.ts). */
export interface LogStats {
  /** Seconds of clear stick movement (|setpoint| above the activity threshold) per axis roll/pitch/yaw. */
  activeSec: [number, number, number];
  /** Share of 10 % throttle bins (0-100 %) that hold at least a little data; null without a throttle column. */
  throttleCoverage: number | null;
  /** Share of samples where at least one motor sits at its maximum; null when the motor range is unknown. */
  saturation: number | null;
}

export interface Peak {
  hz: number;
  db: number;
  /** Wybicie ponad lokalne tlo [dB]. */
  prom: number;
}

export interface AxisResult {
  name: 'Roll' | 'Pitch' | 'Yaw';
  /** Odpowiedz skokowa 0..500 ms co 1 ms (501 punktow) albo null, gdy brak danych. */
  step: number[] | null;
  windows: number;
  /** Przeregulowanie [%]. */
  overshoot: number | null;
  peakValue: number | null;
  peakTime: number | null; // ms
  /** Czas narastania 10-90% [ms]. */
  rise: number | null;
  /** Czas ustalania (pasmo +-5%) [ms]; null = nie ustalil sie w 500 ms. */
  settle: number | null;
}

export interface AnalysisResult {
  name: string;
  fs: number;
  duration: number;
  rows: number;
  rcFallback: boolean;
  axes: AxisResult[];
  spectrum: { df: number; maxHz: number; db: number[][] };
  peaks: { motor: Peak | null; frame: Peak | null };
  /** Coverage statistics for the log quality score (optional: older cached results do not have it). */
  stats?: LogStats;
  /** PIDs from the log header, when the log has them. */
  headerPid?: HeaderPid;
}

export type PidTriple = [p: number, i: number, d: number];
