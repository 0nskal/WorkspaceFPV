import { C } from '../bf/codes';
import * as D from '../bf/decode';
import type { BfData, BfSession } from '../bf/store';
import { MSP, s16, u16, view } from '../serial/msp';
import type { FcLink } from '../serial/types';
import type { FcConfig, FcInfo, FcState, FcStatus, FcStore, PidSet, Telemetry } from './state';

/** FcStatus (the slim view used by the shared state and the diagnosis) from a decoded MSP_STATUS_EX. */
export function statusFromEx(ex: D.StatusEx): FcStatus {
  return {
    cycleTimeUs: ex.cycleTimeUs,
    i2cErrors: ex.i2cErrors,
    sensors: ex.sensors,
    flightModeFlags: ex.modeFlags,
    cpuLoad: ex.cpuLoad,
    armingDisableFlags: ex.armingFlags,
    armingFlagCount: ex.armingFlagCount,
    armed: (ex.modeFlags & 1) === 1,
  };
}

export function decodeStatus(p: Uint8Array, apiMinor = 46): FcStatus {
  return statusFromEx(D.decodeStatusEx(p, apiMinor));
}

export function decodeMotors(p: Uint8Array, count = 4): number[] {
  const dv = view(p);
  const out: number[] = [];
  for (let i = 0; i < Math.min(8, Math.floor(p.length / 2)); i++) out.push(u16(dv, i * 2));
  return out.slice(0, Math.max(count, 1));
}

export function decodeAnalog(p: Uint8Array, apiMinor: number): { vbat: number; mah: number; rssi: number; amperage: number } {
  return D.decodeAnalog(p, apiMinor);
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

/** MSP_RX_CONFIG (44): byte 0 = serialrx_provider (9 = CRSF, i.e. ExpressLRS/Crossfire). */
export function decodeRxConfig(p: Uint8Array): { serialRxProvider: number } {
  return { serialRxProvider: p[0] ?? 0 };
}

export async function readRxConfig(link: FcLink): Promise<{ serialRxProvider: number }> {
  return decodeRxConfig(await link.request(MSP.RX_CONFIG));
}

/** Estimated cell count 1S-8S from the voltage (assumes a full pack up to 4.35 V per cell). */
export function estimateCells(vbat: number): number | null {
  if (vbat < 5) return null; // USB power, no battery
  return Math.max(1, Math.min(8, Math.ceil(vbat / 4.36)));
}

/** The shared FcInfo/FcConfig view derived from the Betaflight store (single source of truth: the store). */
export function deriveCore(bf: BfData): { info: FcInfo; config: FcConfig | null } {
  const b = bf.board;
  const info: FcInfo = {
    apiVersion: { major: 1, minor: bf.api },
    variant: bf.variant,
    version: bf.version,
    boardId: b?.boardId ?? '',
    boardName: b?.boardName || b?.targetName || '',
    manufacturer: b?.manufacturer ?? '',
    craftName: bf.craftName,
  };
  const a = bf.advanced;
  const m = bf.motor;
  const config: FcConfig | null =
    a && m
      ? {
          gyroSyncDenom: a.gyroSyncDenom,
          pidProcessDenom: a.pidProcessDenom,
          motorPwmProtocol: a.motorProtocol,
          motorPwmRate: a.motorPwmRate,
          minThrottle: m.minThrottle,
          maxThrottle: m.maxThrottle,
          minCommand: m.minCommand,
          motorCount: m.motorCount,
          motorPoles: m.motorPoles,
          bidir: m.dshotTelemetry,
          useEscSensor: m.escSensor,
        }
      : null;
  return { info, config };
}

/** Full read after connecting: the Betaflight snapshot (with progress) plus the first telemetry sample. */
export async function readAll(link: FcLink, bf: BfSession): Promise<Pick<FcState, 'info' | 'config' | 'status' | 'pid' | 'cells' | 'telemetry'>> {
  await bf.snapshot(link);
  const d = bf.get();
  const { info, config } = deriveCore(d);
  const status = d.status ? statusFromEx(d.status) : null;
  const rawPid = d.raw.get('pid');
  const pid: PidSet | null = rawPid ? decodePid(rawPid) : null;
  if (!config) return { info, config, status, pid, cells: null, telemetry: null };
  const telemetry = await readTelemetry(link, info.apiVersion.minor, config.motorCount);
  return { info, config, status, pid, cells: estimateCells(telemetry.vbat), telemetry };
}

export async function readTelemetry(link: FcLink, apiMinor: number, motorCount: number): Promise<Telemetry> {
  const motors = decodeMotors(await link.request(C.MOTOR), motorCount);
  const analog = decodeAnalog(await link.request(C.ANALOG), apiMinor);
  const imu = decodeImu(await link.request(C.RAW_IMU));
  return { motors, ...analog, gyro: imu.gyro, acc: imu.acc, t: Date.now() };
}

/**
 * Telemetry loop every ~100 ms (motors, analog, IMU), status every ~1 s (STATUS_EX, also fed to the Betaflight store).
 * Pauses during CLI. Returns the stop function.
 */
export function startTelemetry(link: FcLink, store: FcStore, bf?: BfSession): () => void {
  let stop = false;
  let tick = 0;
  void (async () => {
    while (!stop) {
      const t0 = Date.now();
      if (!link.busy) {
        try {
          const s = store.get();
          const api = s.info?.apiVersion.minor ?? 46;
          const t = await readTelemetry(link, api, s.config?.motorCount ?? 4);
          if (stop) break;
          store.setTelemetry(t);
          if (tick++ % 10 === 0) {
            const ex = D.decodeStatusEx(await link.request(C.STATUS_EX), api);
            if (stop) break;
            bf?.ingestStatus(ex);
            const status = statusFromEx(ex);
            const prev = store.get().status;
            if (!prev || prev.armingDisableFlags !== status.armingDisableFlags || prev.armed !== status.armed || prev.i2cErrors !== status.i2cErrors) {
              store.patch({ status, cells: estimateCells(t.vbat) });
            }
          }
        } catch {
          /* transient timeout - try again next cycle */
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
