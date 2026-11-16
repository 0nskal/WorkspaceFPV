/** IPC for the local AI providers: Claude Code (CLI) and Ollama (called from here to avoid CORS). */
import { ipcMain, type WebContents } from 'electron';
import { detectClaude, runClaudeCode } from './claude-code';
import { listOllamaModels, normalizeBase, ollamaErrorMessage, OllamaHttpError, streamOllamaChat, type FetchFn } from '../app/src/ai/ollama-core';
import { buildCliPrompt, type ChatTurn } from '../app/src/ai/types';

type StartPayload =
  | { provider: 'claude-code'; model: string; prompt: string; messages: ChatTurn[]; context: string }
  | { provider: 'ollama'; baseUrl: string; model: string; system: string; messages: ChatTurn[] };

const active = new Map<string, () => void>();
const nodeFetch = fetch as unknown as FetchFn;

const isTurns = (v: unknown): v is ChatTurn[] => Array.isArray(v) && v.every((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string');
const validUrl = (u: unknown): u is string => {
  if (typeof u !== 'string') return false;
  try {
    return /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
};

function ollamaFailure(e: unknown): { code: string; message: string } {
  if (e instanceof OllamaHttpError) return { code: e.status === 404 ? 'model' : 'http', message: ollamaErrorMessage(e.message) };
  return { code: 'connect', message: e instanceof Error ? e.message : String(e) };
}

export function setupAi(): void {
  ipcMain.handle('ai:claude-detect', (_e, force: unknown) => detectClaude(force === true));

  ipcMain.handle('ai:ollama-tags', async (_e, baseUrl: unknown) => {
    if (!validUrl(baseUrl)) return { ok: false, code: 'connect', message: 'Invalid URL', models: [] as string[] };
    try {
      return { ok: true, models: await listOllamaModels(nodeFetch, baseUrl, AbortSignal.timeout(5000)) };
    } catch (e) {
      return { ok: false, models: [] as string[], ...ollamaFailure(e) };
    }
  });

  ipcMain.handle('ai:start', (e, id: unknown, p: StartPayload) => {
    if (typeof id !== 'string' || !p || typeof p !== 'object' || active.has(id)) return false;
    const wc: WebContents = e.sender;
    const send = (ev: Record<string, unknown>) => {
      if (!wc.isDestroyed()) wc.send('ai:event', { id, ...ev });
    };
    const end = () => active.delete(id);

    if (p.provider === 'claude-code') {
      if (typeof p.model !== 'string' || typeof p.prompt !== 'string' || !isTurns(p.messages) || typeof p.context !== 'string') return false;
      const cancel = runClaudeCode({ model: p.model, systemPrompt: p.prompt, prompt: buildCliPrompt(p.messages, p.context) }, (ev) => {
        send(ev);
        if (ev.type !== 'text') end();
      });
      active.set(id, cancel);
      return true;
    }
    if (p.provider === 'ollama') {
      if (!validUrl(p.baseUrl) || typeof p.model !== 'string' || typeof p.system !== 'string' || !isTurns(p.messages)) return false;
      const ctl = new AbortController();
      active.set(id, () => ctl.abort());
      void streamOllamaChat(nodeFetch, { baseUrl: normalizeBase(p.baseUrl), model: p.model, system: p.system, messages: p.messages }, (text) => send({ type: 'text', text }), ctl.signal)
        .then((r) => send({ type: 'done', stopReason: r.stopReason }))
        .catch((err) => (ctl.signal.aborted ? send({ type: 'error', code: 'exit', message: 'Cancelled.' }) : send({ type: 'error', ...ollamaFailure(err) })))
        .finally(end);
      return true;
    }
    return false;
  });

  ipcMain.on('ai:cancel', (_e, id: unknown) => {
    if (typeof id === 'string') active.get(id)?.();
  });
}
