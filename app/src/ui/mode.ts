/**
 * Interface mode (Basic / Expert): the top-bar switch, the first-run chooser and the document attributes that CSS uses
 * to hide expert-only parts (`data-level="expert"`) and beginner explanations (`data-only="basic"`).
 */
import { t } from '../i18n';
import type { SettingsStore, UiMode } from '../settings';
import { escapeHtml } from './dom';
import basicImg from '../assets/img/mode-basic.webp';
import expertImg from '../assets/img/mode-expert.webp';

export function currentMode(settings: SettingsStore): UiMode {
  return settings.get().uiMode || 'basic';
}

/** Mirrors the mode and the tip setting on <html> (CSS reads them). */
export function applyModeAttrs(settings: SettingsStore): void {
  const s = settings.get();
  const mode = currentMode(settings);
  document.documentElement.dataset.mode = mode;
  document.documentElement.dataset.tips = mode === 'basic' || s.expertTips ? 'on' : 'off';
}

/** Segmented Basic | Expert switch for the top bar. */
export function modeSwitchHtml(mode: UiMode): string {
  const b = (m: UiMode) =>
    `<button type="button" role="radio" aria-checked="${mode === m}" data-mode="${m}" title="${escapeHtml(t(m === 'basic' ? 'mode.basicTitle' : 'mode.expertTitle'))}">${t(m === 'basic' ? 'mode.basic' : 'mode.expert')}</button>`;
  return `<div class="mode-sw" role="radiogroup" aria-label="${escapeHtml(t('mode.label'))}" data-on="${mode}"><span class="mode-thumb" aria-hidden="true"></span>${b('basic')}${b('expert')}</div>`;
}

/** First start: ask once how much the user knows. Resolves with the choice (Escape = Basic). */
export function chooseModeDialog(): Promise<UiMode> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay mode-choose';
    const card = (m: UiMode) =>
      `<button type="button" class="mode-card" data-mode="${m}"><img src="${m === 'basic' ? basicImg : expertImg}" alt="" aria-hidden="true" width="800" height="446" /><b>${t(m === 'basic' ? 'mode.basicCard' : 'mode.expertCard')}</b><span>${t(m === 'basic' ? 'mode.basicCardText' : 'mode.expertCardText')}</span><em>${t(m === 'basic' ? 'mode.basic' : 'mode.expert')}</em></button>`;
    overlay.innerHTML = `<div class="modal mode-modal" role="dialog" aria-modal="true" aria-labelledby="mode-h">
      <div class="modal-h" id="mode-h"><i></i>${t('mode.chooseTitle')}</div>
      <div class="modal-b"><div class="mode-cards">${card('basic')}${card('expert')}</div><p class="mode-lead">${t('mode.chooseLead')}</p></div></div>`;
    const done = (m: UiMode) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(m);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done('basic');
    };
    overlay.addEventListener('click', (e) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode;
      if (m === 'basic' || m === 'expert') done(m);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    overlay.querySelector<HTMLElement>('.mode-card')?.focus();
  });
}
