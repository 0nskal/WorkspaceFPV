/**
 * CLI tab: terminal for the Betaflight CLI. The link runs a CLI session per "Run" (enter CLI, send the lines,
 * leave with exit or save), and every session ends with a reboot of the FC, so the tab works as a script
 * terminal: type or paste lines, history on the arrow keys, Tab completes setting names (cached from `get`),
 * diff all / dump to a file, load or paste a diff and apply it after a confirmation.
 */
import type { AppContext, ScreenMount } from '../context';
import { t } from '../i18n';
import { errMsg } from '../bf/steps';
import { bindConnect, downloadBytes, emptyHtml } from '../bf/ui-bits';
import { copyText, escapeHtml, stamp } from '../ui/dom';
import { icon } from '../ui/icons';
import { intro, tip } from '../ui/tip';

const COMMANDS = ['adjrange', 'aux', 'beeper', 'bl', 'defaults', 'diff', 'dump', 'dshotprog', 'exit', 'feature', 'flash_info', 'get', 'help', 'map', 'mixer', 'motor', 'name', 'profile', 'rateprofile', 'resource', 'save', 'serial', 'set', 'status', 'tasks', 'version'];
const RISKY = /^(defaults|bl|dfu|flash_erase|flash_write|msc|resource|dshotprog|motor)(\s|$)/i;
const CACHE_KEY = 'workspacefpv.cli.names';

let namesCache: string[] = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
})();
const history: string[] = [];
let scrollback = '';

function harvest(text: string): void {
  const set = new Set(namesCache);
  for (const line of text.split('\n')) {
    const m = /^(?:set\s+)?([a-z][a-z0-9_]{2,}) = /i.exec(line.trim());
    if (m) set.add(m[1]!.toLowerCase());
  }
  if (set.size !== namesCache.length) {
    namesCache = [...set].sort();
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(namesCache));
    } catch {
      /* storage unavailable */
    }
  }
}

