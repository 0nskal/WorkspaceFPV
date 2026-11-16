/**
 * Tiny local adapter between the Motors / Blackbox / CLI / OSD tabs and the FC link.
 * Deliberately small and self-contained (the shared core of the parallel branch may replace it):
 *   read(cmd)  write(cmd, payload)  save({ reboot })  cli(commands)
 * Nothing here is ever called without a user action (Save, Download, Erase ...).
 */
import type { AppContext } from '../context';
import type { CliOptions, CliResult, FcLink } from '../serial/types';
import { MSPM } from './motors';

export interface BfIo {
  readonly demo: boolean;
  /** MSP API minor version of the connected FC (1.xx), 0 when unknown. */
  apiMinor(): number;
  /** Throws when the FC rejects the command (error frame) or times out. */
  read(cmd: number, payload?: Uint8Array, timeoutMs?: number): Promise<Uint8Array>;
  /** Same as read; the returned payload is the (usually empty) acknowledgement. */
  write(cmd: number, payload: Uint8Array, timeoutMs?: number): Promise<Uint8Array>;
  /** Like read, but resolves null instead of throwing ("not supported by this firmware"). */
  tryRead(cmd: number, payload?: Uint8Array, timeoutMs?: number): Promise<Uint8Array | null>;
  /** EEPROM_WRITE (after a 100 ms settle) and optionally REBOOT. Never called without the user pressing Save. */
  save(opts: { reboot: boolean }): Promise<void>;
  /** Runs a CLI session (the FC reboots when it ends). */
  cli(commands: string[], options?: CliOptions): Promise<CliResult>;
  link(): FcLink;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function makeIo(ctx: AppContext): BfIo {
  const need = (): FcLink => {
    const l = ctx.link();
    if (!l) throw new Error('not connected');
    return l;
  };
  const io: BfIo = {
    get demo() {
      return ctx.state.get().mode === 'demo';
    },
    apiMinor: () => ctx.state.get().info?.apiVersion.minor ?? 0,
    read: (cmd, payload, timeoutMs) => need().request(cmd, payload, timeoutMs),
    write: (cmd, payload, timeoutMs) => need().request(cmd, payload, timeoutMs),
    tryRead: async (cmd, payload, timeoutMs) => {
      try {
        return await need().request(cmd, payload, timeoutMs);
      } catch {
        return null;
      }
    },
    async save({ reboot }) {
      const l = need();
      await wait(100);
      await l.request(MSPM.EEPROM_WRITE, undefined, 3000);
      if (reboot) {
        // The shared link may offer expectReboot() so the app reconnects by itself; harmless when absent.
        (l as { expectReboot?: () => void }).expectReboot?.();
        await l.request(MSPM.REBOOT, Uint8Array.of(0), 1500).catch(() => undefined);
      }
    },
    cli: (commands, options) => need().cli(commands, options),
    link: need,
  };
  return io;
}

/** Shared "pending changes" bar markup helpers live in the screens; this only formats an error for toasts. */
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
