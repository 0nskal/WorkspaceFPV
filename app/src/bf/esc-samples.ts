/** Synthetic ESC settings blocks (same offsets as the real layouts). Used by the demo device and by the unit tests. */

const put = (d: Uint8Array, off: number, s: string, len: number): void => {
  for (let i = 0; i < len; i++) d[off + i] = i < s.length ? s.charCodeAt(i) : 0;
};

export interface SilabsSample {
  main: number;
  sub: number;
  layoutRev?: number;
  layout?: string;
  mcu?: string;
  name: string;
  direction?: number;
  pwm?: number;
  timing?: number;
}

/** 0xFF-byte EFM8 EEPROM image (BLHeli_S fills the first 0x70, Bluejay uses everything). */
export function buildSilabs(s: SilabsSample): Uint8Array {
  const d = new Uint8Array(0xff).fill(0xff);
  d[0] = s.main;
  d[1] = s.sub;
  d[2] = s.layoutRev ?? 208;
  d[0x04] = 150; // startup power min (Bluejay)
  d[0x05] = 1; // startup beep
  d[0x06] = 1; // dithering
  d[0x07] = 255; // startup power max
  d[0x09] = 9; // startup power (BLHeli_S)
  d[0x0a] = s.pwm ?? 48;
  d[0x0b] = s.direction ?? 1;
  d[0x10] = 255; // braking strength
  d[0x15] = s.timing ?? 3;
  d[0x1b] = 40;
  d[0x1c] = 80;
  d[0x1d] = 4; // 10 min
  d[0x1f] = 2;
  d[0x23] = 4; // 100 C
  d[0x27] = 0;
  d[0x2a] = 1;
  put(d, 0x40, s.layout ?? '#S_H_90#', 16);
  put(d, 0x50, s.mcu ?? '#BLHELI$EFM8B21#', 16);
  put(d, 0x60, s.name, 16);
  return d;
}

export const bluejaySample = (): Uint8Array => buildSilabs({ main: 0, sub: 21, name: 'Bluejay', pwm: 48 });
export const blheliSSample = (): Uint8Array => buildSilabs({ main: 16, sub: 7, layoutRev: 33, name: 'BLHELI_S', pwm: 24 });
/** An ESC whose settings page was erased or written by something we do not know. */
export const garbageSample = (): Uint8Array => new Uint8Array(0xff).fill(0xff);

/** AM32 EEPROM image (0xB0 bytes). */
export function am32Sample(): Uint8Array {
  const d = new Uint8Array(0xb0);
  d[0] = 1;
  d[1] = 1;
  d[2] = 3;
  d[3] = 2; // MAIN
  d[4] = 16; // SUB
  put(d, 0x05, 'AM32', 12);
  d[0x11] = 0; // direction normal
  d[0x12] = 1; // bidirectional DShot
  d[0x14] = 1;
  d[0x15] = 1;
  d[0x17] = 2; // 15 deg
  d[0x18] = 24;
  d[0x19] = 100;
  d[0x1a] = 55; // 2220 kV placeholder
  d[0x1b] = 14;
  d[0x1c] = 0;
  d[0x1d] = 1;
  d[0x1e] = 5;
  return d;
}

export function am32FileName(name = 'FOXEER_F051'): Uint8Array {
  const d = new Uint8Array(16);
  put(d, 0, name, 16);
  return d;
}
