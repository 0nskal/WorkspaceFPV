// Autotune PID flow logic (state machine, backups/restore, checklist, flight script, parts, header PIDs): npm test
import assert from 'node:assert/strict';
import { STEPS, initialState, blockFor, canJump, go, backupName, parseSet, parseState, recordUndo, restoreCommands, pidMismatch, pidOld, addBackup, MAX_BACKUPS, trend } from './state.ts';
import { prepareChecks, allFixes, bestSampleRate, NEEDED_FIELDS } from './prepare.ts';
import { SCRIPTS, coachAt, startOf, scriptSeconds } from './flight-script.ts';
import { emptyFacts, emptyParts, mergeDetected, missingParts, ruleProfile, typicalBuild, aiFacts } from './parts.ts';
import { headerPid, motorRange, parseHeader } from '../bf/bbl.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}

// 1. Step gating: no step 3 without a backup, nothing while armed, ticks before the flight, a log before the proposal
{
  const g = { backup: null, armed: false, ticks: { battery: false, space: false }, hasLog: false };
  check('steps order', STEPS.join() === 'parts,backup,prepare,flight,import,propose');
  check('backup step open', blockFor('backup', g) === null);
  check('prepare needs backup', blockFor('prepare', g) === 'needBackup');
  const g2 = { ...g, backup: 'before-pid-x' };
  check('prepare open with backup', blockFor('prepare', g2) === null);
  check('armed blocks prepare', blockFor('prepare', { ...g2, armed: true }) === 'armed');
  check('flight needs ticks', blockFor('flight', g2) === 'needTicks');
  const g3 = { ...g2, ticks: { battery: true, space: true } };
  check('import open', blockFor('import', g3) === null);
  check('propose needs log', blockFor('propose', g3) === 'needLog' && blockFor('propose', { ...g3, hasLog: true }) === null);
  const s0 = initialState();
  check('go blocked keeps state', go(s0, 'prepare', g) === s0);
  const s1 = go(s0, 'backup', g);
  check('go moves + reached', s1.step === 'backup' && s1.reached === 'backup');
  const s2 = go(go(s1, 'flight', g3), 'parts', g3);
  check('going back keeps reached', s2.step === 'parts' && s2.reached === 'flight');
}

// 2. Backup name, set parsing, undo and restore
{
  check('backup name', backupName(new Date(2026, 10, 7, 9, 5)) === 'before-pid-2026-11-07-0905', backupName(new Date(2026, 10, 7, 9, 5)));
  check('parseSet', JSON.stringify(parseSet('set P_roll = 48')) === '{"key":"p_roll","value":"48"}' && parseSet('feature OSD') === null);
  let undo = recordUndo({}, ['set p_roll = 52', 'set d_roll = 42', 'set debug_mode = GYRO_SCALED'], { p_roll: '48', d_roll: '38' });
  undo = recordUndo(undo, ['set p_roll = 55'], { p_roll: '52' });
  check('undo keeps the first old value, skips unknown', JSON.stringify(undo) === '{"p_roll":"48","d_roll":"38"}', JSON.stringify(undo));
  const diff = ['# diff all', 'batch start', 'defaults nosave', 'board_name SPEEDYBEEF405V4', 'feature OSD', 'set gyro_lpf1_static_hz = 0', '# profile 0', 'profile 0', 'set d_roll = 40', 'set craft_name = My Quad', 'rateprofile 0', 'save', 'batch end'].join('\r\n');
  const cmds = restoreCommands(diff, { ...undo, debug_mode: 'NONE' });
  check(
    'restore: set lines + profiles + undo for keys missing from the diff',
    JSON.stringify(cmds) === JSON.stringify(['set gyro_lpf1_static_hz = 0', 'profile 0', 'set d_roll = 40', 'set craft_name = My Quad', 'rateprofile 0', 'set p_roll = 48', 'set debug_mode = NONE']),
    JSON.stringify(cmds),
  );
  check('restore: no blocked commands', !cmds.some((c) => /^(defaults|save|exit|batch|board_name)/.test(c)));
  let list = [];
  for (let i = 0; i < 7; i++) list = addBackup(list, { name: `b${i}`, at: i, text: 'x' });
  check('backups capped, newest first', list.length === MAX_BACKUPS && list[0].name === 'b6');
  list = addBackup(list, { name: 'b4', at: 99, text: 'y' });
  check('same name replaced', list.filter((b) => b.name === 'b4').length === 1 && list[0].at === 99);
}

