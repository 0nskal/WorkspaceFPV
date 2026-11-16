/** CRC helpers shared by the 4-way interface (CRC-16/XMODEM) and CRSF / MSP v2 (CRC-8 poly 0xD5). */

/** CRC-16/XMODEM: poly 0x1021, init 0, MSB first, no reflection. Check value for "123456789" is 0x31C3. */
export function crc16Xmodem(data: ArrayLike<number>, init = 0): number {
  let crc = init & 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] & 0xff) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** CRC-8 DVB-S2: poly 0xD5, init 0. Used by CRSF frames and MSP v2 frames. */
export function crc8D5(data: ArrayLike<number>, init = 0): number {
  let crc = init & 0xff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] & 0xff;
    for (let b = 0; b < 8; b++) crc = crc & 0x80 ? ((crc << 1) ^ 0xd5) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

export const hex = (d: ArrayLike<number>, sep = ' '): string => Array.from({ length: d.length }, (_, i) => (d[i] & 0xff).toString(16).padStart(2, '0')).join(sep);
