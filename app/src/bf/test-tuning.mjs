// Run: npx esbuild app/src/bf/test-tuning.mjs --bundle --platform=node --format=esm --outfile=$TEMP/bf-tuning-test.mjs && node $TEMP/bf-tuning-test.mjs
import assert from 'node:assert/strict';
import {
  decodePid, encodePid, decodePidAdvanced, encodePidAdvanced, decodeRcTuning, encodeRcTuning, decodeFilterConfig, encodeFilterConfig,
  rateAt, maxRate, throttleCurve, lowpassGain, notchGain, toDb, PID_ADV_FIELDS, FILTER_FIELDS,
} from './tuning.ts';
import { decodeStatusEx } from './decode.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// PID: 5 items, round trip, extra bytes untouched
{
  const raw = Uint8Array.from([48, 82, 38, 52, 88, 42, 45, 90, 3, 50, 75, 0, 40, 0, 0]);
  const t = decodePid(raw);
  check('pid items', t.items.length === 5 && t.items[0][0] === 48 && t.items[2][2] === 3);
  t.items[0][1] = 90;
  const out = encodePid(t.raw, t.items);
  check('pid roundtrip', out[1] === 90 && out[3] === 52 && out.length === raw.length);
  check('pid short payload tolerated', decodePid(Uint8Array.from([1, 2])).items.length === 0);
}

// PID_ADVANCED: 61 bytes (API 1.46) and 58 bytes (4.3 = 1.44 stops at offset 57)
{
  const raw = new Uint8Array(61);
  const dv = new DataView(raw.buffer);
  raw[8] = 15; raw[17] = 55; dv.setUint16(21, 80, true); raw[27] = 1; raw[28] = 0;
  dv.setUint16(32, 120, true); dv.setUint16(34, 125, true); dv.setUint16(36, 120, true);
  raw[39] = 40; raw[40] = 44; raw[41] = 3; raw[46] = 15; raw[57] = 1; raw[58] = 65; dv.setUint16(59, 1350, true);
  raw[5] = 0xaa; raw[23] = 0xbb; // legacy bytes must survive
  const d = decodePidAdvanced(raw, 46);
  check('adv decode', d.values.ff0 === 120 && d.values.dMax0 === 40 && d.values.tpaRate === 65 && d.values.tpaBreakpoint === 1350 && d.values.antiGravityGain === 80);
  const edited = { ...d.values, ff0: 150, dMax1: 50, tpaRate: 70 };
  const out = encodePidAdvanced(d.raw, edited, 46);
  const d2 = decodePidAdvanced(out, 46);
  check('adv roundtrip', d2.values.ff0 === 150 && d2.values.dMax1 === 50 && d2.values.tpaRate === 70 && d2.values.ff1 === 125);
  check('adv legacy bytes untouched', out[5] === 0xaa && out[23] === 0xbb && out.length === 61);
  const old = decodePidAdvanced(raw.subarray(0, 57), 44);
  check('adv API 1.44 (57 bytes): no TPA', old.values.tpaRate === undefined && old.values.ffAveraging !== undefined && old.values.ff0 === 120);
  const old2 = decodePidAdvanced(raw, 44);
  check('adv API gate hides tpa even if bytes present', old2.values.tpaMode === undefined);
  check('adv encode skips missing fields', encodePidAdvanced(raw.slice(0, 57), { tpaRate: 99 }, 46).length === 57);
}