function commonPrefix(a: string[]): string {
  let p = a[0] ?? '';
  for (const s of a) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  const root = document.createElement('div');
  root.className = 'bf-cli';
  el.appendChild(root);
  let disposed = false;
  let running = false;
  let saveAfter = false;
  let hist = -1;
  let hint = '';
  let draft = '';
  let built = false;
  const offConn = bindConnect(root, ctx);

  const q = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s);
  const area = () => q<HTMLTextAreaElement>('.bf-cli-in');
  const out = () => q<HTMLElement>('.bf-cli-out');

  function build(): void {
    root.innerHTML = `
      <div class="bf-cli-page">
        <div class="bf-cli-title"><h1>${t('bfCli.title')}</h1><span class="mono">${t('bfCli.sub')}</span></div>
        ${intro('tips.cli.intro')}
        <div class="bf-cli-warn" role="note">${icon('alert', 18)}<span>${t('bfCli.warn')} ${tip('tips.cli.warn')}</span></div>
        <div class="bf-cli-term">
          <pre class="bf-cli-out mono" tabindex="0" aria-label="${t('bfCli.outAria')}"></pre>
          <div class="bf-cli-hint mono"></div>
          <textarea class="bf-cli-in mono" rows="3" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="${escapeHtml(t('bfCli.placeholder'))}" aria-label="${t('bfCli.inAria')}"></textarea>
        </div>
        <div class="bf-cli-bar">
          <label class="esc-check small bf-cli-save"><input type="checkbox" data-f="save"><span>${t('bfCli.saveAfter')}</span></label>${tip('tips.cli.save')}
          <button type="button" class="btn light" data-act="run">${icon('play', 16)}${t('bfCli.run')}</button>
          <button type="button" class="btn ghost" data-act="diff">${t('bfCli.readDiff')}</button>${tip('tips.cli.backup')}
          <button type="button" class="btn ghost" data-act="dump">${t('bfCli.readDump')}</button>${tip('tips.cli.dump')}
          <button type="button" class="btn ghost" data-act="names" title="${escapeHtml(t('bfCli.namesTip'))}">${t('bfCli.loadNames')} <span class="mono" data-names></span></button>${tip('tips.cli.names')}
          <button type="button" class="btn ghost" data-act="load">${icon('download', 16)}${t('bfCli.loadFile')}</button>
          <button type="button" class="btn ghost" data-act="copy">${icon('copy', 16)}${t('bfCli.copy')}</button>
          <button type="button" class="btn ghost" data-act="savefile">${t('bfCli.saveFile')}</button>
          <button type="button" class="btn ghost" data-act="clear">${t('bfCli.clear')}</button>
          <button type="button" class="btn ghost" data-act="ask">${icon('chip', 16)}${t('bfCli.askAi')}</button>
        </div>
        <input type="file" accept=".txt,.cli,.diff,text/plain" hidden data-file>
        <p class="esc-note mono bf-cli-keys">${t('bfCli.keys')}</p>
      </div>`;
    built = true;
    paintOut();
    paintBusy();
  }

  function paintOut(): void {
    const o = out();
    if (!o) return;
    o.innerHTML = scrollback ? escapeHtml(scrollback).replace(/^(# .*)$/gm, '<span class="c">$1</span>').replace(/^(\[!\].*)$/gm, '<span class="e">$1</span>') : `<span class="d">${escapeHtml(t('bfCli.empty'))}</span>`;
    o.scrollTop = o.scrollHeight;
    const n = q('[data-names]');
    if (n) n.textContent = namesCache.length ? `(${namesCache.length})` : '';
  }

  function paintBusy(): void {
    root.querySelectorAll<HTMLButtonElement>('[data-act="run"],[data-act="diff"],[data-act="dump"],[data-act="names"]').forEach((b) => (b.disabled = running));
    const a = area();
    if (a) a.disabled = running;
    const h = q('.bf-cli-hint');
    if (h) h.textContent = running ? t('bfCli.running') : hint;
  }

  function append(text: string): void {
    scrollback += text;
    paintOut();
  }

  /** Runs lines as one CLI session. `save` leaves with `save` (writes + reboot), otherwise with `exit` (discards, reboots). */
  async function session(lines: string[], opts: { save: boolean; backup?: boolean; label?: string }): Promise<void> {
    if (running) return;
    const link = ctx.link();
    if (!link) return;
    running = true;
    paintBusy();
    append(`\n# ${opts.label ?? t('bfCli.sessionStart')}\n`);
    try {
      const cmds = opts.backup ? ['diff all', ...lines] : lines;
      const res = await link.cli(cmds, {
        save: opts.save,
        onEntry: (e, i) => {
          if (opts.backup && i === 0) {
            downloadBytes(`${t('backup.filePrefix')}-${stamp()}.txt`, e.output, 'text/plain');
            append(`# diff all (${t('bfCli.backupSaved')})\n`);
            harvest(e.output);
            return;
          }
          append(`# ${e.command}\n${e.output}${e.output ? '\n' : ''}${e.error ? `[!] ${t('bfCli.cmdError')}\n` : ''}`);
          harvest(e.output);
        },
      });
      append(res.saved ? `# ${t('bfCli.endSaved')}\n` : `# ${t('bfCli.endExit')}\n`);
      if (ctx.state.get().mode === 'demo') void ctx.refresh();
    } catch (e) {
      append(`[!] ${errMsg(e)}\n`);
    } finally {
      running = false;
      if (!disposed) paintBusy();
    }
  }

  async function runInput(): Promise<void> {
    const a = area();
    if (!a || running) return;
    const raw = a.value;
    let lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (!lines.length) return;
    let save = saveAfter;
    // trailing save / exit lines only choose how the session ends
    while (lines.length && /^(save|exit)$/i.test(lines[lines.length - 1]!)) {
      if (/^save$/i.test(lines[lines.length - 1]!)) save = true;
      lines = lines.slice(0, -1);
    }
    lines = lines.filter((l) => !/^(save|exit)$/i.test(l));
    if (!lines.length && !save) return;
    const risky = lines.filter((l) => RISKY.test(l));
    const changing = lines.some((l) => /^(set|feature|serial|aux|adjrange|map|mixer|resource|profile|rateprofile|name|beeper|defaults|dshotprog)\b/i.test(l));
    const ok = await ctx.confirm({
      title: t('bfCli.confirmTitle'),
      danger: risky.length > 0,
      confirmText: save ? t('bfCli.runSave') : t('bfCli.run'),
      body: `<p>${t('bfCli.confirmIntro', { n: lines.length })}</p><pre class="code">${escapeHtml(lines.slice(0, 40).join('\n'))}${lines.length > 40 ? '\n…' : ''}</pre><p class="save-note">${save ? t('bfCli.confirmSave') : t('bfCli.confirmExit')}</p>${risky.length ? `<p class="warn-note">${t('bfCli.confirmRisky', { cmds: escapeHtml(risky.join(', ')) })}</p>` : ''}${changing && save ? `<p class="warn-note">${t('apply.propsWarn')}</p>` : ''}`,
    });
    if (!ok) return;
    history.unshift(raw);
    hist = -1;
    a.value = '';
    await session(lines, { save, backup: changing && save });
  }

  function complete(a: HTMLTextAreaElement): void {
    const pos = a.selectionStart;
    const before = a.value.slice(0, pos);
    const lineStart = before.lastIndexOf('\n') + 1;
    const line = before.slice(lineStart);
    const m = /^(\s*)(\S*)$/.exec(line);
    const m2 = /^(\s*)(get|set|help)\s+(\S*)$/i.exec(line);
    let prefix = '';
    let pool: string[] = [];
    if (m2) {
      prefix = m2[3]!.toLowerCase();
      pool = namesCache;
    } else if (m) {
      prefix = m[2]!.toLowerCase();
      pool = COMMANDS;
    } else return;
    if (!pool.length) {
      hint = t('bfCli.noNames');
      return paintBusy();
    }
    let c = pool.filter((n) => n.startsWith(prefix));
    if (!c.length) c = pool.filter((n) => n.includes(prefix));
    if (!c.length) {
      hint = '';
      return paintBusy();
    }
    const p = c.length === 1 ? c[0]! + (m2 ? ' ' : ' ') : commonPrefix(c);
    const tokenStart = pos - prefix.length;
    if (p.length > prefix.length || c.length === 1) {
      a.value = a.value.slice(0, tokenStart) + p + a.value.slice(pos);
      a.selectionStart = a.selectionEnd = tokenStart + p.length;
    }
    hint = c.length > 1 ? c.slice(0, 12).join('  ') + (c.length > 12 ? `  … +${c.length - 12}` : '') : '';
    paintBusy();
  }

  function onKey(e: KeyboardEvent): void {
    const a = e.target as HTMLTextAreaElement;
    if (!a.classList.contains('bf-cli-in')) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void runInput();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete(a);
    } else if (e.key === 'ArrowUp' && a.selectionStart === 0 && history.length) {
      e.preventDefault();
      if (hist === -1) draft = a.value;
      hist = Math.min(history.length - 1, hist + 1);
      a.value = history[hist]!;
    } else if (e.key === 'ArrowDown' && hist >= 0 && a.selectionStart === a.value.length) {
      e.preventDefault();
      hist -= 1;
      a.value = hist === -1 ? draft : history[hist]!;
    }
  }

  async function loadFile(f: File | undefined): Promise<void> {
    if (!f) return;
    const text = await f.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const a = area();
    if (!a || !lines.length) return ctx.toast(t('bfCli.fileEmpty'), 'error');
    a.value = lines.join('\n');
    harvest(text);
    paintOut();
    ctx.toast(t('bfCli.fileLoaded', { n: lines.length, name: f.name }), 'ok');
  }

  root.addEventListener('keydown', onKey);
  root.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act || act === 'connect' || act === 'demo') return;
    if (act === 'run') void runInput();
    else if (act === 'diff') void session(['diff all'], { save: false, label: 'diff all' });
    else if (act === 'dump') void session(['dump'], { save: false, label: 'dump' });
    else if (act === 'names') void session(['get'], { save: false, label: t('bfCli.loadNames') });
    else if (act === 'load') q<HTMLInputElement>('[data-file]')?.click();
    else if (act === 'copy') void copyText(scrollback).then((ok) => ctx.toast(ok ? t('at.copied') : t('at.copyFail'), ok ? 'ok' : 'error'));
    else if (act === 'savefile') {
      if (!scrollback.trim()) return;
      downloadBytes(`${t('bfCli.filePrefix')}-${stamp()}.txt`, scrollback, 'text/plain');
    } else if (act === 'clear') {
      scrollback = '';
      paintOut();
    } else if (act === 'ask') {
      const tail = scrollback.split('\n').slice(-40).join('\n');
      ctx.askAi(t('bfCli.aiSummary', { names: namesCache.length, tail }));
    }
  });
  root.addEventListener('change', (e) => {
    const i = e.target as HTMLInputElement;
    if (i.matches('[data-file]')) void loadFile(i.files?.[0]);
    else if (i.dataset.f === 'save') saveAfter = i.checked;
  });
  root.addEventListener('paste', () => {
    /* pasted multi-line diffs stay in the box until Run is pressed (with confirmation) */
  });

  function render(): void {
    if (disposed) return;
    const connected = ctx.state.get().conn === 'connected';
    if (!connected) {
      built = false;
      root.innerHTML = emptyHtml(ctx, t('bfCli.emptyTag'), t('bfCli.emptyTitle'), t('bfCli.emptyLead'));
    } else if (!built) build();
  }
  const off = ctx.state.subscribe(() => {
    if (!running) render();
  });
  render();

  return () => {
    disposed = true;
    off();
    offConn();
    root.remove();
  };
};