// 3. PIDs: header vs FC, old values, header parsing from a real-format log header
{
  const fc = { roll: [48, 82, 38], pitch: [52, 88, 42], yaw: [45, 90, 3] };
  check('pidMismatch none', pidMismatch(fc, fc).length === 0 && pidMismatch(null, fc).length === 0);
  check('pidMismatch roll+yaw', pidMismatch({ ...fc, roll: [50, 82, 38], yaw: [45, 90, 0] }, fc).join() === 'roll,yaw');
  check('pidOld', pidOld(fc).d_pitch === '42' && pidOld(fc).i_yaw === '90' && Object.keys(pidOld(null)).length === 0);
  const lines = [
    'H Product:Blackbox flight data recorder by Nicholas Sherlock',
    'H Data version:2',
    'H Field I name:loopIteration,time',
    'H Field I signed:0,0',
    'H Field I predictor:0,0',
    'H Field I encoding:1,1',
    'H Field P predictor:6,2',
    'H Field P encoding:9,0',
    'H rollPID:47,84,36',
    'H pitchPID:51,88,40',
    'H yawPID:45,90,0',
    'H motorOutput:158,2047',
    '',
  ];
  const buf = new TextEncoder().encode(lines.join('\n'));
  const h = parseHeader(buf, 0, buf.length);
  const pid = headerPid(h.info);
  check('headerPid from header lines', JSON.stringify(pid) === JSON.stringify({ roll: [47, 84, 36], pitch: [51, 88, 40], yaw: [45, 90, 0] }), JSON.stringify(pid));
  check('motorRange', JSON.stringify(motorRange(h.info)) === '[158,2047]');
  check('headerPid missing axis -> null', headerPid({ rollPID: '1,2,3', pitchPID: '1,2,3' }) === null && headerPid({ rollPID: '1,x,3', pitchPID: '1,2,3', yawPID: '1,2,3' }) === null);
  check('motorRange absent -> null', motorRange({}) === null);
}

// 4. Checklist from FC facts
{
  const f = { ...emptyFacts(), connected: true, api: 46, pidLoopHz: 8000, bbDevice: 1, bbSampleRate: 3, bbDisabledMask: (1 << 2) | (1 << 10), debugIndex: 0, debugName: 'NONE', bidir: false, rpmHarmonics: 3, flash: { supported: true, total: 16e6, used: 12e6 } };
  const checks = prepareChecks(f);
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  check('bestSampleRate 8k -> 1/4', bestSampleRate(8000) === 2 && bestSampleRate(4000) === 1 && bestSampleRate(1000) === 0);
  check('rate 1 kHz -> fix to 1/4', by.bbRate.status === 'fix' && by.bbRate.fix[0] === 'set blackbox_sample_rate = 1/4' && by.bbRate.old.blackbox_sample_rate === '1/8');
  check('debug NONE -> fix GYRO_SCALED', by.debug.status === 'fix' && by.debug.old.debug_mode === 'NONE');
  check('fields: setpoint + motors off -> fix', by.fields.status === 'fix' && by.fields.fix.join() === 'set blackbox_disable_setpoint = OFF,set blackbox_disable_motors = OFF');
  check('rpm warn only (no fix)', by.rpm.status === 'warn' && !by.rpm.fix);
  check('flash 75% warn', by.flash.status === 'warn' && by.flash.params.pct === 75);
  check('manual items', by.battery.status === 'manual' && by.space.status === 'manual');
  const all = allFixes(checks);
  check('fix all = 4 commands', all.commands.length === 4 && all.old.blackbox_disable_setpoint === 'ON', all.commands.join(' | '));
  check('fix all skips fixed', allFixes(checks, new Set(['bbRate', 'debug'])).commands.length === 2);
  const armed = prepareChecks({ ...f, armed: true });
  check('armed -> block', armed.find((c) => c.id === 'armed').status === 'block');
  const off = prepareChecks({ ...f, bbDevice: 0, sdSupported: false });
  check('device off + flash -> SPIFLASH', off.find((c) => c.id === 'bbDevice').fix[0] === 'set blackbox_device = SPIFLASH');
  check('needed fields bits', NEEDED_FIELDS.map((x) => x[0]).join() === '1,2,7,10');
  const good = prepareChecks({ ...f, bbSampleRate: 1, bbDisabledMask: 0, debugName: 'GYRO_SCALED', bidir: true });
  check('good setup: no fixes', allFixes(good).commands.length === 0);
}

