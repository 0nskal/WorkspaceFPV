import Anthropic from '@anthropic-ai/sdk';
import { t } from '../i18n';
import { bridgeStream, BridgeError, desktopAi } from './bridge';
import { streamGemini, type GeminiClientLike } from './gemini-core';
import { listOllamaModels, normalizeBase, ollamaErrorMessage, OllamaHttpError, streamOllamaChat, type FetchFn } from './ollama-core';
import { AiError, DEFAULT_CLAUDE_CODE_MODEL, DEFAULT_GEMINI_MODEL, DEFAULT_OLLAMA_URL, PROVIDER_IDS, cleanTurns, joinSystem, type AiConfig, type AiProvider, type Availability, type ChatTurn, type ProviderId, type StopReason, textTurns } from './types';

const isAbort = (e: unknown, signal: AbortSignal) => signal.aborted || (e instanceof DOMException && e.name === 'AbortError');

/* ---------------- Anthropic API ---------------- */

export function describeAnthropicError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return t('ai.errAuth');
  if (e instanceof Anthropic.PermissionDeniedError) return t('ai.errPermission');
  if (e instanceof Anthropic.RateLimitError) return t('ai.errRate');
  if (e instanceof Anthropic.BadRequestError) return t('ai.errBadRequest', { msg: e.message });
  if (e instanceof Anthropic.APIConnectionError) return t('ai.errConnection');
  if (e instanceof Anthropic.APIError) return t('ai.errApi', { status: e.status ?? '?', msg: e.message });
  return e instanceof Error ? e.message : String(e);
}

function anthropicProvider(cfg: () => AiConfig): AiProvider {
  return {
    id: 'anthropic',
    async available() {
      return cfg().anthropicKey.trim() ? { ok: true, reason: t('aiProviders.state.keySet') } : { ok: false, reason: t('aiProviders.state.missingKey') };
    },
    async stream(messages, system, onText, signal) {
      const c = cfg();
      try {
        const client = new Anthropic({ apiKey: c.anthropicKey.trim(), dangerouslyAllowBrowser: true });
        const stream = client.beta.messages.stream(
          {
            model: c.anthropicModel,
            max_tokens: 16000,
            thinking: { type: 'adaptive' },
            output_config: { effort: 'medium' },
            system: [
              { type: 'text', text: system.prompt },
              { type: 'text', text: system.context, cache_control: { type: 'ephemeral' } },
            ],
            messages: cleanTurns(messages).map((m) =>
              m.image && m.role === 'user'
                ? { role: m.role, content: [{ type: 'image' as const, source: { type: 'base64' as const, media_type: m.image.mime, data: m.image.data } }, { type: 'text' as const, text: m.text }] }
                : { role: m.role, content: m.text },
            ),
            // Server-side fallback on a classifier refusal (available for Opus 5.x models).
            ...(c.anthropicModel.startsWith('claude-opus-5') ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          },
          { signal },
        );
        let text = '';
        stream.on('text', (delta: string) => {
          text += delta;
          onText(delta);
        });
        const final = await stream.finalMessage();
        if (!text) text = final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        const stopReason: StopReason = final.stop_reason === 'refusal' ? 'refusal' : final.stop_reason === 'max_tokens' ? 'max_tokens' : 'end';
        return { text, stopReason };
      } catch (e) {
        if (isAbort(e, signal)) throw e;
        throw new AiError(describeAnthropicError(e));
      }
    },
  };
}

/* ---------------- Claude Code (desktop) ---------------- */

function claudeCodeProvider(cfg: () => AiConfig): AiProvider {
  return {
    id: 'claude-code',
    async available(): Promise<Availability> {
      const api = desktopAi();
      if (!api) return { ok: false, reason: t('aiProviders.state.desktopOnly') };
      const info = await api.detectClaude(true);
      if (info.ok) return { ok: true, reason: t('aiProviders.state.ccDetected', { version: info.version ?? '?' }) };
      return { ok: false, reason: t(info.reason === 'failed' ? 'aiProviders.state.ccFailed' : 'aiProviders.state.ccMissing') };
    },
    async stream(messages, system, onText, signal) {
      const api = desktopAi();
      if (!api) throw new AiError(t('aiProviders.err.ccDesktop'));
      try {
        return await bridgeStream(api, { provider: 'claude-code', model: cfg().claudeCodeModel || DEFAULT_CLAUDE_CODE_MODEL, prompt: system.prompt, messages: textTurns(messages), context: system.context }, onText, signal);
      } catch (e) {
        if (isAbort(e, signal)) throw e;
        if (e instanceof BridgeError) {
          if (e.code === 'missing') throw new AiError(t('aiProviders.err.ccMissing'));
          if (e.code === 'spawn') throw new AiError(t('aiProviders.err.ccStart', { msg: e.message }));
          if (/log ?in|authenticat|credential|401|oauth/i.test(e.message)) throw new AiError(t('aiProviders.err.ccLogin'));
          throw new AiError(t('aiProviders.err.ccFailed', { msg: e.message }));
        }
        throw e;
      }
    },
  };
}

/* ---------------- Google Gemini ---------------- */

function geminiProvider(cfg: () => AiConfig): AiProvider {
  return {
    id: 'gemini',
    async available() {
      return cfg().geminiKey.trim() ? { ok: true, reason: t('aiProviders.state.keySet') } : { ok: false, reason: t('aiProviders.state.missingKey') };
    },
    async stream(messages, system, onText, signal) {
      const c = cfg();
      const model = c.geminiModel.trim() || DEFAULT_GEMINI_MODEL;
      try {
        const { GoogleGenAI } = await import('@google/genai'); // loaded only when Gemini is used
        const client = new GoogleGenAI({ apiKey: c.geminiKey.trim() });
        return await streamGemini(client as unknown as GeminiClientLike, model, joinSystem(system), messages, onText, signal);
      } catch (e) {
        if (isAbort(e, signal)) throw e;
        throw new AiError(describeGeminiError(e, model));
      }
    },
  };
}

export function describeGeminiError(e: unknown, model: string): string {
  const status = (e as { status?: number } | null)?.status;
  const msg = e instanceof Error ? e.message : String(e);
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) return t('aiProviders.err.geminiAuth');
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return t('aiProviders.err.geminiRate');
  if (status === 404 || /not found|is not supported/i.test(msg)) return t('aiProviders.err.geminiModel', { model });
  if (status === undefined && (e instanceof TypeError || /failed to fetch|network/i.test(msg))) return t('aiProviders.err.geminiConnection');
  return t('aiProviders.err.geminiApi', { msg: msg.slice(0, 300) });
}

