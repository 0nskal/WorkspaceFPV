/** Common types of the AI layer: every provider (Anthropic API, Claude Code, Gemini, Ollama) implements AiProvider. */
type Lang = 'en' | 'pl'; // same as i18n's Lang (not imported: the Electron build has no DOM types)

export type ProviderId = 'anthropic' | 'claude-code' | 'gemini' | 'ollama';
export const PROVIDER_IDS: ProviderId[] = ['claude-code', 'gemini', 'ollama', 'anthropic'];

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Screenshot of a fragment the user pointed at (base64 PNG). Only the Anthropic API and Gemini receive it. */
  image?: { mime: 'image/png'; data: string };
}

/** Providers that read images; the others get the fragment as text only. */
export const IMAGE_PROVIDERS: ProviderId[] = ['anthropic', 'gemini'];

/** Text-only turns (for the CLI and Ollama, and for anything sent over IPC). */
export const textTurns = (m: ChatTurn[]): ChatTurn[] => m.map((x) => ({ role: x.role, text: x.text }));

/** System prompt split in two: stable instructions and the drone context (Anthropic caches the context block). */
export interface AiSystem {
  prompt: string;
  context: string;
}

export type StopReason = 'end' | 'max_tokens' | 'refusal' | 'other';

export interface StreamResult {
  text: string;
  stopReason: StopReason;
}

export interface Availability {
  ok: boolean;
  /** Short human-readable status (already translated), e.g. "Detected: Claude Code 2.1.325" or why it is not usable. */
  reason?: string;
}

export interface AiProvider {
  id: ProviderId;
  available(): Promise<Availability>;
  stream(messages: ChatTurn[], system: AiSystem, onText: (delta: string) => void, signal: AbortSignal): Promise<StreamResult>;
}

/** Everything the providers need from the settings. */
export interface AiConfig {
  provider: ProviderId | '';
  lang: Lang;
  anthropicKey: string;
  anthropicModel: string;
  claudeCodeModel: string;
  geminiKey: string;
  geminiModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  /** Interface mode: 'basic' makes the assistant explain in plain words. */
  uiMode?: 'basic' | 'expert';
}

/** Error whose message is already user-facing (translated). */
export class AiError extends Error {}

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * A Gemini model id ("gemini-2.5-flash", also accepted with the "models/" prefix). Anything else (e.g. the key's
 * display name "Default Gemini API Key" pasted into the model field) falls back to the default instead of failing.
 */
export function normalizeGeminiModel(raw: string): string {
  const m = raw.trim().replace(/^models\//, '');
  return /^[a-z0-9][a-z0-9.-]*$/i.test(m) ? m : DEFAULT_GEMINI_MODEL;
}
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
export const DEFAULT_CLAUDE_CODE_MODEL = 'opus';
export const CLAUDE_CODE_MODELS = ['opus', 'sonnet'] as const;

/** Joins the system parts for providers that take a single string. */
export function joinSystem(s: AiSystem): string {
  return s.context ? `${s.prompt}\n\n${s.context}` : s.prompt;
}

/** Messages the model sees: real turns only (no empty ones). */
export function cleanTurns(turns: ChatTurn[]): ChatTurn[] {
  return turns.filter((m) => m.text.trim());
}

/** Prompt for Claude Code (stdin): drone context + the conversation, since the CLI takes one prompt. */
export function buildCliPrompt(messages: ChatTurn[], context: string): string {
  const turns = cleanTurns(messages);
  const last = turns[turns.length - 1];
  const earlier = turns.slice(0, -1);
  const parts: string[] = [];
  if (context) parts.push(`<drone_context>\n${context}\n</drone_context>`);
  if (earlier.length) {
    parts.push(`<conversation_so_far>\n${earlier.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n\n')}\n</conversation_so_far>`);
  }
  parts.push(last ? `User: ${last.text}` : 'User: Hello');
  return parts.join('\n\n');
}
