import { app, ipcMain, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';

type Status =
  | { state: 'dev' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes: string; auto?: boolean }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number; bytesPerSecond: number; total: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

const prefsFile = () => path.join(app.getPath('userData'), 'updates.json');

function readAuto(): boolean {
  try {
    const j = JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) as { checkOnStart?: boolean };
    return j.checkOnStart !== false;
  } catch {
    return true; // domyslnie wlaczone
  }
}

function writeAuto(on: boolean): void {
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify({ checkOnStart: on }));
  } catch {
    /* ignore */
  }
}

function notesToText(n: unknown): string {
  if (typeof n === 'string') return n;
  if (Array.isArray(n)) return n.map((x) => (x && typeof x === 'object' && 'note' in x ? String((x as { note: unknown }).note ?? '') : '')).join('\n');
  return '';
}

export function setupUpdater(getWin: () => BrowserWindow | null): void {
  let last: Status | null = null;
  let availableVersion = '';
  let autoCheck = false;
  let busy = false;

  const push = (s: Status) => {
    last = s;
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('updates:status', s);
  };

  // Niespakowana appka (dev) nie ma app-update.yml - updater nie dziala.
  const active = app.isPackaged;

  autoUpdater.autoDownload = false; // pobieranie zatwierdza uzytkownik
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => push({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => {
    availableVersion = i.version;
    push({ state: 'available', version: i.version, releaseNotes: notesToText(i.releaseNotes), auto: autoCheck });
  });
  autoUpdater.on('update-not-available', () => push({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p) =>
    push({ state: 'downloading', percent: p.percent, bytesPerSecond: p.bytesPerSecond, total: p.total }),
  );
  autoUpdater.on('update-downloaded', (i) => push({ state: 'downloaded', version: i.version || availableVersion }));
  autoUpdater.on('error', (e) => push({ state: 'error', message: e?.message ?? String(e) }));

  const check = async (auto: boolean): Promise<Status> => {
    if (!active) {
      push({ state: 'dev' });
      return { state: 'dev' };
    }
    if (busy) return last ?? { state: 'checking' };
    busy = true;
    autoCheck = auto;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      push({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      busy = false;
    }
    return last ?? { state: 'not-available' };
  };

  ipcMain.handle('updates:version', () => app.getVersion());
  ipcMain.handle('updates:status', () => last);
  ipcMain.handle('updates:check', () => check(false));
  ipcMain.handle('updates:download', async () => {
    if (!active) return;
    try {
      await autoUpdater.downloadUpdate();
    } catch (e) {
      push({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  });
  ipcMain.handle('updates:install', () => {
    if (active) autoUpdater.quitAndInstall(false, true);
  });
  ipcMain.handle('updates:get-auto', () => readAuto());
  ipcMain.handle('updates:set-auto', (_e, on: boolean) => writeAuto(!!on));

  if (active) {
    setTimeout(() => {
      if (readAuto()) void check(true);
    }, 5000);
  }
}
