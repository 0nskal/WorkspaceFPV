// USB-only power: problems a missing battery explains are split from real ones: npm test
import { isUsbOnly, powerCaused, splitByPower } from './power.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}
const c = (id, severity) => ({ id, label: id, severity, part: null });

// the case from a GEPRC F722 on USB: no battery, receiver failsafe, DShot telemetry, I2C errors, plus one real problem
const usb = [
  c('vbat', 'info'),
  c('arm-RX_FAILSAFE', 'warn'),
  c('arm-DSHOT_TELEM', 'warn'),
  c('i2c', 'warn'),
  c('protocol', 'fail'),
  c('motors', 'ok'),
];
check('usb only detected', isUsbOnly(usb));
const s = splitByPower(usb);
check('three wait for a battery', s.noBattery.map((x) => x.id).join() === 'arm-RX_FAILSAFE,arm-DSHOT_TELEM,i2c', s.noBattery.map((x) => x.id).join());
check('protocol stays a real problem', s.real.map((x) => x.id).join() === 'protocol', s.real.map((x) => x.id).join());
check('ok checks never counted', !s.real.concat(s.noBattery).some((x) => x.severity === 'ok'));

// with a battery nothing is excused
const bat = usb.map((x) => (x.id === 'vbat' ? c('vbat', 'ok') : x));
const b = splitByPower(bat);
check('battery present: nothing excused', b.noBattery.length === 0 && b.real.length === 4, `${b.real.length}`);

// flags a battery does not explain stay real even on USB
check('THROTTLE is not power-caused', !powerCaused(c('arm-THROTTLE', 'warn')));
check('ACC_CALIBRATION is not power-caused', !powerCaused(c('arm-ACC_CALIBRATION', 'warn')));

if (fails) process.exit(1);
console.log('power OK');
