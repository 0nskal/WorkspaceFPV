// Tests of the MSP v2 codec and the core decoders/encoders. Run:
//   npx esbuild app/src/bf/test-core.mjs --bundle --platform=node --format=esm --outfile=%TEMP%/bf-core-test.mjs && node %TEMP%/bf-core-test.mjs
import {
  MspParser,
  crc8DvbS2,
  encodeMspV1,
  encodeMspV2,
  encodeMspV2Response,
  encodeMspResponse,
  encodeMspJumboResponse,
} from '../serial/msp.ts';
import * as D from './decode.ts';
import { Wr } from './codec.ts';
import { armingTable, decodeArmFlags } from './arming.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const bytes = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

// CRC-8 DVB-S2 check value of "123456789" is 0xBC
check('crc8 dvb-s2 check value', crc8DvbS2(bytes('123456789')) === 0xbc);

// v1 request frame, golden: $M< 0 1 1 (API_VERSION)
check('v1 request golden', same(encodeMspV1(1), Uint8Array.from([0x24, 0x4d, 0x3c, 0, 1, 1])));

// v2 request frame structure + crc over flag..payload
{
  const f = encodeMspV2(0x3006, Uint8Array.of(2));
  check('v2 request header', same(f.subarray(0, 8), Uint8Array.from([0x24, 0x58, 0x3c, 0, 0x06, 0x30, 1, 0])) && f[8] === 2);
  check('v2 request crc', f[9] === crc8DvbS2(f.subarray(3, 9)));
}

// parser: v1, v2, v2 error, jumbo, split across chunks, garbage in front
{
  const p = new MspParser();
  const payload = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
  const stream = [
    Uint8Array.of(0x00, 0xff, 0x24, 0x00),
    encodeMspResponse(4, Uint8Array.of(1, 2, 3)),
    encodeMspV2Response(0x1009, payload),
    encodeMspV2Response(0x3010, new Uint8Array(0), true),
    encodeMspJumboResponse(70, payload),
  ];
  const all = new Uint8Array(stream.reduce((a, s) => a + s.length, 0));
  let o = 0;
  for (const s of stream) {
    all.set(s, o);
    o += s.length;
  }
  const frames = [];
  for (let i = 0; i < all.length; i += 7) frames.push(...p.push(all.subarray(i, i + 7)));
  check('parser frame count', frames.length === 4, String(frames.length));
  check('parser v1', frames[0].cmd === 4 && !frames[0].v2 && same(frames[0].payload, Uint8Array.of(1, 2, 3)));
  check('parser v2 300 B', frames[1].cmd === 0x1009 && frames[1].v2 && same(frames[1].payload, payload));
  check('parser v2 error', frames[2].cmd === 0x3010 && frames[2].error && frames[2].payload.length === 0);
  check('parser v1 jumbo', frames[3].cmd === 70 && !frames[3].v2 && same(frames[3].payload, payload));
  // corrupted crc is dropped
  const bad = encodeMspResponse(4, Uint8Array.of(1));
  bad[bad.length - 1] ^= 0xff;
  check('parser drops bad crc', new MspParser().push(bad).length === 0);
}

// version string: classic and calendar
check('fc version 4.5.1', D.decodeFcVersion(Uint8Array.of(4, 5, 1)) === '4.5.1');
check('fc version calver', D.decodeFcVersion(new Wr().u8(26).u8(6).u8(0).pstr('2026.6.0').done()) === '2026.6.0');

