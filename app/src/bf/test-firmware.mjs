// Reference values computed from the Betaflight firmware source (src/main/fc/rc.c apply*Rates and the throttle curve,
// runtime_config.h, io/beeper.h, io/serial.h; 4.5-maintenance = API 1.46, 2025.12 = API 1.47, master = API 1.49).
// The numbers below come from a literal port of the C code, not from this app's formulas. Run:
//   npx esbuild app/src/bf/test-firmware.mjs --bundle --platform=node --format=esm --outfile=%TEMP%/bf-fw-test.mjs && node %TEMP%/bf-fw-test.mjs
import { rateAt, throttleCurve } from './tuning.ts';
import { armingTable } from './arming.ts';
import { beeperTable, serialPortName, decodeStatusEx } from './decode.ts';

let fails = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
};

/* ---------- rates: raw MSP_RC_TUNING bytes -> deg/s at stick 0, .25, .5, .75, 1 (rate_limit 1998) ---------- */
const XS = [0, 0.25, 0.5, 0.75, 1];
const RATES = [
  ['betaflight', { rcRate: 100, expo: 0, superRate: 70 }, [0, 60.61, 153.85, 315.79, 666.67]],
  ['betaflight', { rcRate: 120, expo: 30, superRate: 73 }, [0, 51.72, 139.37, 328.8, 888.89]],
  ['betaflight', { rcRate: 250, expo: 10, superRate: 50 }, [0, 503.33, 1188.68, 1998, 1998]],
  ['raceflight', { rcRate: 37, expo: 25, superRate: 65 }, [0, 82.33, 199.16, 367.63, 610.5]],
  ['raceflight', { rcRate: 50, expo: 0, superRate: 30 }, [0, 134.38, 287.5, 459.38, 650]],
  ['kiss', { rcRate: 100, expo: 0, superRate: 70 }, [0, 60.61, 153.85, 315.79, 666.67]],
  ['kiss', { rcRate: 120, expo: 30, superRate: 73 }, [0, 52.75, 146.46, 345.58, 888.89]],
  ['actual', { rcRate: 7, expo: 54, superRate: 67 }, [0, 34.83, 109.06, 265.42, 670]],
  ['actual', { rcRate: 20, expo: 0, superRate: 80 }, [0, 87.5, 250, 487.5, 800]],
  ['quick', { rcRate: 100, expo: 0, superRate: 67 }, [0, 60.63, 154.02, 316.54, 670]],
  ['quick', { rcRate: 50, expo: 30, superRate: 80 }, [0, 29.66, 75.65, 174.47, 800]],
];
for (const [type, r, want] of RATES) {
  const got = XS.map((x) => rateAt(type, { ...r, limit: 1998 }, x));
  const neg = XS.map((x) => rateAt(type, { ...r, limit: 1998 }, -x));
  const ok = got.every((v, i) => Math.abs(v - want[i]) <= 0.05) && neg.every((v, i) => Math.abs(v + want[i]) <= 0.05);
  check(`rates ${type} ${r.rcRate}/${r.expo}/${r.superRate}`, ok, ok ? '' : `got ${got.map((v) => v.toFixed(2))} neg ${neg.map((v) => v.toFixed(2))}`);
}
check('rate limit clamps', Math.abs(rateAt('betaflight', { rcRate: 100, expo: 0, superRate: 70, limit: 500 }, 1) - 500) < 1e-9);

/* ---------- throttle: stick PWM 1000..2000 -> output PWM ---------- */
const STICKS = [1000, 1250, 1500, 1750, 2000];
const pwm = (mid, expo, us, opts) => Math.round(1000 + 1000 * throttleCurve(mid, expo, (us - 1000) / 1000, opts));
const THR = [
  [50, 0, 50, 46, [1000, 1250, 1500, 1750, 2000]],
  [40, 50, 50, 46, [1000, 1311, 1451, 1637, 2000]],
  [50, 0, 50, 47, [1000, 1250, 1500, 1750, 2000]],
  [40, 50, 50, 47, [1000, 1369, 1550, 1732, 2000]],
];
for (const [mid, expo, hover, api, want] of THR) {
  const got = STICKS.map((us) => pwm(mid, expo, us, { hover, api }));
  check(`throttle mid ${mid} expo ${expo} hover ${hover} api 1.${api}`, got.every((v, i) => Math.abs(v - want[i]) <= 1), `got ${got}`);
}

