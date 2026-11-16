/** Ustawienia uzytkownika - tylko lokalnie (localStorage), klucz API nigdy nie opuszcza maszyny poza zapytaniami do API Anthropic. */

export const MODELS: Array<{ id: string; labelKey: 'settings.modelOpus' | 'settings.modelSonnet' }> = [
  { id: 'claude-opus-5-5', labelKey: 'settings.modelOpus' },
  { id: 'claude-sonnet-5-5', labelKey: 'settings.modelSonnet' },
];

export interface Settings {
  apiKey: string;
  model: string;
  /** Sprawdzaj aktualizacje przy starcie (tylko wersja desktop). */
  checkUpdates: boolean;
  /** Send MSP_SET_ARMING_DISABLED while connected (like the Betaflight Configurator); released on disconnect. */
  armingDisable: boolean;
  /** Read ESC firmware/settings via the 4-way interface once after connect, when the battery is detected. */
  autoEscInfo: boolean;
  /** Read the ELRS receiver version via CRSF passthrough once after connect (the FC reboots afterwards). */
  autoElrsInfo: boolean;
}

const KEY = 'rotorlab.settings.v1';
const DEFAULTS: Settings = { apiKey: '', model: MODELS[0].id, checkUpdates: true, armingDisable: true, autoEscInfo: true, autoElrsInfo: true };

export class SettingsStore {
  private s: Settings = { ...DEFAULTS };
  private cbs = new Set<() => void>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        this.s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
        delete (this.s as unknown as Record<string, unknown>).elrsVersion; // removed: the ELRS version is read from the receiver now
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
