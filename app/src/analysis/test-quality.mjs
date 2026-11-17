// Log quality score (analysis/quality.ts): npm test, or
//   npx esbuild app/src/analysis/test-quality.mjs --bundle --platform=node --format=esm --outfile=%TEMP%/q.mjs && node %TEMP%/q.mjs
import assert from 'node:assert/strict';
import { synthLog } from './synth.ts';
import { analyze } from './analyze.ts';
import { logStats, scoreQuality, ACTIVE_DPS } from './quality.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}

// 1. The demo log (40 s, 4 kHz, sticks on every axis, throttle sweeps) scores "good"
{
  const res = analyze(synthLog({ seconds: 40 }), 'demo');
  const q = scoreQuality(res);
  check('demo log: stats present', !!res.stats && res.stats.throttleCoverage !== null && res.stats.saturation === 0, JSON.stringify(res.stats));
  check('demo log: good', q.label === 'good' && q.score >= 75, `${q.score} ${q.label} ${q.advice.join(',')}`);
  check('demo log: no axis advice', !q.advice.some((a) => a.startsWith('more')), q.advice.join(','));
}

// 2. logStats: activity, throttle bins, saturation on a hand-made log
{
  const fs = 1000;
  const n = 10000;
  const sp = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < 3000; i++) sp[0][i] = ACTIVE_DPS + 10; // 3 s of roll
  const throttle = new Float32Array(n);
  for (let i = 0; i < n; i++) throttle[i] = i < n / 2 ? 1150 : 1550; // two bins out of ten
  const motor = [new Float32Array(n).fill(1500), new Float32Array(n).fill(1500)];
  for (let i = 0; i < 1000; i++) motor[1][i] = 2000; // 10 % at the top
  const st = logStats({ fs, rows: n, duration: 10, setpoint: sp, gyro: sp, motor, rcFallback: false, throttle, motorRange: [1000, 2000] });
  check('logStats: roll active 3 s', Math.abs(st.activeSec[0] - 3) < 1e-6 && st.activeSec[1] === 0 && st.activeSec[2] === 0, st.activeSec.join(','));
  check('logStats: throttle coverage 0.2', Math.abs(st.throttleCoverage - 0.2) < 1e-9, String(st.throttleCoverage));
  check('logStats: saturation 0.1', Math.abs(st.saturation - 0.1) < 1e-9, String(st.saturation));
  const none = logStats({ fs, rows: n, duration: 10, setpoint: sp, gyro: sp, motor, rcFallback: false });
  check('logStats: no throttle / range -> null', none.throttleCoverage === null && none.saturation === null);
}

// 3. scoreQuality: poor log (short, slow, no yaw, no throttle) -> poor + concrete advice; null parts are skipped
{
  const ax = (windows, step = true) => ({ name: 'Roll', step: step ? [0] : null, windows, overshoot: 5, peakValue: 1, peakTime: 1, rise: 20, settle: 40 });
  const res = { fs: 500, duration: 6, rcFallback: true, axes: [ax(2), ax(1), ax(0, false)], stats: { activeSec: [1, 0.5, 0], throttleCoverage: null, saturation: null } };
  const q = scoreQuality(res);
  check('poor log: label poor', q.label === 'poor' && q.score < 50, `${q.score}`);
  for (const a of ['moreRoll', 'morePitch', 'moreYaw', 'noThrottle', 'sampleRate', 'longer', 'rcFallback']) check(`poor log: advice ${a}`, q.advice.includes(a), q.advice.join(','));
  check('null parts not weighted', q.parts.filter((p) => p.value === null).map((p) => p.id).join() === 'throttle,saturation');
  const perfect = scoreQuality({ fs: 4000, duration: 60, rcFallback: false, axes: [ax(40), ax(40), ax(40)], stats: { activeSec: [10, 10, 10], throttleCoverage: 1, saturation: 0 } });
  check('perfect log: 100', perfect.score === 100 && perfect.label === 'good' && perfect.advice.length === 0, `${perfect.score} ${perfect.advice}`);
  const sat = scoreQuality({ fs: 4000, duration: 60, rcFallback: false, axes: [ax(40), ax(40), ax(40)], stats: { activeSec: [10, 10, 10], throttleCoverage: 1, saturation: 0.2 } });
  check('saturated log: advice + lower score', sat.advice.includes('saturation') && sat.score === 90, `${sat.score}`);
  const narrow = scoreQuality({ fs: 4000, duration: 60, rcFallback: false, axes: [ax(40), ax(40), ax(40)], stats: { activeSec: [10, 10, 10], throttleCoverage: 0.2, saturation: 0 } });
  check('narrow throttle: advice', narrow.advice.includes('throttleRange'), narrow.advice.join(','));
  const noStats = scoreQuality({ fs: 4000, duration: 60, rcFallback: false, axes: [ax(40), ax(40), ax(40)] });
  check('old result without stats still scores', noStats.score === 100, `${noStats.score}`);
}

assert.equal(fails, 0, `${fails} checks failed`);
console.log('quality OK');