// RC_TUNING 24 bytes (1.47) / 23 bytes
{
  const raw = new Uint8Array(24);
  const dv = new DataView(raw.buffer);
  raw[0] = 100; raw[1] = 0; raw[2] = 70; raw[3] = 70; raw[4] = 70; raw[6] = 50; raw[7] = 0;
  raw[10] = 0; raw[11] = 100; raw[12] = 100; raw[13] = 0; dv.setUint16(16, 1998, true); dv.setUint16(18, 1998, true); dv.setUint16(20, 1998, true);
  raw[22] = 0; raw[23] = 37;
  const d = decodeRcTuning(raw, 47);
  check('rc decode', d.values.rcRate0 === 100 && d.values.superRate1 === 70 && d.values.rateLimit2 === 1998 && d.values.throttleHover === 37 && d.values.ratesType === 0);
  const d46 = decodeRcTuning(raw, 46);
  check('throttle hover gated by API', d46.values.throttleHover === undefined);
  const out = encodeRcTuning(d.raw, { ...d.values, rcRate1: 120, ratesType: 4, throttleMid: 55 }, 47);
  const d2 = decodeRcTuning(out, 47);
  check('rc roundtrip', d2.values.rcRate1 === 120 && d2.values.ratesType === 4 && d2.values.throttleMid === 55 && d2.values.rcRate0 === 100);
  check('rc short payload', decodeRcTuning(raw.subarray(0, 8), 46).values.rcRate0 === 100 && decodeRcTuning(raw.subarray(0, 8), 46).values.rcExpo2 === undefined);
}

// FILTER_CONFIG 49 bytes
{
  const raw = new Uint8Array(49);
  const dv = new DataView(raw.buffer);
  raw[0] = 100;
  dv.setUint16(1, 100, true); dv.setUint16(20, 150, true); dv.setUint16(22, 0, true); raw[24] = 0; raw[25] = 0;
  dv.setUint16(26, 0, true); dv.setUint16(29, 150, true); dv.setUint16(31, 400, true); dv.setUint16(33, 70, true); dv.setUint16(35, 170, true);
  dv.setUint16(39, 300, true); dv.setUint16(41, 100, true); raw[43] = 3; raw[44] = 100; dv.setUint16(45, 600, true); raw[47] = 5; raw[48] = 3;
  const d = decodeFilterConfig(raw, 46);
  check('filter decode', d.values.gyroLpf1Hz === 150 && d.values.dynNotchQ === 300 && d.values.dynNotchMax === 600 && d.values.rpmHarmonics === 3 && d.values.dynNotchCount === 3 && d.values.dtermLpf1DynMax === 170);
  const out = encodeFilterConfig(d.raw, { ...d.values, gyroLpf1Hz: 300, rpmHarmonics: 2 }, 46);
  const d2 = decodeFilterConfig(out, 46);
  check('filter roundtrip + legacy u8 clamp', d2.values.gyroLpf1Hz === 300 && d2.values.rpmHarmonics === 2 && out[0] === 255);
  const old = decodeFilterConfig(raw.subarray(0, 41), 42);
  check('filter old (no dyn notch max)', old.values.dynNotchMax === undefined && old.values.dynNotchQ === 300);
  check('field tables have unique keys', new Set(PID_ADV_FIELDS.map((f) => f.key)).size === PID_ADV_FIELDS.length && new Set(FILTER_FIELDS.map((f) => f.key)).size === FILTER_FIELDS.length);
}

