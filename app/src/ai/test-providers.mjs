// Tests of the AI provider adapters against recorded sample chunks (no network, no CLI). Run:
//   npx esbuild app/src/ai/test-providers.mjs --bundle --platform=node --format=esm --outfile=$TEMP/ai-test.mjs && node $TEMP/ai-test.mjs
import { ClaudeStreamParser } from './claude-stream.ts';
import { streamOllamaChat, listOllamaModels, ndjson, ollamaErrorMessage, OllamaHttpError } from './ollama-core.ts';
import { streamGemini, mapGeminiFinish } from './gemini-core.ts';
import { buildCliPrompt, joinSystem } from './types.ts';
import { claudeArgs } from '../../../electron/claude-code.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}
const enc = new TextEncoder();
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- Claude Code stream-json: lines recorded from `claude -p --output-format stream-json --verbose --include-partial-messages` (v2.1.325), usage trimmed ----
const REC_OK = [
  '{"type":"system","subtype":"init","cwd":"C:\\\\Temp\\\\x","session_id":"s1","tools":[],"model":"claude-opus-5-5"}',
  '{"type":"system","subtype":"status","status":"requesting","session_id":"s1"}',
  '{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-opus-5-5","role":"assistant","content":[]}},"session_id":"s1","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"s1","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"O"}},"session_id":"s1","parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"K"}},"session_id":"s1","parent_tool_use_id":null}',
  '{"type":"assistant","message":{"model":"claude-opus-5-5","role":"assistant","content":[{"type":"text","text":"OK"}],"stop_reason":null},"parent_tool_use_id":null}',
  '{"type":"stream_event","event":{"type":"content_block_stop","index":0},"session_id":"s1"}',
  '{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn"}},"session_id":"s1"}',
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}',
  '{"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","result":"OK","session_id":"s1","terminal_reason":"completed"}',
];
{
  const p = new ClaudeStreamParser();
  const ev = [];
  // feed in awkward chunk sizes, including a split in the middle of a line
  const raw = REC_OK.join('\n') + '\n';
  for (let i = 0; i < raw.length; i += 37) ev.push(...p.push(raw.slice(i, i + 37)));
  ev.push(...p.flush());
  const text = ev.filter((e) => e.kind === 'text').map((e) => e.text).join('');
  check('claude: text deltas assembled', text === 'OK', text);
  const done = ev.filter((e) => e.kind === 'done');
  check('claude: one done, end', done.length === 1 && done[0].stopReason === 'end' && done[0].fallbackText === undefined);
  check('claude: finished flag', p.finished);
}
{
  // no partial deltas (older CLI / flag ignored): fall back to the whole message
  const p = new ClaudeStreamParser();
  const ev = p.push('{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}\n{"type":"result","is_error":false,"stop_reason":"end_turn","result":"Hello"}');
  ev.push(...p.flush());
  check('claude: fallback text without deltas', ev.length === 1 && ev[0].kind === 'done' && ev[0].fallbackText === 'Hello');
}
{
  // recorded error (unknown model): the result line has is_error true and the message in "result"
  const p = new ClaudeStreamParser();
  const ev = p.push(
    '{"type":"assistant","message":{"model":"<synthetic>","content":[{"type":"text","text":"There is an issue with the selected model (x)."}]},"error":"model_not_found"}\n' +
      '{"type":"result","subtype":"success","is_error":true,"stop_reason":"stop_sequence","result":"There is an issue with the selected model (x). It may not exist or you may not have access to it.","terminal_reason":"api_error"}\n',
  );
  check('claude: error result', ev.length === 1 && ev[0].kind === 'error' && /selected model/.test(ev[0].message));
}
{
  const p = new ClaudeStreamParser();
  const ev = p.push('warning: something\n{"type":"result","is_error":false,"stop_reason":"max_tokens","result":"abc"}\n');
  check('claude: junk line ignored, max_tokens mapped', ev.length === 1 && ev[0].stopReason === 'max_tokens');
}
{
  const a = claudeArgs('opus', 'SYS');
  check('claude: args array, no shell chars needed', a[0] === '-p' && a.includes('stream-json') && a[a.indexOf('--model') + 1] === 'opus' && a[a.indexOf('--tools') + 1] === '' && a[a.indexOf('--system-prompt') + 1] === 'SYS' && !a.includes('--dangerously-skip-permissions'));
}
{
  const prompt = buildCliPrompt(
    [
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'answer' },
      { role: 'user', text: 'second' },
    ],
    'CTX',
  );
  check('cli prompt: context, history, last question', prompt.startsWith('<drone_context>\nCTX') && prompt.includes('User: first') && prompt.includes('Assistant: answer') && prompt.endsWith('User: second'));
  check('joinSystem', joinSystem({ prompt: 'P', context: 'C' }) === 'P\n\nC' && joinSystem({ prompt: 'P', context: '' }) === 'P');
}

