// Tests for the Motors / Blackbox / OSD decoders and the native BBL decoder.
// Run:  npx esbuild app/src/bf/test-motors.mjs --bundle --platform=node --format=esm --outfile=$TEMP/bf-motors-test.mjs && node $TEMP/bf-motors-test.mjs
import assert from 'node:assert/strict';
import * as M from './motors.ts';
import * as B from './blackbox.ts';
import * as O from './osd.ts';
import { demoMsp } from '../serial/demo-motors.ts';
import { analyze } from '../analysis/analyze.ts';
import { Reader, readFrame, decodeLog, splitLogs, summarizeBbl, parseBbl, looksLikeBbl } from './bbl.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}
const eq = (name, a, b) => {
  let ok = true;
  try {
    assert.deepEqual(a, b);
  } catch {
    ok = false;
  }
  check(name, ok, ok ? '' : `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
};
const u8 = (...n) => Uint8Array.from(n);

/* ---------------- motors ---------------- */
{
  // BF 4.5.1 style ADVANCED_CONFIG (API 1.46): 20 bytes
  const adv = new Uint8Array(20);
  const dv = new DataView(adv.buffer);
  adv[0] = 1; adv[1] = 2; adv[3] = 6; dv.setUint16(4, 480, true); dv.setUint16(6, 550, true); adv[9] = 1; adv[10] = 0; adv[18] = 6; adv[19] = 90;
  const a = M.decodeAdvancedConfig(adv);
  eq('advanced decode', [a.pidProcessDenom, a.protocol, a.pwmRate, a.idlePercent, a.debugMode, a.debugCount], [2, 6, 480, 5.5, 6, 90]);
  const out = M.encodeAdvancedConfig(a, { protocol: 7, idlePercent: 6.25, debugMode: 0 });
  check('advanced SET is 19 bytes', out.length === 19);
  const back = M.decodeAdvancedConfig(out);
  eq('advanced round trip patched', [back.protocol, back.idlePercent, back.debugMode, back.pidProcessDenom, back.pwmRate], [7, 6.25, 0, 2, 480]);
  check('advanced untouched byte kept', out[9] === 1);
  const short = M.decodeAdvancedConfig(u8(1, 1, 0, 6));
  eq('advanced short payload tolerated', [short.protocol, short.pwmRate, short.idlePercent], [6, 0, 0]);
  check('advanced encode from short pads to 19', M.encodeAdvancedConfig(short, { protocol: 5 }).length === 19);

  const mot = new Uint8Array(10);
  const mv = new DataView(mot.buffer);
  mv.setUint16(0, 1070, true); mv.setUint16(2, 2000, true); mv.setUint16(4, 1000, true); mot[6] = 4; mot[7] = 14; mot[8] = 1; mot[9] = 0;
  const m = M.decodeMotorConfig(mot, 46);
  eq('motor config decode', [m.minThrottle, m.maxThrottle, m.minCommand, m.motorCount, m.poles, m.bidir, m.escSensor, m.kv], [1070, 2000, 1000, 4, 14, true, false, null]);
  const ms = M.encodeMotorConfig(m, { poles: 12, bidir: false }, 46);
  eq('motor SET (API 1.46)', Array.from(ms), [0x2e, 0x04, 0xd0, 0x07, 0xe8, 0x03, 12, 0]);
  const m49 = M.decodeMotorConfig(new Uint8Array([...mot, 0xb8, 0x0b]), 49);
  check('motor kv on API 1.49', m49.kv === 3000);
  check('motor SET API 1.49 has kv', M.encodeMotorConfig(m49, { kv: 2400 }, 49).length === 10);

  eq('mixer round trip', M.decodeMixerConfig(M.encodeMixerConfig({ mixer: 3, reversed: true })), { mixer: 3, reversed: true });

  const tel = [
    { rpm: 24800, invalidPct: 0.5, tempC: 41, voltage: 24.9, current: 3.4, mah: 120 },
    { rpm: 25100, invalidPct: 0, tempC: 43, voltage: 24.88, current: 3.5, mah: 118 },
  ];
  const enc = M.encodeMotorTelemetry(tel);
  check('telemetry length 1+13n', enc.length === 27);
  eq('telemetry round trip', M.decodeMotorTelemetry(enc), tel);
  eq('telemetry truncated payload', M.decodeMotorTelemetry(enc.subarray(0, 20)).length, 1);
  eq('telemetry empty', M.decodeMotorTelemetry(new Uint8Array(0)), []);
  check('telemetryActive', M.telemetryActive(tel) && !M.telemetryActive(M.decodeMotorTelemetry(M.encodeMotorTelemetry([{ rpm: 0, invalidPct: 0, tempC: 0, voltage: 0, current: 0, mah: 0 }]))));
  eq('legacy ESC sensor', M.decodeEscSensor(u8(2, 40, 0x10, 0x27, 42, 0x20, 0x4e)).map((x) => [x.tempC, x.rpm]), [[40, 10000], [42, 20000]]);
  eq('validate ok', M.validateMotorEdit({ idlePercent: 5.5, poles: 14, protocol: 6, bidir: true }), []);
  eq('validate bad', M.validateMotorEdit({ idlePercent: 30, poles: 3, protocol: 1, bidir: true }), ['idle', 'poles', 'bidirProtocol']);
  eq('validate dyn idle', M.validateMotorEdit({ idlePercent: 5, poles: 14, protocol: 6, bidir: false, dynIdle: 250 }), ['dynIdle']);
  const d3 = M.encodeMotor3d({ low: 1406, high: 1514, neutral: 1460 });
  eq('3D round trip', M.decodeMotor3d(d3), { low: 1406, high: 1514, neutral: 1460 });
  check('3D short payload', M.decodeMotor3d(u8(1, 2)) === null);
  check('3D validate', M.validateMotor3d(M.MOTOR_3D_DEFAULTS) && !M.validateMotor3d({ low: 1480, high: 1514, neutral: 1460 }));
  check('feature bits', M.featureOn(M.setFeature(0, M.MOTOR_FEATURE.ESC_SENSOR, true), 27) && M.setFeature(0x10, 4, false) === 0);
  eq('pct to motor value', [M.pctToMotor(0), M.pctToMotor(30), M.pctToMotor(150)], [1000, 1300, 2000]);
  {
    const cfg3 = { protocol: 6, bidir: false, pidDenom: 1, poles: 14 };
    demoMsp(M.MSPM.SET_MOTOR_3D_CONFIG, M.encodeMotor3d({ low: 1400, high: 1520, neutral: 1450 }), cfg3, 0);
    eq('demo 3D write/read', M.decodeMotor3d(demoMsp(M.MSPM.MOTOR_3D_CONFIG, undefined, cfg3, 0)), { low: 1400, high: 1520, neutral: 1450 });
    const fm = new DataView(demoMsp(M.MSPM.FEATURE_CONFIG, undefined, cfg3, 0).buffer).getUint32(0, true);
    check('demo features include ESC_SENSOR', M.featureOn(fm, 27));
  }
  check('debug mode names (4.5 only)', M.debugModeName(6, 46) === 'GYRO_SCALED' && M.debugModeName(6, 44) === '#6');
}

/* ---------------- blackbox / dataflash ---------------- */
{
  const s = { ready: true, supported: true, sectors: 4096, totalSize: 16777216, usedSize: 5242880 };
  const e = B.encodeFlashSummary(s);
  check('flash summary 13 bytes', e.length === 13);
  eq('flash summary round trip', B.decodeFlashSummary(e), s);
  check('flash summary short = unsupported', !B.decodeFlashSummary(u8(1, 2, 3)).supported);

  const cfg46 = B.encodeBlackboxConfigRead({ device: 1, rateNum: 1, rateDenom: 2, pRatio: 8, sampleRate: 1, disabledMask: 0 }, 46);
  const c = B.decodeBlackboxConfig(cfg46, 46);
  eq('blackbox config decode', [c.supported, c.device, c.rateNum, c.rateDenom, c.pRatio, c.sampleRate, c.disabledMask], [true, 1, 1, 2, 8, 1, 0]);
  const set = B.encodeBlackboxConfig(c, { device: 2, sampleRate: 2 }, 46);
  check('blackbox SET 1.45+ = 10 bytes', set.length === 10);
  eq('blackbox SET fields', [set[0], set[1], set[2], set[3] | (set[4] << 8), set[5]], [2, 1, 2, 16, 2]);
  const set44 = B.encodeBlackboxConfig(B.decodeBlackboxConfig(B.encodeBlackboxConfigRead({ device: 1, rateNum: 1, rateDenom: 1, pRatio: 4, sampleRate: 2, disabledMask: 0 }, 44), 44), { sampleRate: 1 }, 44);
  check('blackbox SET 1.44 = 6 bytes, pRatio halved', set44.length === 6 && (set44[3] | (set44[4] << 8)) === 2 && set44[5] === 1);
  check('rate Hz', Math.abs(B.loggingRateHz(125, 1) - 4000) < 1e-9);

  const req = B.encodeFlashRead(0x1234, 224);
  eq('flash read request', Array.from(req), [0x34, 0x12, 0, 0, 224, 0, 0]);
  const data = u8(1, 2, 3, 4, 5);
  const resp = B.encodeFlashReadResponse(0x1234, data);
  const ch = B.decodeFlashRead(resp, 0x1234);
  check('flash read response', ch.ok && ch.address === 0x1234 && ch.data.length === 5 && ch.data[4] === 5);
  check('flash read wrong address', !B.decodeFlashRead(resp, 0x9999).ok && B.decodeFlashRead(resp, 0x9999).reason === 'address');
  const comp = resp.slice();
  comp[6] = 1;
  check('flash read compressed -> error', B.decodeFlashRead(comp, 0x1234).reason === 'compressed');
  check('flash read short', B.decodeFlashRead(u8(1, 2), 0).reason === 'short');
  eq('msc reply', B.decodeMscReply(u8(2, 1)), { mode: 2, ready: true });
  check('log name', /^LOG_\d{8}-\d{6}\.bbl$/.test(B.logFileName()));
  eq('sd summary', B.decodeSdSummary(u8(1, 4, 0, 0x10, 0, 0, 0, 0x20, 0, 0, 0)).state, 4);
}

/* ---------------- OSD ---------------- */
{
  const pos = { x: 38, y: 17, vis: [true, false, true], type: 0 };
  const w = O.encodePos(pos);
  eq('osd position round trip (HD x>31)', O.decodePos(w), pos);
  check('osd position word layout', O.encodePos({ x: 5, y: 3, vis: [true, false, false], type: 0 }) === (5 | (3 << 5) | 0x0800));
  const cfg = {
    flags: 0x25, video: 1, units: 1, rssiAlarm: 20, capAlarm: 2200, altAlarm: 100,
    items: [O.encodePos({ x: 2, y: 1, vis: [true, true, true], type: 0 }), 0, O.encodePos({ x: 40, y: 18, vis: [true, false, false], type: 1 })],
    stats: [1, 0, 1, 1], timers: [0x0100, 0x0110], warnings: 0x0003ffff, warningCount: 18,
    profileCount: 3, profile: 1, overlay: 0, camW: 24, camH: 11, lqAlarm: 70,
  };
  const enc = O.encodeOsdConfig(cfg);
  eq('osd config round trip', O.decodeOsdConfig(enc), cfg);
  const noLq = O.encodeOsdConfig({ ...cfg, lqAlarm: null });
  eq('osd config without link-quality alarm (API<1.46)', O.decodeOsdConfig(noLq).lqAlarm, null);
  // forward compatibility: an FC with more items than we know keeps them
  const big = { ...cfg, items: Array.from({ length: 80 }, (_, i) => i) };
  eq('osd unknown extra items kept', O.decodeOsdConfig(O.encodeOsdConfig(big)).items.length, 80);
  check('osd tail after items parsed by counts', O.decodeOsdConfig(O.encodeOsdConfig(big)).camW === 24);
  eq('grid pal/ntsc/hd', [O.gridFor(1), O.gridFor(2), O.gridFor(3), O.gridFor(3, { cols: 60, rows: 22 }), O.gridFor(0)], [{ cols: 30, rows: 16 }, { cols: 30, rows: 13 }, { cols: 53, rows: 20 }, { cols: 60, rows: 22 }, { cols: 30, rows: 16 }]);
  eq('canvas', O.decodeCanvas(u8(53, 20)), { cols: 53, rows: 20 });
  eq('set item payload', Array.from(O.encodeSetItem(7, 0x0a45)), [7, 0x45, 0x0a]);
  eq('set stat payload', Array.from(O.encodeSetStat(3, true)), [3, 1, 0, 0]);
  const g = O.encodeSetGeneral(cfg);
  check('general payload starts 0xFF', g[0] === 0xff && g[1] === 1 && g[2] === 1 && g[3] === 20 && g.length === 22);
  const to = { ...cfg, items: [...cfg.items], units: 0 };
  to.items[1] = O.encodePos({ x: 10, y: 4, vis: [true, true, false], type: 0 });
  const d = O.diffOsd(cfg, to);
  check('diff: one item + general', d.length === 2 && d[0][0] === 1 && d[1][0] === 0xff);
  eq('diff: no change', O.diffOsd(cfg, cfg), []);
}

/* ---------------- BBL decoder ---------------- */
{
  // literal vectors (hand-built from the format description)
  const rd = (bytes, n = 1) => new Reader(Uint8Array.from(bytes), 0, bytes.length);
  let r = rd([0xac, 0x02]);
  check('unsigned VB 300', r.uvb() === 300);
  r = rd([0x01, 0x02, 0x03, 0x04]);
  eq('signed VB zigzag', [r.svb(), r.svb(), r.svb(), r.svb()], [-1, 1, -2, 2]);
  let out = [];
  readFrame(rd([0x1b]), [7, 7, 7], out);
  eq('TAG2_3S32 2-bit', out, [1, -2, -1]);
  out = [];
  readFrame(rd([0x45, 0xf3]), [7, 7, 7], out);
  eq('TAG2_3S32 4-bit', out, [5, -1, 3]);
  out = [];
  readFrame(rd([0xbf, 0x05, 0x20]), [7, 7, 7], out);
  eq('TAG2_3S32 6-bit', out, [-1, 5, -32]);
  out = [];
  readFrame(rd([0xe4, 0xfe, 0x00, 0x01, 0x10, 0x00, 0x00]), [7, 7, 7], out);
  eq('TAG2_3S32 8/16/24-bit', out, [-2, 256, 16]);
  out = [];
  readFrame(rd([0xe4, 0x7f, 0x2c, 0x12, 0x34]), [8, 8, 8, 8], out);
  eq('TAG8_4S16 packed nibble/byte/16bit', out, [0, 7, -14, -16093]);
  out = [];
  readFrame(rd([0b00000101, 0x02, 0x04]), [6, 6, 6], out);
  eq('TAG8_8SVB tag bits', out, [1, 0, 2]);
  out = [];
  readFrame(rd([0x03]), [3], out);
  eq('NEG_14BIT', out, [-3]);

  // synthetic log writer (own implementation of the encoders; decoder must give back the source signals)
  const uvbE = (v) => { const o = []; v = Math.floor(v); while (v >= 128) { o.push((v % 128) | 0x80); v = Math.floor(v / 128); } o.push(v); return o; };
  const svbE = (v) => uvbE(v >= 0 ? v * 2 : -v * 2 - 1);
  const fits = (v, bits) => v >= -(1 << (bits - 1)) && v < 1 << (bits - 1);
  const tag23 = (v) => {
    if (v.every((x) => fits(x, 2))) return [((v[0] & 3) << 4) | ((v[1] & 3) << 2) | (v[2] & 3)];
    if (v.every((x) => fits(x, 4))) return [0x40 | (v[0] & 15), ((v[1] & 15) << 4) | (v[2] & 15)];
    if (v.every((x) => fits(x, 6))) return [0x80 | (v[0] & 63), v[1] & 63, v[2] & 63];
    let lead = 0xc0;
    const body = [];
    v.forEach((x, i) => {
      if (fits(x, 8)) body.push(x & 255);
      else if (fits(x, 16)) { lead |= 1 << (i * 2); body.push(x & 255, (x >> 8) & 255); }
      else { lead |= 2 << (i * 2); body.push(x & 255, (x >> 8) & 255, (x >> 16) & 255); }
    });
    return [lead, ...body];
  };
  const tag4s16 = (v) => {
    let sel = 0;
    const nibs = [];
    const bytesOut = [];
    // simple, valid encoding: no nibble packing for 8/16-bit fields -> only use zero / 8 / 16-bit selectors (nibble index stays 0)
    v.forEach((x, i) => {
      if (x === 0) return;
      if (fits(x, 8)) { sel |= 2 << (i * 2); bytesOut.push(x & 255); }
      else { sel |= 3 << (i * 2); bytesOut.push((x >> 8) & 255, x & 255); }
    });
    void nibs;
    return [sel, ...bytesOut];
  };
  const tag88 = (v) => {
    let tag = 0;
    const body = [];
    v.forEach((x, i) => { if (x !== 0) { tag |= 1 << i; body.push(...svbE(x)); } });
    return [tag, ...body];
  };

  const names = ['loopIteration', 'time', 'setpoint[0]', 'setpoint[1]', 'setpoint[2]', 'setpoint[3]', 'gyroADC[0]', 'gyroADC[1]', 'gyroADC[2]', 'motor[0]', 'motor[1]', 'motor[2]', 'motor[3]'];
  const hdr = (extra = '') =>
    [
      'H Product:Blackbox flight data recorder by Nicholas Sherlock',
      'H Data version:2',
      'H I interval:32',
      'H P interval:1/1',
      `H Field I name:${names.join(',')}`,
      'H Field I signed:0,0,1,1,1,1,1,1,1,0,1,1,1',
      'H Field I predictor:0,0,0,0,0,0,0,0,0,11,5,5,5',
      'H Field I encoding:1,1,0,0,0,0,0,0,0,1,0,0,0',
      'H Field P predictor:6,2,1,1,1,1,3,3,3,3,3,3,3',
      'H Field P encoding:9,0,8,8,8,8,7,7,7,6,6,6,6',
      'H minthrottle:1070',
      'H motorOutput:48,2047',
      'H Firmware revision:Betaflight 4.5.1 (77d01ba3b) STM32F405',
      'H Firmware date:Jan  8 2025 10:23:01',
      'H Craft name:TESTQUAD',
      'H looptime:125',
      extra,
    ]
      .filter(Boolean)
      .join('\n') + '\n';

  const N = 6000;
  const dtUs = 250; // 4 kHz
  const src = [];
  for (let k = 0; k < N; k++) {
    const t = k * dtUs;
    const sp = [0, 1, 2].map((a) => Math.round(300 * Math.sin(k / (40 + a * 7)) + (k % 700 < 20 ? 500 : 0)));
    const gy = [0, 1, 2].map((a) => Math.round(280 * Math.sin((k - 6) / (40 + a * 7)) + 6 * Math.sin(k * 0.9 + a)));
    const mo = [0, 1, 2, 3].map((m) => Math.round(1200 + 400 * Math.sin(k / 90 + m) + 3 * Math.sin(k * 1.3 + m)));
    src.push({ t, sp, gy, mo });
  }
  const frame = (k) => [k, src[k].t, ...src[k].sp, 1000 + (k % 50), ...src[k].gy, ...src[k].mo];
  function writeLog(startK, count) {
    const bytes = [...Buffer.from(hdr('H Log start datetime:2026-11-16T10:00:00.000+00:00'), 'latin1')];
    let prev = null;
    let prev2 = null;
    for (let k = startK; k < startK + count; k++) {
      const f = frame(k);
      f[5] = 1000 + (k % 50);
      if ((k - startK) % 32 === 0) {
        // intra frame
        const raw = [f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8], f[9] - 48, f[10] - f[9], f[11] - f[9], f[12] - f[9]];
        bytes.push(0x49, ...uvbE(raw[0]), ...uvbE(raw[1]), ...svbE(raw[2]), ...svbE(raw[3]), ...svbE(raw[4]), ...svbE(raw[5]), ...svbE(raw[6]), ...svbE(raw[7]), ...svbE(raw[8]), ...uvbE(raw[9]), ...svbE(raw[10]), ...svbE(raw[11]), ...svbE(raw[12]));
        prev = prev2 = f;
      } else {
        const avg = (i) => Math.trunc((prev[i] + prev2[i]) / 2);
        const d = [
          f[1] - (2 * prev[1] - prev2[1]),
          f[2] - prev[2], f[3] - prev[3], f[4] - prev[4], f[5] - prev[5],
          f[6] - avg(6), f[7] - avg(7), f[8] - avg(8),
          f[9] - avg(9), f[10] - avg(10), f[11] - avg(11), f[12] - avg(12),
        ];
        bytes.push(0x50, ...svbE(d[0]), ...tag4s16(d.slice(1, 5)), ...tag23(d.slice(5, 8)), ...tag88(d.slice(8, 12)));
        prev2 = prev;
        prev = f;
      }
      if (k === startK + 40) bytes.push(0x45, 0, ...uvbE(1234)); // sync-beep event between P frames
    }
    return bytes;
  }
  const a = writeLog(0, 3000);
  const b2 = writeLog(3000, 3000);
  const file = Uint8Array.from([...a, 0x45, 255, ...Buffer.from('End of log\0', 'latin1'), ...b2]);

  check('looksLikeBbl', looksLikeBbl(file) && !looksLikeBbl(u8(65, 66, 67)));
  const starts = splitLogs(file);
  check('splitLogs finds 2 logs', starts.length === 2, String(starts));
  const dec = decodeLog(file, starts[0], starts[1]);
  check('log 1 row count', dec.rows === 3000, `${dec.rows} corrupt ${dec.corrupt}`);
  let maxErr = 0;
  for (let k = 0; k < dec.rows; k++) {
    for (let a2 = 0; a2 < 3; a2++) {
      maxErr = Math.max(maxErr, Math.abs(dec.gyro[a2][k] - src[k].gy[a2]), Math.abs(dec.setpoint[a2][k] - src[k].sp[a2]));
    }
    for (let m = 0; m < 4; m++) maxErr = Math.max(maxErr, Math.abs(dec.motor[m][k] - src[k].mo[m]));
    maxErr = Math.max(maxErr, Math.abs(dec.time[k] - src[k].t));
  }
  check('decoded signals equal the source (gyro, setpoint, motor, time)', maxErr === 0, `max error ${maxErr}`);
  check('no resync needed on a clean log', dec.corrupt === 0);

  const sum = summarizeBbl(file);
  check('summary: firmware, craft, logs', sum.logs === 2 && /Betaflight 4\.5\.1/.test(sum.firmware) && sum.craft === 'TESTQUAD' && sum.looptimeUs === 125, JSON.stringify(sum));
  check('summary: duration ~0.75 s', Math.abs(sum.duration - 0.75) < 0.01, String(sum.duration));

  // corruption: flip bytes in the middle of log 1, decoder must resync at the next I frame and keep most rows
  const bad = file.slice();
  for (let i = 0; i < 60; i++) bad[starts[0] + 2500 + i] = 0xff;
  const dec2 = decodeLog(bad, starts[0], starts[1]);
  check('corrupt data: resync, most rows kept', dec2.rows > 2500 && dec2.rows < 3000 && dec2.corrupt > 0, `${dec2.rows} rows, ${dec2.corrupt} dropped`);

  // whole-file parse (needs >= 1000 rows; longest log wins) -> LogData for the autotune analysis
  const blob = new Blob([file]);
  const ld = await parseBbl(blob, () => {});
  check('parseBbl LogData', ld.rows === 3000 && Math.abs(ld.fs - 4000) < 1 && ld.gyro.length === 3 && ld.setpoint.length === 3 && ld.motor.length === 4 && !ld.rcFallback, `fs ${ld.fs.toFixed(0)} rows ${ld.rows}`);

  // header without setpoint -> rcCommand fallback is exercised by the CSV path; here: missing gyro must give a clear error
  const noGyro = Uint8Array.from([...Buffer.from(hdr().replaceAll('gyroADC', 'gyroXX'), 'latin1'), 0x49, 0]);
  let err = '';
  try {
    decodeLog(noGyro, 0, noGyro.length);
  } catch (e) {
    err = e.key;
  }
  check('missing gyro columns -> LogError', err === 'at.err.missingCols', err);
}

/* demo FC: download the whole flash through MSP_DATAFLASH_READ, decode and analyse it like the Autotune tab does */
{
  const cfg = { protocol: 6, bidir: false, pidDenom: 1, poles: 14 };
  const sum = B.decodeFlashSummary(demoMsp(70, undefined, cfg, 0));
  check('demo flash summary', sum.supported && sum.usedSize > 100000 && sum.totalSize === 16777216, String(sum.usedSize));
  const parts = [];
  let addr = 0;
  while (addr < sum.usedSize) {
    const ch = B.decodeFlashRead(demoMsp(71, B.encodeFlashRead(addr, 4096), cfg, 0), addr);
    if (!ch.ok || !ch.data.length) break;
    parts.push(ch.data);
    addr += ch.data.length;
  }
  const bytes = new Uint8Array(addr);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }
  check('demo flash fully downloaded', addr === sum.usedSize);
  const info = summarizeBbl(bytes);
  check('demo log summary', info.logs === 1 && /Betaflight 4.5.1/.test(info.firmware) && info.duration > 13.9 && info.duration < 14.1, JSON.stringify(info));
  const ld = await parseBbl(new Blob([bytes]), () => {});
  const res = analyze(ld, 'demo.bbl');
  check('demo log analyses (step response found)', ld.rows === 28000 && res.axes[0].windows > 5, 'rows ' + ld.rows + ' windows ' + res.axes[0].windows + ' overshoot ' + res.axes[0].overshoot);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
