/** Compact plain-text summaries of the Betaflight store, for the AI context and the per-tab "Ask AI" action. */
import type { BfData } from './store';
import * as D from './decode';

export const FEATURE_NAMES: Record<number, string> = Object.fromEntries(Object.entries(D.FEATURE).map(([k, v]) => [v, k]));

export const featureList = (mask: number): string[] =>
  Object.entries(FEATURE_NAMES)
    .filter(([bit]) => D.hasFeature(mask, Number(bit)))
    .map(([, name]) => name);

const FN_NAMES: Array<[number, string]> = [
  [D.SERIAL_FN.MSP, 'MSP'],
  [D.SERIAL_FN.GPS, 'GPS'],
  [D.SERIAL_FN.RX_SERIAL, 'RX_SERIAL'],
  [D.SERIAL_FN.BLACKBOX, 'BLACKBOX'],
  [D.SERIAL_FN.ESC_SENSOR, 'ESC_SENSOR'],
  [D.SERIAL_FN.TELEMETRY_FRSKY, 'TELEM_FRSKY'],
  [D.SERIAL_FN.TELEMETRY_SMARTPORT, 'TELEM_SMARTPORT'],
  [D.SERIAL_FN.TELEMETRY_HOTT, 'TELEM_HOTT'],
  [D.SERIAL_FN.TELEMETRY_LTM, 'TELEM_LTM'],
  [D.SERIAL_FN.TELEMETRY_MAVLINK, 'TELEM_MAVLINK'],
  [D.SERIAL_FN.TELEMETRY_IBUS, 'TELEM_IBUS'],
  [D.SERIAL_FN.VTX_SMARTAUDIO, 'VTX_SMARTAUDIO'],
  [D.SERIAL_FN.VTX_TRAMP, 'VTX_TRAMP'],
  [D.SERIAL_FN.VTX_MSP, 'VTX_MSP'],
  [D.SERIAL_FN.RCDEVICE, 'RCDEVICE'],
  [D.SERIAL_FN.FRSKY_OSD, 'FRSKY_OSD'],
  [D.SERIAL_FN.LIDAR_TF, 'LIDAR'],
  [D.SERIAL_FN.GIMBAL, 'GIMBAL'],
];

export const serialFunctions = (mask: number): string[] => FN_NAMES.filter(([bit]) => (mask & bit) !== 0).map(([, n]) => n);

/** Lines describing everything the core tabs know about the FC. */
export function bfSummaryLines(bf: Readonly<BfData>): string[] {
  const out: string[] = [];
  if (!bf.supported) return out;
  const b = bf.board;
  if (b) out.push(`- Board: ${b.boardId}${b.gyroRateHz ? `, gyro ${b.gyroRateHz} Hz` : ''}, config state ${['bare defaults', 'custom defaults', 'configured'][b.configState] ?? b.configState}${b.problems ? `, config problems mask ${b.problems}` : ''}`);
  if (bf.build) out.push(`- Build: ${bf.build.date} ${bf.build.time} (${bf.build.hash})`);
  if (bf.advanced) {
    const a = bf.advanced;
    const rate = b?.gyroRateHz ? ` (~${Math.round(b.gyroRateHz / a.gyroSyncDenom / a.pidProcessDenom)} Hz)` : '';
    out.push(`- Loop: pid_process_denom ${a.pidProcessDenom}${rate}, digital idle ${a.motorIdlePct}%`);
  }
  if (bf.mixer) out.push(`- Mixer: ${D.MIXERS.find(([id]) => id === bf.mixer?.mixer)?.[1] ?? bf.mixer.mixer}, motors reversed (props out): ${bf.mixer.reversed ? 'yes' : 'no'}`);
  if (bf.features !== null) out.push(`- Features: ${featureList(bf.features).join(', ') || 'none'}`);
  if (bf.arming) out.push(`- Arming: auto-disarm ${bf.arming.autoDisarmDelay}s, small_angle ${bf.arming.smallAngle}`);
  if (bf.battery) {
    const x = bf.battery;
    out.push(`- Battery config: cell min ${x.minCell} V / warn ${x.warnCell} V / max ${x.maxCell} V, capacity ${x.capacityMah} mAh, voltage source ${x.voltageSource}, current source ${x.currentSource}`);
  }
  if (bf.failsafe) {
    const f = bf.failsafe;
    out.push(`- Failsafe: procedure ${['auto-landing', 'drop', 'GPS rescue'][f.procedure] ?? f.procedure}, guard ${f.delay / 10}s, landing ${f.offDelay / 10}s, throttle ${f.throttle}`);
  }
  if (bf.serial) out.push(`- Serial ports: ${bf.serial.ports.map((p) => `${D.serialPortName(p.id)}=${serialFunctions(p.mask).join('+') || 'none'}`).join('; ')}`);
  return out;
}
