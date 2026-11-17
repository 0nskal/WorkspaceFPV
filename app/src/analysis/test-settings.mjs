// Header settings (analysis/settings.ts), CSV header rows + optional columns (parse.ts), multi-session .bbl (bf/bbl.ts).
// npm test, or: npx esbuild app/src/analysis/test-settings.mjs --bundle --platform=node --format=esm --outfile=%TEMP%/s.mjs && node %TEMP%/s.mjs
import assert from 'node:assert/strict';
import { parseLogSettings, hasGyroScaledDebug, rpmFilterActive } from './settings.ts';
import { parseCsv } from './parse.ts';
import { decodeSessions, parseBblSessions, parseBbl } from '../bf/bbl.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}
const near = (a, b, tol) => a !== undefined && a !== null && Math.abs(a - b) <= tol;

// 1. Betaflight 4.5-style header
{
  const s = parseLogSettings({
    'Firmware revision': 'Betaflight 4.5.1 (77d01ba3b) STM32F405',
    'Firmware date': 'Jan  8 2025 10:23:01',
    'Craft name': 'QUAD',
    looptime: '125',
    pid_process_denom: '2',
    'P interval': '2',
    debug_mode: '6',
    rollPID: '45,80,40',
    pitchPID: '47,84,46',
    yawPID: '45,80,0',
    d_min: '30,34,0',
    ff_weight: '120,125,120',
    simplified_pids_mode: '2',
    simplified_master_multiplier: '120',
    simplified_pi_gain: '80',
    simplified_dmax_gain: '100',
    simplified_dterm_filter: '1',
    simplified_gyro_filter_multiplier: '110',
    gyro_lpf1_dyn_hz: '250,500',
    gyro_lpf2_static_hz: '500',
    dterm_lpf1_dyn_hz: '75,150',
    dyn_notch_count: '3',
    dyn_notch_min_hz: '100',
    rpm_filter_harmonics: '3',
    rpm_filter_min_hz: '100',
    dshot_bidir: '1',
    motor_poles: '14',
    tpa_rate: '65',
    tpa_breakpoint: '1350',
    iterm_relax: '1',
    iterm_relax_cutoff: '15',
    dyn_idle_min_rpm: '30',
    feedforward_boost: '15',
    motorOutput: '158,2047',
  });
  check('firmware version', JSON.stringify(s.firmwareVersion) === '[4,5,1]' && s.firmwareName === 'Betaflight', JSON.stringify(s.firmwareVersion));
  check('rates: gyro 8k, pid 4k, blackbox 2k', s.gyroHz === 8000 && s.pidHz === 4000 && s.bbPDenom === 2 && s.bbRateHz === 2000, `${s.gyroHz} ${s.pidHz} ${s.bbRateHz}`);
  check('debug GYRO_SCALED', s.debugMode === 6 && s.debugModeName === 'GYRO_SCALED' && hasGyroScaledDebug(s));
  check('PIDs, FF, d_min scheme', s.pid.pitch[2] === 46 && s.ff[1] === 125 && s.dMin[1] === 34 && s.dScheme === 'dmin');
  check('sliders x100 -> multipliers', s.simplified.mode === 'rpy' && s.simplified.master === 1.2 && s.simplified.pi === 0.8 && s.simplified.gyroMultiplier === 1.1 && s.simplified.dtermFilter === true && s.simplified.dmaxKey === 'simplified_dmax_gain');
  check('filters', s.gyroLpf1DynMinHz === 250 && s.gyroLpf1DynMaxHz === 500 && s.dtermLpf1DynMaxHz === 150 && s.dynNotchCount === 3 && s.rpmHarmonics === 3);
  check('motors, TPA, relax, idle', s.dshotBidir === true && s.motorPoles === 14 && s.tpaRate === 65 && s.itermRelax === 1 && s.dynIdleMinRpm === 30 && s.ffBoost === 15 && s.motorOutput[1] === 2047);
  check('RPM filter active', rpmFilterActive(s) === true);
  check('raw map kept', s.raw.rollPID === '45,80,40');
}

