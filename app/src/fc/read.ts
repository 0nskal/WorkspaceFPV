import { MSP, ascii, s16, u16, u32, view } from '../serial/msp';
import type { FcLink } from '../serial/types';
import type { FcConfig, FcInfo, FcState, FcStatus, FcStore, PidSet, Telemetry } from './state';

export function decodeApiVersion(p: Uint8Array) {
  return { major: p[1] ?? 0, minor: p[2] ?? 0 };
}

export function decodeBoardInfo(p: Uint8Array): { boardId: string; boardName: string; manufacturer: string } {
  const boardId = ascii(p, 0, 4);
  // 4 B id + 2 B rev + 1 B type + 1 B caps, potem len+str: targetName, boardName, manufacturerId
  let o = 8;
  const readStr = () => {
    if (o >= p.length) return '';
    const n = p[o++];
    const s = ascii(p, o, o + n);
    o += n;
    return s;
  };
  const targetName = readStr();
  const boardName = readStr();
  const manufacturer = readStr();
  return { boardId, boardName: boardName || targetName, manufacturer };
}

export function decodeStatus(p: Uint8Array): FcStatus {
  const dv = view(p);
  const flags = p.length >= 4 ? u32(dv, 6) : 0;
  let armingDisableFlags = 0;
  if (p.length > 16) {
    const extLen = p[15];
    const o = 16 + extLen;
    if (p.length >= o + 5) armingDisableFlags = u32(dv, o + 1);
  }
  return {
    cycleTimeUs: u16(dv, 0),
    i2cErrors: u16(dv, 2),
    sensors: u16(dv, 4),
    flightModeFlags: flags,
    cpuLoad: p.length >= 13 ? u16(dv, 11) : 0,
    armingDisableFlags,
    armed: (flags & 1) === 1,
  };
}

export function decodeMotors(p: Uint8Array, count = 4): number[] {
  const dv = view(p);
  const out: number[] = [];
  for (let i = 0; i < Math.min(8, Math.floor(p.length / 2)); i++) out.push(u16(dv, i * 2));
  return out.slice(0, Math.max(count, 1));
}

export function decodeAnalog(p: Uint8Array, apiMinor: number): { vbat: number; mah: number; rssi: number; amperage: number } {
  const dv = view(p);
  let vbat = p[0] / 10;
  if (apiMinor >= 41 && p.length >= 9) vbat = u16(dv, 7) / 100;
  return { vbat, mah: u16(dv, 1), rssi: u16(dv, 3), amperage: s16(dv, 5) / 100 };
}

export function decodeImu(p: Uint8Array) {
  const dv = view(p);
  const acc: [number, number, number] = [s16(dv, 0), s16(dv, 2), s16(dv, 4)];
  const gyro: [number, number, number] = [s16(dv, 6), s16(dv, 8), s16(dv, 10)];
  return { acc, gyro };
}

export function decodePid(p: Uint8Array): PidSet {
  const ax = (i: number): [number, number, number] => [p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0];
  return { roll: ax(0), pitch: ax(1), yaw: ax(2) };
}

export function decodeConfig(adv: Uint8Array, mot: Uint8Array): FcConfig {
  const a = view(adv);
  const m = view(mot);
  return {
    gyroSyncDenom: adv[0] ?? 1,
    pidProcessDenom: adv[1] ?? 1,
    motorPwmProtocol: adv[3] ?? 0,
    motorPwmRate: adv.length >= 6 ? u16(a, 4) : 0,
    minThrottle: u16(m, 0),
    maxThrottle: u16(m, 2),
    minCommand: u16(m, 4),
    motorCount: mot[6] ?? 4,
    motorPoles: mot[7] ?? 14,
    bidir: (mot[8] ?? 0) === 1,
    useEscSensor: (mot[9] ?? 0) === 1,
  };
}

