/**
 * Read steps of the tabs outside the core (tuning, receiver, modes, blackbox, OSD). Registered at module load, so the
 * connect-time snapshot reads them together with the core config and the user never has to press "read".
 * The tabs decode `ctx.bf.get().raw.get(STEP.x)` themselves (the decoders need the MSP API version) and call
 * `ctx.bf.refresh(AREA.x)` when they open, to pick up changes made elsewhere (CLI, another tool).
 */
import { MSPB } from './blackbox';
import { MSPO } from './osd';
import { registerBfStep, type BfArea } from './store';

/** MSP codes of these tabs that the core code table does not list. */
export const CMD = {
  RSSI_CONFIG: 50,
  SET_RSSI_CONFIG: 51,
  MODE_RANGES: 34,
  SET_MODE_RANGE: 35,
  RX_MAP: 64,
  SET_RX_MAP: 65,
  FILTER_CONFIG: 92,
  SET_FILTER_CONFIG: 93,
  PID_ADVANCED: 94,
  SET_PID_ADVANCED: 95,
  RC_TUNING: 111,
  BOXNAMES: 116,
  BOXIDS: 119,
  RC_DEADBAND: 125,
  SET_PID: 202,
  SET_RC_TUNING: 204,
  SELECT_SETTING: 210,
  SET_RC_DEADBAND: 218,
  MODE_RANGES_EXTRA: 238,
} as const;

/** Step ids (keys of `BfData.raw`). 'pid', 'rx', 'advanced', 'motor' and 'mixer' are core steps. */
export const STEP = {
  pid: 'pid',
  pidAdv: 'pidAdv',
  rcTuning: 'rcTuning',
  filter: 'filter',
  rx: 'rx',
  rxMap: 'rxMap',
  deadband: 'rcDeadband',
  rssi: 'rssiCfg',
  boxNames: 'boxNames',
  boxIds: 'boxIds',
  modeRanges: 'modeRanges',
  modeRangesExtra: 'modeRangesExtra',
  bbConfig: 'bbConfig',
  flash: 'flash',
  sdcard: 'sdcard',
  osd: 'osdConfig',
  osdCanvas: 'osdCanvas',
  advanced: 'advanced',
  motor: 'motor',
  mixer: 'mixer',
} as const;

/** Areas to refresh per tab (core areas included where the tab shows them). */
export const AREA = {
  tuning: ['status', 'pid', 'tuning'] as Array<BfArea | string>,
  receiver: ['rx', 'receiver'] as Array<BfArea | string>,
  modes: ['modes'] as Array<BfArea | string>,
  blackbox: ['blackbox', 'advanced'] as Array<BfArea | string>,
  osd: ['osd'] as Array<BfArea | string>,
  motors: ['advanced', 'motor', 'mixer'] as Array<BfArea | string>,
};

const keep = (): void => undefined; // the raw payload is all the tabs need

const steps: Array<[id: string, area: string, code: number, minApi?: number]> = [
  [STEP.pidAdv, 'tuning', CMD.PID_ADVANCED],
  [STEP.rcTuning, 'tuning', CMD.RC_TUNING],
  [STEP.filter, 'tuning', CMD.FILTER_CONFIG],
  [STEP.rxMap, 'receiver', CMD.RX_MAP],
  [STEP.deadband, 'receiver', CMD.RC_DEADBAND],
  [STEP.rssi, 'receiver', CMD.RSSI_CONFIG],
  [STEP.boxNames, 'modes', CMD.BOXNAMES],
  [STEP.boxIds, 'modes', CMD.BOXIDS],
  [STEP.modeRanges, 'modes', CMD.MODE_RANGES],
  [STEP.modeRangesExtra, 'modes', CMD.MODE_RANGES_EXTRA],
  [STEP.bbConfig, 'blackbox', MSPB.BLACKBOX_CONFIG],
  [STEP.flash, 'blackbox', MSPB.DATAFLASH_SUMMARY],
  [STEP.sdcard, 'blackbox', MSPB.SDCARD_SUMMARY],
  [STEP.osd, 'osd', MSPO.OSD_CONFIG],
  [STEP.osdCanvas, 'osd', MSPO.OSD_CANVAS, 45],
];
for (const [id, area, code, minApi] of steps) registerBfStep({ id, area, code, minApi, apply: keep });

/** The raw payload a step stored for the current connection, or null (not read yet / not supported). */
export const rawOf = (bf: { raw: Map<string, Uint8Array> }, id: string): Uint8Array | null => bf.raw.get(id) ?? null;

/** Stable key of several raw payloads: lets a tab skip re-rendering when a refresh brought nothing new. */
export const rawKey = (bf: { raw: Map<string, Uint8Array> }, ids: readonly string[]): string => ids.map((id) => (bf.raw.get(id) ?? []).join(',')).join('|');

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
