/**
 * Autotune PID flow, step 1: what the drone is made of. Pure logic (no DOM, no i18n): the facts read from the FC,
 * the prefilled form, the rule-based starting profile and the data block sent to the AI assistant.
 * `FcFacts` is built from ctx.state / ctx.bf by wizard/fc-facts.ts.
 */
import type { PidTriple } from '../analysis/types';

export type Style = 'freestyle' | 'racing' | 'cinewhoop' | 'longrange';
export const STYLES: Style[] = ['freestyle', 'racing', 'cinewhoop', 'longrange'];

export interface Pid3 {
  roll: PidTriple;
  pitch: PidTriple;
  yaw: PidTriple;
}

/** What the FC reported (null = not read / not supported). Never holds names, UIDs or other personal data. */
export interface FcFacts {
  connected: boolean;
  demo: boolean;
  armed: boolean;
  api: number;
  firmware: string | null;
  board: string | null;
  protocol: string | null;
  dshot: boolean | null;
  bidir: boolean | null;
  motorCount: number | null;
  motorPoles: number | null;
  cells: number | null;
  capacityMah: number | null;
  vbat: number | null;
  pid: Pid3 | null;
  /** PID loop frequency [Hz]. */
  pidLoopHz: number | null;
  /** Blackbox device: 0 none, 1 flash, 2 SD card, 3 serial. */
  bbDevice: number | null;
  /** blackbox_sample_rate index (logged rate = PID loop / 2^index). */
  bbSampleRate: number | null;
  bbRateHz: number | null;
  /** blackbox_disable_* field mask (API >= 1.45), null when unknown. */
  bbDisabledMask: number | null;
  debugIndex: number | null;
  /** Debug mode name when the firmware's enum is known, else null. */
  debugName: string | null;
  rpmHarmonics: number | null;
  dynNotchCount: number | null;
  gyroLpf1Hz: number | null;
  dtermLpf1Hz: number | null;
  elrs: string | null;
  flash: { supported: boolean; total: number; used: number } | null;
  sdSupported: boolean | null;
}

export const emptyFacts = (): FcFacts => ({
  connected: false,
  demo: false,
  armed: false,
  api: 0,
  firmware: null,
  board: null,
  protocol: null,
  dshot: null,
  bidir: null,
  motorCount: null,
  motorPoles: null,
  cells: null,
  capacityMah: null,
  vbat: null,
  pid: null,
  pidLoopHz: null,
  bbDevice: null,
  bbSampleRate: null,
  bbRateHz: null,
  bbDisabledMask: null,
  debugIndex: null,
  debugName: null,
  rpmHarmonics: null,
  dynNotchCount: null,
  gyroLpf1Hz: null,
  dtermLpf1Hz: null,
  elrs: null,
  flash: null,
  sdSupported: null,
});

/** The form of step 1. Empty string / null = not filled in yet. */
export interface Parts {
  frameIn: number | null;
  motorStator: string;
  motorKv: number | null;
  propIn: number | null;
  propBlades: number | null;
  propPitch: number | null;
  cells: number | null;
  capacityMah: number | null;
  weightG: number | null;
  escProtocol: string;
  vtxMw: number | null;
  style: Style | null;
}

export type PartKey = keyof Parts;
export const PART_KEYS: PartKey[] = ['frameIn', 'motorStator', 'motorKv', 'propIn', 'propBlades', 'propPitch', 'cells', 'capacityMah', 'weightG', 'escProtocol', 'vtxMw', 'style'];

export const emptyParts = (): Parts => ({ frameIn: null, motorStator: '', motorKv: null, propIn: null, propBlades: null, propPitch: null, cells: null, capacityMah: null, weightG: null, escProtocol: '', vtxMw: null, style: null });

/** Values the FC can tell us about the parts (cells, capacity, ESC protocol). */
export function prefillFromFc(f: FcFacts): Partial<Parts> {
  const out: Partial<Parts> = {};
  if (f.cells && f.cells >= 1 && f.cells <= 8) out.cells = f.cells;
  if (f.capacityMah && f.capacityMah > 0) out.capacityMah = f.capacityMah;
  if (f.protocol) out.escProtocol = f.bidir ? `${f.protocol} + bidir` : f.protocol;
  return out;
}

/** Fills only the empty fields of `parts` with what the FC reported; returns the new form and which keys came from the FC. */
export function mergeDetected(parts: Parts, f: FcFacts): { parts: Parts; detected: PartKey[] } {
  const pre = prefillFromFc(f);
  const next = { ...parts };
  const detected: PartKey[] = [];
  for (const k of Object.keys(pre) as PartKey[]) {
    const cur = next[k];
    const v = pre[k];
    if (v === undefined) continue;
    if (cur === null || cur === '' || cur === v) {
      (next as Record<PartKey, unknown>)[k] = v;
      detected.push(k);
    }
  }
  return { parts: next, detected };
}

/** Fields still empty (the "ask me" list). */
export const missingParts = (p: Parts): PartKey[] => PART_KEYS.filter((k) => p[k] === null || p[k] === '');

