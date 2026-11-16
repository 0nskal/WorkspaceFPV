/** MSP_STATUS_EX (150) decoder: profile indexes/counts and the flight-mode bit field (spec 3.2). */
import { readField } from './fieldtable';

export interface StatusEx {
  cycleTimeUs: number;
  sensors: number;
  /** Bit k = k-th box of MSP_BOXIDS is active (spec: "indexed by box id order"). */
  modeFlags: boolean[];
  pidProfile: number;
  pidProfileCount: number;
  rateProfile: number;
  /** API >= 1.47 only; null when the firmware does not report it. */
  rateProfileCount: number | null;
  armingDisableFlags: number;
  rebootRequired: boolean;
}

export function decodeStatusEx(p: Uint8Array, api: number): StatusEx {
  const u8 = (o: number) => readField(p, o, 'u8') ?? 0;
  const u16 = (o: number) => readField(p, o, 'u16') ?? 0;
  const flags32 = readField(p, 6, 'u32') ?? 0;
  const nExtra = u8(15);
  const modeFlags: boolean[] = [];
  for (let i = 0; i < 32; i++) modeFlags.push(((flags32 >>> i) & 1) === 1);
  for (let i = 0; i < nExtra; i++) for (let b = 0; b < 8; b++) modeFlags.push(((u8(16 + i) >>> b) & 1) === 1);
  let o = 16 + nExtra;
  o += 1; // arming-disable flag count
  const armingDisableFlags = readField(p, o, 'u32') ?? 0;
  o += 4;
  const configState = u8(o);
  o += 1;
  if (api >= 46) o += 2; // MCU temperature
  const rateProfileCount = api >= 47 && o < p.length ? u8(o) : null;
  return {
    cycleTimeUs: u16(0),
    sensors: u16(4),
    modeFlags,
    pidProfile: u8(10),
    pidProfileCount: Math.max(1, u8(13) || 3),
    rateProfile: u8(14),
    rateProfileCount,
    armingDisableFlags,
    rebootRequired: (configState & 1) === 1,
  };
}
