/**
 * Lightbulb tips: a small bulb next to a setting that lights up on hover/focus and shows a bubble with a plain-language
 * explanation. Texts live in i18n under `tips.<screen>.<key>` (en is the source, pl must match). See docs/TIPS.md.
 *
 *   `${t('bfSetup.arming')} ${tip('tips.setup.arming')}`     // inline next to a label
 *   intro('tips.setup.intro')                                // "what is this tab for" block, Basic mode only
 *
 * Visibility: `data-level="expert"` on any element hides it in Basic mode, `data-only="basic"` hides it in Expert mode.
 * One delegated controller (initTips) serves every bulb on the page, so screens only emit markup.
 */
import { t, type Key } from '../i18n';
import { escapeHtml } from './dom';

export type TipKey = Extract<Key, `tips.${string}`>;

const BULB = `<svg class="bulb" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle class="bulb-halo" cx="8" cy="6.4" r="6.4"/><path class="bulb-glass" d="M5.4 10.6c-.1-1.2-.8-1.9-1.4-2.7A4.6 4.6 0 1 1 12 7.9c-.6.8-1.3 1.5-1.4 2.7Z"/><path class="bulb-fil" d="M6.6 10.4 6.4 7.6l1.1.9.5-1 .5 1 1.1-.9-.2 2.8"/><path class="bulb-base" d="M5.9 12.3h4.2M6.4 14h3.2"/></svg>`;

/** Inline bulb button. `label` (optional) is the bold first line of the bubble; by default the bubble shows the text only. */
export function tip(key: TipKey, label?: string): string {
  const aria = `${t('tipsUi.aria')}${label ? `: ${label}` : ''}`;
  return `<button type="button" class="tip" data-tip="${key}"${label ? ` data-tip-label="${escapeHtml(label)}"` : ''} aria-label="${escapeHtml(aria)}">${BULB}</button>`;
}

/** Bulb for a plain (already translated) text, e.g. the tip of a form field built at runtime. */
export function tipText(text: string, label?: string): string {
  const aria = `${t('tipsUi.aria')}${label ? `: ${label}` : ''}`;
  return `<button type="button" class="tip" data-tip-text="${escapeHtml(text)}"${label ? ` data-tip-label="${escapeHtml(label)}"` : ''} aria-label="${escapeHtml(aria)}">${BULB}</button>`;
}

/** "What is this tab for" block at the top of a screen; shown in Basic mode only. */
export function intro(key: TipKey): string {
  return `<div class="intro" data-only="basic">${BULB.replace('class="bulb"', 'class="bulb lit"')}<p>${format(t(key))}</p></div>`;
}

/** Tip text: escaped, `**bold**` and line breaks allowed. */
function format(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

let bubble: HTMLElement | null = null;
let active: HTMLElement | null = null;
let pinned = false;
let openTimer: ReturnType<typeof setTimeout> | null = null;
let lastClosed = 0;

function ensureBubble(): HTMLElement {
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'tip-bubble';
    bubble.setAttribute('role', 'tooltip');
    bubble.id = 'tip-bubble';
    document.body.appendChild(bubble);
  }
  return bubble;
}

function place(trigger: HTMLElement, b: HTMLElement): void {
  const r = trigger.getBoundingClientRect();
  const bw = b.offsetWidth;
  const bh = b.offsetHeight;
  const gap = 8;
  const below = r.bottom + gap + bh < window.innerHeight - 8 || r.top - gap - bh < 8;
  const top = below ? r.bottom + gap : r.top - gap - bh;
  const cx = r.left + r.width / 2;
  const left = Math.min(Math.max(8, cx - bw / 2), window.innerWidth - bw - 8);
  b.style.left = `${Math.round(left)}px`;
  b.style.top = `${Math.round(top)}px`;
  // Grow out of the bulb, not out of the bubble's centre.
  b.style.transformOrigin = `${Math.round(cx - left)}px ${below ? '0' : '100%'}`;
  b.dataset.side = below ? 'below' : 'above';
}

function open(trigger: HTMLElement): void {
  const key = trigger.dataset.tip;
  const raw = trigger.dataset.tipText;
  if (!key && raw === undefined) return;
  const b = ensureBubble();
  const label = trigger.dataset.tipLabel;
  b.innerHTML = `${label ? `<b>${escapeHtml(label)}</b>` : ''}<span>${format(key ? t(key as Key) : (raw ?? ''))}</span>`;
  active?.classList.remove('lit');
  active?.removeAttribute('aria-describedby');
  active = trigger;
  trigger.classList.add('lit');
  trigger.setAttribute('aria-describedby', 'tip-bubble');
  b.classList.remove('on');
  place(trigger, b); // reads layout, so the closed state is committed and the transition below runs
  b.classList.add('on');
}

function close(): void {
  if (openTimer) clearTimeout(openTimer);
  openTimer = null;
  if (!active) return;
  active.classList.remove('lit');
  active.removeAttribute('aria-describedby');
  active = null;
  pinned = false;
  bubble?.classList.remove('on');
  lastClosed = Date.now();
}

function schedule(trigger: HTMLElement): void {
  if (openTimer) clearTimeout(openTimer);
  // The first tip waits a moment (no flicker while the mouse crosses the page); the next ones open at once.
  const warm = active !== null || Date.now() - lastClosed < 400;
  if (warm) open(trigger);
  else openTimer = setTimeout(() => open(trigger), 120);
}

/** Installs the single delegated tip controller. Call once at startup. */
export function initTips(): void {
  const isTip = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>('.tip') ?? null;
  document.addEventListener('pointerover', (e) => {
    if ((e as PointerEvent).pointerType !== 'mouse' || pinned) return;
    const tr = isTip(e);
    if (tr && tr !== active) schedule(tr);
  });
  document.addEventListener('pointerout', (e) => {
    if ((e as PointerEvent).pointerType !== 'mouse' || pinned) return;
    const tr = isTip(e);
    const to = (e as PointerEvent).relatedTarget as Element | null;
    if (tr && !to?.closest?.('.tip')) close();
  });
  document.addEventListener('focusin', (e) => {
    const tr = isTip(e);
    if (tr) open(tr);
    else if (!pinned) close();
  });
  document.addEventListener('click', (e) => {
    const tr = isTip(e);
    if (tr) {
      e.preventDefault();
      if (active === tr && pinned) close();
      else {
        open(tr);
        pinned = true;
      }
    } else if (pinned) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  window.addEventListener('scroll', close, true);
  window.addEventListener('hashchange', close);
}
