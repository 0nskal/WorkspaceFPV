/**
 * `?demo=usb`: the simulated quad is plugged in over USB without a battery, like most first connections.
 * No battery voltage, ESCs off (no motor output, no DShot telemetry), receiver off (RX_FAILSAFE) and an
 * unpowered external compass that piles up I2C errors.
 */
export const demoUsbOnly = (): boolean => {
  try {
    return new URLSearchParams(location.search).get('demo') === 'usb';
  } catch {
    return false;
  }
};
