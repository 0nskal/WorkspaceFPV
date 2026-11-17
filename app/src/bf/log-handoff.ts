/** One-shot hand-over of a downloaded blackbox log from the Blackbox tab to the Autotune tab (or the Auto-tune wizard). */
let pending: File | null = null;
/** Tab that receives the log: the wizard claims it while it waits for a log in its import step. */
let target = 'autotune';

export function setPendingLog(file: File): void {
  pending = file;
}

/** Returns the log once and forgets it. */
export function takePendingLog(): File | null {
  const f = pending;
  pending = null;
  return f;
}

/** Route the Blackbox tab opens after "Analyse"; null puts it back to the Autotune tab. */
export function setHandoffTarget(route: string | null): void {
  target = route ?? 'autotune';
}

export const handoffTarget = (): string => target;
