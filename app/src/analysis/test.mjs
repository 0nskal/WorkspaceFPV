// Test analizy: node (po zbundlowaniu esbuildem): npm run test:analysis albo
//   npx esbuild app/src/analysis/test.mjs --bundle --platform=node --format=esm --outfile=%TEMP%/at-test.mjs && node %TEMP%/at-test.mjs
import assert from 'node:assert/strict';
import { fft, welchPsd, findPeaks, nextPow2 } from './fft.ts';
import { stepResponse, stepMetrics } from './step.ts';
import { synthLog, zetaFromOvershoot } from './synth.ts';
import { analyze } from './analyze.ts';
import { parseCsv } from './parse.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}

// 1. FFT: sinusoida 137.5 Hz przy fs 4000, nfft 4096 (df = 0.9766) -> pik we wlasciwym binie
{
  const fs = 4000;
  const n = 4096;
  const f0 = 125; // dokladnie bin 128
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * f0 * i) / fs);
  fft(re, im);
  let best = 0;
  for (let k = 1; k < n / 2; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[best], im[best])) best = k;
  check('FFT pik sinusoidy 125 Hz', Math.abs((best * fs) / n - f0) < 0.5, `bin ${best} = ${((best * fs) / n).toFixed(2)} Hz`);
  // odwrotna FFT oddaje sygnal
  fft(re, im, true);
  let err = 0;
  for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(re[i] - Math.sin((2 * Math.PI * f0 * i) / fs)));
  check('IFFT(FFT(x)) = x', err < 1e-9, `max blad ${err.toExponential(1)}`);
}

// 2. Welch + findPeaks: dwie sinusoidy 120 i 280 Hz + szum
{
  const fs = 4000;
  const n = fs * 10;
  const x = new Float64Array(n);
  let s = 1;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
  for (let i = 0; i < n; i++) x[i] = 2 * Math.sin((2 * Math.PI * 120 * i) / fs) + 5 * Math.sin((2 * Math.PI * 280 * i) / fs) + r();
  const { df, psd } = welchPsd(x, fs, 2048, 500);
  const db = Array.from(psd, (v) => 10 * Math.log10(v + 1e-30));
  const pk = findPeaks(db, df, 40, 500, 6);
  const hz = pk.slice(0, 2).map((p) => p.hz).sort((a, b) => a - b);
  check('Welch: piki 120 i 280 Hz', Math.abs(hz[0] - 120) < 3 && Math.abs(hz[1] - 280) < 3, hz.map((h) => h.toFixed(1)).join(', '));
}

// 3. Dekonwolucja: znana odpowiedz 2. rzedu (18%, szczyt 91 ms), bez szumu i z szumem
for (const noise of [false, true]) {
  const log = synthLog({ seconds: 40, noise });
  const exp = [18, 8, 0.5];
  const res = stepResponse(log.setpoint[0], log.gyro[0], log.fs);
  const m = stepMetrics(res.step);
  check(`step roll ${noise ? 'z szumem' : 'bez szumu'}: overshoot 18% +-3`, Math.abs(m.overshoot - 18) <= 3, `${m.overshoot.toFixed(1)}% szczyt ${m.peakTime} ms, ${res.windows} okien`);
  if (!noise) {
    const r2 = stepResponse(log.setpoint[1], log.gyro[1], log.fs);
    const m2 = stepMetrics(r2.step);
    check('step pitch: overshoot 8% +-3', Math.abs(m2.overshoot - exp[1]) <= 3, `${m2.overshoot.toFixed(1)}%`);
  }
}
check('zeta(18%) ~ 0.479', Math.abs(zetaFromOvershoot(18) - 0.479) < 0.002);

// 4. Pelna analiza demo + parser CSV (round-trip)
{
  const log = synthLog({ seconds: 20 });
  const res = analyze(log, 'test');
  const { motor, frame } = res.peaks;
  check('analyze: pik silnikow ~280 Hz', motor && Math.abs(motor.hz - 280) < 4, motor ? `${motor.hz.toFixed(1)} Hz, +${motor.prom.toFixed(0)} dB` : 'brak');
  check('analyze: pik ramy ~120 Hz', frame && Math.abs(frame.hz - 120) < 4, frame ? `${frame.hz.toFixed(1)} Hz, +${frame.prom.toFixed(0)} dB` : 'brak');

  const lines = ['"loopIteration", "time (us)", "setpoint[0]", "setpoint[1]", "setpoint[2]", "gyroADC[0]", "gyroADC[1]", "gyroADC[2]", "motor[0]", "motor[1]", "motor[2]", "motor[3]"'];
  for (let i = 0; i < log.rows; i++) {
    lines.push(`${i}, ${Math.round((i * 1e6) / log.fs)}, ${log.setpoint[0][i].toFixed(2)}, ${log.setpoint[1][i].toFixed(2)}, ${log.setpoint[2][i].toFixed(2)}, ${log.gyro[0][i].toFixed(2)}, ${log.gyro[1][i].toFixed(2)}, ${log.gyro[2][i].toFixed(2)}, 1300, 1300, 1300, 1300`);
  }
  const parsed = await parseCsv(new Blob([lines.join('\n')]), () => {});
  check('parseCsv: fs i liczba wierszy', Math.abs(parsed.fs - log.fs) < 1 && parsed.rows === log.rows, `fs ${parsed.fs.toFixed(1)}, rows ${parsed.rows}`);
  const res2 = analyze(parsed, 'csv');
  check('parseCsv -> analyze: overshoot roll ~18%', Math.abs(res2.axes[0].overshoot - 18) <= 3, `${res2.axes[0].overshoot.toFixed(1)}%`);
  let binErr = null;
  try {
    await parseCsv(new Blob([new Uint8Array([72, 32, 80, 114, 0, 1, 2, 3])]), () => {});
  } catch (e) {
    binErr = e.code;
  }
  check('parseCsv: plik binarny -> kod "binary"', binErr === 'binary', String(binErr));
}
void nextPow2;
assert.equal(fails, 0, `${fails} testow nie przeszlo`);
console.log('Wszystko OK');
