/** Dane i logika ekranu ELRS: protokol RX, zgodnosc wersji, trwale pola checklisty. */

import { t } from '../i18n';

export const FLASHER_URL = 'https://expresslrs.github.io/web-flasher/';

const PROVIDERS = ['SPEKTRUM1024', 'SPEKTRUM2048', 'SBUS', 'SUMD', 'SUMH', 'XBUS_MODE_B', 'XBUS_MODE_B_RJ01', 'IBUS', 'JETIEXBUS', 'CRSF', 'SRXL', 'CUSTOM', 'FPORT', 'SRXL2', 'GHST'];

export function providerLabel(p: number): { text: string; elrs: boolean } {
  if (p === 9) return { text: 'CRSF (ExpressLRS)', elrs: true };
  return { text: PROVIDERS[p] ?? t('elrs.providerUnknown', { p }), elrs: false };
}

/** Glowna wersja z "3.4.3" -> 3; null gdy nie da sie odczytac. */
export function majorOf(v: string): number | null {
  const m = /^\s*v?(\d+)\./.exec(v) ?? /^\s*v?(\d+)\s*$/.exec(v);
  return m ? Number(m[1]) : null;
}

export type Compat = { kind: 'unknown' | 'ok' | 'warn'; text: string };

export function compat(rx: string, tx: string): Compat {
  const a = majorOf(rx);
  const b = majorOf(tx);
  if (a === null || b === null) return { kind: 'unknown', text: t('elrs.compatUnknown') };
  if (a === b) return { kind: 'ok', text: t('elrs.compatOk', { a }) };
  return { kind: 'warn', text: t('elrs.compatWarn', { a, b }) };
}

export type Region = 'LBT' | 'FCC' | '';
export type Method = 'passthrough' | 'wifi' | '';

export interface ElrsLocal {
  txVersion: string;
  phrase: boolean;
  region: Region;
  method: Method;
  verified: boolean;
}

const KEY = 'rotorlab.elrs.v1';
const EMPTY: ElrsLocal = { txVersion: '', phrase: false, region: '', method: '', verified: false };

export function loadLocal(): ElrsLocal {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<ElrsLocal>) };
  } catch {
    /* brak localStorage */
  }
  return { ...EMPTY };
}

export function saveLocal(l: ElrsLocal): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* ignore */
  }
}
