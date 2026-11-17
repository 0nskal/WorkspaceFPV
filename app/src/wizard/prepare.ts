/**
 * Auto-tune wizard, step 3: the pre-flight checklist built from what the FC reported. Pure logic.
 * Fixes are plain Betaflight CLI commands; the screen sends them only through ctx.applyCommands (confirmation,
 * diff-all backup, save) after the user presses a button.
 */
import type { FcFacts } from './parts';

export type CheckId = 'armed' | 'bbDevice' | 'bbRate' | 'debug' | 'fields' | 'rpm' | 'flash' | 'sliders' | 'battery' | 'space';
export type CheckStatus = 'ok' | 'fix' | 'warn' | 'info' | 'block' | 'manual';

export interface Check {
  id: CheckId;
  status: CheckStatus;
  /** CLI commands that fix it (status 'fix'). */
  fix?: string[];
  /** Values before the fix, for the restore step (key -> old value). */
  old?: Record<string, string>;
  params?: Record<string, string | number>;
}

/** Logging rate the wizard aims for (Hz). */
export const BB_TARGET_HZ = 2000;
export const BB_MIN_HZ = 1600;

/** blackbox_disable_* fields the analysis needs: bit in the MSP mask (FLIGHT_LOG_FIELD_SELECT_*) and CLI name. */
export const NEEDED_FIELDS: Array<[bit: number, cli: string]> = [
  [1, 'blackbox_disable_rc'],
  [2, 'blackbox_disable_setpoint'],
  [7, 'blackbox_disable_gyro'],
  [10, 'blackbox_disable_motors'],
];

/** Smallest logging divider (highest index) that still logs at >= BB_TARGET_HZ; 0 when the loop itself is slower. */
export function bestSampleRate(pidLoopHz: number): number {
  let best = 0;
  for (let i = 0; i <= 4; i++) if (pidLoopHz / 2 ** i >= BB_TARGET_HZ - 1) best = i;
  return best;
}

export const sampleRateCli = (idx: number) => `1/${2 ** idx}`;

export function prepareChecks(f: FcFacts): Check[] {
  const out: Check[] = [];
  out.push({ id: 'armed', status: f.armed ? 'block' : 'ok' });

  if (f.bbDevice === null) out.push({ id: 'bbDevice', status: f.connected ? 'warn' : 'info' });
  else if (f.bbDevice === 0) {
    const dev = f.flash?.supported ? 'SPIFLASH' : f.sdSupported ? 'SDCARD' : null;
    out.push(dev ? { id: 'bbDevice', status: 'fix', fix: [`set blackbox_device = ${dev}`], old: { blackbox_device: 'NONE' }, params: { dev } } : { id: 'bbDevice', status: 'warn' });
  } else out.push({ id: 'bbDevice', status: 'ok', params: { dev: ['', 'SPIFLASH', 'SDCARD', 'SERIAL'][f.bbDevice] ?? String(f.bbDevice) } });

  if (f.pidLoopHz && f.bbSampleRate !== null) {
    const hz = f.pidLoopHz / 2 ** f.bbSampleRate;
    const best = bestSampleRate(f.pidLoopHz);
    if (hz >= BB_MIN_HZ) out.push({ id: 'bbRate', status: 'ok', params: { hz: Math.round(hz) } });
    else if (best < f.bbSampleRate) out.push({ id: 'bbRate', status: 'fix', fix: [`set blackbox_sample_rate = ${sampleRateCli(best)}`], old: { blackbox_sample_rate: sampleRateCli(f.bbSampleRate) }, params: { hz: Math.round(hz), to: Math.round(f.pidLoopHz / 2 ** best) } });
    else out.push({ id: 'bbRate', status: 'warn', params: { hz: Math.round(hz) } });
  } else out.push({ id: 'bbRate', status: 'info', params: { hz: '?' } });

  if (f.debugName === 'GYRO_SCALED') out.push({ id: 'debug', status: 'ok' });
  else if (f.connected) {
    const c: Check = { id: 'debug', status: 'fix', fix: ['set debug_mode = GYRO_SCALED'], params: { cur: f.debugName ?? (f.debugIndex !== null ? `#${f.debugIndex}` : '?') } };
    if (f.debugName) c.old = { debug_mode: f.debugName };
    out.push(c);
  } else out.push({ id: 'debug', status: 'info', params: { cur: '?' } });

  if (f.bbDisabledMask === null || f.api < 45) out.push({ id: 'fields', status: 'info' });
  else {
    const off = NEEDED_FIELDS.filter(([bit]) => ((f.bbDisabledMask! >>> bit) & 1) === 1);
    if (!off.length) out.push({ id: 'fields', status: 'ok' });
    else
      out.push({
        id: 'fields',
        status: 'fix',
        fix: off.map(([, cli]) => `set ${cli} = OFF`),
        old: Object.fromEntries(off.map(([, cli]) => [cli, 'ON'])),
        params: { list: off.map(([, cli]) => cli.replace('blackbox_disable_', '')).join(', ') },
      });
  }

  if (f.bidir === null) out.push({ id: 'rpm', status: 'info' });
  else if (!f.bidir || f.rpmHarmonics === 0) out.push({ id: 'rpm', status: 'warn' });
  else out.push({ id: 'rpm', status: 'ok', params: { h: f.rpmHarmonics ?? '?' } });

  if (f.flash?.supported && f.flash.total > 0) {
    const pct = Math.round((f.flash.used / f.flash.total) * 100);
    out.push({ id: 'flash', status: pct > 50 ? 'warn' : 'ok', params: { pct } });
  } else out.push({ id: 'flash', status: 'info', params: { pct: '?' } });

  out.push({ id: 'sliders', status: 'info' });
  out.push({ id: 'battery', status: 'manual' });
  out.push({ id: 'space', status: 'manual' });
  return out;
}

/** All fix commands of a checklist (for "Fix all"), without duplicates. */
export function allFixes(checks: Check[], skip: ReadonlySet<CheckId> = new Set()): { commands: string[]; old: Record<string, string> } {
  const commands: string[] = [];
  const old: Record<string, string> = {};
  for (const c of checks) {
    if (c.status !== 'fix' || !c.fix || skip.has(c.id)) continue;
    for (const cmd of c.fix) if (!commands.includes(cmd)) commands.push(cmd);
    Object.assign(old, c.old ?? {});
  }
  return { commands, old };
}
