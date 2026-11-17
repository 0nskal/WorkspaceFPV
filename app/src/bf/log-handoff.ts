/** One-shot hand-over of a downloaded blackbox log from the Blackbox tab to the Autotune PID tab. */
let pending: File | null = null;

export function setPendingLog(file: File): void {
  pending = file;
}

/** Returns the log once and forgets it. */
export function takePendingLog(): File | null {
  const f = pending;
  pending = null;
  return f;
}

/** Route of the tab that analyses a handed-over log. */
export const HANDOFF_ROUTE = 'autotune';