// STATUS_EX: API 1.46 sample, plus a short/older payload must not throw
{
  const p = new Wr().u16(125).u16(0).u16(0b100011).u32(1).u8(1).u16(14).u8(3).u8(2).u8(0).u8(26).u32((1 << 16) | (1 << 25)).u8(1).u16(41).done();
  const s = D.decodeStatusEx(p, 46);
  check('status_ex fields', s.cycleTimeUs === 125 && s.sensors === 0b100011 && s.pidProfile === 1 && s.pidProfileCount === 3 && s.rateProfile === 2 && s.armingFlagCount === 26 && s.rebootRequired && s.cpuTempC === 41 && s.rateProfileCount === null);
  check('status_ex arming flags', s.armingFlags === ((1 << 16) | (1 << 25)));
  const s47 = D.decodeStatusEx(new Wr().bytes(p).u8(4).done(), 47);
  check('status_ex api 1.47 rate profile count', s47.rateProfileCount === 4);
  check('status_ex short payload tolerated', D.decodeStatusEx(p.subarray(0, 10), 46).cycleTimeUs === 125);
}

// arming tables
{
  const f45 = decodeArmFlags((1 << 16) | (1 << 25) | (1 << 20), 46, 26).map((f) => f.name);
  check('arming 4.5 names', same(f45, ['MSP', 'DSHOT_TELEM', 'ARM_SWITCH']), f45.join());
  check('arming 4.4 bit 20 = RPMFILTER', armingTable(45).find((f) => f.bit === 20).name === 'RPMFILTER');
  check('arming 2025.12 bit 25 = CRASHFLIP, arm switch last', armingTable(47, 27).find((f) => f.bit === 25).name === 'CRASHFLIP' && armingTable(47, 27).find((f) => f.bit === 26).name === 'ARM_SWITCH');
  check('arming master', armingTable(49, 30).find((f) => f.bit === 29).name === 'ARM_SWITCH');
  check('unknown flag', decodeArmFlags(1 << 31, 46, 26)[0].name === 'FLAG_31');
}

// serial config round trip (v2 and legacy), with an unknown tail byte
{
  const w = new Wr().u8(2);
  w.u8(20).u32(1).u8(5).u8(0).u8(0).u8(5);
  w.u8(1).u32(1 << 6).u8(5).u8(0).u8(0).u8(5);
  const raw = w.done();
  const cfg = D.decodeSerialConfig(raw, 'v2');
  check('serial decode', cfg.ports.length === 2 && cfg.ports[1].mask === 64 && cfg.ports[1].id === 1);
  check('serial v2 round trip', same(D.encodeSerialConfig(cfg), raw));
  const grown = new Wr().u8(1).u8(0).u32(1).u8(5).u8(0).u8(0).u8(5).u8(7).done(); // 10 bytes per port
  const g = D.decodeSerialConfig(grown, 'v2');
  check('serial defensive record size', g.ports[0].tail.length === 1 && same(D.encodeSerialConfig(g), grown));
  const leg = new Wr().u8(1).u8(0).u16(1).u8(5).u8(0).u8(0).u8(5).done();
  check('serial legacy round trip', same(D.encodeSerialConfig(D.decodeSerialConfig(leg, 'legacy')), leg));
}

// battery config: 15-byte payload round trip and edit
{
  const raw = new Wr().u8(33).u8(44).u8(35).u16(1300).u8(1).u8(1).u16(330).u16(435).u16(350).done();
  const b = D.decodeBatteryConfig(raw);
  check('battery decode', b.minCell === 3.3 && b.maxCell === 4.35 && b.warnCell === 3.5 && b.capacityMah === 1300 && b.voltageSource === 1);
  check('battery round trip', same(D.encodeBatteryConfig(b, raw), raw));
  const e = D.decodeBatteryConfig(D.encodeBatteryConfig({ ...b, warnCell: 3.45, capacityMah: 1500 }, raw));
  check('battery edit', e.warnCell === 3.45 && e.capacityMah === 1500 && e.minCell === 3.3);
}

