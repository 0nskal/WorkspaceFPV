// Tests of the Sensors / GPS decoders and encoders. Run via `npm test` (bundled with esbuild).
import * as D from './decode.ts';
import { Wr } from './codec.ts';
import { API } from './codes.ts';
import { DemoBf } from '../serial/demo-bf.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// SENSOR_CONFIG: API 1.46 sends sonar too but the SET payload has only 3 bytes; 1.47 adds sonar + optical flow, 1.49 pitot
{
  const raw46 = Uint8Array.of(0, 0, 0, 7);
  check('sensor config decode', D.decodeSensorConfig(raw46).mag === 0);
  check('SET_SENSOR_CONFIG 1.46 = 3 bytes', same(D.encodeSensorConfig({ acc: 1, baro: 0, mag: 1 }, raw46, API.BF45), [1, 0, 1]));
  check('SET_SENSOR_CONFIG 1.47 keeps sonar/optical flow', same(D.encodeSensorConfig({ acc: 0, baro: 0, mag: 0 }, Uint8Array.of(0, 0, 0, 5, 6), API.BF2025_12), [0, 0, 0, 5, 6]));
  check('SET_SENSOR_CONFIG 1.49 adds pitot', same(D.encodeSensorConfig({ acc: 0, baro: 1, mag: 1 }, Uint8Array.of(0, 0, 0, 5, 6, 9), API.MASTER), [0, 1, 1, 5, 6, 9]));
}

// RAW_IMU scaling (acc / 2048 g, gyro * 4 / 16.4 deg/s)
{
  const p = new Wr().s16(2048).s16(-1024).s16(0).s16(41).s16(-82).s16(0).s16(300).s16(-5).s16(1).done();
  const r = D.decodeRawImu(p);
  check('raw imu acc', r.acc[0] === 1 && r.acc[1] === -0.5 && r.acc[2] === 0);
  check('raw imu gyro', Math.abs(r.gyro[0] - 41 * (4 / 16.4)) < 1e-9 && r.gyro[1] < 0);
  check('raw imu mag', r.mag[0] === 300 && r.mag[1] === -5);
}

// ALTITUDE: s32 cm (+ s16 cm/s)
{
  const r = D.decodeAltitude(new Wr().u32(0xffffff9c).s16(-12).done()); // -100 cm
  check('altitude negative', r.altM === -1 && r.varioMs === -0.12);
  check('altitude 4 bytes only', D.decodeAltitude(new Wr().u32(1234).done()).altM === 12.34);
}

// RAW_GPS with and without the positional DOP (API 1.46+)
{
  const base = new Wr().u8(2).u8(10).u32(Math.round(47.491941 * 1e7)).u32(Math.round(19.053977 * 1e7)).u16(120).u16(250).u16(1340);
  const g = D.decodeRawGps(base.done());
  check('raw gps position', g.fix === 2 && g.numSat === 10 && Math.abs(g.lat - 47.491941) < 1e-7 && Math.abs(g.lon - 19.053977) < 1e-7);
  check('raw gps units', g.altM === 120 && g.speedCms === 250 && g.courseDeg === 134 && g.pdop === 0);
  const withDop = new Wr().u8(2).u8(10).u32(0).u32(0).u16(0).u16(0).u16(0).u16(97).done();
  check('raw gps pdop', D.decodeRawGps(withDop).pdop === 0.97);
  const south = new Wr().u8(2).u8(8).u32(-338688000 >>> 0).u32(1512093000).u16(0).u16(0).u16(0).done();
  const s = D.decodeRawGps(south);
  check('raw gps negative latitude', Math.abs(s.lat + 33.8688) < 1e-6 && Math.abs(s.lon - 151.2093) < 1e-6);
}

// COMP_GPS + offset of the quad from home
{
  const c = D.decodeCompGps(new Wr().u16(100).u16(180).u8(1).done()); // home is to the south, so the quad is 100 m north of it
  const o = D.offsetFromHome(c);
  check('comp gps decode', c.distanceM === 100 && c.directionDeg === 180);
  check('offset from home (quad north of home)', Math.abs(o.north - 100) < 1e-6 && Math.abs(o.east) < 1e-6);
  const o2 = D.offsetFromHome({ distanceM: 50, directionDeg: 270, update: 1 }); // home to the west -> quad east
  check('offset from home (quad east of home)', Math.abs(o2.east - 50) < 1e-6 && Math.abs(o2.north) < 1e-6);
}

// GPS_SV_INFO
{
  const p = new Wr().u8(2).u8(0).u8(7).u8(13).u8(42).u8(2).u8(1).u8(1).u8(0).done();
  const sv = D.decodeGpsSvInfo(p);
  check('sv info', sv.length === 2 && sv[0].svid === 7 && sv[0].quality === 13 && (sv[0].quality & 8) !== 0 && (sv[0].quality & 7) === 5 && sv[0].cno === 42 && sv[1].gnss === 2);
  check('sv info empty', D.decodeGpsSvInfo(new Uint8Array(0)).length === 0);
  check('sv info truncated', D.decodeGpsSvInfo(Uint8Array.of(3, 0, 1, 2, 3)).length === 1);
}

// GPS_CONFIG round trip keeps unknown tail bytes
{
  const raw = Uint8Array.of(1, 1, 1, 1, 1, 1, 9);
  const c = D.decodeGpsConfig(raw);
  check('gps config decode', c.provider === 1 && c.sbas === 1 && c.autoConfig && c.autoBaud && c.homePointOnce && c.useGalileo);
  const out = D.encodeGpsConfig({ ...c, provider: 0, sbas: 5, useGalileo: false }, raw);
  check('gps config encode', same(out, [0, 5, 1, 1, 1, 0, 9]));
}

// demo FC: GPS answers decode, SET commands are accepted and read back
{
  const demo = new DemoBf(() => ({ protocol: 6, bidir: false, pidDenom: 1, poles: 14 }));
  const sv = D.decodeGpsSvInfo(demo.handle(166 - 2, undefined, 3.2) ?? new Uint8Array(0));
  check('demo sv info (code 164)', sv.length > 16 && sv.some((c) => (c.quality & 8) !== 0));
  const gps = D.decodeRawGps(demo.handle(106, undefined, 3.2));
  check('demo raw gps fix + sats', gps.fix === 2 && gps.numSat >= 10 && gps.numSat <= 14 && Math.abs(gps.lat - 52.215) < 0.001);
  const used = sv.filter((c) => (c.quality & 8) !== 0).length;
  check('demo sat count matches used sats', used === gps.numSat);
  demo.handle(223, Uint8Array.of(0, 5, 0, 1, 0, 0), 0);
  const cfg = D.decodeGpsConfig(demo.handle(132, undefined, 0));
  check('demo SET_GPS_CONFIG stored', cfg.provider === 0 && cfg.sbas === 5 && !cfg.autoConfig && cfg.autoBaud);
  demo.handle(97, Uint8Array.of(1, 0, 1), 0);
  const sc = D.decodeSensorConfig(demo.handle(96, undefined, 0));
  check('demo SET_SENSOR_CONFIG stored', sc.acc === 1 && sc.baro === 0 && sc.mag === 1);
}

if (fails) {
  console.log(`\n${fails} FAILED`);
  process.exit(1);
}
console.log('\nall sensors/gps tests passed');
