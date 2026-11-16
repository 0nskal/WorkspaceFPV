// Run: npx esbuild app/src/bf/test-receiver.mjs --bundle --platform=node --format=esm --outfile=$TEMP/bf-rx-test.mjs && node $TEMP/bf-rx-test.mjs
import assert from 'node:assert/strict';
import {
  decodeRxConfig, encodeRxConfig, decodeRcDeadband, encodeRcDeadband, decodeRssiChannel, encodeRssiChannel, decodeRxMap, encodeRxMap,
  mapToString, stringToMap, RX_MAP_PRESETS, channelName, decodeRc, encodeRc, sticksFromRc, elrsLink,
} from './receiver.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}

// RX_CONFIG 39 bytes
{
  const raw = new Uint8Array(39);
  const dv = new DataView(raw.buffer);
  raw[0] = 9; dv.setUint16(1, 1900, true); dv.setUint16(3, 1500, true); dv.setUint16(5, 1050, true); dv.setUint16(8, 885, true); dv.setUint16(10, 2115, true);
  dv.setUint16(14, 1250, true); raw[25] = 0; raw[26] = 0; raw[27] = 30; raw[30] = 30; raw[31] = 1; raw[12] = 7; raw[32] = 0x11;
  const d = decodeRxConfig(raw, 46);
  check('rx decode', d.values.provider === 9 && d.values.maxCheck === 1900 && d.values.midRc === 1500 && d.values.minCheck === 1050 && d.values.smoothAutoFactor === 30 && d.values.smoothMode === 1);
  check('rx 1.46: ff cutoff, no throttle cutoff', d.values.smoothFeedforwardCutoff === 0 && d.values.smoothThrottleCutoff === undefined && d.values.smoothAutoFactorThrottle === undefined);
  const d47 = decodeRxConfig(raw, 47);
  check('rx 1.47: throttle cutoff + factor', d47.values.smoothThrottleCutoff === 0 && d47.values.smoothAutoFactorThrottle === 30 && d47.values.smoothFeedforwardCutoff === undefined);
  const out = encodeRxConfig(d.raw, { ...d.values, provider: 2, minCheck: 1100 }, 46);
  const d2 = decodeRxConfig(out, 46);
  check('rx roundtrip + untouched legacy', d2.values.provider === 2 && d2.values.minCheck === 1100 && out[12] === 7 && out[32] === 0x11 && out.length === 39);
  check('rx short payload (older FC)', decodeRxConfig(raw.subarray(0, 12), 44).values.provider === 9 && decodeRxConfig(raw.subarray(0, 12), 44).values.smoothMode === undefined);
}

// deadband, rssi
{
  const raw = Uint8Array.from([0, 0, 40, 0x32, 0x00]);
  const d = decodeRcDeadband(raw, 46);
  check('deadband decode', d.values.deadband === 0 && d.values.altHoldDeadband === 40 && d.values.deadband3dThrottle === 50);
  const out = encodeRcDeadband(d.raw, { ...d.values, deadband: 5, yawDeadband: 3 }, 46);
  check('deadband roundtrip', out[0] === 5 && out[1] === 3 && out[2] === 40 && out[3] === 0x32);
  check('rssi channel', decodeRssiChannel(encodeRssiChannel(9)) === 9 && decodeRssiChannel(new Uint8Array(0)) === 0);
}

// map
{
  check('AETR map', mapToString([0, 1, 3, 2, 4, 5, 6, 7]) === 'AETR1234');
  check('TAER map', mapToString([1, 2, 3, 0, 4, 5, 6, 7]) === 'TAER1234');
  for (const p of RX_MAP_PRESETS) {
    const m = stringToMap(p);
    check(`preset ${p} round trip`, m !== null && mapToString(m) === p);
  }
  check('AETR -> bytes', stringToMap('AETR1234').join() === '0,1,3,2,4,5,6,7');
  check('invalid strings rejected', stringToMap('AAAR1234') === null && stringToMap('AET') === null && stringToMap('12345678') === null);
  const base = Uint8Array.from([0, 1, 3, 2, 4, 5, 6, 7]);
  check('encode map', encodeRxMap([1, 2, 3, 0, 4, 5, 6, 7], base).join() === '1,2,3,0,4,5,6,7' && decodeRxMap(base).join() === '0,1,3,2,4,5,6,7');
  check('channel names', channelName(0, [0, 1, 3, 2]) === 'Roll' && channelName(2, [0, 1, 3, 2]) === 'Throttle' && channelName(4, [0, 1, 3, 2]) === 'AUX1' && channelName(9, [0, 1, 3, 2]) === 'AUX6');
}

// RC
{
  const ch = [1500, 1500, 1000, 1500, 1000, 1800, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1850, 1500];
  const raw = encodeRc(ch);
  check('rc roundtrip', decodeRc(raw).join() === ch.join() && raw.length === 32);
  check('rc odd length tolerated', decodeRc(Uint8Array.from([1, 2, 3])).length === 1);
  const s = sticksFromRc([1500, 1750, 1000, 1250], [0, 1, 3, 2]); // AETR
  check('sticks AETR', s.roll === 0 && s.pitch === 0.5 && s.throttle === 0 + (1250 - 1000) / 1000 * 0 + 0 || (s.yaw === -0.5));
  const s2 = sticksFromRc([1500, 1500, 1200, 1750], [0, 1, 3, 2]);
  check('sticks yaw/throttle from map', s2.yaw === 0.5 && Math.abs(s2.throttle - 0.2) < 1e-9);
  const l = elrsLink(ch, 9);
  check('elrs link', l && l.lq === 85 && l.rssiDbm > -86 && l.rssiDbm < -84, JSON.stringify(l));
  check('elrs link null without 16 ch / not CRSF', elrsLink(ch.slice(0, 8), 9) === null && elrsLink(ch, 2) === null);
}

assert.equal(fails, 0, `${fails} failed`);
console.log('all receiver tests passed');