// failsafe: patching keeps unknown trailing bytes
{
  const raw = new Wr().u8(15).u8(10).u16(1000).u8(0).u16(100).u8(0).u8(0xaa).u8(0xbb).done();
  const f = D.decodeFailsafe(raw);
  check('failsafe decode', f.delay === 15 && f.offDelay === 10 && f.throttle === 1000 && f.throttleLowDelay === 100 && f.procedure === 0);
  const out = D.encodeFailsafe({ ...f, procedure: 1 }, raw);
  check('failsafe keeps tail', out.length === 10 && out[8] === 0xaa && out[7] === 1);
}

// arming config / mixer / advanced / beeper encoders patch only known bytes
{
  const arm = new Wr().u8(5).u8(0).u8(25).u8(1).done();
  check('arming round trip', same(D.encodeArming(D.decodeArming(arm, 47), arm), arm));
  check('arming 1.46 has no gyro cal', D.decodeArming(Uint8Array.of(5, 0, 25), 46).gyroCalOnFirstArm === null);
  const adv = new Uint8Array(20);
  adv[0] = 1;
  adv[1] = 2;
  adv[3] = 6;
  adv[9] = 1;
  adv[17] = 9;
  adv[19] = 33;
  const out = D.encodeAdvanced({ pidProcessDenom: 4 }, adv);
  check('advanced writes 19 bytes, patches pid denom only', out.length === 19 && out[1] === 4 && out[3] === 6 && out[9] === 1 && out[17] === 9);
  const bp = new Wr().u32(0b101).u8(1).u32(0).done();
  const d = D.decodeBeeper(bp);
  check('beeper round trip', d.disabledMask === 5 && same(D.encodeBeeper(d, bp).subarray(0, 5), bp.subarray(0, 5)));
}

// features
{
  let m = 0;
  m = D.withFeature(m, D.FEATURE.TELEMETRY, true);
  m = D.withFeature(m, D.FEATURE.ANTI_GRAVITY, true);
  check('features set/clear', D.hasFeature(m, 10) && D.hasFeature(m, 28) && !D.hasFeature(D.withFeature(m, 28, false), 28) && m > 0);
}

// RX fail / meters
{
  const rf = new Wr().u8(0).u16(1500).u8(2).u16(1000).done();
  const c = D.decodeRxFail(rf);
  check('rxfail decode', c.length === 2 && c[1].mode === 2 && c[1].value === 1000);
  check('rxfail set payload', same(D.encodeRxFailChannel(1, c[1]), Uint8Array.of(1, 2, 0xe8, 0x03)));
  const vm = D.decodeVoltageMeterConfig(Uint8Array.of(1, 5, 10, 1, 110, 10, 1));
  check('voltage meter decode', vm[0].id === 10 && vm[0].scale === 110 && vm[0].divVal === 10);
  check('voltage meter set', same(D.encodeVoltageMeter({ ...vm[0], scale: 112 }), Uint8Array.of(10, 112, 10, 1)));
  const cm = D.decodeCurrentMeterConfig(new Wr().u8(1).u8(6).u8(10).u8(1).s16(400).s16(-20).done());
  check('current meter decode', cm[0].scale === 400 && cm[0].offset === -20);
}

// board info (API 1.46 tail) and battery state
{
  const raw = new Wr().bytes(bytes('S405')).u16(0).u8(2).u8(53).pstr('SPEEDYBEEF405V4').pstr('SPEEDYBEEF405V4').pstr('SPBE').bytes(new Array(32).fill(0)).u8(3).u8(2).u16(8000).u32(1).done();
  const b = D.decodeBoardInfo(raw, 46);
  check('board info', b.boardId === 'S405' && b.manufacturer === 'SPBE' && b.gyroRateHz === 8000 && b.problems === 1 && b.configState === 2);
  const s = D.decodeBatteryState(new Wr().u8(6).u16(1300).u8(249).u16(100).s16(1250).u8(0).u16(2490).done());
  check('battery state', s.cells === 6 && s.volts === 24.9 && s.amps === 12.5 && s.mahDrawn === 100);
}

console.log(fails === 0 ? 'ALL OK' : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
