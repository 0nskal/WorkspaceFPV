import { contextBridge } from 'electron';

// Minimalny most: appka wie, ze dziala w Electronie (WebSerial i reszta API sa natywne w Chromium).
contextBridge.exposeInMainWorld('rotorlab', {
  isElectron: true,
  platform: process.platform,
});
