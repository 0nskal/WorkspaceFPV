/**
 * "Point at a part of the app" for the AI assistant.
 *
 * startSnip() lets the user drag a box over any part of the window. captureSnip() turns that box into context for the
 * model: every visible text, label, input value and lightbulb tip inside it gets a short id ([s1-4]); in the desktop app
 * a PNG of the box is attached too (for providers that read images). The model points back with `[[s1-4]]`, the drawer
 * renders that as a "Show" button and pointTo() scrolls to the element and rings it.
 */
import { t, type Key } from '../i18n';
import { escapeHtml } from './dom';

export interface SnipImage {
  mime: 'image/png';
  /** base64 without the data: prefix */
  data: string;
}

interface Item {
  ref: string;
  kind: string;
  label: string;
  value?: string;
}

export interface Snip {
  id: number;
  route: string;
  screen: string;
  items: Item[];
  image?: SnipImage;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ref -> where the element lives, so a pointer still works after the screen re-rendered or the user switched tabs. */
const refs = new Map<string, { el: WeakRef<Element>; route: string; tag: string; label: string }>();
let counter = 0;

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Overlay where the user drags a box. Resolves with the box in CSS pixels, or null when cancelled (Esc / right click). */
export function startSnip(): Promise<Box | null> {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'snip-ov';
    ov.innerHTML = `<div class="snip-hint">${escapeHtml(t('snip.hint'))}</div><div class="snip-box" hidden></div>`;
    const box = ov.querySelector<HTMLElement>('.snip-box') as HTMLElement;
    let start: { x: number; y: number } | null = null;
    let cur: Box | null = null;

    const finish = (b: Box | null) => {
      document.removeEventListener('keydown', onKey, true);
      ov.remove();
      resolve(b);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finish(null);
      }
    };
    ov.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      finish(null);
    });
    ov.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      ov.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
      cur = { x: start.x, y: start.y, w: 0, h: 0 };
      box.hidden = false;
      ov.classList.add('dragging');
      draw();
    });
    ov.addEventListener('pointermove', (e) => {
      if (!start) return;
      cur = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
      draw();
    });
    ov.addEventListener('pointerup', () => {
      if (!start || !cur) return;
      const b = cur;
      start = null;
      if (b.w < 16 || b.h < 12) {
        box.hidden = true;
        ov.classList.remove('dragging');
        const hint = ov.querySelector('.snip-hint') as HTMLElement;
        hint.textContent = t('snip.tooSmall');
        return;
      }
      finish(b);
    });
    // Direct manipulation: the box follows the pointer 1:1, no easing.
    function draw() {
      if (!cur) return;
      box.style.transform = `translate(${cur.x}px, ${cur.y}px)`;
      box.style.width = `${cur.w}px`;
      box.style.height = `${cur.h}px`;
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
  });
}

const clean = (s: string | null | undefined, max = 90) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Own text of an element (its direct text nodes), not the text of its children. */
function ownText(el: Element): string {
  let s = '';
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) s += n.textContent ?? '';
  });
  return clean(s);
}

function controlLabel(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const byLabel = el.labels?.[0] ? clean(el.labels[0].textContent) : '';
  if (byLabel) return byLabel;
  const aria = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '';
  if (aria) return clean(aria);
  // nearest row/field text without the control's own value
  const row = el.closest('tr, .field, .row, label, li, .bf-f, .fld, div');
  const txt = row ? clean(Array.from(row.childNodes).filter((n) => n !== el && !(n instanceof HTMLInputElement || n instanceof HTMLSelectElement)).map((n) => n.textContent).join(' '), 60) : '';
  return txt || clean((el as HTMLInputElement).placeholder) || el.name || el.tagName.toLowerCase();
}

function controlValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  if (el instanceof HTMLSelectElement) return clean(el.selectedOptions[0]?.textContent ?? el.value);
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return el.checked ? 'on' : 'off';
  return clean(el.value, 60);
}

