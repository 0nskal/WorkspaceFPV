import { t } from '../i18n';
import { systemPrompt } from './prompts';
import { createProviders, effectiveProvider, looksConfigured, providerName } from './providers';
import type { AiConfig, AiProvider, ProviderId } from './types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Error / system message: not sent to the model. */
  note?: boolean;
  /** Which provider produced this answer (shown in the drawer). */
  provider?: ProviderId;
}

export type AssistantConfig = AiConfig;

type Listener = () => void;

/**
 * AI assistant: streams the answer of the selected provider (Anthropic API, Claude Code, Gemini, Ollama) to the UI and keeps
 * the conversation. The system prompt and the drone context are the same for every provider; the user's question goes last.
 */
export class Assistant {
  history: ChatMessage[] = [];
  busy = false;
  /** True from sending the question to the first text token (the model is "thinking"). */
  thinking = false;
  private cbs = new Set<Listener>();
  private abortCtl: AbortController | null = null;
  private providers: Record<ProviderId, AiProvider>;

  constructor(
    private getConfig: () => AssistantConfig,
    private getContext: () => string,
  ) {
    this.providers = createProviders(getConfig);
  }

  subscribe(cb: Listener): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }

  /** Re-renders subscribers (e.g. after provider detection finished). */
  notify(): void {
    this.emit();
  }

  private emit(): void {
    for (const cb of [...this.cbs]) cb();
  }

  /** The provider currently in effect. */
  providerId(): ProviderId {
    return effectiveProvider(this.getConfig());
  }

  provider(id: ProviderId = this.providerId()): AiProvider {
    return this.providers[id];
  }

  /** Cheap synchronous check whether the selected provider looks set up (drawer hint). */
  ready(): boolean {
    return looksConfigured(this.getConfig());
  }

  clear(): void {
    this.abort();
    this.history = [];
    this.emit();
  }

  abort(): void {
    this.abortCtl?.abort();
  }

  /** Sends a tiny prompt through a provider; used by the Settings "Test" button. */
  async test(id: ProviderId): Promise<{ ok: boolean; message: string }> {
    const started = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 90_000);
    try {
      const r = await this.providers[id].stream([{ role: 'user', text: 'Reply with the single word OK.' }], { prompt: 'You are a connection test. Reply with the single word OK.', context: '' }, () => undefined, ctl.signal);
      const reply = r.text.trim().slice(0, 40) || '(empty)';
      return { ok: true, message: t('aiProviders.test.ok', { provider: providerName(id), sec: ((Date.now() - started) / 1000).toFixed(1), reply }) };
    } catch (e) {
      return { ok: false, message: t('aiProviders.test.fail', { msg: ctl.signal.aborted ? 'timeout' : e instanceof Error ? e.message : String(e) }) };
    } finally {
      clearTimeout(timer);
    }
  }

  async ask(question: string): Promise<void> {
    const q = question.trim();
    if (!q || this.busy) return;
    this.history.push({ role: 'user', text: q });
    const id = this.providerId();
    const provider = this.providers[id];
    if (!this.ready()) {
      this.history.push({ role: 'assistant', note: true, text: t('ai.noKey') });
      this.emit();
      return;
    }

    const reply: ChatMessage = { role: 'assistant', text: '', provider: id };
    this.history.push(reply);
    this.busy = true;
    this.thinking = true;
    this.abortCtl = new AbortController();
    this.emit();

    try {
      // Real conversation turns only (no notes/errors), without the empty reply in progress.
      const messages = this.history.filter((m) => !m.note && m !== reply && m.text.trim()).map((m) => ({ role: m.role, text: m.text }));
      let pending = false;
      const res = await provider.stream(
        messages,
        { prompt: systemPrompt(this.getConfig().lang), context: this.getContext() },
        (delta) => {
          this.thinking = false;
          reply.text += delta;
          if (!pending) {
            pending = true;
            requestAnimationFrame(() => {
              pending = false;
              this.emit();
            });
          }
        },
        this.abortCtl.signal,
      );
      if (res.stopReason === 'refusal') {
        reply.text = reply.text || t('ai.refusal');
        reply.note = true;
      } else if (res.stopReason === 'max_tokens') {
        reply.text += '\n\n' + t('ai.cutOff');
      } else if (!reply.text.trim()) {
        reply.text = res.text || t('ai.empty');
      }
    } catch (e) {
      if (this.abortCtl?.signal.aborted) {
        reply.text = reply.text || t('ai.aborted');
        reply.note = !reply.text.trim() || reply.text === t('ai.aborted');
      } else {
        reply.note = true;
        reply.text = (reply.text ? reply.text + '\n\n' : '') + (e instanceof Error ? e.message : String(e));
      }
    } finally {
      this.busy = false;
      this.thinking = false;
      this.abortCtl = null;
      this.emit();
    }
  }
}
