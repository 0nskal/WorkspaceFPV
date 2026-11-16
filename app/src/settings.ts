/** Ustawienia uzytkownika - tylko lokalnie (localStorage), klucz API nigdy nie opuszcza maszyny poza zapytaniami do API Anthropic. */

export const MODELS: Array<{ id: string; label: string }> = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (domyślny, najdokładniejszy)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (szybszy i tańszy)' },
];

export interface Settings {
  apiKey: string;
  model: string;
  /** Wersja ELRS wpisana recznie (FC jej nie zna). */
  elrsVersion: string;
  /** Sprawdzaj aktualizacje przy starcie (tylko wersja desktop). */
  checkUpdates: boolean;
}

const KEY = 'rotorlab.settings.v1';
const DEFAULTS: Settings = { apiKey: '', model: MODELS[0].id, elrsVersion: '', checkUpdates: true };

export class SettingsStore {
  private s: Settings = { ...DEFAULTS };
  private cbs = new Set<() => void>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
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

const BACKUP_KEY = 'rotorlab.backup.v1';

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
