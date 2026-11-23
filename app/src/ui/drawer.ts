import type { AppContext } from '../context';
import { providerName } from '../ai/providers';
import { partLabel, type Check } from '../fc/diagnose';
import { t } from '../i18n';
import { findScreen } from '../screens/registry';
import { copyText, escapeHtml } from './dom';
import { tip } from './tip';
import { captureSnip, pointTo, refLabel, snipText, startSnip, type Snip } from './snip';
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
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[\[(s\d+-\d+)\]\]/g, (_m, ref: string) => {
      const label = refLabel(ref);
      return `<button type="button" class="ptr" data-act="point" data-ref="${ref}" title="${escapeHtml(t('snip.show'))}">${icon('target', 13)}<span>${escapeHtml(label ? `${t('snip.show')}: ${label}` : t('snip.show'))}</span></button>`;
    });
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
    ? `<div class="btns"><button class="btn p" data-act="apply" data-cmds="${data}">${icon('check', 15)}${t('drawer.apply')}</button><button class="btn s" data-act="copy" data-cmds="${data}">${icon('copy', 15)}${t('drawer.copy')}</button>${tip('tips.drawer.apply', t('drawer.apply'))}</div>`
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
    <header class="dw-h"><h2>${t('simple.ai.title')}</h2><button type="button" class="dw-x" data-act="drawer" aria-label="${t('simple.ai.close')}">${icon('x', 18)}</button></header>
    <div class="scroll">
      <div class="health" hidden data-level="expert"></div>
      <div class="chat"></div>
      <div class="chk" data-level="expert"></div>
    </div>
    <div class="bottom">
      <div class="qa" data-level="expert">
        <button data-nav="elrs">${icon('download')}${t('drawer.updateElrs')}</button>
        <button data-nav="esc">${icon('chip')}${t('drawer.escProtocol')}</button>
        <button data-nav="autotune">${icon('sliders')}${t('drawer.autotune')}</button>
      </div>
      <div class="attach" hidden></div>
      <form class="in">
        <button type="button" class="clip" title="${t('drawer.attachTitle')}" aria-label="${t('drawer.attachAria')}">${icon('paperclip', 18)}</button>
        <button type="button" class="snipb" title="${t('snip.button')}" aria-label="${t('snip.button')}">${icon('scissors', 18)}</button>
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
  let snip: Snip | null = null;
  let showDetails = false;
  let okOpen = false;
  const healthEl = $('.health');

  function renderAttach() {
    attachEl.hidden = !attachment && !snip;
    const file = attachment ? `<div class="att">${icon('paperclip', 13)}<span>${escapeHtml(attachment.name)}</span><button type="button" data-act="detach" aria-label="${t('drawer.detachAria')}">${icon('x', 13)}</button></div>` : '';
    const frag = snip
      ? `<div class="att snip-att">${snip.image ? `<img src="data:image/png;base64,${snip.image.data}" alt="" />` : icon('scissors', 13)}<span>${escapeHtml(t('snip.attached', { screen: snip.screen, n: snip.items.length }))}${
          !snip.image || !ctx.ai.supportsImages() ? `<small>${escapeHtml(t('snip.noImage'))}</small>` : ''
        }</span><button type="button" data-act="unsnip" aria-label="${t('snip.detach')}">${icon('x', 13)}</button></div>`
      : '';
    attachEl.innerHTML = file + frag;
  }

  /** Basic mode, empty chat: one line and three questions a new pilot actually asks. No rule card: the Drone screen has it. */
  function renderStart(): string {
    const hint = ctx.ai.ready() ? '' : `<p class="dw-hint">${t('drawer.keyHint')}</p>`;
    const qs = (['q1', 'q2', 'q3'] as const).map((k) => `<button type="button" class="dw-q" data-q="${escapeHtml(t(`simple.ai.${k}`))}">${escapeHtml(t(`simple.ai.${k}`))}</button>`).join('');
    return `<div class="dw-start"><p>${t('simple.ai.lead')}</p><div class="dw-qs">${qs}</div>${hint}</div>`;
  }

  const expert = () => ctx.settings.get().uiMode === 'expert';

  function renderRulesCard(): string {
    const s = ctx.state.get();
    if (!expert()) return ctx.ai.history.length ? '' : renderStart();
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
    return `<div class="ai"><div class="ai-b">${body}${hint}</div></div>`;
  }

  function renderChat() {
    const parts: string[] = [renderRulesCard()];
    const hist = ctx.ai.history;
    hist.forEach((m, i) => {
      if (m.role === 'user')
        parts.push(
          `<div class="user">${m.snip ? `<div class="u-snip">${m.image ? `<img src="data:image/png;base64,${m.image.data}" alt="" />` : icon('scissors', 13)}<span>${escapeHtml(m.snip)}</span></div>` : ''}${escapeHtml(m.display ?? m.text)}</div>`,
        );
      else {
        const streaming = ctx.ai.busy && i === hist.length - 1;
        const inner = m.text ? renderMessageBody(m.text, streaming) : '';
        const think = streaming && ctx.ai.thinking ? `<div class="thinking"><span></span><span></span><span></span>${t('drawer.thinking')}</div>` : '';
        const via = m.provider && m.text && !streaming ? `<div class="via">${escapeHtml(t('aiProviders.via', { provider: providerName(m.provider) }))}</div>` : '';
        parts.push(`<div class="ai${m.note ? ' note' : ''}"><div class="ai-b">${inner}${think}${via}</div></div>`);
      }
    });
    const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
    chat.innerHTML = parts.join('');
    if (nearBottom || ctx.ai.busy) scroll.scrollTop = scroll.scrollHeight;
  }

  /** 0-100: passing rules count 1, warnings 0.5, failures 0 (info rows are left out). */
  function healthScore(checks: Check[]): number | null {
    const rated = checks.filter((c) => c.severity !== 'info');
    if (!rated.length) return null;
    const pts = rated.reduce((a, c) => a + (c.severity === 'ok' ? 1 : c.severity === 'warn' ? 0.5 : 0), 0);
    return Math.round((pts / rated.length) * 100);
  }

  /** Half-ring gauge at the top of the drawer. The arc length moves with a short transition when the score changes. */
  function renderHealth(checks: Check[] | null): void {
    const score = checks ? healthScore(checks) : null;
    healthEl.hidden = score === null;
    if (score === null) return;
    const len = 138.23; // pi * 44
    const tone = score >= 85 ? 'good' : score >= 60 ? 'mid' : 'bad';
    healthEl.className = `health ${tone}`;
    healthEl.title = t('drawer.healthHint');
    healthEl.innerHTML = `<svg viewBox="0 0 100 56" width="132" height="74" aria-hidden="true"><path class="hg-track" d="M6 50a44 44 0 0 1 88 0"/><path class="hg-arc" d="M6 50a44 44 0 0 1 88 0" stroke-dasharray="${len}" stroke-dashoffset="${(len * (1 - score / 100)).toFixed(1)}"/></svg><div class="hg-v"><b>${score}</b><span>/100</span></div><div class="hg-l">${t('drawer.health')}</div>`;
  }

  function renderChecks() {
    const s = ctx.state.get();
    if (s.conn !== 'connected' && s.conn !== 'reconnecting') {
      chk.innerHTML = '';
      renderHealth(null);
      return;
    }
    const d = ctx.diagnosis();
    renderHealth(d.checks);
    const row = (c: Check) => `<div class="row sev-${c.severity}">${checkIcon(c)}<div class="row-t"><span>${escapeHtml(c.label)}</span>${showDetails && c.detail ? `<small>${escapeHtml(c.detail)}</small>` : ''}</div></div>`;
    const bad = d.checks.filter((c) => c.severity === 'fail' || c.severity === 'warn');
    const good = d.checks.filter((c) => c.severity === 'ok' || c.severity === 'info');
    const rows = `${bad.length ? `<div class="ch fix">${t('drawer.toFix')}</div>${bad.map(row).join('')}` : ''}<button type="button" class="ch okh" data-act="oktoggle" aria-expanded="${okOpen}">${icon('check', 13)}${t('drawer.okList', { n: good.length })}${icon(okOpen ? 'minus' : 'arrowRight', 13)}</button>${okOpen ? good.map(row).join('') : ''}`;
    chk.innerHTML = `${rows}<button class="lnk" data-act="details">${showDetails ? t('drawer.hideLog') : t('drawer.showLog')} ${icon('arrowRight', 13)}</button>${
      s.diff ? '' : `<button class="lnk" data-act="fetchdiff">${t('drawer.fetchDiff')} ${icon('download', 13)}</button>`
    }`;
  }

  function renderHeader() {
    /* the title stays "Assistant": the drone's state is on the Drone screen */
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
    const q = tg.closest<HTMLElement>('[data-q]')?.dataset.q;
    if (q) {
      void ctx.ai.ask(q);
      return;
    }
    const btn = tg.closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'oktoggle') {
      okOpen = !okOpen;
      renderChecks();
    } else if (act === 'details') {
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
    } else if (act === 'unsnip') {
      snip = null;
      renderAttach();
    } else if (act === 'point') {
      void pointTo(btn.dataset.ref ?? '', (r) => ctx.navigate(r), () => ctx.route()).then((ok) => {
        if (!ok) ctx.toast(t('snip.gone'), 'info');
      });
    }
  });

  $('.clip').addEventListener('click', () => fileInput.click());
  $('.snipb').addEventListener('click', () => {
    void startSnip().then(async (box) => {
      if (!box) return;
      const route = ctx.route();
      const def = findScreen(route);
      snip = await captureSnip(box, route, def ? t(def.titleKey) : route);
      renderAttach();
      input.focus();
    });
  });
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
    if (!q && !attachment && !snip) return;
    const shown = q || (snip ? t('snip.question') : t('drawer.analyseFile'));
    let text = shown;
    if (attachment) text += `\n\n${t('drawer.attachedFile', { name: attachment.name })}\n\`\`\`\n${attachment.text}\n\`\`\``;
    const frag = snip;
    if (frag) text += `\n\n${snipText(frag, ctx.settings.get().uiMode || 'basic')}`;
    input.value = '';
    attachment = null;
    snip = null;
    renderAttach();
    void ctx.ai.ask(text, frag ? { display: shown, image: frag.image, snip: t('snip.attached', { screen: frag.screen, n: frag.items.length }) } : { display: shown });
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
