/** Renderer side of the desktop-only AI IPC (window.workspacefpv.ai, see electron/preload.ts). */
import type { ChatTurn, StopReason } from './types';

export interface ClaudeInfo {
  ok: boolean;
  path?: string;
  version?: string;
  reason?: 'missing' | 'failed';
}

export type OllamaTags = { ok: true; models: string[] } | { ok: false; models: string[]; code: string; message: string };

export type StartPayload =
  | { provider: 'claude-code'; model: string; prompt: string; messages: ChatTurn[]; context: string }
  | { provider: 'ollama'; baseUrl: string; model: string; system: string; messages: ChatTurn[] };

export type BridgeEvent =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'done'; stopReason: StopReason }
  | { id: string; type: 'error'; code: string; message: string };

export interface DesktopAi {
  detectClaude(force?: boolean): Promise<ClaudeInfo>;
  ollamaTags(baseUrl: string): Promise<OllamaTags>;
  start(id: string, payload: StartPayload): Promise<boolean>;
  cancel(id: string): void;
  onEvent(cb: (e: BridgeEvent) => void): () => void;
}

export const desktopAi = (): DesktopAi | undefined => window.workspacefpv?.ai;

/** Raised for a failed desktop stream; `code` comes from the main process. */
export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let seq = 0;

/** Runs one streamed request in the main process; resolves on "done", rejects with BridgeError on "error"; abort cancels the process. */
export function bridgeStream(api: DesktopAi, payload: StartPayload, onText: (d: string) => void, signal: AbortSignal): Promise<{ text: string; stopReason: StopReason }> {
  const id = `ai-${Date.now()}-${++seq}`;
  return new Promise((resolve, reject) => {
    let text = '';
    const off = api.onEvent((e) => {
      if (e.id !== id) return;
      if (e.type === 'text') {
        text += e.text;
        onText(e.text);
      } else {
        cleanup();
        if (e.type === 'done') resolve({ text, stopReason: e.stopReason });
        else reject(signal.aborted ? new DOMException('Aborted', 'AbortError') : new BridgeError(e.code, e.message));
      }
    });
    const onAbort = () => api.cancel(id);
    const cleanup = () => {
      off();
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort);
    api
      .start(id, payload)
      .then((ok) => {
        if (!ok) {
          cleanup();
          reject(new BridgeError('cli', 'Request rejected'));
        } else if (signal.aborted) onAbort();
      })
      .catch((e) => {
        cleanup();
        reject(e);
      });
  });
}
