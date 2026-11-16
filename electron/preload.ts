import { contextBridge, ipcRenderer } from 'electron';

type Status = { state: string; [k: string]: unknown };

contextBridge.exposeInMainWorld('workspacefpv', {
  isElectron: true,
  platform: process.platform,
  /** Tells the main process which language the UI uses (for native dialogs). */
  setLanguage: (lang: string): void => ipcRenderer.send('app:set-language', lang),
  /** Local AI providers (Claude Code CLI, Ollama), run in the main process. */
  ai: {
    detectClaude: (force?: boolean): Promise<unknown> => ipcRenderer.invoke('ai:claude-detect', !!force),
    ollamaTags: (baseUrl: string): Promise<unknown> => ipcRenderer.invoke('ai:ollama-tags', baseUrl),
    start: (id: string, payload: unknown): Promise<boolean> => ipcRenderer.invoke('ai:start', id, payload),
    cancel: (id: string): void => ipcRenderer.send('ai:cancel', id),
    onEvent: (cb: (e: unknown) => void): (() => void) => {
      const h = (_e: unknown, ev: unknown) => cb(ev);
      ipcRenderer.on('ai:event', h);
      return () => ipcRenderer.removeListener('ai:event', h);
    },
  },
  updates: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('updates:version'),
    getStatus: (): Promise<Status | null> => ipcRenderer.invoke('updates:status'),
    check: (): Promise<Status> => ipcRenderer.invoke('updates:check'),
    download: (): Promise<void> => ipcRenderer.invoke('updates:download'),
    install: (): Promise<void> => ipcRenderer.invoke('updates:install'),
    getAutoCheck: (): Promise<boolean> => ipcRenderer.invoke('updates:get-auto'),
    setAutoCheck: (on: boolean): Promise<void> => ipcRenderer.invoke('updates:set-auto', !!on),
    onStatus: (cb: (s: Status) => void): (() => void) => {
      const h = (_e: unknown, s: Status) => cb(s);
      ipcRenderer.on('updates:status', h);
      return () => ipcRenderer.removeListener('updates:status', h);
    },
  },
});
