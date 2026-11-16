import type { AppContext } from '../context';
import { providerName } from '../ai/providers';
import { partLabel, type Check } from '../fc/diagnose';
import { t } from '../i18n';
import { copyText, escapeHtml } from './dom';
import { icon } from './icons';

/* ------------------------------------------------------------------ */
/* Mini-markdown: akapity, **pogrubienie**, `kod`, listy, bloki ```    */
/* ------------------------------------------------------------------ */

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang: string; code: string; closed: boolean };

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r/g, '').split('\n');
  let buf: string[] = [];
  let code: string[] | null = null;
  let lang = '';
  const flush = () => {
    if (buf.length) blocks.push({ kind: 'text', text: buf.join('\n') });
    buf = [];
  };
  for (const line of lines) {
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (code === null) {
      if (fence) {
        flush();
        code = [];
        lang = fence[1].toLowerCase();
      } else buf.push(line);
    } else if (fence && !fence[1]) {
      blocks.push({ kind: 'code', lang, code: code.join('\n'), closed: true });
      code = null;
    } else code.push(line);
  }
  if (code !== null) blocks.push({ kind: 'code', lang, code: code.join('\n'), closed: false });
  else flush();
  return blocks;
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderText(text: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const para of text.split(/\n{2,}/)) {
    for (const line of para.split('\n')) {
      const m = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/.exec(line);
      if (m) list.push(m[1]);
      else {
        flushList();
        if (line.trim()) out.push(`<p>${inline(line)}</p>`);
      }
    }
    flushList();
  }
  return out.join('');
}

/** Koloruje linie CLI: slowo kluczowe szare, wartosc po "=" czerwona. */
export function highlightCli(code: string): string {
  return code
    .split('\n')
    .map((line) => {
      const m = /^(\s*)(set|feature|serial|resource|aux|get|dshotprog|vtx|beeper|map|rxrange|led|color|mode_color|mixer|smix|servo|profile|rateprofile|diff|dump|status|save)\b(.*)$/i.exec(line);
      if (!m) return escapeHtml(line);
      const [, sp, kw, rest] = m;
      const eq = /^(.*?=\s*)(.+)$/.exec(rest);
      const restHtml = eq ? `${escapeHtml(eq[1])}<span class="v">${escapeHtml(eq[2])}</span>` : escapeHtml(rest);
      return `${sp}<span class="k">${escapeHtml(kw)}</span>${restHtml}`;
    })
    .join('\n');
}

