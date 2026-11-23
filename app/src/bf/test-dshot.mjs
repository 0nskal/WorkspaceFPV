// Motor direction through MSP2_SEND_DSHOT_COMMAND: frame layout: npm test
import { DSHOT_CMD, MSP2_SEND_DSHOT_COMMAND, directionFrame } from './dshot.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}

check('command code 0x3003', MSP2_SEND_DSHOT_COMMAND === 0x3003);
const rev = Array.from(directionFrame(2, true));
check('reverse motor 3: blocking, index 2, two commands, REVERSED then SAVE', rev.join() === [1, 2, 2, DSHOT_CMD.SPIN_DIRECTION_REVERSED, DSHOT_CMD.SAVE_SETTINGS].join(), rev.join());
const norm = Array.from(directionFrame(0, false));
check('normal motor 1', norm.join() === '1,0,2,20,12', norm.join());

if (fails) process.exit(1);
console.log('dshot OK');
