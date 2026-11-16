/**
 * Arming-disable flag tables (spec 3.12). Bits 0-19 and 21-24 never changed from 4.3 to master;
 * bit 20 = RPMFILTER on 4.3/4.4 and DSHOT_TELEM on 4.5+; bit 25 = ARM_SWITCH up to 4.5 but CRASHFLIP on 2025.12+;
 * 26 ALTHOLD, 27 POSHOLD on 2025.12+, 28 AUTOPILOT on master. ARM_SWITCH is always the LAST flag (index = flag count - 1):
 * 25 on 4.5 (count 26), 28 on 2025.12 (count 29), 29 on master (count 30). Checked against runtime_config.h.
 */
import { API } from './codes';

export interface ArmFlag {
  bit: number;
  /** Stable name, also the i18n key suffix (bfCore.arm.<name>). */
  name: string;
}

const BASE = [
  'NO_GYRO',
  'FAILSAFE',
  'RX_FAILSAFE',
  'NOT_DISARMED',
  'BOXFAILSAFE',
  'RUNAWAY_TAKEOFF',
  'CRASH_DETECTED',
  'THROTTLE',
  'ANGLE',
  'BOOT_GRACE_TIME',
  'NOPREARM',
  'LOAD',
  'CALIBRATING',
  'CLI',
  'CMS_MENU',
  'BST',
  'MSP',
  'PARALYZE',
  'GPS',
  'RESC',
];
const MID = ['REBOOT_REQUIRED', 'DSHOT_BITBANG', 'ACC_CALIBRATION', 'MOTOR_PROTOCOL'];

/** Names known to the app (used to look up descriptions). */
export const ARM_FLAG_NAMES = [...BASE, 'RPMFILTER', 'DSHOT_TELEM', ...MID, 'ARM_SWITCH', 'CRASHFLIP', 'ALTHOLD', 'POSHOLD', 'AUTOPILOT'] as const;

/** Flags that are normal while a configurator is connected or the board has just started: they never count as a problem. */
export const BENIGN_ARM_FLAGS = new Set(['MSP', 'CLI', 'ARM_SWITCH', 'BOOT_GRACE_TIME', 'CALIBRATING', 'REBOOT_REQUIRED']);

/** The flag table for a given API minor and the flag count reported by STATUS_EX (0 = unknown). */
export function armingTable(apiMinor: number, flagCount = 0): ArmFlag[] {
  const t: ArmFlag[] = BASE.map((name, bit) => ({ bit, name }));
  t.push({ bit: 20, name: apiMinor >= API.BF45 ? 'DSHOT_TELEM' : 'RPMFILTER' });
  MID.forEach((name, i) => t.push({ bit: 21 + i, name }));
  if (apiMinor < API.BF2025_12) {
    t.push({ bit: 25, name: 'ARM_SWITCH' });
    return t;
  }
  t.push({ bit: 25, name: 'CRASHFLIP' });
  const last = flagCount > 26 ? flagCount - 1 : apiMinor >= API.MASTER ? 29 : 28; // 2025.12 (1.47): ARM_SWITCH = 28; master (1.49): AUTOPILOT 28, ARM_SWITCH 29
  const masterExtra = ['ALTHOLD', 'POSHOLD', 'AUTOPILOT'];
  for (let bit = 26; bit < last; bit++) t.push({ bit, name: masterExtra[bit - 26] ?? `FLAG_${bit}` });
  t.push({ bit: last, name: 'ARM_SWITCH' });
  return t;
}

/** Flags set in `mask`; unknown set bits come back as `FLAG_<n>`. */
export function decodeArmFlags(mask: number, apiMinor: number, flagCount = 0): ArmFlag[] {
  const table = armingTable(apiMinor, flagCount);
  const out: ArmFlag[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (((mask >>> bit) & 1) === 0) continue;
    out.push(table.find((f) => f.bit === bit) ?? { bit, name: `FLAG_${bit}` });
  }
  return out;
}
