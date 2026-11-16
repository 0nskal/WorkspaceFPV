/** Tiny typed i18n: dictionaries in en.ts / pl.ts, t(key, params), tn() for plurals, number/date formatting. */
import { en, type Dict } from './en';
import { pl } from './pl';

export type Lang = 'en' | 'pl';
export const LANGS: Lang[] = ['en', 'pl'];

type Plural = { one: string; few: string; many: string };
type Join<P extends string, K extends string> = P extends '' ? K : `${P}.${K}`;
type Paths<T, P extends string = ''> = T extends Plural ? never : T extends string ? P : { [K in keyof T & string]: Paths<T[K], Join<P, K>> }[keyof T & string];
type PluralPaths<T, P extends string = ''> = T extends Plural ? P : T extends string ? never : { [K in keyof T & string]: PluralPaths<T[K], Join<P, K>> }[keyof T & string];

export type Key = Paths<Dict>;
export type PluralKey = PluralPaths<Dict>;
export type Params = Record<string, string | number>;

const dicts: Record<Lang, Dict> = { en, pl };
const STORAGE_KEY = 'rotorlab.lang';
const LOCALE: Record<Lang, string> = { en: 'en-GB', pl: 'pl-PL' };

function detect(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'pl') return q;
  } catch {
    /* no location (worker / node) */
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'pl') return saved;
  } catch {
    /* no localStorage */
  }
  try {
    if (typeof navigator !== 'undefined' && /^pl\b/i.test(navigator.language)) return 'pl';
  } catch {
    /* ignore */
  }
  return 'en';
}

let current: Lang = detect();
const listeners = new Set<(l: Lang) => void>();

export const getLang = (): Lang => current;
export const locale = (): string => LOCALE[current];

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* ignore */
  }
  applyDocumentLang();
  for (const cb of [...listeners]) cb(l);
}

/** Subscribe to language changes; returns an unsubscribe function. */
export function onLanguageChange(cb: (l: Lang) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function applyDocumentLang(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

function walk(dict: Dict, key: string): unknown {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object') node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node;
}

function fill(s: string, params?: Params): string {
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

/** Translate a key. {name} placeholders are replaced from params. */
export function t(key: Key, params?: Params): string {
  const v = walk(dicts[current], key) ?? walk(dicts.en, key);
  return typeof v === 'string' ? fill(v, params) : key;
}

/** Plural category: English one/many; Polish one (1), few (2-4, not 12-14), many (5+). */
export function pluralCategory(n: number, lang: Lang = current): 'one' | 'few' | 'many' {
  const a = Math.abs(n);
  if (a === 1) return 'one';
  if (lang === 'pl') {
    const m10 = a % 10;
    const m100 = a % 100;
    if (Number.isInteger(a) && m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return 'few';
  }
  return 'many';
}

/** Plural-aware translate: picks one/few/many by n and injects {n} (plus params). */
export function tn(key: PluralKey, n: number, params?: Params): string {
  const entry = (walk(dicts[current], key) ?? walk(dicts.en, key)) as Plural | undefined;
  if (!entry) return key;
  return fill(entry[pluralCategory(n)], { n, ...params });
}

/** Locale-aware number, e.g. fmtNum(12.4, 1) -> "12.4" (en) / "12,4" (pl). */
export function fmtNum(n: number, digits = 0): string {
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** Locale-aware numeric date: 16/11/2026 (en) / 16.11.2026 (pl). */
export function fmtDate(d = new Date()): string {
  const p = (v: number) => String(v).padStart(2, '0');
  return current === 'pl' ? `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}` : new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

applyDocumentLang();
