/**
 * Ctrl+K search: finds tabs by name and settings by their lightbulb tip text, jumps there and lights the bulb.
 * A keyboard-driven palette opened many times a day, so it appears instantly (no animation).
 */
import { t, tree } from '../i18n';
import { SCREENS, findScreen, screenVisible } from '../screens/registry';
import { escapeHtml } from './dom';
import { icon } from './icons';

/** tips.<screen>.<key> -> route of the tab that shows it. */
const TIP_ROUTE: Record<string, string> = {
  warsztat: 'warsztat',
  settings: 'ustawienia',
  drawer: 'warsztat',
  setup: 'setup',
  ports: 'ports',
  config: 'config',
  power: 'power',
  sensors: 'sensors',
  gps: 'gps',
  failsafe: 'failsafe',
  receiver: 'bf-receiver',
  modes: 'bf-modes',
  osd: 'osd',
  elrs: 'elrs',
  motors: 'esc',
  escInfo: 'esc',
  tuning: 'bf-tuning',
  blackbox: 'blackbox',
  autotune: 'autotune',
  cli: 'cli',
};

interface Hit {
  kind: 'tab' | 'tip';
  route: string;
  title: string;
  sub: string;
  tipKey?: string;
  score: number;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');

function collectTips(): Array<{ key: string; screen: string; text: string }> {
  const out: Array<{ key: string; screen: string; text: string }> = [];
  const walk = (node: unknown, path: string[]) => {
    if (typeof node === 'string') out.push({ key: `tips.${path.join('.')}`, screen: path[0] ?? '', text: node });
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
  };
  walk(tree('tips'), []);
  return out;
}

function search(q: string, mode: 'basic' | 'expert'): Hit[] {
  const nq = norm(q.trim());
  const visible = SCREENS.filter((s) => s.nav !== false || s.id === 'ustawienia').filter((s) => screenVisible(s, mode));
  const routes = new Set(visible.map((s) => s.id));
  const hits: Hit[] = [];
  for (const s of visible) {
    const title = t(s.titleKey);
    const nt = norm(title);
    if (!nq || nt.includes(nq)) hits.push({ kind: 'tab', route: s.id, title, sub: t('nav.tab'), score: nq && nt.startsWith(nq) ? 0 : 1 });
  }
  if (nq.length >= 2) {
    for (const tip of collectTips()) {
      const route = TIP_ROUTE[tip.screen];
      if (!route || !routes.has(route) || tip.key.endsWith('.intro')) continue;
      const nt = norm(tip.text);
      const at = nt.indexOf(nq);
      if (at < 0) continue;
      const screen = findScreen(route);
      const first = tip.text.split(/(?<=[.!?])\s/)[0] ?? tip.text;
      hits.push({ kind: 'tip', route, title: first.length > 90 ? first.slice(0, 88) + '…' : first, sub: screen ? t(screen.titleKey) : route, tipKey: tip.key, score: 2 + at / 1000 });
    }
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, 12);
}

/** Opens the palette. `go` navigates; the caller lights the tip after the screen mounted. */
export function openSearch(mode: 'basic' | 'expert', go: (route: string, tipKey?: string) => void): void {
  if (document.querySelector('.search-ov')) return;
  const ov = document.createElement('div');
  ov.className = 'search-ov';
  ov.innerHTML = `<div class="search-box" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('nav.search'))}">
    <label class="search-in">${icon('search', 16)}<input type="text" placeholder="${escapeHtml(t('nav.searchPh'))}" autocomplete="off" aria-label="${escapeHtml(t('nav.search'))}" /><kbd>Esc</kbd></label>
    <ul class="search-res" role="listbox"></ul></div>`;
  const input = ov.querySelector('input') as HTMLInputElement;
  const list = ov.querySelector('.search-res') as HTMLElement;
  let hits: Hit[] = [];
  let sel = 0;
  const render = () => {
    hits = search(input.value, mode);
    sel = Math.min(sel, Math.max(0, hits.length - 1));
    list.innerHTML = hits.length
      ? hits
          .map(
            (h, i) =>
              `<li role="option" aria-selected="${i === sel}" data-i="${i}">${icon(h.kind === 'tab' ? 'arrowRight' : 'bulb', 14)}<span><b>${escapeHtml(h.title)}</b><small>${escapeHtml(h.sub)}</small></span></li>`,
          )
          .join('')
      : `<li class="empty">${escapeHtml(t('nav.searchEmpty'))}</li>`;
  };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    ov.remove();
  };
  const pick = (i: number) => {
    const h = hits[i];
    if (!h) return;
    close();
    go(h.route, h.tipKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(sel);
    }
  };
  input.addEventListener('input', () => {
    sel = 0;
    render();
  });
  list.addEventListener('click', (e) => {
    const i = (e.target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i;
    if (i !== undefined) pick(Number(i));
  });
  ov.addEventListener('mousedown', (e) => {
    if (e.target === ov) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(ov);
  render();
  input.focus();
}


