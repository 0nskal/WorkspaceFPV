import { contextBridge, ipcRenderer } from 'electron';

type Status = { state: string; [k: string]: unknown };

contextBridge.exposeInMainWorld('rotorlab', {
  isElectron: true,
  platform: process.platform,
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
