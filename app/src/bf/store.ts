/**
 * Betaflight configuration store + session (see docs/ARCHITECTURE.md).
 *
 *  - `BfData`   typed snapshot of everything the FC reported (plus the raw payload of every command).
 *  - `BfStore`  holds BfData and the connect-time progress, notifies subscribers.
 *  - `BfSession` (exposed as `ctx.bf`) runs the read-everything sequence, `refresh(area)`, the typed request helper,
 *                `saveSettings()` and the reboot/reset actions.
 */
import { t } from '../i18n';
import { MspError } from '../serial/msp';
import type { FcLink } from '../serial/types';
import { C, API, TEXT } from './codes';
import * as D from './decode';

export type BfArea =
  | 'ident'
  | 'status'
  | 'names'
  | 'features'
  | 'advanced'
  | 'mixer'
  | 'motor'
  | 'arming'
  | 'sensors'
  | 'alignment'
  | 'beeper'
  | 'rx'
  | 'failsafe'
  | 'pid'
  | 'battery'
  | 'serial';

export const ALL_AREAS: BfArea[] = ['ident', 'status', 'names', 'features', 'advanced', 'mixer', 'motor', 'arming', 'sensors', 'alignment', 'beeper', 'rx', 'failsafe', 'pid', 'battery', 'serial'];

export interface BfData {
  /** MSP API minor (major is always 1); 0 before the first read. */
  api: number;
  /** False when the firmware is not Betaflight or the API is older than 1.44 (CLI only). */
  supported: boolean;
  variant: string;
  version: string;
  build: D.BuildInfo | null;
  board: D.BoardInfo | null;
  uid: string;
  craftName: string;
  pilotName: string;
  mcuName: string;
  sensorActive: D.SensorActive | null;
  status: D.StatusEx | null;
  features: number | null;
  advanced: D.AdvancedConfig | null;
  mixer: D.MixerConfig | null;
  motor: D.MotorConfig | null;
  arming: D.ArmingConfig | null;
  beeper: D.BeeperConfig | null;
  sensorConfig: D.SensorConfig | null;
  sensorAlign: D.SensorAlignment | null;
  accTrim: D.AccTrim | null;
  boardAlign: D.Rpy | null;
  rx: D.RxConfigLite | null;
  failsafe: D.FailsafeConfig | null;
  rxFail: D.RxFailChannel[] | null;
  battery: D.BatteryConfig | null;
  voltageMeters: D.VoltageMeterCfg[] | null;
  currentMeters: D.CurrentMeterCfg[] | null;
  batteryState: D.BatteryState | null;
  serial: D.SerialConfig | null;
  /** Raw payload of the last successful read per step id (e.g. 'arming', 'failsafe'): bug reports and read-modify-write encoders. */
  raw: Map<string, Uint8Array>;
  /** Step ids the FC answered with an error or never answered: "not supported by this firmware". */
  unsupported: Set<string>;
  /** Extension slot for areas owned by other modules (see registerBfStep). */
  ext: Record<string, unknown>;
}

export const emptyBfData = (): BfData => ({
  api: 0,
  supported: true,
  variant: '',
  version: '',
  build: null,
  board: null,
  uid: '',
  craftName: '',
  pilotName: '',
  mcuName: '',
  sensorActive: null,
  status: null,
  features: null,
  advanced: null,
  mixer: null,
  motor: null,
  arming: null,
  beeper: null,
  sensorConfig: null,
  sensorAlign: null,
  accTrim: null,
  boardAlign: null,
  rx: null,
  failsafe: null,
  rxFail: null,
  battery: null,
  voltageMeters: null,
  currentMeters: null,
  batteryState: null,
  serial: null,
  raw: new Map(),
  unsupported: new Set(),
  ext: {},
});

const cloneData = (d: BfData): BfData => ({ ...d, raw: new Map(d.raw), unsupported: new Set(d.unsupported), ext: { ...d.ext } });

export interface BfProgress {
  done: number;
  total: number;
}

type Cb = () => void;

export class BfStore {
  private d: BfData = emptyBfData();
  private prog: BfProgress | null = null;
  private cbs = new Set<Cb>();
  private ready = false;

