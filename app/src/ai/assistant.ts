import Anthropic from '@anthropic-ai/sdk';
import { t, type Lang } from '../i18n';
import { systemPrompt } from './prompts';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Wiadomosc bledu / systemowa - nie wysylana do API. */
  note?: boolean;
}

export interface AssistantConfig {
  apiKey: string;
  model: string;
  /** UI language: the assistant is told to answer in it. */
  lang: Lang;
}

type Listener = () => void;

/**
 * Asystent AI: strumieniuje odpowiedz Claude do UI, trzyma historie rozmowy.
 * Kontekst (dane FC, reguly, diff all) idzie do prompta systemowego z cache_control,
 * pytanie uzytkownika jest ostatnie.
 */
export class Assistant {
  history: ChatMessage[] = [];
  busy = false;
  /** Prawda od wyslania pytania do pierwszego tokenu tekstu (model "mysli"). */
  thinking = false;
  private cbs = new Set<Listener>();
  private abortCtl: AbortController | null = null;

  constructor(
    private getConfig: () => AssistantConfig,
    private getContext: () => string,
  ) {}

  subscribe(cb: Listener): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }

  private emit(): void {
    for (const cb of [...this.cbs]) cb();
  }

  hasKey(): boolean {
    return this.getConfig().apiKey.trim().length > 0;
  }

  clear(): void {
    this.abort();
    this.history = [];
    this.emit();
  }

  abort(): void {
    this.abortCtl?.abort();
  }

  async ask(question: string): Promise<void> {
    const q = question.trim();
    if (!q || this.busy) return;
    const cfg = this.getConfig();
    this.history.push({ role: 'user', text: q });
    if (!cfg.apiKey.trim()) {
      this.history.push({ role: 'assistant', note: true, text: t('ai.noKey') });
      this.emit();
      return;
    }

    const reply: ChatMessage = { role: 'assistant', text: '' };
    this.history.push(reply);
    this.busy = true;
    this.thinking = true;
    this.abortCtl = new AbortController();
    this.emit();

    try {
      const client = new Anthropic({ apiKey: cfg.apiKey.trim(), dangerouslyAllowBrowser: true });
      // Tylko prawdziwe tury rozmowy (bez notatek/bledow), bez pustej odpowiedzi w toku.
      const messages = this.history
        .filter((m) => !m.note && m !== reply && m.text.trim())
        .map((m) => ({ role: m.role, content: m.text }));

      const stream = client.beta.messages.stream(
        {
          model: cfg.model,
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'medium' },
          system: [
            { type: 'text', text: systemPrompt(cfg.lang) },
            { type: 'text', text: this.getContext(), cache_control: { type: 'ephemeral' } },
          ],
          messages,
          // Fallback po stronie serwera przy odmowie klasyfikatora (dostepny dla modeli Opus 5.x).
          ...(cfg.model.startsWith('claude-opus-5') ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal: this.abortCtl.signal },
      );

      let pending = false;
      stream.on('text', (delta: string) => {
        this.thinking = false;
        reply.text += delta;
        if (!pending) {
          pending = true;
          requestAnimationFrame(() => {
            pending = false;
            this.emit();
          });
        }
      });

      const final = await stream.finalMessage();
      // stop_reason sprawdzamy przed uzyciem tresci
      if (final.stop_reason === 'refusal') {
        reply.text = reply.text || t('ai.refusal');
        reply.note = true;
      } else if (final.stop_reason === 'max_tokens') {
        reply.text += '\n\n' + t('ai.cutOff');
      } else if (!reply.text.trim()) {
        const text = final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        reply.text = text || t('ai.empty');
      }
    } catch (e) {
      if (this.abortCtl?.signal.aborted) {
        reply.text = reply.text || t('ai.aborted');
        reply.note = !reply.text.trim() || reply.text === t('ai.aborted');
      } else {
        reply.note = true;
        reply.text = (reply.text ? reply.text + '\n\n' : '') + describeError(e);
      }
    } finally {
      this.busy = false;
      this.thinking = false;
      this.abortCtl = null;
      this.emit();
    }
  }
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return t('ai.errAuth');
  if (e instanceof Anthropic.PermissionDeniedError) return t('ai.errPermission');
  if (e instanceof Anthropic.RateLimitError) return t('ai.errRate');
  if (e instanceof Anthropic.BadRequestError) return t('ai.errBadRequest', { msg: e.message });
  if (e instanceof Anthropic.APIConnectionError) return t('ai.errConnection');
  if (e instanceof Anthropic.APIError) return t('ai.errApi', { status: e.status ?? '?', msg: e.message });
  return e instanceof Error ? e.message : String(e);
}
