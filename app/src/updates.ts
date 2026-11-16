/** Aktualizacje: typy wspolne z procesem glownym Electrona oraz dostep do mostu `window.workspacefpv.updates`. */

import type { DesktopAi } from './ai/bridge';

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
    workspacefpv?: { isElectron?: boolean; platform?: string; updates?: UpdatesApi; ai?: DesktopAi; setLanguage?: (lang: string) => void };
  }
  const __APP_VERSION__: string;
}

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/**
 * Dev-only helper for screenshots: `?fakeUpdates=1` pretends to run inside Electron.
 * Values: `1` (interactive: check -> available, download -> 42% -> downloaded),
 * or a fixed initial state: `available`, `downloading`, `downloaded`.
 */
function fakeUpdates(mode: string): UpdatesApi {
  const cbs = new Set<(s: UpdateStatus) => void>();
  const states: Record<string, UpdateStatus> = {
    available: { state: 'available', version: '0.2.0', releaseNotes: '' },
    downloading: { state: 'downloading', percent: 42, bytesPerSecond: 3.4 * 1048576, total: 86 * 1048576 },
    downloaded: { state: 'downloaded', version: '0.2.0' },
  };
  let status: UpdateStatus | null = states[mode] ?? null;
  const emit = (s: UpdateStatus) => {
    status = s;
    cbs.forEach((cb) => cb(s));
  };
  return {
    getVersion: () => Promise.resolve(APP_VERSION),
    getStatus: () => Promise.resolve(status),
    check: () => {
      emit({ state: 'checking' });
      setTimeout(() => emit(states.available as UpdateStatus), 600);
      return Promise.resolve({ state: 'checking' } as UpdateStatus);
    },
    download: () => {
      emit(states.downloading as UpdateStatus);
      setTimeout(() => emit(states.downloaded as UpdateStatus), 3000);
      return Promise.resolve();
    },
    install: () => Promise.resolve(),
    getAutoCheck: () => Promise.resolve(true),
    setAutoCheck: () => Promise.resolve(),
    onStatus: (cb) => {
      cbs.add(cb);
      return () => cbs.delete(cb);
    },
  };
}

let fake: UpdatesApi | null = null;

export const updatesApi = (): UpdatesApi | null => {
  if (window.workspacefpv?.updates) return window.workspacefpv.updates;
  const mode = new URLSearchParams(location.search).get('fakeUpdates');
  if (mode) return (fake ??= fakeUpdates(mode));
  return null;
};