  get(): Readonly<BfData> {
    return this.d;
  }
  /** Non-null while the connect-time read is running. */
  progress(): BfProgress | null {
    return this.prog;
  }
  /** True once a full snapshot has been read for the current connection. */
  isReady(): boolean {
    return this.ready;
  }
  set(d: BfData, ready = this.ready): void {
    this.d = d;
    this.ready = ready;
    this.emit();
  }
  setProgress(p: BfProgress | null): void {
    this.prog = p;
    this.emit();
  }
  reset(): void {
    this.d = emptyBfData();
    this.prog = null;
    this.ready = false;
    this.emit();
  }
  subscribe(cb: Cb): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }
  private emit(): void {
    for (const cb of [...this.cbs]) cb();
  }
}

/* ---------------- the read-everything sequence ---------------- */

export interface BfStep {
  id: string;
  area: BfArea | (string & {});
  code: number;
  minApi?: number;
  maxApi?: number;
  /** Request payload (e.g. the text type for MSP2_GET_TEXT). */
  payload?: (d: BfData) => Uint8Array | undefined;
  /** Dynamic skip (e.g. the legacy serial command when the v2 one worked). */
  when?: (d: BfData) => boolean;
  /** Writes the decoded value into the working copy. */
  apply(d: BfData, p: Uint8Array, api: number): void;
}

const gate = (s: BfStep, api: number): boolean => (s.minApi === undefined || api >= s.minApi) && (s.maxApi === undefined || api <= s.maxApi);

const STEPS: BfStep[] = [
  { id: 'api', area: 'ident', code: C.API_VERSION, apply: (d, p) => void (d.api = D.decodeApiVersion(p).minor) },
  { id: 'variant', area: 'ident', code: C.FC_VARIANT, apply: (d, p) => void (d.variant = String.fromCharCode(...p.subarray(0, 4))) },
  { id: 'version', area: 'ident', code: C.FC_VERSION, apply: (d, p) => void (d.version = D.decodeFcVersion(p)) },
  { id: 'build', area: 'ident', code: C.BUILD_INFO, apply: (d, p, api) => void (d.build = D.decodeBuildInfo(p, api)) },
  { id: 'board', area: 'ident', code: C.BOARD_INFO, apply: (d, p, api) => void (d.board = D.decodeBoardInfo(p, api)) },
  { id: 'status', area: 'status', code: C.STATUS_EX, apply: (d, p, api) => void (d.status = D.decodeStatusEx(p, api)) },
  { id: 'uid', area: 'ident', code: C.UID, apply: (d, p) => void (d.uid = D.decodeUid(p)) },
  { id: 'craft', area: 'names', code: C.GET_TEXT, minApi: API.BF44, payload: () => Uint8Array.of(TEXT.CRAFT), apply: (d, p) => void (d.craftName = D.decodeText(p).text) },
  { id: 'pilot', area: 'names', code: C.GET_TEXT, minApi: API.BF44, payload: () => Uint8Array.of(TEXT.PILOT), apply: (d, p) => void (d.pilotName = D.decodeText(p).text) },
  { id: 'name', area: 'names', code: C.NAME, maxApi: API.BF43, apply: (d, p) => void (d.craftName = String.fromCharCode(...p).replace(/\0+$/, '')) },
  { id: 'features', area: 'features', code: C.FEATURE_CONFIG, apply: (d, p) => void (d.features = D.decodeFeatures(p)) },
  { id: 'advanced', area: 'advanced', code: C.ADVANCED_CONFIG, apply: (d, p) => void (d.advanced = D.decodeAdvanced(p)) },
  { id: 'mixer', area: 'mixer', code: C.MIXER_CONFIG, apply: (d, p) => void (d.mixer = D.decodeMixer(p)) },
  { id: 'motor', area: 'motor', code: C.MOTOR_CONFIG, apply: (d, p) => void (d.motor = D.decodeMotorConfig(p)) },
  { id: 'arming', area: 'arming', code: C.ARMING_CONFIG, apply: (d, p, api) => void (d.arming = D.decodeArming(p, api)) },
  { id: 'sensorCfg', area: 'sensors', code: C.SENSOR_CONFIG, apply: (d, p) => void (d.sensorConfig = D.decodeSensorConfig(p)) },
  { id: 'sensorAct', area: 'sensors', code: C.SENSOR_CONFIG_ACTIVE, minApi: API.BF45, apply: (d, p) => void (d.sensorActive = D.decodeSensorActive(p)) },
  { id: 'mcu', area: 'ident', code: C.MCU_INFO, minApi: API.BF2025_12, apply: (d, p) => void (d.mcuName = D.decodeMcuInfo(p).name) },
  { id: 'sensorAlign', area: 'alignment', code: C.SENSOR_ALIGNMENT, apply: (d, p) => void (d.sensorAlign = D.decodeSensorAlignment(p)) },
  { id: 'accTrim', area: 'alignment', code: C.ACC_TRIM, apply: (d, p) => void (d.accTrim = D.decodeAccTrim(p)) },
  { id: 'boardAlign', area: 'alignment', code: C.BOARD_ALIGNMENT_CONFIG, apply: (d, p) => void (d.boardAlign = D.decodeBoardAlignment(p)) },
  { id: 'beeper', area: 'beeper', code: C.BEEPER_CONFIG, apply: (d, p) => void (d.beeper = D.decodeBeeper(p)) },
  { id: 'rx', area: 'rx', code: C.RX_CONFIG, apply: (d, p) => void (d.rx = D.decodeRxConfigLite(p)) },
  { id: 'failsafe', area: 'failsafe', code: C.FAILSAFE_CONFIG, apply: (d, p) => void (d.failsafe = D.decodeFailsafe(p)) },
  { id: 'rxfail', area: 'failsafe', code: C.RXFAIL_CONFIG, apply: (d, p) => void (d.rxFail = D.decodeRxFail(p)) },
  { id: 'pid', area: 'pid', code: C.PID, apply: () => undefined },
  { id: 'battery', area: 'battery', code: C.BATTERY_CONFIG, apply: (d, p) => void (d.battery = D.decodeBatteryConfig(p)) },
  { id: 'vmeterCfg', area: 'battery', code: C.VOLTAGE_METER_CONFIG, apply: (d, p) => void (d.voltageMeters = D.decodeVoltageMeterConfig(p)) },
  { id: 'cmeterCfg', area: 'battery', code: C.CURRENT_METER_CONFIG, apply: (d, p) => void (d.currentMeters = D.decodeCurrentMeterConfig(p)) },
  { id: 'batState', area: 'battery', code: C.BATTERY_STATE, apply: (d, p) => void (d.batteryState = D.decodeBatteryState(p)) },
  { id: 'serial2', area: 'serial', code: C.COMMON_SERIAL_CONFIG, apply: (d, p) => void (d.serial = D.decodeSerialConfig(p, 'v2')) },
  { id: 'serial1', area: 'serial', code: C.CF_SERIAL_CONFIG, when: (d) => d.serial === null, apply: (d, p) => void (d.serial = D.decodeSerialConfig(p, 'legacy')) },
];

