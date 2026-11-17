/**
 * Auto-tune wizard, step 4: the flight-test coach script. Data only: the pilot flies, the app shows big step cards
 * with a countdown and never sends anything to the drone. Texts: pidWizard.flight.steps.<id>.title / .body.
 * Another step set (for example a chirp script) is added as another entry of SCRIPTS.
 */

export type StepKind = 'hover' | 'roll' | 'pitch' | 'yaw' | 'throttle' | 'flips' | 'propwash' | 'land';

export interface FlightStep {
  id: StepKind;
  /** Suggested duration [s]; 0 = no timer (the pilot presses Next). */
  seconds: number;
  optional?: boolean;
}

export type ScriptId = 'basic';

export const SCRIPTS: Record<ScriptId, FlightStep[]> = {
  basic: [
    { id: 'hover', seconds: 10 },
    { id: 'roll', seconds: 10 },
    { id: 'pitch', seconds: 10 },
    { id: 'yaw', seconds: 10 },
    { id: 'throttle', seconds: 10 },
    { id: 'flips', seconds: 10, optional: true },
    { id: 'propwash', seconds: 10 },
    { id: 'land', seconds: 0 },
  ],
};

/** Seconds of timed maneuvers in a script. */
export const scriptSeconds = (steps: FlightStep[], withOptional = true): number => steps.reduce((s, x) => s + (x.optional && !withOptional ? 0 : x.seconds), 0);

export interface CoachPos {
  /** Index of the current step. */
  index: number;
  /** Seconds left in the current step (0 for untimed steps). */
  left: number;
  /** 0..1 progress of the current step. */
  frac: number;
  /** True when the timed part of the script is over. */
  done: boolean;
}

/** Where the coach is after `elapsed` seconds (steps run back to back; untimed steps stop the clock). */
export function coachAt(steps: FlightStep[], elapsed: number, skipOptional = false): CoachPos {
  let t = Math.max(0, elapsed);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.optional && skipOptional) continue;
    if (s.seconds <= 0) return { index: i, left: 0, frac: 0, done: true };
    if (t < s.seconds) return { index: i, left: Math.ceil(s.seconds - t), frac: t / s.seconds, done: false };
    t -= s.seconds;
  }
  return { index: steps.length - 1, left: 0, frac: 1, done: true };
}

/** Elapsed seconds at the start of step `index` (used by Next / Back buttons). */
export function startOf(steps: FlightStep[], index: number, skipOptional = false): number {
  let t = 0;
  for (let i = 0; i < Math.min(index, steps.length); i++) {
    const s = steps[i]!;
    if (s.optional && skipOptional) continue;
    t += s.seconds;
  }
  return t;
}