/* ---------------- Ollama ---------------- */

export type OllamaStatus = { kind: 'ok' | 'noModels' | 'down' | 'cors'; models: string[]; message?: string };

const browserFetch: FetchFn = (url, init) => fetch(url, init) as unknown as ReturnType<FetchFn>;

/** Lists the models; in the desktop app through the main process (no CORS), in the browser directly. */
export async function ollamaStatus(baseUrl: string): Promise<OllamaStatus> {
  const url = normalizeBase(baseUrl);
  const api = desktopAi();
  if (api) {
    const r = await api.ollamaTags(url);
    if (!r.ok) return { kind: 'down', models: [], message: r.message };
    return { kind: r.models.length ? 'ok' : 'noModels', models: r.models };
  }
  try {
    const models = await listOllamaModels(browserFetch, url, AbortSignal.timeout(5000));
    return { kind: models.length ? 'ok' : 'noModels', models };
  } catch (e) {
    if (e instanceof OllamaHttpError) return { kind: 'down', models: [], message: ollamaErrorMessage(e.message) };
    // A thrown TypeError is either "server down" or "blocked by CORS". A no-cors request tells them apart: it succeeds (opaque) if something answers.
    try {
      await fetch(`${url}/api/tags`, { mode: 'no-cors', signal: AbortSignal.timeout(3000) });
      return { kind: 'cors', models: [] };
    } catch {
      return { kind: 'down', models: [] };
    }
  }
}

