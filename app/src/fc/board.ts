import type { FcInfo } from './state';

const KNOWN: Record<string, string> = {
  SPEEDYBEEF405V4: 'SpeedyBee F405 V4',
  SPEEDYBEEF405V3: 'SpeedyBee F405 V3',
  SPEEDYBEEF405WING: 'SpeedyBee F405 Wing',
  SPEEDYBEEF745AIO: 'SpeedyBee F745 AIO',
  MATEKH743: 'Matek H743',
  MATEKF405: 'Matek F405',
};

/** Czytelna nazwa plyty FC z BOARD_INFO (np. SPEEDYBEEF405V4 -> SpeedyBee F405 V4). */
export function boardDisplayName(info: FcInfo | null): string {
  if (!info) return 'FC';
  const raw = (info.boardName || info.boardId || '').trim();
  if (KNOWN[raw.toUpperCase()]) return KNOWN[raw.toUpperCase()];
  if (!raw) return info.boardId || 'FC';
  // "NAZWAF405V4" -> "NAZWA F405 V4" tylko gdy nazwa jest cala wielkimi literami
  if (raw === raw.toUpperCase()) {
    return raw.replace(/([A-Z]+?)([FGH]\d{3})/, '$1 $2').replace(/(\d)(V\d)/, '$1 $2');
  }
  return raw;
}

export function firmwareName(info: FcInfo | null): string {
  if (!info) return '';
  const names: Record<string, string> = { BTFL: 'Betaflight', INAV: 'iNav', EMUF: 'EmuFlight', KISS: 'KISS' };
  return `${names[info.variant] ?? info.variant} ${info.version}`;
}
