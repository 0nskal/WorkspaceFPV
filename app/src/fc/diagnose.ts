import type { BfData } from '../bf/store';
import { BENIGN_ARM_FLAGS, decodeArmFlags } from '../bf/arming';
import { describeGroups, summarizeEsc } from '../bf/esc-summary';
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

/** Which drone part an arming-disable flag points at (the flag table itself is version dependent, see bf/arming.ts). */
const FLAG_PART: Record<string, Part> = {
  NO_GYRO: 'fc',
  FAILSAFE: 'rx',
  RX_FAILSAFE: 'rx',
  BOXFAILSAFE: 'rx',
  THROTTLE: 'rx',
  NOPREARM: 'rx',
  RESC: 'rx',
  ARM_SWITCH: 'rx',
  RPMFILTER: 'esc',
  DSHOT_TELEM: 'esc',
  DSHOT_BITBANG: 'esc',
  MOTOR_PROTOCOL: 'esc',
  RUNAWAY_TAKEOFF: 'motors',
};

export interface ArmingFlagInfo {
  bit: number;
  name: string;
  part: Part;
}

/** Decoded arming-disable flags for the firmware's API version (defaults to 1.46 = BF 4.5). */
export function decodeArmingFlags(mask: number, apiMinor = 46, flagCount = 0): ArmingFlagInfo[] {
  return decodeArmFlags(mask, apiMinor, flagCount).map((f) => ({ ...f, part: FLAG_PART[f.name] ?? 'fc' }));
}

/** Localised description of an arming flag. */
export const armingDesc = (name: string): string => (name.startsWith('FLAG_') ? t('bfCore.arm.UNKNOWN', { n: name.slice(5) }) : t(`bfCore.arm.${name}` as Key));

const SEVERITY_RANK: Record<Severity, number> = { fail: 3, warn: 2, info: 1, ok: 0 };
/** Przy remisie waznosci wygrywa czesc wyzej na liscie. */
const PART_PRIORITY: Part[] = ['esc', 'battery', 'motors', 'rx', 'fc'];

export function recommendedDshot(pidProcessDenom: number, gyroSyncDenom: number, gyroHz = 8000): { name: 'DSHOT300' | 'DSHOT600'; speed: number } {
  // PID loop = gyro sample rate / (gyro_sync x pid_process). gyroHz comes from MSP_BOARD_INFO (8 kHz assumed when the FC does not report it).
  const pidHz = (gyroHz || 8000) / Math.max(1, gyroSyncDenom) / Math.max(1, pidProcessDenom);
  return pidHz <= 4000 ? { name: 'DSHOT300', speed: 300 } : { name: 'DSHOT600', speed: 600 };
}

const DSHOT_SPEED: Record<number, number> = { 5: 150, 6: 300, 7: 600, 8: 1000 };

/** Reguly diagnostyczne dzialajace zawsze (bez AI). */
export function diagnose(state: Readonly<FcState>, bf?: Readonly<BfData>): Diagnosis {
  const checks: Check[] = [];
  const suggestions: Suggestion[] = [];
  const { config, status, telemetry } = state;
  // real cell count and warning voltage from the FC (BATTERY_STATE / BATTERY_CONFIG) when known, else the estimate
  const cells = bf?.batteryState?.cells || state.cells;
  const warnCell = bf?.battery?.warnCell || 3.5;

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
    if (perCell < warnCell) {
      checks.push({ id: 'vbat', label: t('diag.vbatLow', { txt }), severity: 'fail', part: 'battery', detail: t('diag.vbatLowDetail', { pc: fmtNum(perCell, 2) }) });
    } else {
      checks.push({ id: 'vbat', label: t('diag.vbatOk', { txt }), severity: 'ok', part: 'battery', detail: t('diag.vbatOkDetail', { pc: fmtNum(perCell, 2) }) });
    }
  } else if (telemetry) {
    checks.push({ id: 'vbat', label: t('diag.usbPower'), severity: 'info', part: 'battery', detail: t('diag.usbPowerDetail') });
  }

  // 3. Protokol silnikow
  const rec = recommendedDshot(config.pidProcessDenom, config.gyroSyncDenom, bf?.board?.gyroRateHz);
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

  // 4. Bidirectional DShot (ESC firmware is read from the hardware when available: Bluejay/AM32/BLHeli_32 can, BLHeli_S cannot)
  const fw = summarizeEsc(state.hw.esc);
  if (fw) {
    checks.push({ id: 'esc-fw', label: t('bfInfo.diag.fw', { fw: describeGroups(fw.groups) }), severity: 'info', part: 'esc', detail: t('bfInfo.diag.fwDetail') });
  }
  if (isDshot(config.motorPwmProtocol)) {
    if (!config.bidir) {
      if (fw?.bidir === 'no') {
        // the generic "turn bidir on" advice would be wrong here: the ESCs cannot do it
        checks.push({ id: 'bidir', label: t('bfInfo.diag.bidirNoFw'), severity: 'warn', part: 'esc', detail: t('bfInfo.diag.bidirNoFwDetail', { fw: describeGroups(fw.blockers) }) });
      } else {
        checks.push({ id: 'bidir', label: t('diag.bidirOff'), severity: 'fail', part: 'esc', detail: fw?.bidir === 'yes' ? `${t('diag.bidirOffDetail')} ${t('bfInfo.diag.bidirFwOk', { fw: describeGroups(fw.groups) })}` : t('diag.bidirOffDetail') });
        suggestions.push({
          id: 'bidir',
          part: 'esc',
          title: t('diag.bidirEnable'),
          commands: ['set dshot_bidir = ON'],
          caveat: t('diag.bidirCaveat'),
        });
      }
    } else if (fw?.bidir === 'no') {
      checks.push({ id: 'bidir', label: t('bfInfo.diag.bidirOnNoFw'), severity: 'fail', part: 'esc', detail: t('bfInfo.diag.bidirOnNoFwDetail', { fw: describeGroups(fw.blockers) }) });
    } else {
      checks.push({ id: 'bidir', label: t('diag.bidirOn'), severity: 'ok', part: 'esc', detail: t('diag.bidirOnDetail') });
    }
  }

  // ELRS receiver version, read from the receiver itself
  if (state.hw.elrs) {
    checks.push({ id: 'elrs', label: t('bfInfo.diag.elrs', { v: state.hw.elrs.version }), severity: 'info', part: 'rx', detail: t('bfInfo.diag.elrsDetail', { name: state.hw.elrs.name }) });
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

  // 6. Arming-disable flags (benign ones such as MSP/CLI/ARM_SWITCH are normal while a tool is connected)
  if (status) {
    const flags = decodeArmingFlags(status.armingDisableFlags, state.info?.apiVersion.minor ?? 46, status.armingFlagCount);
    const real = flags.filter((f) => !BENIGN_ARM_FLAGS.has(f.name));
    if (real.length === 0) {
      checks.push({ id: 'arming', label: t('diag.armingNone'), severity: 'ok', part: 'fc' });
    } else {
      for (const f of flags) {
        checks.push({ id: `arm-${f.name}`, label: t('diag.armingFlag', { name: f.name }), severity: BENIGN_ARM_FLAGS.has(f.name) ? 'info' : 'warn', part: f.part, detail: armingDesc(f.name) });
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
