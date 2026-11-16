/** One-shot hand-over of a downloaded blackbox log from the Blackbox tab to the Autotune tab. */
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