export function cliLines(code: string): string[] {
  return code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function cliBlockHtml(code: string, closed: boolean, caveat?: string): string {
  const cmds = cliLines(code);
  const data = escapeHtml(JSON.stringify(cmds));
  const buttons = closed
    ? `<div class="btns"><button class="btn p" data-act="apply" data-cmds="${data}">${icon('check', 15)}${t('drawer.apply')}</button><button class="btn s" data-act="copy" data-cmds="${data}">${icon('copy', 15)}${t('drawer.copy')}</button></div>`
    : '';
  return `<div class="code">${highlightCli(code)}</div>${caveat ? `<div class="caveat">${escapeHtml(caveat)}</div>` : ''}${buttons}`;
}

function renderMessageBody(text: string, streaming: boolean): string {
  return parseBlocks(text)
    .map((b) => {
      if (b.kind === 'text') return renderText(b.text);
      if (b.lang === 'cli') return cliBlockHtml(b.code, b.closed && !streaming);
      return `<div class="code plain">${escapeHtml(b.code)}</div>`;
    })
    .join('');
}

/* ------------------------------------------------------------------ */

const AV = `<div class="av"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="none" stroke="#CFE6F2" stroke-width="1.5"/><rect x="6.2" y="6.2" width="3.6" height="3.6" fill="#CFE6F2"/></svg></div>`;

function checkIcon(c: Check): string {
  switch (c.severity) {
    case 'ok':
      return icon('check', 16, 'class="i ck ok"');
    case 'fail':
      return icon('x', 16, 'class="i ck fail"');
    case 'warn':
      return icon('alert', 16, 'class="i ck warn"');
    default:
      return icon('minus', 16, 'class="i ck info"');
  }
}

export interface Drawer {
  el: HTMLElement;
  destroy(): void;
}

/** Szuflada AI: karta pacjenta (reguly + rozmowa z asystentem + "Co sprawdzilem"). */
export function createDrawer(ctx: AppContext): Drawer {
  const el = document.createElement('aside');
  el.className = 'drawer';
  el.setAttribute('aria-label', t('shell.assistantAria'));
  el.innerHTML = `
    <div class="tab" aria-hidden="true"></div>
    <div class="dh"><i></i><span class="dh-t">${t('drawer.title')}</span><span class="r">${t('drawer.r')}</span></div>
    <div class="scroll">
      <div class="chat"></div>
      <div class="chk"></div>
    </div>
    <div class="bottom">
      <div class="qa">
        <button data-nav="elrs">${icon('download')}${t('drawer.updateElrs')}</button>
        <button data-nav="esc">${icon('chip')}${t('drawer.escProtocol')}</button>
        <button data-nav="autotune">${icon('sliders')}${t('drawer.autotune')}</button>
      </div>
      <div class="attach" hidden></div>
      <form class="in">
        <button type="button" class="clip" title="${t('drawer.attachTitle')}" aria-label="${t('drawer.attachAria')}">${icon('paperclip', 18)}</button>
        <input type="text" name="q" placeholder="${t('drawer.placeholder')}" autocomplete="off" aria-label="${t('drawer.inputAria')}" />
        <button type="submit" class="send" aria-label="${t('drawer.sendAria')}">${icon('arrowUp', 18)}</button>
        <input type="file" hidden accept=".txt,.csv,.log,.json,.md,.cli" />
      </form>
    </div>`;

  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s) as T;
  const chat = $('.chat');
  const chk = $('.chk');
  const scroll = $('.scroll');
  const form = $<HTMLFormElement>('form.in');
  const input = $<HTMLInputElement>('input[name="q"]');
  const fileInput = $<HTMLInputElement>('input[type="file"]');
  const attachEl = $('.attach');
  let attachment: { name: string; text: string } | null = null;
  let showDetails = false;

  function renderAttach() {
    attachEl.hidden = !attachment;
    attachEl.innerHTML = attachment ? `${icon('paperclip', 13)}<span>${escapeHtml(attachment.name)}</span><button type="button" data-act="detach" aria-label="${t('drawer.detachAria')}">${icon('x', 13)}</button>` : '';
  }

  function renderRulesCard(): string {
    const s = ctx.state.get();
    if (s.conn !== 'connected' && s.conn !== 'reconnecting') return '';
    const d = ctx.diagnosis();
    let body: string;
    if (d.suggestions.length) {
      const text = d.suggestions.map((x) => x.title).join('. ') + ':';
      const caveats = [...new Set(d.suggestions.map((x) => x.caveat).filter(Boolean) as string[])].join(' ');
      body = `<div class="tx">${escapeHtml(text)}</div>${cliBlockHtml(d.commands.join('\n'), true, caveats)}`;
    } else if (d.checks.some((c) => c.severity === 'fail' || c.severity === 'warn')) {
      body = `<div class="tx">${escapeHtml(d.summary)} ${t('drawer.rulesCardProblems')}</div>`;
    } else {
      body = `<div class="tx">${t('drawer.rulesCardOk')}</div>`;
    }
    const hint = ctx.ai.ready() ? '' : `<div class="hint">${t('drawer.keyHint')}</div>`;
    return `<div class="ai">${AV}<div class="ai-b">${body}${hint}</div></div>`;
  }

  function renderChat() {
    const parts: string[] = [renderRulesCard()];
    const hist = ctx.ai.history;
    hist.forEach((m, i) => {
      if (m.role === 'user') parts.push(`<div class="user">${escapeHtml(m.text)}</div>`);
      else {
        const streaming = ctx.ai.busy && i === hist.length - 1;
        const inner = m.text ? renderMessageBody(m.text, streaming) : '';
        const think = streaming && ctx.ai.thinking ? `<div class="thinking"><span></span><span></span><span></span>${t('drawer.thinking')}</div>` : '';
        const via = m.provider && m.text && !streaming ? `<div class="via">${escapeHtml(t('aiProviders.via', { provider: providerName(m.provider) }))}</div>` : '';
        parts.push(`<div class="ai${m.note ? ' note' : ''}">${AV}<div class="ai-b">${inner}${think}${via}</div></div>`);
      }
    });
    const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
    chat.innerHTML = parts.join('');
    if (nearBottom || ctx.ai.busy) scroll.scrollTop = scroll.scrollHeight;
  }

  function renderChecks() {
    const s = ctx.state.get();
    if (s.conn !== 'connected' && s.conn !== 'reconnecting') {
      chk.innerHTML = '';
      return;
    }
    const d = ctx.diagnosis();
    const rows = d.checks
      .map((c) => `<div class="row sev-${c.severity}">${checkIcon(c)}<div class="row-t"><span>${escapeHtml(c.label)}</span>${showDetails && c.detail ? `<small>${escapeHtml(c.detail)}</small>` : ''}</div></div>`)
      .join('');
    chk.innerHTML = `<div class="ch">${t('drawer.checked')}</div>${rows}<button class="lnk" data-act="details">${showDetails ? t('drawer.hideLog') : t('drawer.showLog')} ${icon('arrowRight', 13)}</button>${
      s.diff ? '' : `<button class="lnk" data-act="fetchdiff">${t('drawer.fetchDiff')} ${icon('download', 13)}</button>`
    }`;
  }

  function renderHeader() {
    const s = ctx.state.get();
    const d = s.conn === 'connected' ? ctx.diagnosis() : null;
    const title = $('.dh-t');
    const dot = $('.dh i');
    if (d?.focus) {
      title.textContent = partLabel(d.focus);
      dot.className = 'hot';
    } else {
      title.textContent = d ? t('drawer.allOk') : t('drawer.title');
      dot.className = '';
    }
  }

  function renderNav() {
    el.querySelectorAll<HTMLElement>('.qa button').forEach((b) => b.classList.toggle('on', b.dataset.nav === ctx.route()));
  }

  function renderAll() {
    renderHeader();
    renderChat();
    renderChecks();
    renderNav();
    input.disabled = ctx.ai.busy;
    form.classList.toggle('busy', ctx.ai.busy);
  }

  /* zdarzenia */
  el.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    const nav = tg.closest<HTMLElement>('[data-nav]')?.dataset.nav;
    if (nav) {
      ctx.navigate(nav as never);
      return;
    }
    const btn = tg.closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'details') {
      showDetails = !showDetails;
      renderChecks();
    } else if (act === 'fetchdiff') {
      void ctx.fetchDiff();
    } else if (act === 'apply') {
      const cmds = JSON.parse(btn.dataset.cmds ?? '[]') as string[];
      void ctx.applyCommands(cmds);
    } else if (act === 'copy') {
      const cmds = JSON.parse(btn.dataset.cmds ?? '[]') as string[];
      void copyText(cmds.join('\n')).then((ok) => ctx.toast(ok ? t('drawer.copied') : t('drawer.copyFail'), ok ? 'ok' : 'error'));
    } else if (act === 'detach') {
      attachment = null;
      renderAttach();
    }
  });

  $('.clip').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    if (/\.(bbl|bfl)$/i.test(f.name)) {
      ctx.toast(t('drawer.bblUnsupported'), 'info');
      return;
    }
    void f.text().then((txt) => {
      attachment = { name: f.name, text: txt.slice(0, 12000) + (txt.length > 12000 ? '\n' + t('drawer.truncated') : '') };
      renderAttach();
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q && !attachment) return;
    let text = q || t('drawer.analyseFile');
    if (attachment) text += `\n\n${t('drawer.attachedFile', { name: attachment.name })}\n\`\`\`\n${attachment.text}\n\`\`\``;
    input.value = '';
    attachment = null;
    renderAttach();
    void ctx.ai.ask(text);
  });

  const offs = [ctx.ai.subscribe(renderAll), ctx.state.subscribe(renderAll), ctx.settings.subscribe(renderAll)];
  window.addEventListener('hashchange', renderNav);
  renderAll();

  return {
    el,
    destroy() {
      offs.forEach((o) => o());
      window.removeEventListener('hashchange', renderNav);
    },
  };
}

/** Wypelnia pole pytania w szufladzie i wysyla (uzywane przez ctx.askAi). */
export function drawerAsk(ctx: AppContext, q: string): void {
  void ctx.ai.ask(q);
}
