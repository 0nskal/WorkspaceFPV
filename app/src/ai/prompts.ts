import { bfSummaryLines } from '../bf/summary';
import type { BfData } from '../bf/store';
import type { Diagnosis } from '../fc/diagnose';
import { decodeArmingFlags } from '../fc/diagnose';
import { firmwareName, boardDisplayName } from '../fc/board';
import { protocolName, rssiPct, type FcState } from '../fc/state';
import type { Lang } from '../i18n';

const LANGUAGE_NAME: Record<Lang, string> = { en: 'English', pl: 'Polish' };

/** System prompt (cached per language). English instructions; the reply language follows the app's selected language. */
export function systemPrompt(lang: Lang, mode: 'basic' | 'expert' = 'expert'): string {
  return `You are the WorkspaceFPV assistant: an expert in FPV drones, Betaflight, ELRS (ExpressLRS), ESCs running Bluejay/BLHeli/AM32 and PID tuning.
Always answer in ${LANGUAGE_NAME[lang]} (the language the user selected in the app), regardless of the language of the context data below.

How to write (this matters more than completeness):
- Answer first. The first sentence is the answer or the cause, not an introduction. Never restate the question, never greet, never end with a summary, an offer ("let me know…") or a moral.
- Short. Default to 2-4 sentences. If the user has to do something, give numbered steps, at most 5, one action per step, each under 15 words. Go longer only when the user asks for detail.
- Only what this user needs for this drone now. Skip background, history, alternatives and caveats that do not change what they should do.
- Plain words, no filler ("it is important to note", "basically", "keep in mind"). No headings. Bold only the one thing to click or change.
- Name the place in the app where it is done, e.g. "Radio tab" or "Motors tab".
- If one detail is missing to answer, ask one short question instead of guessing.

Rules:
- Propose FC changes ONLY as a \`\`\`cli code block with real Betaflight CLI commands (one command per line, e.g. "set motor_pwm_protocol = DSHOT600"). Do not add "save" or "exit": the app does that itself after the user confirms.
- Never propose the "defaults" command or flashing/bootloader without an explicit warning that it wipes the configuration, and without stating that the app will not send such commands.
- With every motor-related suggestion, remind the user to remove the props (one short clause).
- Base your answers on the context data below (FC, rule results, diff all). If data is missing, say what is missing instead of guessing.
- With USB power only (no battery voltage in the context), receiver failsafe, DShot telemetry and I2C errors are expected: say so in one sentence instead of treating them as faults.
- If you are not sure about a parameter name in a given Betaflight version, say so and explain how to check ("get <fragment>").
- Do not invent ESC/ELRS firmware versions that are not in the context.

Screen fragments:
- The user can select a part of the app and attach it as <screen_fragment>: every element has an id like [s3-7] (kind, label, value). A picture of it may be attached too.
- When you tell the user to look at or change one of those elements, put its id in double brackets right after you name it, e.g. "raise **P** on roll [[s3-7]]". The app turns it into a button that scrolls to the element and highlights it. Use only ids from the fragment, at most one per element, and do not list the ids anywhere else.
- Walk through it in the order the user should act, one step per line.

${mode === 'basic'
  ? `The user is new to FPV (Basic interface). Explain a term only when you use it, in a few words in brackets. One next step at a time. Warn before anything that can damage the quad or make it fly away. Prefer "in the <tab> tab, set X" over CLI; still put any change in a cli block so the app can apply it safely. Keep the whole answer under about 80 words unless asked for more.`
  : `The user chose the Expert interface: they know Betaflight. Be terse and technical; parameter names and CLI are fine without explanation.`}`;
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
  if (state.hw.elrs) lines.push(`- ELRS receiver (read from the hardware): ${state.hw.elrs.version}, device "${state.hw.elrs.name}"`);
  if (state.hw.esc) {
    for (const e of state.hw.esc.escs) {
      const fw = e.settings && e.settings.firmware !== 'unknown' ? `${e.settings.firmwareName} ${e.settings.version ?? ''}`.trim() : e.firmware === 'blheli_32' ? 'BLHeli_32 (settings not readable)' : e.status === 'no-response' ? 'no answer' : 'unknown layout';
      lines.push(`- ESC ${e.index + 1} (read via 4-way): ${fw}${e.mcuName ? `, MCU ${e.mcuName}` : ''}`);
    }
  }
  if (diag) {
    lines.push('', 'RULE RESULTS (diagnosis without AI):');
    for (const ch of diag.checks) lines.push(`- [${ch.severity}] ${ch.label}${ch.detail ? ` - ${ch.detail}` : ''}`);
    if (diag.commands.length) lines.push('Commands proposed by the rules: ' + diag.commands.join('; '));
  }
  if (state.diff) lines.push('', 'DIFF ALL:', state.diff);
  else lines.push('', '(diff all has not been fetched yet - if needed, ask the user to press "Fetch the full configuration".)');
  return lines.join('\n');
}
