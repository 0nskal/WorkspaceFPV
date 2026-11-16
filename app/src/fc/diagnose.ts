import { fmtNum, t, type Key } from '../i18n';
import { isDshot, protocolName, type FcState } from './state';

/** Czesc drona, na ktorej skupia sie "ognisko" na rentgenie. */
export type Part = 'esc' | 'rx' | 'fc' | 'motors' | 'battery';

/** Localised part name. */
export const partLabel = (p: Part): string => t(`parts.${p}`);

export type Severity = 'ok' | 'warn' | 'fail' | 'info';

export interface Check {
  id: string;
  label: string;
  severity: Severity;
  part: Part | null;
  detail?: string;
}

export interface Suggestion {
  id: string;
  part: Part;
  title: string;
  /** Prawdziwe komendy CLI Betaflight. */
  commands: string[];
  caveat?: string;
}

export interface Diagnosis {
  checks: Check[];
  suggestions: Suggestion[];
  /** Czesc z najpowazniejszym problemem (do ogniska) albo null, gdy wszystko OK. */
  focus: Part | null;
  /** Short summary in the UI language. */
  summary: string;
  /** Wszystkie proponowane komendy (bez duplikatow). */
  commands: string[];
}

/** Betaflight 4.4/4.5 arming disable flags (bit -> name); descriptions live in the dictionaries under `arm.<NAME>`. */
export const ARMING_FLAGS: Array<{ bit: number; name: string; part: Part }> = [
  { bit: 0, name: 'NOGYRO', part: 'fc' },
  { bit: 1, name: 'FAILSAFE', part: 'rx' },
  { bit: 2, name: 'RXLOSS', part: 'rx' },
  { bit: 3, name: 'BADRX', part: 'rx' },
  { bit: 4, name: 'BOXFAILSAFE', part: 'rx' },
  { bit: 5, name: 'THROTTLE', part: 'rx' },
  { bit: 6, name: 'ANGLE', part: 'fc' },
  { bit: 7, name: 'BOOTGRACE', part: 'fc' },
  { bit: 8, name: 'NOPREARM', part: 'rx' },
  { bit: 9, name: 'LOAD', part: 'fc' },
  { bit: 10, name: 'CALIB', part: 'fc' },
  { bit: 11, name: 'CLI', part: 'fc' },
  { bit: 12, name: 'CMS', part: 'fc' },
  { bit: 13, name: 'BST', part: 'fc' },
  { bit: 14, name: 'MSP', part: 'fc' },
  { bit: 15, name: 'PARALYZE', part: 'fc' },
  { bit: 16, name: 'GPS', part: 'fc' },
  { bit: 17, name: 'RESCUE_SW', part: 'rx' },
  { bit: 18, name: 'RPMFILTER', part: 'esc' },
  { bit: 19, name: 'REBOOT_REQD', part: 'fc' },
  { bit: 20, name: 'DSHOT_BBANG', part: 'esc' },
  { bit: 21, name: 'NO_ACC_CAL', part: 'fc' },
  { bit: 22, name: 'MOTOR_PROTO', part: 'esc' },
  { bit: 23, name: 'ARMSWITCH', part: 'rx' },
];

export function decodeArmingFlags(mask: number) {
  return ARMING_FLAGS.filter((f) => (mask & (1 << f.bit)) !== 0);
}

/** Localised description of an arming flag. */
export const armingDesc = (name: string): string => t(`arm.${name}` as Key);

const SEVERITY_RANK: Record<Severity, number> = { fail: 3, warn: 2, info: 1, ok: 0 };
/** Przy remisie waznosci wygrywa czesc wyzej na liscie. */
const PART_PRIORITY: Part[] = ['esc', 'battery', 'motors', 'rx', 'fc'];

export function recommendedDshot(pidProcessDenom: number, gyroSyncDenom: number): { name: 'DSHOT300' | 'DSHOT600'; speed: number } {
  // Zakladamy zyroskop 8 kHz (typowy dla F4/F7/H7 w BF 4.x): petla PID = 8000 / (gyro_sync x pid_process).
  const pidHz = 8000 / Math.max(1, gyroSyncDenom) / Math.max(1, pidProcessDenom);
  return pidHz <= 4000 ? { name: 'DSHOT300', speed: 300 } : { name: 'DSHOT600', speed: 600 };
}

const DSHOT_SPEED: Record<number, number> = { 5: 150, 6: 300, 7: 600, 8: 1000 };

