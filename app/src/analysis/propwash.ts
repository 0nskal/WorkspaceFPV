/**
 * Propwash detection: band energy (default 20-90 Hz, frame-size aware) of the roll/pitch tracking error
 * (gyro - setpoint) in the 400 ms after throttle-down events, against a clean baseline (steady mid throttle, steady
 * sticks). Ratio >= 5x = severe, 2-5x = moderate; needs >= 3 events.
 */
import { BAD_GYRO_SAT, filter, highpass, lowpass, median, smoothCentered } from './signals';
import type { LogData } from './types';

export type PropwashLevel = 'none' | 'moderate' | 'severe' | 'insufficient' | 'noThrottle';

export interface PropwashResult {
  level: PropwashLevel;
  /** Throttle-down events used. */
  events: number;
  /** Median event energy / baseline energy (roll + pitch average); null when it could not be measured. */
  ratio: number | null;
  perAxis: [roll: number | null, pitch: number | null];
  band: [number, number];
  baselineWindows: number;
  /** Event start times [s] (up to 50). */
  eventTimes: number[];
}

export const PROPWASH_MIN_EVENTS = 3;
export const PROPWASH_SEVERE = 5;
export const PROPWASH_MODERATE = 2;

export interface PropwashOptions {
  /** Minimum throttle drop [percentage points] within `dropMs`. */
  minDrop?: number;
  dropMs?: number;
  windowMs?: number;
}

export function detectPropwash(log: LogData, thr: Float32Array | null, mask: Uint8Array | null, band: [number, number], o: PropwashOptions = {}): PropwashResult {
  const base: PropwashResult = { level: 'noThrottle', events: 0, ratio: null, perAxis: [null, null], band, baselineWindows: 0, eventTimes: [] };
  if (!thr) return base;
  const fs = log.fs;
  const n = log.rows;
  const ms = fs / 1000;
  const minDrop = o.minDrop ?? 15;
  const dropN = Math.round((o.dropMs ?? 250) * ms);
  const win = Math.round((o.windowMs ?? 400) * ms);
  const ts = smoothCentered(thr, Math.max(1, Math.round(20 * ms)));
  const step = Math.max(1, Math.round(5 * ms));

  // throttle-down events
  const events: number[] = [];
  for (let i = 0; i + dropN < n - win; i += step) {
    if (ts[i]! < 25) continue;
    let mn = Infinity;
    let at = i;
    for (let j = i; j <= i + dropN; j += step) {
      if (ts[j]! < mn) {
        mn = ts[j]!;
        at = j;
      }
    }
    if (ts[i]! - mn >= minDrop) {
      // window starts where the drop ends
      let bad = 0;
      if (mask) for (let k = at; k < at + win; k++) bad |= mask[k]!;
      // a stick slam inside the window would swamp the band with commanded motion: skip such drops
      let slam = false;
      for (let a = 0; a < 2; a++) {
        const s = log.setpoint[a]!;
        let spLo = Infinity;
        let spHi = -Infinity;
        for (let k = at; k < at + win; k += step) {
          spLo = Math.min(spLo, s[k]!);
          spHi = Math.max(spHi, s[k]!);
        }
        if (spHi - spLo > 150) slam = true;
      }
      if (!(bad & BAD_GYRO_SAT) && !slam) events.push(at);
      i = at + Math.round(500 * ms);
    }
  }

  // band-passed tracking error, roll and pitch
  const bp = [0, 1].map((a) => {
    const err = new Float64Array(n);
    const g = log.gyro[a]!;
    const s = log.setpoint[a]!;
    for (let i = 0; i < n; i++) err[i] = g[i]! - s[i]!;
    return filter(filter(err, highpass(band[0], fs)), lowpass(Math.min(band[1], fs / 2.5), fs));
  });
  const energy = (x: Float64Array, at: number) => {
    let s = 0;
    for (let k = at; k < at + win; k++) s += x[k]! * x[k]!;
    return s / win;
  };

  // baseline: steady mid throttle, calm sticks, away from events
  const cands: number[] = [];
  const far = Math.round(1000 * ms);
  const lead = Math.round(150 * ms);
  for (let at = Math.round(200 * ms); at + win < n; at += win >> 1) {
    if (events.some((e) => Math.abs(e - at) < far)) continue;
    let lo = Infinity;
    let hi = -Infinity;
    const sLo = [Infinity, Infinity];
    const sHi = [-Infinity, -Infinity];
    let bad = 0;
    for (let k = at - lead; k < at + win; k += step) {
      const v = ts[k]!;
      if (k >= at) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      // sticks must also be steady 150 ms before the window (no ringing tail of an earlier move)
      for (let a = 0; a < 2; a++) {
        const sv = log.setpoint[a]![k]!;
        sLo[a] = Math.min(sLo[a]!, sv);
        sHi[a] = Math.max(sHi[a]!, sv);
      }
      if (mask) bad |= mask[k]!;
    }
    // steady sticks (a held roll rate is fine), steady mid throttle
    const steady = sHi[0]! - sLo[0]! <= 30 && sHi[1]! - sLo[1]! <= 30;
    if (steady && !bad && hi - lo <= 8 && lo >= 20 && hi <= 80) cands.push(at);
  }
  const strideB = Math.max(1, Math.ceil(cands.length / 60));
  const baseWins = cands.filter((_, i) => i % strideB === 0);
  const res: PropwashResult = { ...base, level: 'insufficient', events: events.length, baselineWindows: baseWins.length, eventTimes: events.slice(0, 50).map((e) => Math.round((e / fs) * 100) / 100) };
  if (events.length < PROPWASH_MIN_EVENTS || baseWins.length < 3) return res;
  const perAxis = bp.map((x) => {
    const b = median(baseWins.map((at) => energy(x, at)));
    const e = median(events.map((at) => energy(x, at)));
    return b && b > 0 && e !== null ? e / b : null;
  }) as [number | null, number | null];
  const vals = perAxis.filter((v): v is number => v !== null);
  const ratio = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  res.perAxis = perAxis.map((v) => (v === null ? null : Math.round(v * 100) / 100)) as [number | null, number | null];
  res.ratio = ratio === null ? null : Math.round(ratio * 100) / 100;
  res.level = ratio === null ? 'insufficient' : ratio >= PROPWASH_SEVERE ? 'severe' : ratio >= PROPWASH_MODERATE ? 'moderate' : 'none';
  return res;
}
