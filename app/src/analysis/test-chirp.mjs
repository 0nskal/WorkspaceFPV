// CHIRP system identification: detection, runs, Bode estimate vs a known system, margins, demo integration, i18n.
// npm test, or: npx esbuild app/src/analysis/test-chirp.mjs --bundle --platform=node --format=esm --outfile=%TEMP%/c.mjs && node %TEMP%/c.mjs
import { analyzeChirp, chirpConfig, findChirpRuns, hasChirpDebug } from './chirp.ts';
import { synthChirpLog } from './synth-chirp.ts';
import { synthFlight, synthDemoSessions } from './synth.ts';
import { autotune } from './autotune.ts';
import { en } from '../i18n/en.ts';
import { pl } from '../i18n/pl.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}

// --- a known system: gyro = PT1(setpoint) at 30 Hz -> |T| = -3 dB at 30 Hz, L = integrator, PM = 90 deg
{
  const base = synthChirpLog({ axes: [0], seconds: 20, seed: 9 });
  const fs = base.fs;
  const x = base.setpoint[0];
  const y = new Float32Array(x.length);
  const a = 1 - Math.exp((-2 * Math.PI * 30) / fs);
  let v = 0;
  for (let i = 0; i < x.length; i++) {
    v += (x[i] - v) * a;
    y[i] = v;
  }
  base.gyro[0] = y;
  const r = analyzeChirp(base);
  const ax = r?.axes[0];
  check('pt1: roll analysed', !!ax);
  if (ax) {
    const near = (hz) => ax.bode.reduce((b, p) => (Math.abs(Math.log(p.hz / hz)) < Math.abs(Math.log(b.hz / hz)) ? p : b));
    const p10 = near(10);
    const expect10 = -10 * Math.log10(1 + (p10.hz / 30) ** 2);
    check('pt1: |T| at 10 Hz within 0.5 dB', Math.abs(p10.tDb - expect10) < 0.5, `${p10.tDb.toFixed(2)} vs ${expect10.toFixed(2)}`);
    const ph10 = (-Math.atan(p10.hz / 30) * 180) / Math.PI;
    check('pt1: phase at 10 Hz within 5 deg', Math.abs(p10.tDeg - ph10) < 5, `${p10.tDeg.toFixed(1)} vs ${ph10.toFixed(1)}`);
    check('pt1: bandwidth ~30 Hz', ax.bandwidthHz !== null && Math.abs(ax.bandwidthHz - 30) < 3, String(ax.bandwidthHz?.toFixed(1)));
    check('pt1: crossover ~30 Hz', ax.crossoverHz !== null && Math.abs(ax.crossoverHz - 30) < 3, String(ax.crossoverHz?.toFixed(1)));
    check('pt1: phase margin ~90 deg', ax.phaseMarginDeg !== null && Math.abs(ax.phaseMarginDeg - 90) < 8, String(ax.phaseMarginDeg?.toFixed(1)));
    check('pt1: no sensitivity peak, no overshoot', ax.sMaxDb < 1 && (ax.overshoot ?? 0) < 3, `${ax.sMaxDb.toFixed(2)} dB, os ${ax.overshoot}`);
    check('pt1: coherence ~1', ax.coherence > 0.95, ax.coherence.toFixed(3));
    check('pt1: step reaches 1 and is monotonic-ish', !!ax.step && Math.abs(ax.step[300] - 1) < 0.05 && ax.step[2] < ax.step[20]);
  }
}

// --- detection
{
  const normal = synthFlight({ seconds: 10, fs: 2000 });
  check('detect: normal flight (GYRO_SCALED debug) is not a chirp log', !hasChirpDebug(normal) && findChirpRuns(normal).length === 0 && analyzeChirp(normal) === null);
  const noDebug = { ...normal, debug: undefined };
  check('detect: no debug columns', !hasChirpDebug(noDebug));
  const log = synthChirpLog();
  const runs = findChirpRuns(log, chirpConfig(log.settings?.raw));
  check('detect: chirp log with 3 runs roll/pitch/yaw', hasChirpDebug(log) && runs.length === 3 && runs.map((r) => r.axis).join() === '0,1,2', runs.map((r) => `${r.axis}:${r.seconds.toFixed(1)}`).join(' '));
  check('detect: runs complete, ~20 s, sweep 0.2..600 Hz', runs.every((r) => r.complete && Math.abs(r.seconds - 20) < 0.1 && r.fFrom < 0.3 && r.fTo > 590));
  const cfg = chirpConfig(log.settings?.raw);
  check('config: header chirp_* read', cfg.fromHeader && cfg.fEndHz === 600 && cfg.seconds === 20 && cfg.ampYaw === 180);
  check('config: defaults without header', !chirpConfig(undefined).fromHeader && chirpConfig({}).fStartHz === 0.2);
}

