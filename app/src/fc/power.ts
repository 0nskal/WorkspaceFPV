/**
 * USB-only power: most flight controllers do not feed the receiver, the ESCs or external sensors (GPS/compass)
 * from USB. With no battery those parts are simply off, and the FC reports them as problems. These checks are
 * shown as "will be checked with a battery" instead of as faults, and they do not count as problems.
 */
import type { Check } from './diagnose';

/** Arming flags that a missing battery explains on its own. */
const POWER_FLAGS = new Set(['RX_FAILSAFE', 'FAILSAFE', 'DSHOT_TELEM', 'RPMFILTER', 'DSHOT_BITBANG']);

/** True when the FC runs from USB only (no battery voltage). */
export const isUsbOnly = (checks: readonly Check[]): boolean => checks.some((c) => c.id === 'vbat' && c.severity === 'info');

/** A failing check that a missing battery explains (only meaningful while isUsbOnly). */
export function powerCaused(c: Check): boolean {
  if (c.severity !== 'fail' && c.severity !== 'warn') return false;
  if (c.id.startsWith('arm-')) return POWER_FLAGS.has(c.id.slice(4));
  return c.id === 'i2c' || c.id === 'armed-motors';
}

/** Splits failing checks into real problems and the ones waiting for a battery. */
export function splitByPower(checks: readonly Check[]): { real: Check[]; noBattery: Check[] } {
  const bad = checks.filter((c) => c.severity === 'fail' || c.severity === 'warn');
  if (!isUsbOnly(checks)) return { real: bad, noBattery: [] };
  return { real: bad.filter((c) => !powerCaused(c)), noBattery: bad.filter(powerCaused) };
}