// 2. older (4.2-style) keys, fraction P interval, names instead of numbers, 2025 d_max scheme, garbage
{
  const old = parseLogSettings({ 'Firmware revision': 'Betaflight 4.2.11 (948ba6339) STM32F7X2', looptime: '125', pid_process_denom: '1', 'P interval': '1/2', gyro_lowpass_hz: '200', dyn_lpf_gyro_min_hz: '200', dyn_lpf_gyro_max_hz: '500', dterm_lowpass_hz: '100', dterm_lowpass2_hz: '150', debug_mode: 'GYRO_SCALED', iterm_relax: 'RP', dshot_bidir: 'OFF', simplified_pids_mode: 'OFF' });
  check('old: fraction P interval', old.bbPDenom === 2 && old.bbRateHz === 4000, String(old.bbRateHz));
  check('old: lowpass aliases', old.gyroLpf1StaticHz === 200 && old.gyroLpf1DynMinHz === 200 && old.gyroLpf1DynMaxHz === 500 && old.dtermLpf1StaticHz === 100 && old.dtermLpf2StaticHz === 150);
  check('old: names', old.debugMode === 6 && old.itermRelax === 1 && old.dshotBidir === false && old.simplified.mode === 'off');
  check('old: RPM filter off', rpmFilterActive(old) === false);
  const nu = parseLogSettings({ 'Firmware revision': 'Betaflight 2025.12.0 (abc) STM32H743', d_max: '45,50,0', rollPID: '45,80,30', pitchPID: '47,84,34', yawPID: '45,80,0', simplified_d_max_gain: '110' });
  check('2025: d_max scheme', nu.dScheme === 'dmax' && nu.dMax[0] === 45 && nu.firmwareVersion[0] === 2025 && nu.simplified.dmaxKey === 'simplified_d_max_gain' && nu.simplified.dmax === 1.1);
  const junk = parseLogSettings({ rollPID: 'a,b', looptime: 'x', motorOutput: '2000,100', debug_mode: '99' });
  check('malformed values are left out', junk.pid === undefined && junk.gyroHz === undefined && junk.motorOutput === undefined && junk.debugMode === 99 && junk.debugModeName === undefined);
  check('empty header', Object.keys(parseLogSettings({})).join() === 'raw');
}

// 3. CSV export with header rows and optional columns
{
  const fs = 2000;
  const rows = [
    '"Product","Blackbox flight data recorder by Nicholas Sherlock"',
    '"Firmware revision","Betaflight 4.4.3 (abc) STM32F7X2"',
    '"rollPID","50,90,42"',
    '"pitchPID","52,92,44"',
    '"yawPID","45,90,0"',
    '"debug_mode","6"',
    '"motorOutput","48,2047"',
    'H simplified_pi_gain:90',
    '"loopIteration","time (us)","axisD[0]","axisD[1]","setpoint[0]","setpoint[1]","setpoint[2]","setpoint[3]","gyroADC[0]","gyroADC[1]","gyroADC[2]","rcCommand[3]","debug[0]","debug[1]","debug[2]","debug[3]","motor[0]","motor[1]","motor[2]","motor[3]"',
  ];
  for (let i = 0; i < 3000; i++) {
    const g = Math.sin(i / 50) * 100;
    rows.push([i, Math.round((i * 1e6) / fs), (g * 0.1).toFixed(1), 1, g.toFixed(1), 0, 0, 0, g.toFixed(1), 0, 0, 1500, (g + 3).toFixed(1), 2, 3, 0, 1200, 1200, 1200, 1200].join(','));
  }
  const log = await parseCsv(new Blob([rows.join('\n')]), () => {});
  check('csv: header rows -> settings', log.settings?.firmwareVersion?.[1] === 4 && log.settings.simplified?.pi === 0.9 && JSON.stringify(log.headerPid?.pitch) === '[52,92,44]' && log.motorRange?.[0] === 48, JSON.stringify(log.settings?.firmwareVersion));
  check('csv: axisD, debug and GYRO_SCALED gyroUnfilt', log.axisD?.length === 2 && log.debug?.length === 4 && log.gyroUnfilt?.length === 3 && near(log.gyroUnfilt[0][100] - log.gyro[0][100], 3, 0.11), `${log.axisD?.length} ${log.debug?.length}`);
  check('csv: rows and rate', log.rows === 3000 && near(log.fs, 2000, 1));
}