// rates
{
  // Betaflight defaults rcRate 1.00, super 0.70, expo 0: max = 200 * 1/(1-0.7) = 666.7
  check('betaflight max', near(maxRate('betaflight', { rcRate: 100, expo: 0, superRate: 70 }), 666.6667, 0.01));
  check('betaflight zero', rateAt('betaflight', { rcRate: 100, expo: 0, superRate: 70 }, 0) === 0);
  check('betaflight odd symmetry', near(rateAt('betaflight', { rcRate: 120, expo: 20, superRate: 60 }, -0.4), -rateAt('betaflight', { rcRate: 120, expo: 20, superRate: 60 }, 0.4)));
  // expo makes the centre softer
  check('betaflight expo softens centre', rateAt('betaflight', { rcRate: 100, expo: 50, superRate: 70 }, 0.2) < rateAt('betaflight', { rcRate: 100, expo: 0, superRate: 70 }, 0.2));
  // rcRate above 2.0 gets the extra increment
  check('betaflight rcRate>2 increment', near(rateAt('betaflight', { rcRate: 255, expo: 0, superRate: 0 }, 1), 200 * (2.55 + 14.54 * 0.55), 0.01) || rateAt('betaflight', { rcRate: 255, expo: 0, superRate: 0, limit: 5000 }, 1) > 1900);
  // actual: centre = rcRate*10 slope, max = superRate*10
  check('actual max', near(maxRate('actual', { rcRate: 20, expo: 0, superRate: 70 }), 700));
  check('actual curve at 0.1', near(rateAt('actual', { rcRate: 20, expo: 0, superRate: 70 }, 0.1), 0.1 * 200 + 500 * 0.01));
  // quick: max = superRate*10 (when above rcRate*2)
  check('quick max', near(maxRate('quick', { rcRate: 30, expo: 0, superRate: 80, limit: 1998 }), 800));
  // kiss (rc.c applyKissRates): 2000 * superFactor * (rcRate/1000) at x=1 -> 2000 * 0.1 / 0.3
  check('kiss max', near(maxRate('kiss', { rcRate: 100, expo: 0, superRate: 70 }), 2000 * 0.1 * (1 / 0.3), 0.01));
  check('raceflight max', near(maxRate('raceflight', { rcRate: 80, expo: 0, superRate: 50 }), 10 * 80 * 1 * 1.5, 0.01));
  check('limit clamps', maxRate('betaflight', { rcRate: 100, expo: 0, superRate: 90, limit: 500 }) === 500);
}

// throttle curve
{
  check('throttle linear', near(throttleCurve(50, 0, 0.3), 0.3) && near(throttleCurve(50, 0, 1), 1) && near(throttleCurve(50, 0, 0), 0));
  check('throttle mid shift', near(throttleCurve(50, 0, 0.5), 0.5));
  check('throttle expo mid stays', near(throttleCurve(50, 50, 0.5), 0.5) && throttleCurve(50, 50, 0.75) < 0.75);
}

// filter response
{
  check('PT1 -3 dB at cutoff', near(toDb(lowpassGain(0, 100, 100)), -3.0103, 0.01));
  check('PT2 -3 dB at cutoff', near(toDb(lowpassGain(2, 100, 100)), -3.0103, 0.01));
  check('PT3 -3 dB at cutoff', near(toDb(lowpassGain(3, 100, 100)), -3.0103, 0.01));
  check('biquad -3 dB at cutoff', near(toDb(lowpassGain(1, 100, 100)), -3.0103, 0.01));
  check('filter off = unity', lowpassGain(0, 0, 500) === 1);
  check('notch null at centre', notchGain(300, 3, 300) === 0 && near(notchGain(300, 3, 10), 1, 0.01));
}

// STATUS_EX (API 1.47): rate profile count at the end
{
  const p = new Uint8Array(16 + 4 + 1 + 4 + 1 + 2 + 1);
  const dv = new DataView(p.buffer);
  dv.setUint16(0, 125, true); dv.setUint32(6, 0b101, true); p[10] = 1; p[13] = 3; p[14] = 2; p[15] = 4; // 4 extra bytes
  p[16 + 4] = 24; dv.setUint32(16 + 4 + 1, 0, true); p[16 + 4 + 1 + 4] = 1; p[p.length - 1] = 6;
  const s = decodeStatusEx(p, 47);
  check('status_ex profiles', s.pidProfile === 1 && s.pidProfileCount === 3 && s.rateProfile === 2 && s.rateProfileCount === 6 && s.rebootRequired);
  check('status_ex mode flags', s.modeBits[0] && !s.modeBits[1] && s.modeBits[2] && s.modeBits.length === 64 && s.modeFlags === 0b101);
  check('status_ex API 1.46 has no rate profile count', decodeStatusEx(p.subarray(0, p.length - 1), 46).rateProfileCount === null);
}

assert.equal(fails, 0, `${fails} failed`);
console.log('all tuning tests passed');
