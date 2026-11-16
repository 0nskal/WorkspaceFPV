// Run: npx esbuild app/src/bf/test-modes.mjs --bundle --platform=node --format=esm --outfile=$TEMP/bf-modes-test.mjs && node $TEMP/bf-modes-test.mjs
import assert from 'node:assert/strict';
import {
  decodeBoxNames, decodeBoxIds, decodeModeRanges, encodeSetModeRange, stepToUs, usToStep, isEmptyRange, rangeContains,
  activeModeIds, activeIdsFromFlags, flagsFromActiveIds, emptyRange,
} from './modes.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}

const asc = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
check('boxnames', decodeBoxNames(asc('ARM;ANGLE;HORIZON;BEEPER;')).join('|') === 'ARM|ANGLE|HORIZON|BEEPER');
check('boxids', decodeBoxIds(Uint8Array.from([0, 1, 2, 13])).join() === '0,1,2,13');

check('step <-> us', stepToUs(0) === 900 && stepToUs(48) === 2100 && stepToUs(24) === 1500 && usToStep(1500) === 24 && usToStep(1010) === 4 && usToStep(5000) === 48 && usToStep(0) === 0);

// 20 slots; slot0 ARM on AUX1 1700..2100, slot1 ANGLE on AUX2 1300..1700, rest empty; extra: slot 1 AND linked to ARM
{
  const raw = new Uint8Array(80);
  raw.set([0, 0, 32, 48], 0);
  raw.set([1, 1, 16, 32], 4);
  raw.set([13, 2, 32, 48], 8); // BEEPER on AUX3 high
  const extra = new Uint8Array(1 + 20 * 3);
  extra[0] = 20;
  extra.set([1, 1, 13], 1 + 3); // slot 1: ANGLE, logic AND, linked to BEEPER (13)
  const r = decodeModeRanges(raw, extra);
  check('ranges decode', r.length === 20 && r[0].id === 0 && r[0].start === 32 && r[1].aux === 1 && r[1].logic === 1 && r[1].linkedTo === 13 && isEmptyRange(r[3]));
  const noExtra = decodeModeRanges(raw);
  check('ranges without extra (older FC)', noExtra[1].logic === 0 && noExtra.length === 20);
  const enc = encodeSetModeRange({ slot: 3, id: 28, aux: 2, start: 24, end: 48, logic: 0, linkedTo: 0 });
  check('SET_MODE_RANGE bytes', enc.join() === '3,28,2,24,48,0,0');
  check('empty range', isEmptyRange(emptyRange(5)) && emptyRange(5).slot === 5);
  check('rangeContains edges', rangeContains(r[0], 1700) && rangeContains(r[0], 2099) && !rangeContains(r[0], 1699) && !rangeContains(r[0], 2100));

  const rc = [1500, 1500, 1000, 1500, 2000, 1500, 2000]; // AUX1 high, AUX2 mid, AUX3 high
  const act = activeModeIds(r, rc);
  check('active: ARM, ANGLE (AND linked to active BEEPER)', act.has(0) && act.has(1) && act.has(13));
  const act2 = activeModeIds(r, [1500, 1500, 1000, 1500, 2000, 1500, 1000]);
  check('active: AND dependent drops when linked mode off', act2.has(0) && !act2.has(13) && !act2.has(1));

  const ids = [0, 1, 2, 13];
  const flags = flagsFromActiveIds(ids, act);
  check('flags <-> ids', flags === 0b1011 && activeIdsFromFlags(ids, [true, true, false, false]).size === 2 && activeIdsFromFlags(ids, [false, false, false, true]).has(13));
}

assert.equal(fails, 0, `${fails} failed`);
console.log('all modes tests passed');