/* ---------- arming-disable flags (runtime_config.h) ---------- */
const name = (tbl, bit) => tbl.find((f) => f.bit === bit)?.name;
const a46 = armingTable(46, 26);
check('arming 4.5: 20 DSHOT_TELEM, 24 MOTOR_PROTOCOL, 25 ARM_SWITCH', name(a46, 20) === 'DSHOT_TELEM' && name(a46, 24) === 'MOTOR_PROTOCOL' && name(a46, 25) === 'ARM_SWITCH' && a46.length === 26);
const a47 = armingTable(47, 0);
check('arming 2025.12 (no count): 25 CRASHFLIP, 26 ALTHOLD, 27 POSHOLD, 28 ARM_SWITCH', name(a47, 25) === 'CRASHFLIP' && name(a47, 26) === 'ALTHOLD' && name(a47, 27) === 'POSHOLD' && name(a47, 28) === 'ARM_SWITCH' && a47.length === 29);
const a49 = armingTable(49, 30);
check('arming master: 28 AUTOPILOT, 29 ARM_SWITCH', name(a49, 28) === 'AUTOPILOT' && name(a49, 29) === 'ARM_SWITCH');
check('arming base bits', name(a46, 0) === 'NO_GYRO' && name(a46, 7) === 'THROTTLE' && name(a46, 16) === 'MSP' && name(a46, 19) === 'RESC' && name(a46, 21) === 'REBOOT_REQUIRED');

/* ---------- beeper mask bits (beeperMode_e - 1) ---------- */
const b46 = new Map(beeperTable(46).map(([bit, n]) => [n, bit]));
const b47 = new Map(beeperTable(47).map(([bit, n]) => [n, bit]));
check('beeper 4.5: RC_SMOOTHING_INIT_FAIL 22, ARMING_GPS_NO_FIX 23', b46.get('RC_SMOOTHING_INIT_FAIL') === 22 && b46.get('ARMING_GPS_NO_FIX') === 23);
check('beeper 2025.12: ARMING_GPS_NO_FIX 22, no RC smoothing', b47.get('ARMING_GPS_NO_FIX') === 22 && !b47.has('RC_SMOOTHING_INIT_FAIL'));
check('beeper common bits', b46.get('GYRO_CALIBRATED') === 0 && b46.get('READY_BEEP') === 12 && b46.get('DISARM_REPEAT') === 14 && b46.get('CRASH_FLIP_MODE') === 19 && ![...b46.values()].includes(13));

/* ---------- serial port identifiers ---------- */
check('serial ids 4.5', serialPortName(0) === 'UART1' && serialPortName(5) === 'UART6' && serialPortName(20) === 'USB VCP' && serialPortName(30) === 'SOFTSERIAL1' && serialPortName(40) === 'LPUART1');
check('serial ids 2025.12', serialPortName(51) === 'UART1' && serialPortName(56) === 'UART6' && serialPortName(50) === 'UART0' && serialPortName(70) === 'PIOUART0');

/* ---------- MSP_STATUS_EX layout (msp.c) ---------- */
{
  // cycle 125, i2c 0, sensors 0x23, modes 0b1 + 1 extra byte (box 32 active), pid 2, cpu 14, pidCount 4, rate 1,
  // extra count 1 [0x01], arming count 29, arming flags bit 28, config 1, cpu temp 41, rate profile count 4
  const p = Uint8Array.from([125, 0, 0, 0, 0x23, 0, 1, 0, 0, 0, 2, 14, 0, 4, 1, 1, 0x01, 29, 0, 0, 0, 0x10, 1, 41, 0, 4]);
  const s = decodeStatusEx(p, 47);
  check('status_ex fields', s.cycleTimeUs === 125 && s.sensors === 0x23 && s.pidProfile === 2 && s.cpuLoad === 14 && s.pidProfileCount === 4 && s.rateProfile === 1);
  check('status_ex extra mode byte', s.modeBits.length === 40 && s.modeBits[0] && s.modeBits[32] && !s.modeBits[33]);
  check('status_ex arming + config + temp + rate count', s.armingFlagCount === 29 && s.armingFlags === 1 << 28 && s.rebootRequired && s.cpuTempC === 41 && s.rateProfileCount === 4);
  check('status_ex 1.46 has no rate profile count', decodeStatusEx(p.subarray(0, p.length - 1), 46).rateProfileCount === null);
}

console.log(fails === 0 ? 'all firmware reference tests passed' : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
