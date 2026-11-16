/**
 * Tiny MSP adapter for the tuning / receiver / modes screens. It sits on the existing `ctx.link().request()` (MSP v1)
 * and exposes read / write / save. It is deliberately small so it can be swapped for the shared core helper later.
 */
import type { AppContext } from '../context';

/** MSP v1 command codes used by these screens (spec 3.x). */
export const CMD = {
  RX_CONFIG: 44,
  SET_RX_CONFIG: 45,
  RSSI_CONFIG: 50,
  SET_RSSI_CONFIG: 51,
  RX_MAP: 64,
  SET_RX_MAP: 65,
  SET_REBOOT: 68,
  FILTER_CONFIG: 92,
  SET_FILTER_CONFIG: 93,
  PID_ADVANCED: 94,
  SET_PID_ADVANCED: 95,
  MODE_RANGES: 34,
  SET_MODE_RANGE: 35,
  RC: 105,
  RC_TUNING: 111,
  PID: 112,
  BOXNAMES: 116,
  BOXIDS: 119,
  RC_DEADBAND: 125,
  STATUS_EX: 150,
  SET_PID: 202,
  SET_RC_TUNING: 204,
  SELECT_SETTING: 210,
  SET_RC_DEADBAND: 218,
  MODE_RANGES_EXTRA: 238,
  EEPROM_WRITE: 250,
} as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface BfIo {
  /** MSP request; rejects when the FC answers with the error frame (= unsupported) or on timeout. */
  read(cmd: number, payload?: Uint8Array): Promise<Uint8Array>;
  /** Like read, but resolves null instead of rejecting (optional commands). */
  tryRead(cmd: number, payload?: Uint8Array): Promise<Uint8Array | null>;
  /** MSP SET command (RAM only until save()). */
  write(cmd: number, payload: Uint8Array): Promise<void>;
  /** MSP_EEPROM_WRITE after a short settle delay, optionally followed by MSP_SET_REBOOT. */
  save(opts?: { reboot?: boolean }): Promise<void>;
  /** MSP API minor (1.x) of the connected FC; 46 when unknown. */
  apiMinor(): number;
  connected(): boolean;
}

export function createIo(ctx: AppContext): BfIo {
  const link = () => {
    const l = ctx.link();
    if (!l) throw new Error('not connected');
    return l;
  };
  const read: BfIo['read'] = (cmd, payload) => link().request(cmd, payload);
  return {
    read,
    tryRead: async (cmd, payload) => {
      try {
        return await read(cmd, payload);
      } catch {
        return null;
      }
    },
    write: async (cmd, payload) => {
      await link().request(cmd, payload);
    },
    save: async (opts) => {
      await sleep(100); // let the FC process every SET before EEPROM_WRITE (spec 4)
      await link().request(CMD.EEPROM_WRITE);
      if (opts?.reboot) await link().request(CMD.SET_REBOOT, Uint8Array.from([0]));
    },
    apiMinor: () => ctx.state.get().info?.apiVersion.minor ?? 46,
    connected: () => ctx.state.get().conn === 'connected' && ctx.link() !== null,
  };
}
