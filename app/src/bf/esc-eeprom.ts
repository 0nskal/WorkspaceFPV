/**
 * ESC settings layouts, decode only (read-only). BLHeli_S, Bluejay (EFM8 / SiLabs) and AM32 (ARM).
 * BLHeli_32 is closed: only the MCU signature is known. Offsets: design/BETAFLIGHT-PARITY.md section 6.4.
 * Decoders never throw: a block that does not look like a known layout yields `firmware: 'unknown'`.
 */

export type EscFirmware = 'bluejay' | 'blheli_s' | 'jesc' | 'blheli_m' | 'am32' | 'blheli_32' | 'blheli_atmel' | 'unknown';

/** Where to read the settings block and how many bytes. */
export interface EepromLocation {
  /** 16-bit address for DEVICE_READ. */
  addr: number;
  len: number;
  /** AM32 only: the firmware file name sits `nameBefore` bytes before the EEPROM block. */
  nameBefore?: number;
}

export interface EscField {
  id: string;
  /** 'text' = already readable ("24 kHz"); 'enum' = string key translated by the UI; 'bool'; 'num'. */
  kind: 'text' | 'enum' | 'bool' | 'num';
  value: string | number | boolean;
  unit?: string;
}

export interface EscSettings {
  firmware: EscFirmware;
  /** "Bluejay", "BLHeli_S", "AM32", ... */
  firmwareName: string;
  /** "0.21" (MAIN.SUB), null when unknown. */
  version: string | null;
  /** Hardware layout (SiLabs: "#S_H_90#") or AM32 target file name. */
  target: string | null;
  /** SiLabs MCU string ("#BLHELI$EFM8B21#"). */
  mcuString: string | null;
  fields: EscField[];
}

const ascii = (d: Uint8Array, from: number, len: number): string => {
  let s = '';
  for (let i = from; i < from + len && i < d.length; i++) {
    const c = d[i];
    if (c === 0) break;
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '�';
  }
  return s.trim();
};
const printable = (d: Uint8Array, from: number, len: number): boolean => {
  let n = 0;
  for (let i = from; i < from + len && i < d.length; i++) {
    const c = d[i];
    if (c === 0) break;
    if (c < 0x20 || c >= 0x7f) return false;
    n++;
  }
  return n > 0;
};
const at = (d: Uint8Array, i: number): number => (i < d.length ? d[i] : 0xff);

/* ---------------- MCU table ---------------- */

export interface McuInfo {
  name: string;
  family: 'silabs' | 'arm' | 'atmel' | 'unknown';
}

/** MCU signature -> name (from the 4-way DEVICE_INIT_FLASH answer). Unknown signatures are still reported. */
export function mcuFromSignature(sig: number, mode: number): McuInfo {
  switch (sig) {
    case 0xe8b1:
      return { name: 'EFM8BB10', family: 'silabs' };
    case 0xe8b2:
      return { name: 'EFM8BB21', family: 'silabs' };
    case 0xe8b5:
      return { name: 'EFM8BB51', family: 'silabs' };
    case 0x1f06:
      return { name: 'STM32F051', family: 'arm' };
    case 0x3506:
      return { name: 'ARM 64K', family: 'arm' };
    default:
      return { name: `0x${sig.toString(16).toUpperCase().padStart(4, '0')}`, family: mode === 4 ? 'arm' : mode === 2 || mode === 3 ? 'atmel' : mode === 0 || mode === 1 ? 'silabs' : 'unknown' };
  }
}

/** AM32 bootloader pin codes in the INIT_FLASH answer (b2): PA2, PB4, PA6. */
export const AM32_BOOT_PINS: ReadonlySet<number> = new Set([0x02, 0x14, 0x06]);