/** MSP_RX_CONFIG (44): bajt 0 = serialrx_provider (9 = CRSF, czyli ExpressLRS/Crossfire). */
export function decodeRxConfig(p: Uint8Array): { serialRxProvider: number } {
  return { serialRxProvider: p[0] ?? 0 };
}

export async function readRxConfig(link: FcLink): Promise<{ serialRxProvider: number }> {
  return decodeRxConfig(await link.request(MSP.RX_CONFIG));
}

/** Szacunek liczby cel 1S-8S z napiecia (zaklada pelne do HV 4.35 V na cele). */
export function estimateCells(vbat: number): number | null {
  if (vbat < 5) return null; // zasilanie z USB, brak baterii
  return Math.max(1, Math.min(8, Math.ceil(vbat / 4.36)));
}

/** Pelny odczyt statyczny po polaczeniu: info, konfiguracja, status, PID, pierwsza telemetria. */
export async function readAll(link: FcLink): Promise<Pick<FcState, 'info' | 'config' | 'status' | 'pid' | 'cells' | 'telemetry'>> {
  const api = decodeApiVersion(await link.request(MSP.API_VERSION));
  const variant = ascii(await link.request(MSP.FC_VARIANT));
  const v = await link.request(MSP.FC_VERSION);
  const board = decodeBoardInfo(await link.request(MSP.BOARD_INFO));
  let craftName = '';
  try {
    craftName = ascii(await link.request(MSP.NAME));
  } catch {
    /* brak nazwy */
  }
  const info: FcInfo = {
    apiVersion: api,
    variant,
    version: `${v[0]}.${v[1]}.${v[2]}`,
    ...board,
    craftName,
  };
  const config = decodeConfig(await link.request(MSP.ADVANCED_CONFIG), await link.request(MSP.MOTOR_CONFIG));
  const status = decodeStatus(await link.request(MSP.STATUS));
  let pid: PidSet | null = null;
  try {
    pid = decodePid(await link.request(MSP.PID));
  } catch {
    /* PID opcjonalny */
  }
  const telemetry = await readTelemetry(link, info.apiVersion.minor, config.motorCount);
  return { info, config, status, pid, cells: estimateCells(telemetry.vbat), telemetry };
}

export async function readTelemetry(link: FcLink, apiMinor: number, motorCount: number): Promise<Telemetry> {
  const motors = decodeMotors(await link.request(MSP.MOTOR), motorCount);
  const analog = decodeAnalog(await link.request(MSP.ANALOG), apiMinor);
  const imu = decodeImu(await link.request(MSP.RAW_IMU));
  return { motors, ...analog, gyro: imu.gyro, acc: imu.acc, t: Date.now() };
}

/**
 * Petla telemetrii co ~100 ms (silniki, analog, IMU), status co ~1 s.
 * Wstrzymuje sie w trakcie CLI. Zwraca funkcje zatrzymujaca.
 */
export function startTelemetry(link: FcLink, store: FcStore): () => void {
  let stop = false;
  let tick = 0;
  void (async () => {
    while (!stop) {
      const t0 = Date.now();
      if (!link.busy) {
        try {
          const s = store.get();
          const t = await readTelemetry(link, s.info?.apiVersion.minor ?? 46, s.config?.motorCount ?? 4);
          if (stop) break;
          store.setTelemetry(t);
          if (tick++ % 10 === 0) {
            const status = decodeStatus(await link.request(MSP.STATUS));
            if (stop) break;
            const prev = store.get().status;
            if (!prev || prev.armingDisableFlags !== status.armingDisableFlags || prev.armed !== status.armed || prev.i2cErrors !== status.i2cErrors) {
              store.patch({ status, cells: estimateCells(t.vbat) });
            }
          }
        } catch {
          /* chwilowy timeout - sprobuj w nastepnym cyklu */
        }
      }
      const wait = Math.max(20, 100 - (Date.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
    }
  })();
  return () => {
    stop = true;
  };
}
