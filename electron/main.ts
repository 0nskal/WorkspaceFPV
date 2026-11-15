import { app, BrowserWindow, Menu, dialog, session, shell } from 'electron';
import path from 'node:path';

/** VID STM32 (Betaflight FC zwykle uzywaja 0x0483). */
const STM32_VID = 0x0483;

let win: BrowserWindow | null = null;

const iconPath = () => path.join(__dirname, '..', 'assets', 'icon.png');

function vidMatches(vendorId: string | undefined): boolean {
  if (!vendorId) return false;
  // Electron podaje vendorId jako string (dziesietnie); dla pewnosci sprawdzamy tez zapis szesnastkowy.
  return parseInt(vendorId, 10) === STM32_VID || parseInt(vendorId, 16) === STM32_VID;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    title: 'Rotorlab',
    backgroundColor: '#070B10',
    autoHideMenuBar: true,
    icon: iconPath(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.on('page-title-updated', (e) => e.preventDefault()); // tytul zawsze "Rotorlab"
  win.on('closed', () => (win = null));

  // Linki zewnetrzne otwieraj w przegladarce systemowej.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.ROTORLAB_DEV_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function setupSerial(): void {
  const ses = session.defaultSession;

  // WebSerial: wybor portu. Pierwszy pasujacy VID STM32; w innym wypadku mala lista wyboru.
  ses.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();
    void (async () => {
      if (portList.length === 0) {
        callback('');
        if (win) {
          await dialog.showMessageBox(win, {
            type: 'info',
            title: 'Rotorlab',
            message: 'Nie znaleziono żadnego portu szeregowego.',
            detail: 'Podłącz FC kablem USB (z przesyłem danych) i spróbuj ponownie.',
            buttons: ['OK'],
          });
        }
        return;
      }
      const stm = portList.filter((p) => vidMatches(p.vendorId));
      if (stm.length === 1 || (stm.length === 0 && portList.length === 1)) {
        callback((stm[0] ?? portList[0]).portId);
        return;
      }
      const candidates = (stm.length ? stm : portList).slice(0, 8);
      const labels = candidates.map((p) => `${p.displayName || p.portName} (${p.portName})`);
      const opts: Electron.MessageBoxOptions = {
        type: 'question',
        title: 'Wybierz port FC',
        message: 'Wybierz port, do którego podłączony jest FC',
        buttons: [...labels, 'Anuluj'],
        cancelId: labels.length,
        defaultId: 0,
        noLink: true,
      };
      const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      callback(res.response < labels.length ? candidates[res.response].portId : '');
    })();
  });

  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial' || permission === 'clipboard-sanitized-write');
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'serial' || permission === 'clipboard-sanitized-write'));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    setupSerial();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
