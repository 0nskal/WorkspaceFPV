/**
 * Modes (Auxiliary) area: MSP_BOXNAMES / MSP_BOXIDS / MSP_MODE_RANGES / MSP_MODE_RANGES_EXTRA /
 * MSP_SET_MODE_RANGE (spec 3.5). Pure decoders/encoders plus range <-> microsecond helpers.
 */

export const MODE_SLOTS = 20;
export const STEP_MIN_US = 900;
export const STEP_US = 25;
export const STEP_COUNT = 48;

export interface ModeRange {
  slot: number;
  /** Permanent box id (0 ARM, 1 ANGLE, ...). */
  id: number;
  /** 0 = AUX1 = RC channel 5. */
  aux: number;
  start: number;
  end: number;
  /** 0 OR, 1 AND (MODE_RANGES_EXTRA). */
  logic: number;
  /** Permanent id of the linked mode for AND logic. */
  linkedTo: number;
}

/** Empty slot: start == end (spec). */
export const isEmptyRange = (r: Pick<ModeRange, 'start' | 'end'>): boolean => r.start === r.end;

export const stepToUs = (step: number): number => STEP_MIN_US + STEP_US * step;
export const usToStep = (us: number): number => Math.max(0, Math.min(STEP_COUNT, Math.round((us - STEP_MIN_US) / STEP_US)));

/** MSP_BOXNAMES: names separated by ';'. */
export const decodeBoxNames = (p: Uint8Array): string[] =>
  String.fromCharCode(...p)
    .split(';')
    .filter((s) => s.length > 0);

/** MSP_BOXIDS: one byte per box = permanent id. */
export const decodeBoxIds = (p: Uint8Array): number[] => Array.from(p);

/** Permanent ids of Betaflight 4.5 (`msp_box.c`), used only as a fallback when BOXIDS/BOXNAMES are unavailable. */
export const FALLBACK_BOXES: Record<number, string> = {
  0: 'ARM',
  1: 'ANGLE',
  2: 'HORIZON',
  4: 'ANTI GRAVITY',
  5: 'MAG',
  6: 'HEADFREE',
  13: 'BEEPER',
  15: 'LEDLOW',
  19: 'OSD DISABLE',
  20: 'TELEMETRY',
  26: 'BLACKBOX',
  27: 'FAILSAFE',
  28: 'AIR MODE',
  29: '3D DISABLE / SWITCH',
  31: 'BLACKBOX ERASE',
  35: 'FLIP OVER AFTER CRASH',
  36: 'PREARM',
  39: 'VTX PIT MODE',
  40: 'USER1',
  41: 'USER2',
  42: 'USER3',
  43: 'USER4',
  46: 'GPS RESCUE',
  47: 'ACRO TRAINER',
  50: 'MSP OVERRIDE',
  52: 'BEEPER MUTE',
  53: 'READY',
};

/** Merges MSP_MODE_RANGES (20 x 4 bytes) with the optional MSP_MODE_RANGES_EXTRA (u8 count, 3 bytes per slot). */
export function decodeModeRanges(p: Uint8Array, extra?: Uint8Array): ModeRange[] {
  const out: ModeRange[] = [];
  const n = Math.min(MODE_SLOTS, Math.floor(p.length / 4));
  const ex = extra && extra.length >= 1 ? extra : null;
  for (let i = 0; i < n; i++) {
    const e = ex && i < ex[0]! && 1 + i * 3 + 2 < ex.length ? [ex[1 + i * 3 + 1]!, ex[1 + i * 3 + 2]!] : [0, 0];
    out.push({ slot: i, id: p[i * 4]!, aux: p[i * 4 + 1]!, start: p[i * 4 + 2]!, end: p[i * 4 + 3]!, logic: e[0]!, linkedTo: e[1]! });
  }
  return out;
}

/** MSP_SET_MODE_RANGE (35): u8 slot, id, aux, start, end, then (4.1+) logic, linkedTo. */
export function encodeSetModeRange(r: ModeRange): Uint8Array {
  return Uint8Array.from([r.slot, r.id, r.aux, r.start, r.end, r.logic, r.linkedTo]);
}

/** A slot that clears the range: id 0 with start == end (the firmware ignores empty ranges). */
export const emptyRange = (slot: number): ModeRange => ({ slot, id: 0, aux: 0, start: 0, end: 0, logic: 0, linkedTo: 0 });

/** Pulse in microseconds is inside [900+25*start, 900+25*end), the firmware's rule. */
export const rangeContains = (r: Pick<ModeRange, 'start' | 'end'>, us: number): boolean => us >= stepToUs(r.start) && us < stepToUs(r.end);

/**
 * Which permanent ids would be active for the given channels (approximation of the firmware: OR ranges any-active,
 * AND ranges all-active together with the linked mode). The UI prefers the FC's own flags from STATUS_EX; this is
 * what the demo link and the "preview" marker use.
 */
export function activeModeIds(ranges: ModeRange[], rc: number[]): Set<number> {
  const live = ranges.filter((r) => !isEmptyRange(r));
  const on = (r: ModeRange) => {
    const v = rc[4 + r.aux];
    return v !== undefined && rangeContains(r, v);
  };
  const ids = new Set(live.map((r) => r.id));
  const active = new Set<number>();
  for (const id of ids) {
    const mine = live.filter((r) => r.id === id);
    const or = mine.filter((r) => r.logic === 0);
    const and = mine.filter((r) => r.logic === 1);
    const orOk = or.length === 0 || or.some(on);
    const andOk = and.every(on);
    if (orOk && andOk) active.add(id);
  }
  // AND ranges also need the linked mode (from its own OR/AND result) to be active
  for (const r of live) if (r.logic === 1 && r.linkedTo && !active.has(r.linkedTo)) active.delete(r.id);
  return active;
}

/** Flight-mode bit k of STATUS_EX is the k-th box of MSP_BOXIDS. Returns the active permanent ids. */
export function activeIdsFromFlags(boxIds: number[], flags: boolean[]): Set<number> {
  const s = new Set<number>();
  boxIds.forEach((id, k) => {
    if (flags[k]) s.add(id);
  });
  return s;
}

/** Inverse of activeIdsFromFlags (for the demo link). */
export function flagsFromActiveIds(boxIds: number[], active: Set<number>): number {
  let f = 0;
  boxIds.forEach((id, k) => {
    if (k < 32 && active.has(id)) f |= 1 << k;
  });
  return f >>> 0;
}
