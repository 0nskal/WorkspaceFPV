/** Ustawienia uzytkownika - tylko lokalnie (localStorage), klucz API nigdy nie opuszcza maszyny poza zapytaniami do API Anthropic. */

import type { ProviderId } from './ai/types';
import { DEFAULT_CLAUDE_CODE_MODEL, DEFAULT_GEMINI_MODEL, DEFAULT_OLLAMA_URL } from './ai/types';

export const MODELS: Array<{ id: string; labelKey: 'settings.modelOpus' | 'settings.modelSonnet' }> = [
  { id: 'claude-opus-5-5', labelKey: 'settings.modelOpus' },
  { id: 'claude-sonnet-5-5', labelKey: 'settings.modelSonnet' },
];

export interface Settings {
  /** Anthropic API key and model (the original two settings). */
  apiKey: string;
  model: string;
  /** Chosen AI provider; '' = automatic (Claude Code in the desktop app when detected and no Anthropic key, else Anthropic). */
  aiProvider: ProviderId | '';
  claudeCodeModel: string;
  geminiKey: string;
  geminiModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  /** Sprawdzaj aktualizacje przy starcie (tylko wersja desktop). */
  checkUpdates: boolean;
  /** Send MSP_SET_ARMING_DISABLED while connected (like the Betaflight Configurator); released on disconnect. */
  armingDisable: boolean;
  /** Read ESC firmware/settings via the 4-way interface once after connect, when the battery is detected. */
  autoEscInfo: boolean;
  /** Read the ELRS receiver version via CRSF passthrough once after connect (the FC reboots afterwards). */
  autoElrsInfo: boolean;
  /** Interface level: 'basic' (beginner: fewer tabs, explanations everywhere) or 'expert' (every Betaflight function). '' = not chosen yet. */
  uiMode: UiMode | '';
  /** Lightbulb tips in expert mode (basic mode always shows them). */
  expertTips: boolean;
  /**
   * Boards (BOARD_INFO name) where `serialpassthrough ... reset` does not reboot the FC when DTR drops (seen on a
   * GEPRC F722, Betaflight 2026.6): after an ELRS read they stay in passthrough until the USB cable is replugged.
   * The ELRS read never runs automatically on them and the confirmation warns about the replug.
   */
  noDtrReset: string[];
  /** Settings migrations already applied. */
  rev: number;
}

export type UiMode = 'basic' | 'expert';

const KEY = 'workspacefpv.settings.v1';
const DEFAULTS: Settings = { apiKey: '', model: MODELS[0].id, aiProvider: '', claudeCodeModel: DEFAULT_CLAUDE_CODE_MODEL, geminiKey: '', geminiModel: DEFAULT_GEMINI_MODEL, ollamaUrl: DEFAULT_OLLAMA_URL, ollamaModel: '', checkUpdates: true, armingDisable: true, autoEscInfo: true, autoElrsInfo: false, uiMode: '', expertTips: true, noDtrReset: [], rev: 1 };

export class SettingsStore {
  private s: Settings = { ...DEFAULTS };
  private cbs = new Set<() => void>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        this.s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
        delete (this.s as unknown as Record<string, unknown>).elrsVersion; // removed: the ELRS version is read from the receiver now
        if (!(this.s.rev >= 1)) {
          // rev 1: the automatic ELRS read can leave some boards stuck in passthrough; it is opt-in now
          this.s = { ...this.s, autoElrsInfo: false, rev: 1 };
          localStorage.setItem(KEY, JSON.stringify(this.s));
        }
      }
    } catch {
      /* brak localStorage - zostaja domyslne */
    }
  }

  get(): Readonly<Settings> {
    return this.s;
  }

  set(patch: Partial<Settings>): void {
    this.s = { ...this.s, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* ignore */
    }
    for (const cb of [...this.cbs]) cb();
  }

  subscribe(cb: () => void): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }
}

const BACKUP_KEY = 'workspacefpv.backup.v1';

export interface StoredBackup {
  at: number;
  craft: string;
  text: string;
}

export function loadBackup(): StoredBackup | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    return raw ? (JSON.parse(raw) as StoredBackup) : null;
  } catch {
    return null;
  }
}

export function saveBackup(b: StoredBackup): void {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(b));
  } catch {
    /* zbyt duze / brak miejsca - kopia i tak jest pobierana jako plik */
  }
}
