/**
 * Parser of `claude -p --output-format stream-json --verbose --include-partial-messages` output (one JSON object per line).
 * Pure (no DOM, no Electron) so the main process and the node tests share it.
 *
 * Relevant lines:
 *  {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}}
 *  {"type":"assistant","message":{"content":[{"type":"text","text":"OK"}]}}          (whole message; fallback when no deltas)
 *  {"type":"result","is_error":false,"stop_reason":"end_turn","result":"OK"}          (last line)
 */
export type CliEvent =
  | { kind: 'text'; text: string }
  | { kind: 'done'; stopReason: 'end' | 'max_tokens' | 'refusal' | 'other'; fallbackText?: string }
  | { kind: 'error'; message: string };

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null;

export class ClaudeStreamParser {
  private buf = '';
  private sawDelta = false;
  private lastAssistantText = '';
  private ended = false;

  /** Feed a raw stdout chunk; returns the events completed by it. */
  push(chunk: string): CliEvent[] {
    this.buf += chunk;
    const out: CliEvent[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) out.push(...this.line(line));
    }
    return out;
  }

  /** Call at EOF: parses a last line without a trailing newline. */
  flush(): CliEvent[] {
    const rest = this.buf.trim();
    this.buf = '';
    return rest ? this.line(rest) : [];
  }

  /** True once the final "result" line was seen. */
  get finished(): boolean {
    return this.ended;
  }

  private line(line: string): CliEvent[] {
    let j: unknown;
    try {
      j = JSON.parse(line);
    } catch {
      return []; // not JSON (stray warning): ignore
    }
    if (!isObj(j)) return [];
    if (j.type === 'stream_event' && isObj(j.event)) {
      const ev = j.event;
      if (ev.type === 'content_block_delta' && isObj(ev.delta) && ev.delta.type === 'text_delta' && typeof ev.delta.text === 'string') {
        if (j.parent_tool_use_id) return []; // sub-agent output is never shown (cannot occur without tools)
        this.sawDelta = true;
        return ev.delta.text ? [{ kind: 'text', text: ev.delta.text }] : [];
      }
      return [];
    }
    if (j.type === 'assistant' && isObj(j.message) && Array.isArray(j.message.content)) {
      this.lastAssistantText = j.message.content.map((b) => (isObj(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('');
      return [];
    }
    if (j.type === 'result') {
      this.ended = true;
      const text = typeof j.result === 'string' ? j.result : '';
      if (j.is_error === true) return [{ kind: 'error', message: text || this.lastAssistantText || 'Claude Code reported an error.' }];
      const sr = j.stop_reason;
      const stopReason = sr === 'max_tokens' ? 'max_tokens' : sr === 'refusal' ? 'refusal' : sr === 'end_turn' || sr === 'stop_sequence' || sr == null ? 'end' : 'other';
      return [{ kind: 'done', stopReason, fallbackText: this.sawDelta ? undefined : text || this.lastAssistantText }];
    }
    return [];
  }
}