// 5. Flight script and coach clock
{
  const s = SCRIPTS.basic;
  check('script: 8 steps, ends with land', s.length === 8 && s[s.length - 1].id === 'land' && s.find((x) => x.id === 'flips').optional);
  check('script seconds', scriptSeconds(s) === 70 && scriptSeconds(s, false) === 60);
  const p0 = coachAt(s, 0);
  check('coach start', p0.index === 0 && p0.left === 10 && !p0.done);
  const p1 = coachAt(s, 12.5);
  check('coach at 12.5 s -> roll', p1.index === 1 && p1.left === 8 && Math.abs(p1.frac - 0.25) < 1e-9);
  check('coach skips optional', coachAt(s, 50, true).index === 6 && coachAt(s, 50).index === 5);
  check('coach done at land', coachAt(s, 999).done && coachAt(s, 999).index === 7);
  check('startOf', startOf(s, 3) === 30 && startOf(s, 7, true) === 60);
}

// 6. Parts: FC prefill never overwrites user input; rules; typical builds; AI facts carry no names
{
  const f = { ...emptyFacts(), connected: true, cells: 6, capacityMah: 1300, protocol: 'DSHOT300', dshot: true, bidir: false, rpmHarmonics: 3, bbRateHz: 1000 };
  const m = mergeDetected({ ...emptyParts(), cells: 4 }, f);
  check('mergeDetected keeps typed cells', m.parts.cells === 4 && m.parts.capacityMah === 1300 && m.parts.escProtocol === 'DSHOT300' && !m.detected.includes('cells'));
  check('missing parts', missingParts(m.parts).includes('frameIn') && !missingParts(m.parts).includes('capacityMah'));
  const notes = ruleProfile({ ...m.parts, motorKv: 2600, frameIn: 5, style: 'freestyle' }, f).map((n) => n.code);
  check('rules', ['bidirOff', 'bbRateLow', 'cellsMismatch', 'freestyle', 'startFromCurrent'].every((c) => notes.includes(c)) && !notes.includes('highRpm'), notes.join(','));
  check('highRpm', ruleProfile({ ...emptyParts(), motorKv: 2600, cells: 6 }, emptyFacts()).some((n) => n.code === 'highRpm'));
  check('typical 5"', typicalBuild(5).stator === '2207' && typicalBuild(7).stator === '2807' && typicalBuild(null) === null);
  const txt = aiFacts({ ...emptyParts(), frameIn: 5 }, { ...f, board: 'SpeedyBee F405 V4' }).join('\n');
  check('aiFacts lists facts and unknowns', txt.includes('Frame: 5 in') && txt.includes('Unknown fields:') && txt.includes('Bidirectional DShot: off'));
  check('trend', trend(20, 10) === 'better' && trend(10, 20) === 'worse' && trend(10, 10.5) === 'same' && trend(null, 1) === null);
}

// 7. Offline analysis is never gated; jumping in Basic vs Expert; stored state is parsed defensively
{
  const g = { backup: null, armed: true, ticks: { battery: false, space: false }, hasLog: false };
  check('log step open without backup / FC / ticks', blockFor('import', g) === null);
  check('flight only needs the checklist', blockFor('flight', { ...g, armed: false, ticks: { battery: true, space: true } }) === null);
  const s0 = initialState();
  check('basic: cannot jump ahead', !canJump(s0, 'flight', { ...g, armed: false, ticks: { battery: true, space: true } }, false));
  check('basic: log step always reachable', canJump(s0, 'import', g, false));
  check('expert: jump to any unblocked step', canJump(s0, 'flight', { ...g, ticks: { battery: true, space: true } }, true) && !canJump(s0, 'prepare', g, true));
  check('result needs a log in both modes', !canJump({ ...s0, reached: 'propose' }, 'propose', g, true));
  const old = JSON.stringify({ v: 1, step: 'flight', reached: 'import', parts: { frameIn: 5 }, backup: 'before-pid-x', ticks: { battery: true }, fixed: ['debug'], undo: { debug_mode: 'NONE' }, beep: true });
  const p = parseState(old);
  check('migrated wizard state keeps fields', p.step === 'flight' && p.reached === 'import' && p.parts.frameIn === 5 && p.parts.propIn === null && p.backup === 'before-pid-x' && p.ticks.battery && !p.ticks.space && p.undo.debug_mode === 'NONE' && p.folded === false);
  check('broken state resets', parseState('{nope').step === 'parts' && parseState(JSON.stringify({ v: 2 })).step === 'parts');
  check('unknown step resets', parseState(JSON.stringify({ v: 1, step: 'wat' })).step === 'parts');
}

assert.equal(fails, 0, `${fails} checks failed`);
console.log('wizard OK');