// --- synthetic quad: roll lively, pitch damped, yaw slow; advice
{
  const r = analyzeChirp(synthChirpLog());
  const [ro, pi, ya] = r.axes;
  check('quad: all three axes', !!ro && !!pi && !!ya);
  check('quad: pitch has more phase margin than roll', pi.phaseMarginDeg > ro.phaseMarginDeg, `${pi.phaseMarginDeg?.toFixed(0)} > ${ro.phaseMarginDeg?.toFixed(0)}`);
  check('quad: yaw slower than roll (bandwidth)', ya.bandwidthHz < ro.bandwidthHz, `${ya.bandwidthHz?.toFixed(0)} < ${ro.bandwidthHz?.toFixed(0)}`);
  check('quad: pitch rated good', pi.rating === 'good', pi.rating);
  check('quad: roll sensitivity hump flagged', r.advice.some((a) => a.id === 'chirp.sens.roll'));
  check('quad: yaw low phase margin flagged', r.advice.some((a) => a.id === 'chirp.pm.yaw'));
  check('quad: advice never carries PID changes', r.advice.every((a) => a.sliders.length === 0 && a.cli.every((c) => !/_gain|PID|p_|d_/.test(c) || c.includes('feedforward'))));
  check('quad: feedforward off -> no ffOn note', !r.ffOn && !r.advice.some((a) => a.id === 'chirp.ffOn'));
  check('quad: overshoot from the sweep step response', ya.overshoot > ro.overshoot && ro.overshoot > 5, `${ya.overshoot?.toFixed(0)} / ${ro.overshoot?.toFixed(0)}`);
}

// --- incomplete sweep and missing axes
{
  const log = synthChirpLog({ axes: [0], fEnd: 120 });
  log.settings.raw.chirp_frequency_end_deci_hz = '6000';
  const r = analyzeChirp(log);
  check('incomplete: flagged', r.runs.length === 1 && !r.runs[0].complete && r.advice.some((a) => a.key === 'autotune2.chirp.incomplete'));
  check('incomplete: missing pitch, yaw', r.advice.some((a) => a.id === 'chirp.missingAxes' && a.params.axes === 'pitch, yaw'));
  const ff = analyzeChirp(synthChirpLog({ axes: [1], ff: true }));
  check('ff on: approximate margins + note with CLI', ff.ffOn && ff.advice.some((a) => a.id === 'chirp.ffOn' && a.cli.length === 2));
}

// --- autotune integration: demo sessions + chirp flight
{
  const logs = [...synthDemoSessions({ seconds: 8, fs: 2000 }), synthChirpLog({ seconds: 10 })];
  const r = autotune(logs);
  check('autotune: chirp session marked', r.sessions[logs.length - 1].chirp && !r.sessions[0].chirp);
  check('autotune: step analysis does not pick the chirp flight', r.session !== logs.length - 1, String(r.session));
  check('autotune: series excludes the chirp flight', !r.series || r.series.sessions.every((s) => s.index !== logs.length - 1));
  check('autotune: chirp result from that session', !!r.chirp && r.chirpSession === logs.length - 1 && r.chirp.axes.filter(Boolean).length === 3);
  const only = autotune([synthChirpLog({ seconds: 10 })]);
  check('autotune: chirp-only file still analysed', only.session === 0 && !!only.chirp);
  const none = autotune(synthFlight({ seconds: 8, fs: 2000 }));
  check('autotune: no chirp -> null', none.chirp === null && none.chirpSession === null);
}

// --- i18n: every advice key in both languages
{
  const keys = ['ok', 'sensHigh', 'sensLow', 'lowPm', 'tPeak', 'room', 'lowCoh', 'incomplete', 'missingAxes', 'ffOn'];
  check('i18n: chirp advice en + pl', keys.every((k) => en.autotune2.chirp[k] && pl.autotune2.chirp[k]));
  const flow = (l) => l.atFlow.expert.chirp;
  check('i18n: chirp tab texts en + pl', Object.keys(flow(en)).every((k) => k in flow(pl)) && en.atFlow.expert.tabs.chirp && pl.atFlow.expert.tabs.chirp);
  const tips = ['chirp', 'chirpSetup', 'chirpBode', 'chirpMargins', 'chirpCoh', 'chirpStep', 'chirpAdvice'];
  check('i18n: chirp tips en + pl', tips.every((k) => en.tips.autotune[k] && pl.tips.autotune[k]));
}

if (fails) {
  console.log(`\n${fails} failed`);
  process.exit(1);
}
console.log('\nall chirp tests passed');
