/** Advice records of the auto-tune engine: an i18n key (autotune2.*) + params, severity, confidence and CLI forms. */
import type { SimplifiedSliders } from './settings';

export type Severity = 'ok' | 'info' | 'suggest' | 'warn' | 'critical';

export type SliderKey = 'master' | 'pi' | 'i' | 'd' | 'dmax' | 'ff' | 'pitchD' | 'pitchPi' | 'dtermMultiplier' | 'gyroMultiplier';

/** One simplified-tuning slider change; values are multipliers (1.0 = 100 in the CLI). */
export interface SliderChange {
  slider: SliderKey;
  /** CLI variable name, e.g. simplified_pi_gain. */
  cli: string;
  from: number | null;
  to: number;
}

export interface Advice {
  /** Stable rule id (e.g. 'pid.overshoot.roll'). */
  id: string;
  /** i18n key under autotune2.* (translated by the UI; this code also runs in a worker). */
  key: string;
  params?: Record<string, string | number>;
  severity: Severity;
  /** 0..1: how much the data supports the rule (log quality x number of steps/events). */
  confidence: number;
  /** Raw CLI lines (no save). */
  cli: string[];
  /** Slider form of the same change, when it has one. */
  sliders: SliderChange[];
  /** True when the numbers come from a rule of thumb / lookup table, not from the log. */
  approximate?: boolean;
}

export const SLIDER_CLI: Record<Exclude<SliderKey, 'dmax'>, string> = {
  master: 'simplified_master_multiplier',
  pi: 'simplified_pi_gain',
  i: 'simplified_i_gain',
  d: 'simplified_d_gain',
  ff: 'simplified_feedforward_gain',
  pitchD: 'simplified_pitch_d_gain',
  pitchPi: 'simplified_pitch_pi_gain',
  dtermMultiplier: 'simplified_dterm_filter_multiplier',
  gyroMultiplier: 'simplified_gyro_filter_multiplier',
};

export function sliderCliName(k: SliderKey, s?: SimplifiedSliders): string {
  return k === 'dmax' ? (s?.dmaxKey ?? 'simplified_dmax_gain') : SLIDER_CLI[k];
}

/** Rounds a slider multiplier to the 0.05 grid of the Configurator and clamps it to 0..2. */
export const roundSlider = (v: number, lo = 0, hi = 2) => Math.max(lo, Math.min(hi, Math.round(v * 20) / 20));

/** `set simplified_x = N` lines followed by `simplified_tuning apply` (empty when nothing changes). */
export function sliderCli(changes: SliderChange[]): string[] {
  const real = changes.filter((c) => c.from === null || Math.round(c.from * 100) !== Math.round(c.to * 100));
  if (!real.length) return [];
  return [...real.map((c) => `set ${c.cli} = ${Math.round(c.to * 100)}`), 'simplified_tuning apply'];
}

export function advice(id: string, key: string, severity: Severity, confidence: number, extra: Partial<Pick<Advice, 'params' | 'cli' | 'sliders' | 'approximate'>> = {}): Advice {
  return { id, key: `autotune2.${key}`, severity, confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100, cli: extra.cli ?? [], sliders: extra.sliders ?? [], ...(extra.params ? { params: extra.params } : {}), ...(extra.approximate ? { approximate: true } : {}) };
}
