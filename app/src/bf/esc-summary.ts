/** Condenses an ESC scan for the diagnosis and the AI context: which firmware runs where, and what it means for bidirectional DShot. */
import { supportsBidir } from './esc-eeprom';
import type { EscDevice, EscScan } from './esc-flow';

export interface EscFwGroup {
  /** "Bluejay 0.21", "BLHeli_32", ... */
  name: string;
  /** 1-based motor numbers. */
  motors: number[];
}

export interface EscFwSummary {
  groups: EscFwGroup[];
  /** 'no' as soon as one ESC runs firmware without bidirectional DShot; 'yes' only when every answering ESC supports it. */
  bidir: 'yes' | 'no' | 'unknown';
  /** Groups that cannot do bidirectional DShot (for the message). */
  blockers: EscFwGroup[];
}

export function escLabel(e: EscDevice): string | null {
  if (e.status !== 'ok') return null;
  if (e.settings && e.settings.firmware !== 'unknown') return `${e.settings.firmwareName}${e.settings.version ? ' ' + e.settings.version : ''}`;
  if (e.firmware === 'blheli_32') return 'BLHeli_32';
  if (e.firmware === 'am32') return 'AM32';
  if (e.firmware === 'blheli_atmel') return 'BLHeli (Atmel)';
  return null;
}

/** null when there is no scan or no ESC answered. */
export function summarizeEsc(scan: EscScan | undefined): EscFwSummary | null {
  if (!scan) return null;
  const answered = scan.escs.filter((e) => e.status === 'ok');
  if (!answered.length) return null;
  const byName = new Map<string, EscFwGroup>();
  const verdicts: Array<'yes' | 'no' | 'unknown'> = [];
  const blockerNames = new Set<string>();
  for (const e of answered) {
    const name = escLabel(e) ?? 'unknown';
    const g = byName.get(name) ?? { name, motors: [] };
    g.motors.push(e.index + 1);
    byName.set(name, g);
    const v = supportsBidir(e.firmware);
    verdicts.push(v);
    if (v === 'no') blockerNames.add(name);
  }
  const groups = [...byName.values()];
  const bidir = verdicts.includes('no') ? 'no' : verdicts.every((v) => v === 'yes') ? 'yes' : 'unknown';
  return { groups, bidir, blockers: groups.filter((g) => blockerNames.has(g.name)) };
}

/** "Bluejay 0.21 (M1, M2, M4), unknown (M3)" */
export function describeGroups(groups: EscFwGroup[]): string {
  return groups.map((g) => `${g.name} (${g.motors.map((m) => 'M' + m).join(', ')})`).join(', ');
}
