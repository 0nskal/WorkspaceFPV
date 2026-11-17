/** Gemini streaming over the official @google/genai SDK (the client is injectable for tests). */
import type { ChatTurn, StopReason, StreamResult } from './types';

interface GeminiChunk {
  text?: string;
  candidates?: Array<{ finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}
export interface GeminiClientLike {
  models: {
    generateContentStream(p: {
      model: string;
      contents: Array<{ role: string; parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> }>;
      config?: { systemInstruction?: string; abortSignal?: AbortSignal };
    }): Promise<AsyncIterable<GeminiChunk>>;
  };
}

export function mapGeminiFinish(r: string | undefined): StopReason {
  if (!r || r === 'STOP' || r === 'FINISH_REASON_UNSPECIFIED') return 'end';
  if (r === 'MAX_TOKENS') return 'max_tokens';
  if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY'].includes(r)) return 'refusal';
  return 'other';
}

export async function streamGemini(client: GeminiClientLike, model: string, system: string, messages: ChatTurn[], onText: (d: string) => void, signal?: AbortSignal): Promise<StreamResult> {
  const contents = messages
    .filter((m) => m.text.trim())
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: m.image && m.role === 'user' ? [{ inlineData: { mimeType: m.image.mime, data: m.image.data } }, { text: m.text }] : [{ text: m.text }],
    }));
  const stream = await client.models.generateContentStream({ model, contents, config: { systemInstruction: system, abortSignal: signal } });
  let text = '';
  let finish: string | undefined;
  let blocked = false;
  for await (const chunk of stream) {
    if (chunk.promptFeedback?.blockReason) blocked = true;
    const fr = chunk.candidates?.[0]?.finishReason;
    if (fr) finish = fr;
    const d = chunk.text;
    if (d) {
      text += d;
      onText(d);
    }
  }
  return { text, stopReason: blocked ? 'refusal' : mapGeminiFinish(finish) };
}
