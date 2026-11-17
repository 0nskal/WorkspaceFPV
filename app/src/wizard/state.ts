/**
 * Auto-tune wizard: step order and gating, named "before-pid" backups, the restore command list, the undo map of
 * values the wizard changed, and the header-vs-FC PID check. Everything except load/save is pure.
 * Wizard state and backups live in localStorage (like the settings and the last diff backup), iterations in memory.
 */
import { emptyParts, type Parts, type Pid3 } from './parts';

export const STEPS = ['parts', 'backup', 'prepare', 'flight', 'import', 'propose'] as const;
export type StepId = (typeof STEPS)[number];

export interface WizardState {
  v: 1;
  step: StepId;
  /** Furthest step reached (the stepper lets the user jump back to any step up to it). */
  reached: StepId;
  parts: Parts;
  /** Name of the backup made in step 2 (must exist before step 3). */
  backup: string | null;
  /** Manual checklist items ticked in step 3. */
  ticks: { battery: boolean; space: boolean };
  /** Checklist items fixed through applyCommands (the FC may confirm them only after the reboot / re-read). */
  fixed: string[];
  /** Values before the wizard changed them (CLI key -> old value), for the restore. The first recorded value wins. */
  undo: Record<string, string>;
  beep: boolean;
}

export const initialState = (): WizardState => ({ v: 1, step: 'parts', reached: 'parts', parts: emptyParts(), backup: null, ticks: { battery: false, space: false }, fixed: [], undo: {}, beep: false });

export const stepIndex = (s: StepId): number => STEPS.indexOf(s);

export interface GateInput {
  backup: string | null;
  armed: boolean;
  ticks: { battery: boolean; space: boolean };
  hasLog: boolean;
}

/** Why a step cannot be entered yet (null = it can). */
export type Block = 'needBackup' | 'armed' | 'needTicks' | 'needLog';

export function blockFor(step: StepId, g: GateInput): Block | null {
  const i = stepIndex(step);
  if (i >= stepIndex('prepare') && !g.backup) return 'needBackup';
  if (i >= stepIndex('prepare') && g.armed) return 'armed';
  if (i >= stepIndex('flight') && !(g.ticks.battery && g.ticks.space)) return 'needTicks';
  if (i >= stepIndex('propose') && !g.hasLog) return 'needLog';
  return null;
}

/** Moves to `to` when allowed; returns the new state (unchanged when blocked). */
export function go(s: WizardState, to: StepId, g: GateInput): WizardState {
  if (blockFor(to, g)) return s;
  const reached = stepIndex(to) > stepIndex(s.reached) ? to : s.reached;
  return { ...s, step: to, reached };
}

/** before-pid-YYYY-MM-DD-HHmm (local time). */
export function backupName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `before-pid-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** "set p_roll = 48" -> { key: 'p_roll', value: '48' }. */
export function parseSet(cmd: string): { key: string; value: string } | null {
  const m = /^\s*set\s+([a-z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(cmd);
  return m ? { key: m[1]!.toLowerCase(), value: m[2]! } : null;
}

/** Records the old value of every `set` command (only keys not recorded yet, so the restore goes back to the start). */
export function recordUndo(undo: Record<string, string>, commands: string[], old: Record<string, string>): Record<string, string> {
  const next = { ...undo };
  for (const c of commands) {
    const s = parseSet(c);
    if (s && !(s.key in next) && old[s.key] !== undefined) next[s.key] = old[s.key]!;
  }
  return next;
}

/**
 * Commands that bring the FC back to the backup: the `set` lines of the diff (with its `profile` / `rateprofile`
 * switches, so PIDs land in the right profile) plus the recorded old values of keys the diff does not list
 * (a key missing from `diff all` was at its default before the wizard changed it).
 * Lines the app refuses (defaults, save, ...) and board identity lines are left out.
 */
export function restoreCommands(diff: string, undo: Record<string, string>): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  for (const raw of diff.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const s = parseSet(line);
    if (s) {
      out.push(`set ${s.key} = ${s.value}`);
      keys.add(s.key);
    } else if (/^(profile|rateprofile)\s+\d+$/i.test(line)) out.push(line.toLowerCase());
  }
  for (const [k, v] of Object.entries(undo)) if (!keys.has(k)) out.push(`set ${k} = ${v}`);
  return out;
}

/** Axes whose P/I/D in the log header differ from the FC's current PIDs. */
export function pidMismatch(header: Pid3 | null | undefined, fc: Pid3 | null | undefined): Array<'roll' | 'pitch' | 'yaw'> {
  if (!header || !fc) return [];
  return (['roll', 'pitch', 'yaw'] as const).filter((a) => header[a].some((v, i) => v !== fc[a][i]));
}

/** Old values for the PID keys of the FC (for recordUndo before applying a proposal). */
export function pidOld(fc: Pid3 | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fc) return out;
  for (const a of ['roll', 'pitch', 'yaw'] as const) {
    out[`p_${a}`] = String(fc[a][0]);
    out[`i_${a}`] = String(fc[a][1]);
    out[`d_${a}`] = String(fc[a][2]);
  }
  return out;
}

/* ---------------- iterations (memory only) ---------------- */

export interface AxisMetrics {
  overshoot: number | null;
  rise: number | null;
  settle: number | null;
}

export interface Iteration {
  n: number;
  at: number;
  name: string;
  score: number;
  axes: [AxisMetrics, AxisMetrics, AxisMetrics];
  /** Commands applied after this log (empty = nothing applied). */
  applied: string[];
}

/** Change of a metric between two iterations: 'better' | 'worse' | 'same' (overshoot and times: lower is better). */
export function trend(prev: number | null, cur: number | null, tol = 1): 'better' | 'worse' | 'same' | null {
  if (prev === null || cur === null) return null;
  if (Math.abs(cur - prev) <= tol) return 'same';
  return cur < prev ? 'better' : 'worse';
}

/* ---------------- persistence ---------------- */

const KEY = 'workspacefpv.pidWizard.v1';
const BACKUPS_KEY = 'workspacefpv.pidBackups.v1';
/** Named backups kept in localStorage (each is a full diff all; the files are downloaded too). */
export const MAX_BACKUPS = 5;

export function loadState(): WizardState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialState();
    const s = JSON.parse(raw) as Partial<WizardState>;
    if (s.v !== 1) return initialState();
    const base = initialState();
    return { ...base, ...s, parts: { ...base.parts, ...(s.parts ?? {}) }, ticks: { ...base.ticks, ...(s.ticks ?? {}) } };
  } catch {
    return initialState();
  }
}

export function saveState(s: WizardState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* no storage: the wizard keeps working in memory */
  }
}

export interface NamedBackup {
  name: string;
  at: number;
  text: string;
}

export function loadBackups(): NamedBackup[] {
  try {
    const raw = localStorage.getItem(BACKUPS_KEY);
    const list = raw ? (JSON.parse(raw) as NamedBackup[]) : [];
    return Array.isArray(list) ? list.filter((b) => b && typeof b.name === 'string' && typeof b.text === 'string') : [];
  } catch {
    return [];
  }
}

/** Adds a backup (newest first, at most MAX_BACKUPS; a backup with the same name is replaced). */
export function addBackup(list: NamedBackup[], b: NamedBackup): NamedBackup[] {
  return [b, ...list.filter((x) => x.name !== b.name)].slice(0, MAX_BACKUPS);
}

export function saveBackups(list: NamedBackup[]): boolean {
  try {
    localStorage.setItem(BACKUPS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