/** Settings block location per MCU, or null when we do not know where it is (then nothing is read). */
export function eepromLocation(family: McuInfo['family'], sig: number, firmwareHint: 'am32' | 'silabs'): EepromLocation | null {
  if (family === 'silabs' && firmwareHint === 'silabs') {
    // 0xFF bytes covers BLHeli_S (0x70) and Bluejay (melody + wait time); EEPROM page start per MCU.
    if (sig === 0xe8b5) return { addr: 0x3000, len: 0xff };
    if (sig === 0xe8b1 || sig === 0xe8b2) return { addr: 0x1a00, len: 0xff };
    return null;
  }
  if (family === 'arm' && firmwareHint === 'am32') {
    if (sig === 0x1f06) return { addr: 0x7c00, len: 0xb0, nameBefore: 32 };
    if (sig === 0x3506) return { addr: 0xf800, len: 0xb0, nameBefore: 32 };
    return null; // newer AM32 MCUs: detected, settings not decoded
  }
  return null;
}

/* ---------------- SiLabs: BLHeli_S / Bluejay ---------------- */

const DIRECTION_SIL = ['', 'normal', 'reversed', 'bidir', 'bidirReversed'];
const TIMING = ['', 'low', 'medLow', 'med', 'medHigh', 'high'];
const BEACON_DELAY_MIN = [0, 1, 2, 5, 10]; // 5 = infinite

function pwmField(v: number): EscField | null {
  if (v === 0xff || v === 0) return null;
  if (v === 192) return { id: 'pwm', kind: 'enum', value: 'dynamic' };
  if (v === 24 || v === 48 || v === 96) return { id: 'pwm', kind: 'text', value: `${v} kHz` };
  return { id: 'pwm', kind: 'num', value: v };
}

