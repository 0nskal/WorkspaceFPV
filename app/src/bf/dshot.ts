/**
 * Motor spin direction through the flight controller, like the Betaflight Configurator "Motor direction" tool:
 * MSP2_SEND_DSHOT_COMMAND (Betaflight 4.3+, API 1.44) sends DShot commands to one ESC while disarmed.
 * The direction is written into the ESC itself (SAVE_SETTINGS), so it survives a power cycle.
 * NORMAL / REVERSED are relative to how the motor is wired; when the pilot does not know which one the ESC has,
 * try REVERSED first and NORMAL if the motor still spins the wrong way.
 */
import type { AppContext } from '../context';
import { isDshot } from '../fc/state';

export const MSP2_SEND_DSHOT_COMMAND = 0x3003;
export const DSHOT_CMD = { SAVE_SETTINGS: 12, SPIN_DIRECTION_NORMAL: 20, SPIN_DIRECTION_REVERSED: 21 } as const;
/** Blocking: the FC pauses the motor output while it sends the commands (DSHOT_CMD_TYPE_BLOCKING). */
const CMD_TYPE_BLOCKING = 1;
const MIN_API = 44;

/** Payload: [type][motor index][command count][commands…]. */
export function directionFrame(motor: number, reversed: boolean): Uint8Array {
  return Uint8Array.of(CMD_TYPE_BLOCKING, motor, 2, reversed ? DSHOT_CMD.SPIN_DIRECTION_REVERSED : DSHOT_CMD.SPIN_DIRECTION_NORMAL, DSHOT_CMD.SAVE_SETTINGS);
}

export type DirectionBlock = 'notConnected' | 'armed' | 'noBattery' | 'notDshot' | 'oldFirmware' | null;

/** Why the direction cannot be changed right now (null = it can). */
export function directionBlock(ctx: AppContext): DirectionBlock {
  const s = ctx.state.get();
  if (s.conn !== 'connected') return 'notConnected';
  if (s.status?.armed) return 'armed';
  if ((s.telemetry?.vbat ?? 0) <= 5) return 'noBattery';
  if (!s.config || !isDshot(s.config.motorPwmProtocol)) return 'notDshot';
  const api = s.info?.apiVersion;
  if (api && api.major === 1 && api.minor < MIN_API) return 'oldFirmware';
  return null;
}

/** Sends the direction to one motor (0-based BF index) and saves it in the ESC. */
export async function setMotorDirection(ctx: AppContext, motor: number, reversed: boolean): Promise<void> {
  const block = directionBlock(ctx);
  if (block) throw new Error(block);
  await ctx.bf.send(MSP2_SEND_DSHOT_COMMAND, directionFrame(motor, reversed), 2000);
}
