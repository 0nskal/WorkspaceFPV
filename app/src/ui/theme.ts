/** Light / dark / system theme on <html data-theme>. Dark is the default; light stays readable in direct sunlight. */
import type { SettingsStore } from '../settings';

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let bound: SettingsStore | null = null;

export function applyTheme(settings: SettingsStore): void {
  const pref = settings.get().theme || 'dark';
  const dark = pref === 'dark' || (pref === 'auto' && !!media?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (!bound && media) {
    bound = settings;
    media.addEventListener('change', () => bound && applyTheme(bound));
  }
}