// ---- Ollama: NDJSON as /api/chat streams it (chunk boundaries inside lines and inside a UTF-8 char) ----
const OLLAMA_LINES = [
  '{"model":"qwen3:8b","created_at":"2026-11-16T10:00:00Z","message":{"role":"assistant","content":"Za"},"done":false}',
  '{"model":"qwen3:8b","created_at":"2026-11-16T10:00:00Z","message":{"role":"assistant","content":"łóż"},"done":false}',
  '{"model":"qwen3:8b","created_at":"2026-11-16T10:00:01Z","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","total_duration":1,"eval_count":3}',
];
function bodyFrom(bytes, step) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => (i >= bytes.length ? { done: true } : ((i += step), { done: false, value: bytes.slice(i - step, Math.min(i, bytes.length)) })),
    }),
  };
}
{
  const calls = [];
  const bytes = enc.encode(OLLAMA_LINES.join('\n') + '\n');
  const f = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => '', json: async () => ({}), body: bodyFrom(bytes, 29) };
  };
  const got = [];
  const r = await streamOllamaChat(f, { baseUrl: 'http://localhost:11434/', model: 'qwen3:8b', system: 'SYS', messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: '' }] }, (d) => got.push(d));
  check('ollama: text streamed incl. UTF-8 split', r.text === 'Załóż' && got.join('') === 'Załóż', r.text);
  check('ollama: stop reason end', r.stopReason === 'end');
  const body = JSON.parse(calls[0].init.body);
  check('ollama: request shape', calls[0].url === 'http://localhost:11434/api/chat' && body.stream === true && body.model === 'qwen3:8b' && eq(body.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }]));
}
{
  const bytes = enc.encode('{"message":{"content":"x"},"done":true,"done_reason":"length"}');
  const f = async () => ({ ok: true, status: 200, text: async () => '', json: async () => ({}), body: bodyFrom(bytes, 1000) });
  const r = await streamOllamaChat(f, { baseUrl: 'http://x', model: 'm', system: 's', messages: [] }, () => {});
  check('ollama: length -> max_tokens, last line without newline', r.stopReason === 'max_tokens' && r.text === 'x');
}
{
  const f = async () => ({ ok: false, status: 404, text: async () => '{"error":"model \'nope\' not found"}', json: async () => ({}), body: null });
  let err;
  try {
    await streamOllamaChat(f, { baseUrl: 'http://x', model: 'nope', system: 's', messages: [] }, () => {});
  } catch (e) {
    err = e;
  }
  check('ollama: 404 error body', err instanceof OllamaHttpError && err.status === 404 && /not found/.test(ollamaErrorMessage(err.message)));
}
{
  const f = async (url) => ({ ok: true, status: 200, text: async () => '', json: async () => ({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b' }, { name: 'llama3.1:8b' }] }), body: null, url });
  const names = await listOllamaModels(f, 'http://localhost:11434/');
  check('ollama: /api/tags model names', eq(names, ['qwen3:8b', 'llama3.1:8b']));
}

// ---- Gemini: chunks shaped like generateContentStream results ----
{
  const chunks = [
    { text: 'Ustaw ', candidates: [{ content: { role: 'model', parts: [{ text: 'Ustaw ' }] } }] },
    { text: 'DSHOT600', candidates: [{ content: { role: 'model', parts: [{ text: 'DSHOT600' }] }, finishReason: 'STOP' }] },
  ];
  let seen;
  const client = {
    models: {
      generateContentStream: async (p) => {
        seen = p;
        return (async function* () {
          for (const c of chunks) yield c;
        })();
      },
    },
  };
  const got = [];
  const ac = new AbortController();
  const r = await streamGemini(client, 'gemini-2.5-flash', 'SYS', [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }, { role: 'user', text: 'q2' }], (d) => got.push(d), ac.signal);
  check('gemini: streamed text', r.text === 'Ustaw DSHOT600' && got.length === 2 && r.stopReason === 'end');
  check('gemini: request shape (roles, system, signal)', seen.model === 'gemini-2.5-flash' && eq(seen.contents.map((c) => c.role), ['user', 'model', 'user']) && seen.config.systemInstruction === 'SYS' && seen.config.abortSignal === ac.signal);
  check('gemini: finish reasons', mapGeminiFinish('MAX_TOKENS') === 'max_tokens' && mapGeminiFinish('SAFETY') === 'refusal' && mapGeminiFinish(undefined) === 'end' && mapGeminiFinish('OTHER') === 'other');
  const blocked = { models: { generateContentStream: async () => (async function* () { yield { promptFeedback: { blockReason: 'SAFETY' } }; })() } };
  const rb = await streamGemini(blocked, 'm', 's', [{ role: 'user', text: 'q' }], () => {});
  check('gemini: blocked prompt -> refusal', rb.stopReason === 'refusal' && rb.text === '');
}

console.log(fails ? `\n${fails} FAILED` : '\nall AI provider tests passed');
process.exit(fails ? 1 : 0);
