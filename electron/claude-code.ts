/**
 * Claude Code provider, main-process side (no Electron imports: also runs from plain node for tests).
 * Uses the user's installed and logged-in `claude` CLI headless. Nothing goes through a shell: spawn() with an args array.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeStreamParser } from '../app/src/ai/claude-stream';

export interface ClaudeInfo {
  ok: boolean;
  path?: string;
  version?: string;
  reason?: 'missing' | 'failed';
}

interface Launch {
  cmd: string;
  prefix: string[];
  env: NodeJS.ProcessEnv;
}

function exists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function lookup(): Promise<string[]> {
  return new Promise((resolve) => {
    const tool = process.platform === 'win32' ? 'where' : 'which';
    execFile(tool, ['claude'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([]);
      resolve(
        stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    });
  });
}

/** Candidate locations, PATH hits first. */
async function candidates(): Promise<string[]> {
  const home = os.homedir();
  const win = process.platform === 'win32';
  const list = await lookup();
  const extra = win
    ? [path.join(home, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd')]
    : [path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude', path.join(home, '.npm-global', 'bin', 'claude')];
  const seen = new Set<string>();
  return [...list, ...extra].filter((p) => (seen.has(p.toLowerCase()) ? false : (seen.add(p.toLowerCase()), exists(p))));
}

/** A Windows npm shim (claude.cmd) cannot be spawned without a shell; resolve what it launches instead. */
function resolveLaunch(found: string): Launch | null {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // make sure the CLI uses the user's login (plan), not a pay-per-token key from the environment
  delete env.ANTHROPIC_AUTH_TOKEN;
  if (!/\.(cmd|bat)$/i.test(found)) return { cmd: found, prefix: [], env };
  const base = path.join(path.dirname(found), 'node_modules', '@anthropic-ai', 'claude-code');
  const exe = path.join(base, 'bin', 'claude.exe');
  if (exists(exe)) return { cmd: exe, prefix: [], env };
  const cli = path.join(base, 'cli.js');
  if (exists(cli)) return { cmd: process.execPath, prefix: [cli], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } };
  return null;
}

let cached: { info: ClaudeInfo; launch: Launch | null; at: number } | null = null;

export async function detectClaude(force = false): Promise<ClaudeInfo> {
  if (!force && cached && Date.now() - cached.at < 30_000) return cached.info;
  const found = await candidates();
  if (!found.length) {
    cached = { info: { ok: false, reason: 'missing' }, launch: null, at: Date.now() };
    return cached.info;
  }
  for (const p of found) {
    const launch = resolveLaunch(p);
    if (!launch) continue;
    const version = await new Promise<string | null>((resolve) => {
      execFile(launch.cmd, [...launch.prefix, '--version'], { windowsHide: true, timeout: 10_000, env: launch.env }, (err, stdout) => resolve(err ? null : stdout.trim()));
    });
    if (version) {
      cached = { info: { ok: true, path: p, version: version.replace(/\s*\(Claude Code\)\s*$/, '') }, launch, at: Date.now() };
      return cached.info;
    }
  }
  cached = { info: { ok: false, reason: 'failed', path: found[0] }, launch: null, at: Date.now() };
  return cached.info;
}

/** Exact CLI arguments (verified against `claude --help`, v2.1.325). Prompt goes through stdin, never through args. */
export function claudeArgs(model: string, systemPrompt: string): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model',
    model,
    '--tools',
    '', // no tools at all
    '--system-prompt',
    systemPrompt,
    '--no-session-persistence',
    '--disable-slash-commands',
    '--strict-mcp-config', // no MCP servers (none are passed)
    '--setting-sources',
    '', // no user/project/local settings, hooks, memory or CLAUDE.md
  ];
}

export type RunEvent = { type: 'text'; text: string } | { type: 'done'; stopReason: 'end' | 'max_tokens' | 'refusal' | 'other' } | { type: 'error'; code: 'missing' | 'spawn' | 'exit' | 'cli'; message: string };

const MODEL_RE = /^[A-Za-z0-9._:\-[\]]{1,80}$/;

/** Runs one headless request. Returns a cancel function. Exactly one terminal event (done or error) is emitted. */
export function runClaudeCode(opts: { model: string; systemPrompt: string; prompt: string }, onEvent: (e: RunEvent) => void): () => void {
  let child: ChildProcess | null = null;
  let finished = false;
  let cancelled = false;
  let workDir = '';
  const finish = (e: RunEvent) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (workDir) fs.rm(workDir, { recursive: true, force: true }, () => undefined);
    onEvent(e);
  };
  const timer = setTimeout(() => {
    child?.kill();
    finish({ type: 'error', code: 'exit', message: 'Timed out after 5 minutes.' });
  }, 5 * 60_000);

  void (async () => {
    if (!MODEL_RE.test(opts.model)) return finish({ type: 'error', code: 'cli', message: `Invalid model name: ${opts.model}` });
    const info = await detectClaude();
    if (!info.ok || !cached?.launch) return finish({ type: 'error', code: 'missing', message: 'Claude Code not found.' });
    if (cancelled) return;
    const launch = cached.launch;
    try {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspacefpv-cc-')); // empty cwd: nothing of the user's to read
    } catch (e) {
      return finish({ type: 'error', code: 'spawn', message: String(e) });
    }
    const parser = new ClaudeStreamParser();
    let stderr = '';
    let sawText = false;
    const handle = (events: ReturnType<ClaudeStreamParser['push']>) => {
      for (const ev of events) {
        if (ev.kind === 'text') {
          sawText = true;
          onEvent({ type: 'text', text: ev.text });
        } else if (ev.kind === 'done') {
          if (!sawText && ev.fallbackText) onEvent({ type: 'text', text: ev.fallbackText });
          finish({ type: 'done', stopReason: ev.stopReason });
        } else finish({ type: 'error', code: 'cli', message: ev.message });
      }
    };
    try {
      child = spawn(launch.cmd, [...launch.prefix, ...claudeArgs(opts.model, opts.systemPrompt)], { cwd: workDir, env: launch.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return finish({ type: 'error', code: 'spawn', message: String(e) });
    }
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => handle(parser.push(d)));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (d: string) => (stderr = (stderr + d).slice(-2000)));
    child.on('error', (e) => finish({ type: 'error', code: 'spawn', message: e.message }));
    child.on('close', (code) => {
      handle(parser.flush());
      if (!finished) finish(cancelled ? { type: 'error', code: 'exit', message: 'Cancelled.' } : { type: 'error', code: 'exit', message: stderr.trim() || `claude exited with code ${code}` });
    });
    child.stdin?.on('error', () => undefined); // EPIPE if the process dies early; "close" reports it
    child.stdin?.end(opts.prompt, 'utf8');
  })();

  return () => {
    cancelled = true;
    child?.kill();
    if (!child) finish({ type: 'error', code: 'exit', message: 'Cancelled.' });
  };
}
