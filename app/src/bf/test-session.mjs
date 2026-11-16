// Session test against the demo FC: snapshot, typed read, save + re-read, reset. Run:
//   npx esbuild app/src/bf/test-session.mjs --bundle --platform=node --format=esm --outfile=%TEMP%/bf-session-test.mjs && node %TEMP%/bf-session-test.mjs
import { BfSession } from './store.ts';
import { DemoLink } from '../serial/demo.ts';
import * as D from './decode.ts';
import { C } from './codes.ts';
import { STEP, rawOf } from './steps.ts'; // registers the tuning / receiver / modes / blackbox / OSD read steps

let fails = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
};

const link = new DemoLink();
const bf = new BfSession({ link: () => link, watchReconnect: async () => true });
const progress = [];
bf.subscribe(() => {
  const p = bf.store.progress();
  if (p) progress.push(p.done);
});
await bf.snapshot(link);
const d = bf.get();
check('snapshot ready', bf.store.isReady() && d.supported && d.api === 46 && d.variant === 'BTFL' && d.version === '4.5.1');
check('progress reaches total', progress.length > 20 && bf.store.progress() === null);
check('board + gyro rate', d.board?.gyroRateHz === 8000 && d.board?.boardId === 'S405');
check('serial ports (v2)', d.serial?.source === 'v2' && d.serial.ports.length === 7);
check('craft/pilot names via GET_TEXT', d.craftName === '5" Freestyle' && d.pilotName === 'OSKAR');
check('unsupported API-gated steps skipped (MCU info needs 1.47)', d.mcuName === '');

// every tab's data is read on connect (nobody has to press "read")
for (const id of [STEP.pid, STEP.pidAdv, STEP.rcTuning, STEP.filter, STEP.rx, STEP.rxMap, STEP.deadband, STEP.rssi, STEP.boxNames, STEP.boxIds, STEP.modeRanges, STEP.modeRangesExtra, STEP.bbConfig, STEP.flash, STEP.osd, STEP.osdCanvas, STEP.advanced, STEP.motor, STEP.mixer])
  check(`snapshot read ${id}`, !!rawOf(d, id) && rawOf(d, id).length > 0);
check('status mode bits decoded', Array.isArray(d.status?.modeBits) && d.status.modeBits.length >= 32);

// typed read
const att = await bf.read({ code: C.ATTITUDE, decode: (p) => D.decodeAttitude(p) });
check('typed read', att !== null && typeof att.rollDeg === 'number');
check('typed read respects minApi', (await bf.read({ code: C.MCU_INFO, minApi: 47, decode: () => 1 })) === null);

// save: arming config + failsafe, no reboot -> store refreshed
const res = await bf.saveSettings(
  [
    { code: C.SET_ARMING_CONFIG, payload: D.encodeArming({ autoDisarmDelay: 9, smallAngle: 40, gyroCalOnFirstArm: null }, d.raw.get('arming')) },
    { code: C.SET_FAILSAFE_CONFIG, payload: D.encodeFailsafe({ ...d.failsafe, procedure: 1 }, d.raw.get('failsafe')) },
  ],
  { areas: ['arming', 'failsafe'] },
);
check('save ok', res.ok && !res.rebooted, res.error ?? '');
check('re-read shows new values', bf.get().arming?.autoDisarmDelay === 9 && bf.get().arming?.smallAngle === 40 && bf.get().failsafe?.procedure === 1);

// save with reboot (demo simulates it)
const res2 = await bf.saveSettings([{ code: C.SET_MIXER_CONFIG, payload: D.encodeMixer({ mixer: 3, reversed: true }, d.raw.get('mixer')) }], { reboot: true, areas: ['mixer'] });
check('save + reboot ok', res2.ok && res2.rebooted && bf.get().mixer?.reversed === true);

// arming disable shows up as MSP flag in STATUS_EX
await bf.setArmingDisabled(true);
await bf.refresh('status');
check('arming disable flag set', ((bf.get().status?.armingFlags ?? 0) & (1 << 16)) !== 0);
await bf.setArmingDisabled(false);
await bf.refresh('status');
check('arming disable released', bf.get().status?.armingFlags === 0);

// reset config returns to defaults
const rs = await bf.resetConfig();
check('reset ok', rs.ok && bf.get().arming?.autoDisarmDelay === 5);

console.log(fails === 0 ? 'ALL OK' : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