// 4. multi-session .bbl: intra-frame-only writer (own encoder: unsigned/signed variable byte, predictor 0)
{
  const uvb = (v) => { const o = []; v = Math.floor(v); while (v >= 128) { o.push((v % 128) | 0x80); v = Math.floor(v / 128); } o.push(v); return o; };
  const svb = (v) => uvb(v >= 0 ? v * 2 : -v * 2 - 1);
  const names = ['loopIteration', 'time', 'axisD[0]', 'axisD[1]', 'setpoint[0]', 'setpoint[1]', 'setpoint[2]', 'setpoint[3]', 'gyroADC[0]', 'gyroADC[1]', 'gyroADC[2]', 'rcCommand[3]', 'debug[0]', 'debug[1]', 'debug[2]', 'debug[3]', 'motor[0]', 'motor[1]', 'motor[2]', 'motor[3]'];
  const enc = names.map((n) => (n === 'loopIteration' || n === 'time' || n.startsWith('motor') || n === 'rcCommand[3]' ? 1 : 0));
  const header = (extra) =>
    [
      'H Product:Blackbox flight data recorder by Nicholas Sherlock',
      'H Data version:2',
      'H I interval:1',
      'H P interval:1',
      `H Field I name:${names.join(',')}`,
      `H Field I signed:${enc.map((e) => 1 - e).join(',')}`,
      `H Field I predictor:${names.map(() => 0).join(',')}`,
      `H Field I encoding:${enc.join(',')}`,
      `H Field P predictor:${names.map(() => 0).join(',')}`,
      `H Field P encoding:${enc.join(',')}`,
      'H Firmware revision:Betaflight 4.5.1 (77d01ba3b) STM32F405',
      'H looptime:250',
      'H pid_process_denom:1',
      'H debug_mode:6',
      'H motorOutput:158,2047',
      'H rollPID:45,80,40',
      'H pitchPID:47,84,46',
      'H yawPID:45,80,0',
      ...extra,
    ].join('\n') + '\n';
  const session = (count, pi, t0) => {
    const b = [...Buffer.from(header([`H simplified_pi_gain:${pi}`, 'H simplified_pids_mode:2']), 'latin1')];
    for (let k = 0; k < count; k++) {
      const g = Math.round(200 * Math.sin(k / 40));
      const vals = [k, t0 + k * 250, Math.round(g / 10), 2, g, -g, 0, 0, g - 1, -g + 1, 0, 1500, g + 5, -g, 0, 0, 1200, 1210, 1220, 1230];
      b.push(0x49, ...vals.flatMap((v, i) => (enc[i] ? uvb(v) : svb(v))));
    }
    return [...b, 0x45, 255, ...Buffer.from('End of log\0', 'latin1')];
  };
  const file = Uint8Array.from([...session(4000, 60, 0), ...session(500, 80, 0), ...session(6000, 100, 0)]);
  const ss = decodeSessions(file);
  check('sessions: 3 found', ss.length === 3, String(ss.length));
  check('sessions: rows and durations', ss[0].rows === 4000 && ss[2].rows === 6000 && near(ss[0].duration, 1.0, 0.01) && near(ss[2].fs, 4000, 1), ss.map((s) => `${s.rows}/${s.duration.toFixed(2)}`).join(' '));
  check('sessions: short one has no log + error key', ss[1].log === null && ss[1].error?.key === 'at.err.tooShort' && ss[1].settings?.simplified?.pi === 0.8);
  check('sessions: per-session settings', ss[0].settings.simplified.pi === 0.6 && ss[2].log.settings.simplified.pi === 1.0);
  const l0 = ss[0].log;
  check('sessions: optional columns + GYRO_SCALED', l0.axisD.length === 2 && l0.debug.length === 4 && l0.gyroUnfilt.length === 3 && l0.gyroUnfilt[0][123] - l0.gyro[0][123] === 6 && l0.throttle[5] === 1500);
  const viaBlob = await parseBblSessions(new Blob([file]), () => {});
  check('parseBblSessions = decodeSessions', viaBlob.length === 3 && viaBlob[2].rows === 6000);
  const longest = await parseBbl(new Blob([file]), () => {});
  check('parseBbl still picks the longest + settings', longest.rows === 6000 && longest.settings?.simplified?.pi === 1.0 && !!longest.gyroUnfilt);
}

assert.equal(fails, 0, `${fails} checks failed`);
console.log('settings OK');
