/**
 * Interface mode (Basic / Expert): the document attributes that CSS uses
 * to hide expert-only parts (`data-level="expert"`) and beginner explanations (`data-only="basic"`).
 */
import type { SettingsStore, UiMode } from '../settings';

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
