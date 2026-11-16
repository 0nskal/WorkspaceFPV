/** Ollama client over an injectable fetch (the browser's fetch or the main process's), so it is testable and shared. */
import type { ChatTurn, StopReason, StreamResult } from './types';

type ReadResult = { done: boolean; value?: Uint8Array };
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  body: { getReader(): { read(): Promise<ReadResult> } } | null;
}
export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<FetchResponseLike>;

export class OllamaHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function normalizeBase(url: string): string {
  const u = url.trim().replace(/\/+$/, '');
  return u || 'http://localhost:11434';
}

export async function listOllamaModels(f: FetchFn, baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  const r = await f(`${normalizeBase(baseUrl)}/api/tags`, { signal });
  if (!r.ok) throw new OllamaHttpError(r.status, await r.text());
  const j = (await r.json()) as { models?: Array<{ name?: string; model?: string }> };
  return (j.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
}

/** Splits an NDJSON byte stream into parsed objects. */
export async function* ndjson(body: NonNullable<FetchResponseLike['body']>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += dec.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as Record<string, unknown>;
    }
    if (done) break;
  }
  if (buf.trim()) yield JSON.parse(buf) as Record<string, unknown>;
}

export interface OllamaChatArgs {
  baseUrl: string;
  model: string;
  system: string;
  messages: ChatTurn[];
}

export async function streamOllamaChat(f: FetchFn, a: OllamaChatArgs, onText: (d: string) => void, signal?: AbortSignal): Promise<StreamResult> {
  const msgs = [{ role: 'system', content: a.system }, ...a.messages.filter((m) => m.text.trim()).map((m) => ({ role: m.role, content: m.text }))];
  const r = await f(`${normalizeBase(a.baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: a.model, messages: msgs, stream: true }),
    signal,
  });
  if (!r.ok) throw new OllamaHttpError(r.status, await r.text());
  if (!r.body) throw new Error('Empty response body');
  let text = '';
  let stop: StopReason = 'end';
  for await (const o of ndjson(r.body)) {
    if (typeof o.error === 'string') throw new OllamaHttpError(500, o.error);
    const m = o.message as { content?: string } | undefined;
    if (m?.content) {
      text += m.content;
      onText(m.content);
    }
    if (o.done === true) stop = o.done_reason === 'length' ? 'max_tokens' : 'end';
  }
  return { text, stopReason: stop };
}

/** Pulls the message out of an Ollama error body ({"error":"..."}) or returns the raw text. */
export function ollamaErrorMessage(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: string };
    if (typeof j.error === 'string') return j.error;
  } catch {
    /* plain text */
  }
  return body.trim();
}