/**
 * Lets another module add commands to the connect-time snapshot. The decoded value goes into `data.ext[id]`:
 *
 *   registerBfStep({ id: 'osd', area: 'osd', code: 92, apply: (d, p, api) => { d.ext.osd = decodeOsd(p, api); } });
 *
 * Call it at module load (imported from your screen file) and read the result with `ctx.bf.get().ext.osd`.
 */
export function registerBfStep(step: BfStep): void {
  if (!STEPS.some((s) => s.id === step.id)) STEPS.push(step);
}

/* ---------------- typed request helper ---------------- */

export interface BfCommand<T> {
  code: number;
  minApi?: number;
  decode(p: Uint8Array, api: number): T;
}

export interface MspWrite {
  code: number;
  payload: Uint8Array;
  /** Short label for error messages (e.g. "SET_ARMING_CONFIG"). */
  label?: string;
}

export interface SaveOptions {
  /** Send MSP_REBOOT after EEPROM_WRITE and wait for the FC to come back (serial ports, motor protocol, ...). */
  reboot?: boolean;
  /** Areas to re-read afterwards (default: all). */
  areas?: BfArea[];
}

export interface SaveResult {
  ok: boolean;
  error?: string;
  rebooted: boolean;
}

export interface BfSessionDeps {
  link(): FcLink | null;
  /** Starts watching the connection NOW; resolves true when it dropped and came back within `ms`. */
  watchReconnect(ms: number): Promise<boolean>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class BfSession {
  readonly store = new BfStore();
  constructor(private deps: BfSessionDeps) {}

  get(): Readonly<BfData> {
    return this.store.get();
  }
  subscribe(cb: () => void): () => void {
    return this.store.subscribe(cb);
  }
  reset(): void {
    this.store.reset();
  }

  /** Full read-everything sequence (spec section 2) with progress; throws only when the link is dead or the API version is unreadable. */
  async snapshot(link: FcLink): Promise<void> {
    const d = emptyBfData();
    this.store.set(d, false);
    const first = STEPS.slice(0, 2); // API version, variant
    const rest = STEPS.slice(2);
    this.store.setProgress({ done: 0, total: STEPS.length });
    const streak = { n: 0 };
    let done = 0;
    for (const s of first) {
      await this.runStep(link, d, s, streak, true);
      this.store.setProgress({ done: ++done, total: STEPS.length });
    }
    d.supported = d.variant === 'BTFL' && d.api >= API.BF43;
    if (!d.supported) {
      this.store.set(d, true);
      this.store.setProgress(null);
      return;
    }
    const list = rest.filter((s) => gate(s, d.api));
    const total = first.length + list.length;
    this.store.setProgress({ done, total });
    for (const s of list) {
      if (!s.when || s.when(d)) await this.runStep(link, d, s, streak, false);
      this.store.setProgress({ done: ++done, total });
    }
    this.store.set(d, true);
    this.store.setProgress(null);
  }

  /** Re-reads one or more areas (e.g. after a save, or when a tab opens and wants fresh data). */
  async refresh(area: BfArea | string | Array<BfArea | string>): Promise<void> {
    const link = this.deps.link();
    if (!link || !this.store.isReady()) return;
    const areas = Array.isArray(area) ? area : [area];
    const d = cloneData(this.store.get());
    const list = STEPS.filter((s) => areas.includes(s.area) && gate(s, d.api));
    const streak = { n: 0 };
    try {
      for (const s of list) if (!s.when || s.when(d)) await this.runStep(link, d, s, streak, false);
    } catch {
      return; // the link is gone; the app handles the disconnect
    }
    this.store.set(d);
  }

  private async runStep(link: FcLink, d: BfData, s: BfStep, streak: { n: number }, mandatory: boolean): Promise<void> {
    try {
      const p = await link.request(s.code, s.payload?.(d), 1000, 3);
      streak.n = 0;
      s.apply(d, p, d.api);
      d.raw.set(s.id, p);
      d.unsupported.delete(s.id);
    } catch (e) {
      if (mandatory) throw e;
      if (e instanceof MspError && e.kind === 'timeout') {
        if (++streak.n >= 3) throw e; // 3 timeouts in a row: the link is dead
      } else if (e instanceof MspError && e.kind === 'closed') {
        throw e;
      } else streak.n = 0;
      d.unsupported.add(s.id);
    }
  }

  /** Typed request: sends the command and decodes the reply. Returns null when the firmware does not support it. */
  async read<T>(cmd: BfCommand<T>, payload?: Uint8Array): Promise<T | null> {
    const link = this.deps.link();
    if (!link) return null;
    const api = this.store.get().api;
    if (cmd.minApi !== undefined && api < cmd.minApi) return null;
    try {
      return cmd.decode(await link.request(cmd.code, payload, 1000, 2), api);
    } catch (e) {
      if (e instanceof MspError && e.kind === 'closed') throw e;
      return null;
    }
  }

  /** Raw request on the active link (throws when there is no link or the FC rejects). */
  send(code: number, payload?: Uint8Array, timeoutMs = 1000): Promise<Uint8Array> {
    const link = this.deps.link();
    if (!link) return Promise.reject(new Error(t('conn.connectFirst')));
    return link.request(code, payload, timeoutMs);
  }

  /** Keeps the status in the store current (called by the telemetry loop about once a second). */
  ingestStatus(ex: D.StatusEx): void {
    const cur = this.store.get();
    const prev = cur.status;
    const changed = !prev || prev.armingFlags !== ex.armingFlags || prev.sensors !== ex.sensors || prev.rebootRequired !== ex.rebootRequired || prev.pidProfile !== ex.pidProfile || prev.rateProfile !== ex.rateProfile || (prev.modeFlags & 1) !== (ex.modeFlags & 1);
    if (changed) this.store.set({ ...cur, status: ex }, this.store.isReady());
    else (cur as BfData).status = ex; // quiet update (CPU load, cycle time): readers pick it up on their next poll
  }

  /** True while the FC reports itself armed (MSP refuses EEPROM writes, reboots and calibration then). */
  isArmed(): boolean {
    return ((this.store.get().status?.modeFlags ?? 0) & 1) === 1;
  }

  /**
   * The one save path: MSP SET commands -> 100 ms -> MSP_EEPROM_WRITE -> (MSP_REBOOT -> reconnect) -> re-read.
   * Never called without the user pressing Save.
   */
  async saveSettings(writes: MspWrite[], opts: SaveOptions = {}): Promise<SaveResult> {
    const link = this.deps.link();
    if (!link) return { ok: false, error: t('conn.connectFirst'), rebooted: false };
    if (this.isArmed()) return { ok: false, error: t('bfCore.armedBlock'), rebooted: false };
    try {
      for (const w of writes) {
        try {
          await link.request(w.code, w.payload, 1500, 2);
        } catch (e) {
          return { ok: false, error: t('bfCore.writeFail', { cmd: w.label ?? String(w.code), msg: errText(e) }), rebooted: false };
        }
      }
      await sleep(100);
      try {
        await link.request(C.EEPROM_WRITE, undefined, 3000);
      } catch (e) {
        return { ok: false, error: t('bfCore.eepromFail', { msg: errText(e) }), rebooted: false };
      }
      if (opts.reboot) {
        if (link.kind === 'demo') {
          await sleep(1200); // simulated reboot: the demo keeps its state
          await this.refresh(opts.areas ?? ALL_AREAS);
          return { ok: true, rebooted: true };
        }
        const back = this.deps.watchReconnect(25000);
        link.expectReboot('reconnect');
        await link.request(C.REBOOT, Uint8Array.of(0), 1000).catch(() => undefined);
        const ok = await back; // the app re-opens the port and re-reads everything
        return ok ? { ok: true, rebooted: true } : { ok: false, error: t('bfCore.noReturn'), rebooted: true };
      }
      await this.refresh(opts.areas ?? ALL_AREAS);
      return { ok: true, rebooted: false };
    } catch (e) {
      return { ok: false, error: errText(e), rebooted: false };
    }
  }

  /** Reboots the FC into the ROM bootloader (DFU), the flash bootloader or mass-storage mode. The connection is dropped on purpose. */
  async rebootTo(kind: 'firmware' | 'bootloader' | 'flashBootloader' | 'msc'): Promise<{ ok: boolean; demo?: boolean; error?: string }> {
    const link = this.deps.link();
    if (!link) return { ok: false, error: t('conn.connectFirst') };
    if (this.isArmed()) return { ok: false, error: t('bfCore.armedBlock') };
    if (link.kind === 'demo') return { ok: true, demo: true };
    const type = { firmware: 0, bootloader: 1, msc: 2, flashBootloader: 4 }[kind];
    try {
      link.expectReboot(kind === 'firmware' ? 'reconnect' : 'leave');
      await link.request(C.REBOOT, Uint8Array.of(type), 1500);
      return { ok: true };
    } catch (e) {
      if (e instanceof MspError && e.kind === 'closed') return { ok: true }; // the port vanished with the reboot
      return { ok: false, error: errText(e) };
    }
  }

  /** MSP_RESET_CONF: wipes the EEPROM to defaults and reboots. The caller must have asked for typed confirmation. */
  async resetConfig(): Promise<SaveResult> {
    const link = this.deps.link();
    if (!link) return { ok: false, error: t('conn.connectFirst'), rebooted: false };
    if (this.isArmed()) return { ok: false, error: t('bfCore.armedBlock'), rebooted: false };
    try {
      if (link.kind === 'demo') {
        await link.request(C.RESET_CONF);
        await sleep(1200);
        await this.refresh(ALL_AREAS);
        return { ok: true, rebooted: true };
      }
      const back = this.deps.watchReconnect(25000);
      link.expectReboot('reconnect');
      const reply = await link.request(C.RESET_CONF, undefined, 3000);
      if (reply.length > 0 && reply[0] === 0) return { ok: false, error: t('bfCore.resetRefused'), rebooted: false };
      const ok = await back;
      return ok ? { ok: true, rebooted: true } : { ok: false, error: t('bfCore.noReturn'), rebooted: true };
    } catch (e) {
      return { ok: false, error: errText(e), rebooted: false };
    }
  }

  /** MSP_SET_ARMING_DISABLED (1 = disable arming while the tool is connected, 0 = release). Best effort. */
  async setArmingDisabled(on: boolean): Promise<void> {
    try {
      await this.deps.link()?.request(C.SET_ARMING_DISABLED, Uint8Array.of(on ? 1 : 0), 600);
    } catch {
      /* not fatal: the FC keeps working, only the safety interlock is missing */
    }
  }
}