/** Typical build for a frame size (a hint for empty fields, not a measurement). */
export interface TypicalBuild {
  stator: string;
  kv: [number, number];
  kvCells: number;
  prop: number;
  blades: number;
}
const TYPICAL: Array<[maxIn: number, b: TypicalBuild]> = [
  [2.2, { stator: '1103', kv: [8000, 11000], kvCells: 2, prop: 2, blades: 4 }],
  [3.2, { stator: '1404', kv: [3800, 4800], kvCells: 4, prop: 3, blades: 5 }],
  [4.2, { stator: '2004', kv: [2500, 3000], kvCells: 4, prop: 3.5, blades: 3 }],
  [5.6, { stator: '2207', kv: [1700, 1950], kvCells: 6, prop: 5.1, blades: 3 }],
  [6.5, { stator: '2506', kv: [1500, 1750], kvCells: 6, prop: 6, blades: 3 }],
  [7.6, { stator: '2807', kv: [1200, 1350], kvCells: 6, prop: 7, blades: 2 }],
  [99, { stator: '3110', kv: [900, 1100], kvCells: 6, prop: 9, blades: 2 }],
];
export function typicalBuild(frameIn: number | null): TypicalBuild | null {
  if (!frameIn || frameIn <= 0) return null;
  return TYPICAL.find(([max]) => frameIn <= max)?.[1] ?? null;
}

export type RuleCode =
  | 'noDshot'
  | 'bidirOff'
  | 'rpmOff'
  | 'bbRateLow'
  | 'cellsMismatch'
  | 'highRpm'
  | 'heavy'
  | 'whoop'
  | 'longRange'
  | 'racing'
  | 'freestyle'
  | 'startFromCurrent'
  | 'notConnected';

export interface RuleNote {
  level: 'ok' | 'warn' | 'info';
  code: RuleCode;
  params?: Record<string, string | number>;
}

/** Rule-based starting profile and risks (works without AI). */
export function ruleProfile(p: Parts, f: FcFacts): RuleNote[] {
  const out: RuleNote[] = [];
  if (!f.connected) out.push({ level: 'info', code: 'notConnected' });
  if (f.dshot === false) out.push({ level: 'warn', code: 'noDshot' });
  else if (f.bidir === false) out.push({ level: 'warn', code: 'bidirOff' });
  else if (f.bidir && f.rpmHarmonics === 0) out.push({ level: 'warn', code: 'rpmOff' });
  if (f.bbRateHz !== null && f.bbRateHz > 0 && f.bbRateHz < 1600) out.push({ level: 'warn', code: 'bbRateLow', params: { hz: Math.round(f.bbRateHz) } });
  if (p.cells && f.cells && p.cells !== f.cells) out.push({ level: 'warn', code: 'cellsMismatch', params: { typed: p.cells, fc: f.cells } });
  if (p.motorKv && p.cells) {
    const rpm = Math.round(p.motorKv * p.cells * 4.2);
    if (rpm > 50000) out.push({ level: 'warn', code: 'highRpm', params: { rpm } });
  }
  if (p.frameIn && p.weightG && p.frameIn >= 4.5 && p.frameIn <= 5.6 && p.weightG > 750) out.push({ level: 'info', code: 'heavy', params: { g: p.weightG } });
  const style = p.style ?? (p.frameIn && p.frameIn <= 3.5 ? 'cinewhoop' : p.frameIn && p.frameIn >= 6.5 ? 'longrange' : null);
  if (style === 'cinewhoop') out.push({ level: 'info', code: 'whoop' });
  else if (style === 'longrange') out.push({ level: 'info', code: 'longRange' });
  else if (style === 'racing') out.push({ level: 'info', code: 'racing' });
  else if (style === 'freestyle') out.push({ level: 'info', code: 'freestyle' });
  out.push({ level: 'ok', code: 'startFromCurrent' });
  return out;
}

/** Lines describing the build for the AI (labels in English, the model answers in the app language). No personal data. */
export function aiFacts(p: Parts, f: FcFacts): string[] {
  const L: string[] = [];
  const add = (k: string, v: string | number | null | undefined, unit = '') => {
    if (v !== null && v !== undefined && v !== '') L.push(`- ${k}: ${v}${unit}`);
  };
  L.push('Read from the flight controller:');
  add('Firmware', f.firmware);
  add('Board', f.board);
  add('Motor protocol', f.protocol);
  add('Bidirectional DShot', f.bidir === null ? null : f.bidir ? 'on' : 'off');
  add('RPM filter harmonics', f.rpmHarmonics);
  add('PID loop', f.pidLoopHz ? Math.round(f.pidLoopHz) : null, ' Hz');
  add('Blackbox logging rate', f.bbRateHz ? Math.round(f.bbRateHz) : null, ' Hz');
  add('Battery cells', f.cells);
  add('Gyro LPF1', f.gyroLpf1Hz, ' Hz');
  add('D-term LPF1', f.dtermLpf1Hz, ' Hz');
  add('Dynamic notch count', f.dynNotchCount);
  add('ELRS receiver', f.elrs);
  if (f.pid) add('PIDs roll/pitch/yaw (P/I/D)', `${f.pid.roll.join('/')}  ${f.pid.pitch.join('/')}  ${f.pid.yaw.join('/')}`);
  if (L.length === 1) L.push('- (not connected)');
  L.push('Entered by the pilot:');
  const n = L.length;
  add('Frame', p.frameIn, ' in');
  add('Motor stator', p.motorStator);
  add('Motor KV', p.motorKv);
  add('Props', p.propIn ? `${p.propIn} in${p.propPitch ? ` x ${p.propPitch}` : ''}${p.propBlades ? `, ${p.propBlades} blades` : ''}` : null);
  add('Battery', p.cells ? `${p.cells}S${p.capacityMah ? ` ${p.capacityMah} mAh` : ''}` : null);
  add('All-up weight', p.weightG, ' g');
  add('ESC protocol', p.escProtocol);
  add('VTX power', p.vtxMw, ' mW');
  add('Flying style', p.style);
  if (L.length === n) L.push('- (nothing yet)');
  const miss = missingParts(p);
  if (miss.length) L.push(`Unknown fields: ${miss.join(', ')}`);
  return L;
}