function ollamaProvider(cfg: () => AiConfig): AiProvider {
  const url = () => normalizeBase(cfg().ollamaUrl || DEFAULT_OLLAMA_URL);
  return {
    id: 'ollama',
    async available() {
      const s = await ollamaStatus(url());
      if (s.kind === 'ok') return { ok: true, reason: t('aiProviders.state.ollamaRunning', { n: s.models.length }) };
      if (s.kind === 'noModels') return { ok: false, reason: t('aiProviders.state.ollamaNoModels') };
      if (s.kind === 'cors') return { ok: false, reason: t('aiProviders.state.ollamaCors') };
      return { ok: false, reason: t('aiProviders.state.ollamaDown') };
    },
    async stream(messages: ChatTurn[], system, onText, signal) {
      const c = cfg();
      const model = c.ollamaModel.trim();
      if (!model) throw new AiError(t('aiProviders.err.ollamaNoModel'));
      const base = url();
      const mapHttp = (e: OllamaHttpError | BridgeError) => {
        const status = e instanceof OllamaHttpError ? e.status : e.code === 'model' ? 404 : e.code === 'connect' ? 0 : 500;
        const msg = e instanceof OllamaHttpError ? ollamaErrorMessage(e.message) : e.message;
        if (status === 404 || /not found/i.test(msg)) return new AiError(t('aiProviders.err.ollamaModel', { model }));
        if (status === 0) return new AiError(t('aiProviders.err.ollamaConnect', { url: base }));
        return new AiError(t('aiProviders.err.ollamaApi', { msg: msg.slice(0, 300) }));
      };
      try {
        const api = desktopAi();
        if (api) return await bridgeStream(api, { provider: 'ollama', baseUrl: base, model, system: joinSystem(system), messages: textTurns(messages) }, onText, signal);
        return await streamOllamaChat(browserFetch, { baseUrl: base, model, system: joinSystem(system), messages: textTurns(messages) }, onText, signal);
      } catch (e) {
        if (isAbort(e, signal)) throw e;
        if (e instanceof OllamaHttpError || e instanceof BridgeError) throw mapHttp(e);
        if (e instanceof TypeError) {
          const s = await ollamaStatus(base);
          if (s.kind === 'cors') throw new AiError(t('aiProviders.ollama.corsHelp', { origin: location.origin }).replace(/<\/?code>/g, ''));
          throw new AiError(t('aiProviders.err.ollamaConnect', { url: base }));
        }
        throw e;
      }
    },
  };
}

/* ---------------- registry ---------------- */

export function createProviders(cfg: () => AiConfig): Record<ProviderId, AiProvider> {
  return { anthropic: anthropicProvider(cfg), 'claude-code': claudeCodeProvider(cfg), gemini: geminiProvider(cfg), ollama: ollamaProvider(cfg) };
}

export const providerName = (id: ProviderId): string => t(`aiProviders.short.${id}`);

/** Cached "Claude Code detected" flag so the sync default-provider choice can use it (filled by refreshClaudeDetected). */
let claudeDetected = false;
export function setClaudeDetected(v: boolean): void {
  claudeDetected = v;
}
export async function refreshClaudeDetected(): Promise<boolean> {
  const api = desktopAi();
  claudeDetected = api ? (await api.detectClaude()).ok : false;
  return claudeDetected;
}

/** The provider in effect: the user's choice, else Claude Code in the desktop app when detected and no Anthropic key is set, else Anthropic. */
export function effectiveProvider(cfg: AiConfig): ProviderId {
  if (cfg.provider && PROVIDER_IDS.includes(cfg.provider)) return cfg.provider;
  if (desktopAi() && claudeDetected && !cfg.anthropicKey.trim()) return 'claude-code';
  return 'anthropic';
}

/** Cheap synchronous "is it configured" check used by the drawer hint (Ollama/Claude Code are verified when asking). */
export function looksConfigured(cfg: AiConfig): boolean {
  switch (effectiveProvider(cfg)) {
    case 'anthropic':
      return !!cfg.anthropicKey.trim();
    case 'gemini':
      return !!cfg.geminiKey.trim();
    case 'ollama':
      return !!cfg.ollamaModel.trim();
    case 'claude-code':
      return !!desktopAi();
  }
}
