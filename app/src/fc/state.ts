/** Model drona i magazyn stanu z eventami. */
import type { ElrsInfo } from '../bf/elrs-flow';
import type { EscScan } from '../bf/esc-flow';

export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface FcInfo {
  apiVersion: { major: number; minor: number };
  variant: string; // "BTFL"
  version: string; // "4.5.1"
  /** Identyfikator plyty (4 znaki), np. S405. */
  boardId: string;
  /** Nazwa targetu/plyty z BOARD_INFO, np. SPEEDYBEEF405V4. */
  boardName: string;
  manufacturer: string;
  /** Craft name (MSP_NAME), empty when not set. */
  craftName: string;
}

export interface FcConfig {
  gyroSyncDenom: number;
  pidProcessDenom: number;
  /** Enum protokolu silnikow BF (0 PWM .. 9 DISABLED). */
  motorPwmProtocol: number;
  motorPwmRate: number;
  minThrottle: number;
  maxThrottle: number;
  minCommand: number;
  motorCount: number;
  motorPoles: number;
  /** Bidirectional DShot (dshot_bidir) - z MSP_MOTOR_CONFIG.useDshotTelemetry. */
  bidir: boolean;
  useEscSensor: boolean;
}

export interface FcStatus {
  cycleTimeUs: number;
  i2cErrors: number;
  sensors: number;
  flightModeFlags: number;
  cpuLoad: number;
  /** Maska flag blokady uzbrojenia (arming disable flags). */
  armingDisableFlags: number;
  /** Czy FC jest uzbrojony (bit 0 flightModeFlags = ARM). */
  armed: boolean;
}

export type PidAxis = [p: number, i: number, d: number];
export interface PidSet {
  roll: PidAxis;
  pitch: PidAxis;
  yaw: PidAxis;
}

export interface Telemetry {
  /** Surowe wartosci silnikow 1000-2000 (0 = brak). */
  motors: number[];
  vbat: number; // V
  mah: number;
  /** RSSI 0-1023 z MSP_ANALOG. */
  rssi: number;
  amperage: number; // A
  gyro: [number, number, number];
  acc: [number, number, number];
  t: number;
}

export interface FcState {
  conn: ConnState;
  mode: 'serial' | 'demo' | null;
  info: FcInfo | null;
  config: FcConfig | null;
  status: FcStatus | null;
  pid: PidSet | null;
  telemetry: Telemetry | null;
  /** Szacowana liczba cel (z napiecia), null gdy brak baterii. */
  cells: number | null;
  /** Ostatni `diff all` (kopia/kontekst AI). */
  diff: string | null;
  diffAt: number | null;
  error: string | null;
  /** Read from the hardware (never typed in): ESC scan via the 4-way interface, ELRS receiver via CRSF. */
  hw: { esc?: EscScan; elrs?: ElrsInfo };
}

export const initialState = (): FcState => ({
  conn: 'disconnected',
  mode: null,
  info: null,
  config: null,
  status: null,
  pid: null,
  telemetry: null,
  cells: null,
  diff: null,
  diffAt: null,
  error: null,
  hw: {},
});

type Listener = () => void;

/** Prosty magazyn: `state` (strukturalny, rzadko) i `telemetry` (co 100 ms) maja osobne kanaly. */
export class FcStore {
  private s: FcState = initialState();
  private stateCbs = new Set<Listener>();
  private telCbs = new Set<Listener>();

  get(): Readonly<FcState> {
    return this.s;
  }

  patch(p: Partial<FcState>): void {
    this.s = { ...this.s, ...p };
    for (const cb of [...this.stateCbs]) cb();
  }

  setTelemetry(t: Telemetry): void {
    this.s = { ...this.s, telemetry: t };
    for (const cb of [...this.telCbs]) cb();
  }

  reset(keep: Partial<FcState> = {}): void {
    this.s = { ...initialState(), ...keep };
    for (const cb of [...this.stateCbs]) cb();
  }

  /** Zmiany strukturalne (polaczenie, konfiguracja, status). */
  subscribe(cb: Listener): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }

  /** Probki telemetrii (silniki, bateria, RSSI, gyro). */
  subscribeTelemetry(cb: Listener): () => void {
    this.telCbs.add(cb);
    return () => this.telCbs.delete(cb);
  }
}

export const PROTOCOL_NAMES = ['PWM', 'ONESHOT125', 'ONESHOT42', 'MULTISHOT', 'BRUSHED', 'DSHOT150', 'DSHOT300', 'DSHOT600', 'PROSHOT1000', 'DISABLED'] as const;
export const isDshot = (p: number) => p >= 5 && p <= 8;
export const protocolName = (p: number) => PROTOCOL_NAMES[p] ?? `#${p}`;
/** Procent mocy silnika z surowej wartosci 1000-2000. */
export const motorPct = (raw: number) => Math.max(0, Math.min(100, Math.round((raw - 1000) / 10)));
export const rssiPct = (raw: number) => Math.max(0, Math.min(100, Math.round((raw / 1023) * 100)));
