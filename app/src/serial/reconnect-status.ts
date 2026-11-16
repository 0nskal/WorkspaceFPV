/** Progress of the automatic reconnect after an FC reboot (shared by port.ts and the UI). */
export interface ReconnectStatus {
  phase: 'waiting' | 'opening' | 'done' | 'failed';
  elapsedMs: number;
  timeoutMs: number;
  /** Open attempts so far. */
  attempt: number;
  /** Last open error message, if any (diagnostics for the "failed" state). */
  lastError?: string;
}

let current: ReconnectStatus | null = null;
const cbs = new Set<(s: ReconnectStatus | null) => void>();

export const getReconnectStatus = (): ReconnectStatus | null => current;

export function setReconnectStatus(s: ReconnectStatus | null): void {
  current = s;
  for (const cb of [...cbs]) cb(s);
}

export function onReconnectStatus(cb: (s: ReconnectStatus | null) => void): () => void {
  cbs.add(cb);
  return () => cbs.delete(cb);
}
