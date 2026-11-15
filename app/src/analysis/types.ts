/** Wspolne typy analizy logu blackbox. */

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
}

export type PidTriple = [p: number, i: number, d: number];