function visible(el: Element, r: DOMRect): boolean {
  if (r.width === 0 || r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}

/** Collects what is inside the box, gives every item an id and (desktop app) grabs a PNG of the box. */
export async function captureSnip(b: Box, route: string, screen: string): Promise<Snip> {
  const id = ++counter;
  const items: Item[] = [];
  const root = document.getElementById('app') ?? document.body;
  const inside = (r: DOMRect) => r.right > b.x && r.left < b.x + b.w && r.bottom > b.y && r.top < b.y + b.h;
  const seen = new Set<string>();
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (items.length >= 90) break;
    if (el.closest('.snip-ov, .tip-bubble, svg')) continue;
    const r = el.getBoundingClientRect();
    if (!inside(r) || !visible(el, r)) continue;
    let kind = '';
    let label = '';
    let value: string | undefined;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      if (el instanceof HTMLInputElement && el.type === 'hidden') continue;
      kind = el instanceof HTMLSelectElement ? 'select' : el instanceof HTMLInputElement && el.type === 'checkbox' ? 'switch' : 'input';
      label = controlLabel(el);
      value = controlValue(el);
    } else if (el instanceof HTMLElement && el.classList.contains('tip') && el.dataset.tip) {
      kind = 'tip';
      label = clean(t(el.dataset.tip as Key), 400);
    } else {
      label = ownText(el);
      if (!label) continue;
      kind = /^H[1-6]$/.test(el.tagName) ? 'heading' : el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? 'button' : el.tagName === 'TH' || el.tagName === 'DT' || el.tagName === 'LABEL' ? 'label' : 'text';
    }
    const dedupe = `${kind}|${label}|${value ?? ''}|${Math.round(r.left)}|${Math.round(r.top)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const ref = `s${id}-${items.length}`;
    (el as HTMLElement).dataset.aiRef = ref;
    refs.set(ref, { el: new WeakRef(el), route, tag: el.tagName, label });
    items.push({ ref, kind, label, value });
  }
  const snip: Snip = { id, route, screen, items };
  const cap = window.workspacefpv?.capture;
  if (cap) {
    try {
      // wait for the overlay to leave the screen before grabbing pixels
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const data = await cap({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h) });
      if (data) snip.image = { mime: 'image/png', data };
    } catch {
      /* no picture: the text list still goes */
    }
  }
  return snip;
}

/** The fragment as text for the model (ids first, so it can point back). */
export function snipText(s: Snip, mode: string): string {
  const lines = s.items.map((i) => `[${i.ref}] ${i.kind} "${i.label}"${i.value !== undefined ? ` = ${i.value}` : ''}`);
  return `<screen_fragment tab="${s.screen}" route="${s.route}" ui_mode="${mode}"${s.image ? ' image="attached"' : ''}>\n${lines.join('\n') || '(no text in the selected area)'}\n</screen_fragment>`;
}

/** Short label for a pointer button. */
export function refLabel(ref: string): string | null {
  const r = refs.get(ref);
  return r ? clean(r.label, 32) : null;
}

/** Finds the element again: same node if it still exists, otherwise the same tag and text on the current screen. */
function resolve(ref: string): Element | null {
  const r = refs.get(ref);
  if (!r) return document.querySelector(`[data-ai-ref="${ref}"]`);
  const el = r.el.deref();
  if (el?.isConnected) return el;
  const again = document.querySelector(`[data-ai-ref="${ref}"]`);
  if (again) return again;
  for (const c of Array.from(document.querySelectorAll(r.tag))) if (ownText(c) === r.label) return c;
  return null;
}

/** Scrolls to the element and rings it. Switches tabs first when it lives on another one. Returns false when it is gone. */
export async function pointTo(ref: string, navigate: (route: string) => void, currentRoute: () => string): Promise<boolean> {
  const r = refs.get(ref);
  if (r && r.route !== currentRoute() && !r.el.deref()?.isConnected) {
    navigate(r.route);
    await new Promise((res) => setTimeout(res, 350)); // the screen mounts and renders from the store
  }
  const el = resolve(ref);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  await new Promise((res) => setTimeout(res, reduceMotion() ? 0 : 260));
  ring(el);
  return true;
}

function ring(el: Element): void {
  document.querySelectorAll('.ai-ring').forEach((n) => n.remove());
  const r = el.getBoundingClientRect();
  const pad = 5;
  const ringEl = document.createElement('div');
  ringEl.className = 'ai-ring';
  ringEl.style.transform = `translate(${r.left - pad}px, ${r.top - pad}px)`;
  ringEl.style.width = `${r.width + pad * 2}px`;
  ringEl.style.height = `${r.height + pad * 2}px`;
  document.body.appendChild(ringEl);
  ringEl.addEventListener('animationend', (e) => {
    if (e.animationName === 'ai-ring-out') ringEl.remove();
  });
  setTimeout(() => ringEl.remove(), 3400); // also when animations are switched off
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLButtonElement) el.focus({ preventScroll: true });
}