/** Decodes a SiLabs EEPROM block (>= 0x70 bytes; Bluejay uses 0xFF). */
export function decodeSilabs(d: Uint8Array): EscSettings {
  const unknown: EscSettings = { firmware: 'unknown', firmwareName: '', version: null, target: null, mcuString: null, fields: [] };
  if (d.length < 0x70) return unknown;
  const layoutName = ascii(d, 0x40, 16);
  const mcuString = ascii(d, 0x50, 16);
  const name = ascii(d, 0x60, 16);
  // Real BLHeli_S / Bluejay blocks carry "#LAYOUT#" and "#BLHELI$MCU#" tags; erased or foreign data does not.
  if (!/^#.*#$/.test(layoutName) || !/^#BLHELI\$/.test(mcuString)) return unknown;
  const main = d[0];
  const sub = d[1];

  let firmware: EscFirmware;
  let firmwareName: string;
  if (/^bluejay/i.test(name)) {
    firmware = 'bluejay';
    firmwareName = 'Bluejay';
  } else if (/^jesc/i.test(name)) {
    firmware = 'jesc';
    firmwareName = 'JESC';
  } else if (/^blheli_?s/i.test(name)) {
    firmware = 'blheli_s';
    firmwareName = 'BLHeli_S';
  } else if (name === '' && main === 16 && (sub === 8 || sub === 9)) {
    firmware = 'blheli_m';
    firmwareName = 'BLHeli_M';
  } else {
    return { ...unknown, target: layoutName, mcuString };
  }

  let version = `${main}.${sub}`;
  if (firmware === 'bluejay') {
    // Optional patch number in the NAME suffix ("Bluejay, 0.21.1" style). Without one the display stays MAIN.SUB.
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(name);
    if (m && Number(m[1]) === main && Number(m[2]) === sub) version = `${main}.${sub}.${m[3]}`;
  }

  const f: EscField[] = [];
  const dir = DIRECTION_SIL[at(d, 0x0b)];
  if (dir) f.push({ id: 'direction', kind: 'enum', value: dir });
  const pwm = pwmField(at(d, 0x0a));
  if (pwm) f.push(pwm);
  const tm = TIMING[at(d, 0x15)];
  if (tm) f.push({ id: 'timing', kind: 'enum', value: tm });
  const demag = ['', 'off', 'low', 'high'][at(d, 0x1f)];
  if (demag) f.push({ id: 'demag', kind: 'enum', value: demag });
  if (firmware === 'bluejay') {
    f.push({ id: 'startupPower', kind: 'text', value: `${at(d, 0x04)}–${at(d, 0x07)}` });
    f.push({ id: 'startupBeep', kind: 'bool', value: at(d, 0x05) !== 0 });
    f.push({ id: 'dithering', kind: 'bool', value: at(d, 0x06) !== 0 });
    f.push({ id: 'brakingStrength', kind: 'num', value: at(d, 0x10) });
    f.push({ id: 'forceEdtArm', kind: 'bool', value: at(d, 0x2a) !== 0 });
  } else {
    f.push({ id: 'startupPower', kind: 'num', value: at(d, 0x09) });
  }
  f.push({ id: 'beepStrength', kind: 'num', value: at(d, 0x1b) });
  f.push({ id: 'beaconStrength', kind: 'num', value: at(d, 0x1c) });
  const bd = at(d, 0x1d);
  if (bd >= 1 && bd <= 5) f.push(bd === 5 ? { id: 'beaconDelay', kind: 'enum', value: 'infinite' } : { id: 'beaconDelay', kind: 'num', value: BEACON_DELAY_MIN[bd], unit: 'min' });
  f.push({ id: 'brakeOnStop', kind: 'bool', value: at(d, 0x27) !== 0 });
  const tp = at(d, 0x23);
  if (tp === 1) f.push({ id: 'tempProtection', kind: 'enum', value: 'off' });
  else if (tp >= 2 && tp <= 7) f.push({ id: 'tempProtection', kind: 'num', value: 60 + 10 * tp, unit: '°C' });

  return { firmware, firmwareName, version, target: layoutName, mcuString, fields: f };
}

/* ---------------- ARM: AM32 ---------------- */

/** Decodes an AM32 EEPROM block (0xB0 bytes) plus the optional file name read before the block. */
export function decodeAm32(d: Uint8Array, fileName?: Uint8Array): EscSettings {
  const unknown: EscSettings = { firmware: 'unknown', firmwareName: '', version: null, target: null, mcuString: null, fields: [] };
  if (d.length < 0x30) return unknown;
  // Boot byte 0x01 marks a written AM32 settings page; the name field must be readable text.
  if (d[0] !== 0x01 || !printable(d, 0x05, 12)) return unknown;
  const target = fileName && printable(fileName, 0, Math.min(16, fileName.length)) ? ascii(fileName, 0, 16) : ascii(d, 0x05, 12);
  const f: EscField[] = [];
  f.push({ id: 'direction', kind: 'enum', value: at(d, 0x11) === 1 ? 'reversed' : 'normal' });
  f.push({ id: 'bidirMode', kind: 'bool', value: at(d, 0x12) === 1 });
  f.push({ id: 'timing', kind: 'num', value: +(at(d, 0x17) * 7.5).toFixed(1), unit: '°' });
  f.push({ id: 'pwm', kind: 'num', value: at(d, 0x18), unit: 'kHz' });
  f.push({ id: 'variablePwm', kind: 'bool', value: at(d, 0x15) === 1 });
  f.push({ id: 'complementaryPwm', kind: 'bool', value: at(d, 0x14) === 1 });
  f.push({ id: 'startupPower', kind: 'num', value: at(d, 0x19) });
  f.push({ id: 'motorKv', kind: 'num', value: at(d, 0x1a) * 40 + 20 });
  f.push({ id: 'poles', kind: 'num', value: at(d, 0x1b) });
  f.push({ id: 'brakeOnStop', kind: 'bool', value: at(d, 0x1c) === 1 });
  f.push({ id: 'stallProtection', kind: 'bool', value: at(d, 0x1d) === 1 });
  f.push({ id: 'beepStrength', kind: 'num', value: at(d, 0x1e) });
  f.push({ id: 'telemetryInterval', kind: 'num', value: at(d, 0x1f) });
  return { firmware: 'am32', firmwareName: 'AM32', version: `${d[0x03]}.${d[0x04]}`, target, mcuString: null, fields: f };
}

export function unknownSettings(): EscSettings {
  return { firmware: 'unknown', firmwareName: '', version: null, target: null, mcuString: null, fields: [] };
}

/** Whether this firmware supports bidirectional DShot (needed for the RPM filter). */
export function supportsBidir(fw: EscFirmware): 'yes' | 'no' | 'unknown' {
  switch (fw) {
    case 'bluejay':
    case 'am32':
    case 'blheli_32':
      return 'yes';
    case 'blheli_s':
    case 'jesc':
    case 'blheli_m':
    case 'blheli_atmel':
      return 'no';
    default:
      return 'unknown';
  }
}