/** Reguly diagnostyczne dzialajace zawsze (bez AI). */
export function diagnose(state: Readonly<FcState>): Diagnosis {
  const checks: Check[] = [];
  const suggestions: Suggestion[] = [];
  const { config, status, telemetry, cells } = state;

  if (!config) {
    return { checks, suggestions, focus: null, summary: t('diag.noData'), commands: [] };
  }

  // 1. Mapowanie / liczba silnikow
  checks.push(
    config.motorCount === 4
      ? { id: 'motors', label: t('diag.motorsOk'), severity: 'ok', part: 'motors', detail: t('diag.motorsOkDetail') }
      : { id: 'motors', label: t('diag.motorsCount', { n: config.motorCount }), severity: 'warn', part: 'motors', detail: t('diag.motorsCountDetail') },
  );

  // 2. Napiecie baterii
  if (telemetry && cells) {
    const perCell = telemetry.vbat / cells;
    const txt = t('diag.vbat', { cells, v: fmtNum(telemetry.vbat, 1) });
    if (perCell < 3.5) {
      checks.push({ id: 'vbat', label: t('diag.vbatLow', { txt }), severity: 'fail', part: 'battery', detail: t('diag.vbatLowDetail', { pc: fmtNum(perCell, 2) }) });
    } else {
      checks.push({ id: 'vbat', label: t('diag.vbatOk', { txt }), severity: 'ok', part: 'battery', detail: t('diag.vbatOkDetail', { pc: fmtNum(perCell, 2) }) });
    }
  } else if (telemetry) {
    checks.push({ id: 'vbat', label: t('diag.usbPower'), severity: 'info', part: 'battery', detail: t('diag.usbPowerDetail') });
  }

  // 3. Protokol silnikow
  const rec = recommendedDshot(config.pidProcessDenom, config.gyroSyncDenom);
  const protoName = protocolName(config.motorPwmProtocol);
  if (!isDshot(config.motorPwmProtocol)) {
    checks.push({ id: 'protocol', label: t('diag.protocol', { name: protoName }), severity: 'fail', part: 'esc', detail: t('diag.protocolAnalog') });
    suggestions.push({ id: 'protocol', part: 'esc', title: t('diag.protocolSwitch', { name: rec.name }), commands: [`set motor_pwm_protocol = ${rec.name}`] });
  } else {
    const speed = DSHOT_SPEED[config.motorPwmProtocol] ?? 0;
    if (speed > 0 && speed < rec.speed) {
      checks.push({ id: 'protocol', label: t('diag.protocol', { name: `DShot${speed}` }), severity: 'fail', part: 'esc', detail: t('diag.protocolTooSlow', { name: rec.name }) });
      suggestions.push({ id: 'protocol', part: 'esc', title: t('diag.protocolSwitch', { name: rec.name }), commands: [`set motor_pwm_protocol = ${rec.name}`], caveat: t('diag.protocolSwitchCaveat') });
    } else {
      checks.push({ id: 'protocol', label: t('diag.protocol', { name: `DShot${speed}` }), severity: 'ok', part: 'esc', detail: t('diag.protocolOkDetail', { name: rec.name }) });
    }
  }

  // 4. Bidirectional DShot
  if (isDshot(config.motorPwmProtocol)) {
    if (!config.bidir) {
      checks.push({ id: 'bidir', label: t('diag.bidirOff'), severity: 'fail', part: 'esc', detail: t('diag.bidirOffDetail') });
      suggestions.push({
        id: 'bidir',
        part: 'esc',
        title: t('diag.bidirEnable'),
        commands: ['set dshot_bidir = ON'],
        caveat: t('diag.bidirCaveat'),
      });
    } else {
      checks.push({ id: 'bidir', label: t('diag.bidirOn'), severity: 'ok', part: 'esc', detail: t('diag.bidirOnDetail') });
    }
  }

  // 5. Silniki przy uzbrojeniu
  if (status?.armed) {
    const maxMotor = Math.max(0, ...(telemetry?.motors ?? []));
    if (!telemetry || maxMotor <= 1000) {
      checks.push({ id: 'armed-motors', label: t('diag.armedStill'), severity: 'fail', part: 'motors', detail: t('diag.armedStillDetail') });
    } else {
      checks.push({ id: 'armed-motors', label: t('diag.armedOk'), severity: 'ok', part: 'motors' });
    }
  }

  // 6. Blokady uzbrojenia
  if (status) {
    const flags = decodeArmingFlags(status.armingDisableFlags);
    if (flags.length === 0) {
      checks.push({ id: 'arming', label: t('diag.armingNone'), severity: 'ok', part: 'fc' });
    } else {
      for (const f of flags) {
        checks.push({ id: `arm-${f.name}`, label: t('diag.armingFlag', { name: f.name }), severity: f.name === 'BOOTGRACE' || f.name === 'CLI' || f.name === 'MSP' ? 'info' : 'warn', part: f.part, detail: armingDesc(f.name) });
      }
    }
    if (status.cpuLoad > 70) checks.push({ id: 'cpu', label: t('diag.cpu', { n: status.cpuLoad }), severity: 'warn', part: 'fc', detail: t('diag.cpuDetail') });
    if (status.i2cErrors > 0) checks.push({ id: 'i2c', label: t('diag.i2c', { n: status.i2cErrors }), severity: 'warn', part: 'fc', detail: t('diag.i2cDetail') });
  }

  // Ognisko: najpowazniejszy problem
  let focus: Part | null = null;
  let best = -1;
  for (const c of checks) {
    if (c.severity !== 'fail' && c.severity !== 'warn') continue;
    if (!c.part) continue;
    const score = SEVERITY_RANK[c.severity] * 10 + (PART_PRIORITY.length - PART_PRIORITY.indexOf(c.part));
    if (score > best) {
      best = score;
      focus = c.part;
    }
  }

  const problems = checks.filter((c) => c.severity === 'fail' || c.severity === 'warn');
  const summary = problems.length === 0 ? t('diag.summaryOk') : t('diag.summaryProblems', { n: problems.length, part: partLabel(focus ?? 'fc') });
  const commands = [...new Set(suggestions.flatMap((s) => s.commands))];
  return { checks, suggestions, focus, summary, commands };
}
