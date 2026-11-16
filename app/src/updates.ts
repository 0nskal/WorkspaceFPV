/** Aktualizacje: typy wspolne z procesem glownym Electrona oraz dostep do mostu `window.rotorlab.updates`. */

export type UpdateStatus =
  | { state: 'dev' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes: string; auto?: boolean }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number; bytesPerSecond: number; total: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

export interface UpdatesApi {
  getVersion(): Promise<string>;
  getStatus(): Promise<UpdateStatus | null>;
  check(): Promise<UpdateStatus>;
  download(): Promise<void>;
  install(): Promise<void>;
  getAutoCheck(): Promise<boolean>;
  setAutoCheck(on: boolean): Promise<void>;
  onStatus(cb: (s: UpdateStatus) => void): () => void;
}

declare global {
  interface Window {
    rotorlab?: { isElectron?: boolean; platform?: string; updates?: UpdatesApi };
  }
  const __APP_VERSION__: string;
}

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export const updatesApi = (): UpdatesApi | null => window.rotorlab?.updates ?? null;
