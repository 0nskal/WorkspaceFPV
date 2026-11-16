import { bfSummaryLines } from '../bf/summary';
import type { BfData } from '../bf/store';
import type { Diagnosis } from '../fc/diagnose';
import { decodeArmingFlags } from '../fc/diagnose';
import { firmwareName, boardDisplayName } from '../fc/board';
import { protocolName, rssiPct, type FcState } from '../fc/state';
import type { Lang } from '../i18n';

const LANGUAGE_NAME: Record<Lang, string> = { en: 'English', pl: 'Polish' };

/** System prompt (cached per language). English instructions; the reply language follows the app's selected language. */
export function systemPrompt(lang: Lang): string {
  return `You are the Rotorlab assistant: an expert in FPV drones, Betaflight, ELRS (ExpressLRS), ESCs running Bluejay/BLHeli/AM32 and PID tuning.
Always answer in ${LANGUAGE_NAME[lang]} (the language the user selected in the app), regardless of the language of the context data below. Be short and concrete, skip introductions and do not explain basics unless asked.

Rules:
- Propose FC changes ONLY as a \`\`\`cli code block with real Betaflight CLI commands (one command per line, e.g. "set motor_pwm_protocol = DSHOT600"). Do not add "save" or "exit": the app does that itself after the user confirms.
- Never propose the "defaults" command or flashing/bootloader without an explicit warning that it wipes the configuration, and without stating that the app will not send such commands.
- With every motor-related suggestion, remind the user to remove the props while testing.
- Base your answers on the context data below (FC, rule results, diff all). If data is missing, say what is missing instead of guessing.
- If you are not sure about a parameter name in a given Betaflight version, say so and explain how to check ("get <fragment>").
- Do not invent ESC/ELRS firmware versions that are not in the context.`;
}

/** Context about the current drone (stable within a conversation, cached; the user's question goes last). */
export function buildContext(state: Readonly<FcState>, diag: Diagnosis | null, bf?: Readonly<BfData>): string {
  if (!state.info || !state.config) {
    return 'CONTEXT: not connected to an FC. Answer in general terms and suggest that the user connects the drone.';
  }
  const c = state.config;
  const lines: string[] = ['CONTEXT (read from the FC):'];
  lines.push(`- Board: ${boardDisplayName(state.info)} (${state.info.boardId}), ${firmwareName(state.info)}, MSP API ${state.info.apiVersion.major}.${state.info.apiVersion.minor}`);
  lines.push(`- Craft name: ${state.info.craftName}`);
  lines.push(`- Motors: ${c.motorCount}, protocol ${protocolName(c.motorPwmProtocol)}, dshot_bidir ${c.bidir ? 'ON' : 'OFF'}, motor_poles ${c.motorPoles}, minthrottle ${c.minThrottle}, mincommand ${c.minCommand}`);
  lines.push(`- Loops: gyro_sync_denom ${c.gyroSyncDenom}, pid_process_denom ${c.pidProcessDenom}`);
  const t = state.telemetry;
  if (t) {
    lines.push(`- Battery: ${t.vbat.toFixed(2)} V${state.cells ? ` (~${state.cells}S)` : ' (USB power?)'}, RSSI ${rssiPct(t.rssi)}%`);
    if (t.motors.length) lines.push(`- Raw motor values: ${t.motors.join(', ')}`);
  }
  if (state.status) {
    const flags = decodeArmingFlags(state.status.armingDisableFlags, state.info.apiVersion.minor, state.status.armingFlagCount).map((f) => f.name);
    lines.push(`- Armed: ${state.status.armed ? 'yes' : 'no'}; arming disable flags: ${flags.length ? flags.join(', ') : 'none'}; CPU ${state.status.cpuLoad}%; I2C errors ${state.status.i2cErrors}`);
  }
  if (bf) lines.push(...bfSummaryLines(bf));
  if (state.pid) {
    const p = state.pid;
    lines.push(`- PID (roll/pitch/yaw, P I D): ${p.roll.join('/')}  ${p.pitch.join('/')}  ${p.yaw.join('/')}`);
  }
  if (state.meta.elrsVersion) lines.push(`- ELRS (entered manually): ${state.meta.elrsVersion}`);
  if (diag) {
    lines.push('', 'RULE RESULTS (diagnosis without AI):');
    for (const ch of diag.checks) lines.push(`- [${ch.severity}] ${ch.label}${ch.detail ? ` - ${ch.detail}` : ''}`);
    if (diag.commands.length) lines.push('Commands proposed by the rules: ' + diag.commands.join('; '));
  }
  if (state.diff) lines.push('', 'DIFF ALL:', state.diff);
  else lines.push('', '(diff all has not been fetched yet - if needed, ask the user to press "Fetch the full configuration".)');
  return lines.join('\n');
}
