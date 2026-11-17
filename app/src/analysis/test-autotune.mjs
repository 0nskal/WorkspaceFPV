// Auto-tune engine v2: step metrics/detection, noise ridges, filter delay + recs, propwash, PID rules, series, autotune().
// npm test, or: npx esbuild app/src/analysis/test-autotune.mjs --bundle --platform=node --format=esm --outfile=%TEMP%/a.mjs && node %TEMP%/a.mjs
import assert from 'node:assert/strict';
import { curveMetrics, findSteps, analyzeAxisSteps } from './step2.ts';
import { synthFlight, synthDemoSessions, piResponse, zetaFromOvershoot } from './synth.ts';
import { throttlePct, badMask, BAD_GYRO_SAT, BAD_IDLE } from './signals.ts';
import { analyzeNoise, frameBands, markLow } from './noise.ts';
import { filterDelay, recommendFilters } from './filters.ts';
import { detectPropwash } from './propwash.ts';
import { recommendPids, dynIdleFor, DYN_IDLE_TABLE } from './pidrec.ts';
import { compareSeries, PROCEDURE, nextProcedureStep } from './series.ts';
import { parseLogSettings } from './settings.ts';
import { autotune } from './autotune.ts';
import { recommend } from './recommend.ts';
import { en } from '../i18n/en.ts';
import { pl } from '../i18n/pl.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}
const near = (a, b, tol) => a !== null && a !== undefined && Math.abs(a - b) <= tol;
const f1 = (v) => (v === null || v === undefined ? String(v) : v.toFixed(1));

/** Analytic 2nd-order step response on a grid of dtMs. */
function second(os, peakMs, ms = 500, dtMs = 1) {
  const z = zetaFromOvershoot(os);
  const wd = Math.PI / (peakMs / 1000);
  const wn = wd / Math.sqrt(1 - z * z);
  const y = [];
  for (let t = 0; t <= ms; t += dtMs) {
    const s = t / 1000;
    y.push(1 - Math.exp(-z * wn * s) * (Math.cos(wd * s) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * s)));
  }
  return y;
}
const crossFine = (y, lvl, dt) => {
  for (let i = 1; i < y.length; i++) if (y[i - 1] < lvl && y[i] >= lvl) return (i - 1 + (lvl - y[i - 1]) / (y[i] - y[i - 1])) * dt;
  return null;
};

/* 1. curveMetrics on analytic responses */
{
  const y = second(12, 40);
  const m = curveMetrics(y, { final: 1 });
  const fine = second(12, 40, 500, 0.01);
  const rise = crossFine(fine, 0.9, 0.01) - crossFine(fine, 0.1, 0.01);
  let settle2 = 0;
  for (let i = fine.length - 1; i >= 0; i--) if (Math.abs(fine[i] - 1) > 0.02) { settle2 = i * 0.01; break; }
  check('metrics: overshoot 12 %', near(m.overshoot, 12, 0.3), f1(m.overshoot));
  check('metrics: peak time 40 ms', near(m.peakTime, 40, 1), String(m.peakTime));
  check('metrics: rise = analytic', near(m.rise, rise, 0.3), `${f1(m.rise)} vs ${f1(rise)}`);
  check('metrics: settle 2 % = analytic', near(m.settle2, settle2, 1.5), `${m.settle2} vs ${f1(settle2)}`);
  check('metrics: latency50 = t50', near(m.latency50, crossFine(fine, 0.5, 0.01), 0.3));
  check('metrics: no ringing at 12 %', m.ringing === 0 && m.undershoot < 3, `${m.ringing} ${f1(m.undershoot)}`);
  const r = curveMetrics(second(60, 30), { final: 1 });
  check('metrics: ringing counted at 60 %', r.ringing >= 4 && r.undershoot > 20, `${r.ringing} crossings, undershoot ${f1(r.undershoot)}`);
  const short = curveMetrics(second(5, 40).map((v) => v * 0.9));
  check('metrics: steady-state error -10 %', near(short.ssError, -10, 0.5), f1(short.ssError));
  const slow = curveMetrics(Array.from({ length: 200 }, (_, i) => 0.8 * (1 - Math.exp(-i / 40))), { final: 1 });
  check('metrics: never settles -> null', slow.settle5 === null && slow.rise === null && slow.overshoot === 0);
}

/* 2. findSteps on a hand-made setpoint */
{
  const fs = 2000;
  const sp = new Float32Array(fs * 6);
  const put = (t0, t1, v) => { for (let i = Math.round(t0 * fs); i < Math.round(t1 * fs); i++) sp[i] = v; };
  put(0.5, 1.0, 400); // step + 500 ms hold -> 1 step up, 1 step back
  put(1.5, 1.52, 400); // 20 ms blip: too short to hold
  put(2.0, 2.4, 100); // too small
  for (let i = Math.round(3 * fs); i < Math.round(4 * fs); i++) sp[i] = ((i - 3 * fs) / fs) * 600; // slow ramp (no step)
  put(4.0, 4.0, 0);
  put(4.5, 4.8, -700);
  put(4.8, 5.3, 300); // immediately reversed: second step right after the hold
  const st = findSteps(sp, fs);
  const sizes = st.map((s) => Math.round(s.target - s.base));
  // expected: up 400, back -400, ramp end -596 (a real drop), -700, reversal +1000, back -300; the 20 ms blip (and its
  // return edge), the 100 deg/s step and the slow ramp itself are not steps
  check('findSteps: real steps only', sizes.join(',') === '400,-400,-596,-700,1000,-300', sizes.join(','));
  check('findSteps: onset at the edge', Math.abs(st[0].onset / fs - 0.5) < 0.003 && st[0].holdEnd > st[0].edgeEnd, String(st[0].onset / fs));
}

/* 3. detected steps on a clean synthetic flight: known overshoot, rise and dead time */
{
  const base = { seconds: 40, fs: 4000, motor: null, frame: null, whiteNoise: 0.2, lpfHz: 0, propwash: 0, spTauMs: 0, maxStep: 900 };
  const log = synthFlight({ ...base, axes: [{ overshootPct: 15, peakTime: 0.06 }, { overshootPct: 15, peakTime: 0.06, delayMs: 6 }, { overshootPct: 8, peakTime: 0.1 }] });
  const thr = throttlePct(log);
  const mask = badMask(log, thr);
  const r = analyzeAxisSteps('roll', log.setpoint[0], log.gyro[0], log.fs, thr, mask);
  const p = analyzeAxisSteps('pitch', log.setpoint[1], log.gyro[1], log.fs, thr, mask);
  const ana = curveMetrics(second(15, 60), { final: 1 });
  check('steps: enough detected', r.detected.n >= 15 && r.source === 'steps' && r.confidence === 1, `n ${r.detected.n}`);
  check('steps: overshoot 15 % +-3', near(r.best.overshoot, 15, 3), f1(r.best.overshoot));
  check('steps: rise = analytic +-3 ms', near(r.best.rise, ana.rise, 3), `${f1(r.best.rise)} vs ${f1(ana.rise)}`);
  check('steps: 6 ms dead time shows in latency50', near(p.best.latency50 - r.best.latency50, 6, 1.2), `${f1(r.best.latency50)} -> ${f1(p.best.latency50)}`);
  check('steps: tracking delay grows by ~6 ms', near(p.trackingDelayMs - r.trackingDelayMs, 6, 2), `${f1(r.trackingDelayMs)} -> ${f1(p.trackingDelayMs)}`);
  check('steps: Wiener agrees on overshoot', near(r.wiener.metrics.overshoot, 15, 4), f1(r.wiener.metrics.overshoot));
  check('steps: size buckets filled', r.bySize.every((b) => b.n > 0), r.bySize.map((b) => b.n).join(','));
  check('steps: throttle buckets filled', r.byThrottle.length === 3 && r.byThrottle.reduce((s, b) => s + b.n, 0) === r.detected.n, r.byThrottle.map((b) => b.n).join(','));
  check('steps: list capped and serialisable', r.detected.list.length <= 200 && JSON.stringify(r).length > 0);
  // TPA: more overshoot above 65 % throttle
  const tpa = synthFlight({ ...base, seed: 5, calmPunches: false, axes: [{ overshootPct: 6, peakTime: 0.06, highThrottle: { overshootPct: 30, peakTime: 0.05 } }, { overshootPct: 6, peakTime: 0.06 }, { overshootPct: 6, peakTime: 0.1 }] });
  const t2 = throttlePct(tpa);
  const rt = analyzeAxisSteps('roll', tpa.setpoint[0], tpa.gyro[0], tpa.fs, t2, badMask(tpa, t2));
  const lo = rt.byThrottle.find((b) => b.id === 'low');
  const hi = rt.byThrottle.find((b) => b.id === 'high');
  check('steps: high-throttle bucket shows the extra overshoot', hi.n >= 3 && hi.metrics.overshoot - lo.metrics.overshoot > 12, `low ${f1(lo.metrics?.overshoot)} (${lo.n}) high ${f1(hi.metrics?.overshoot)} (${hi.n})`);
}

/* 4. exclusions: motor saturation, idle, crash */
{
  const log = synthFlight({ seconds: 30, saturatePunches: true, calmPunches: false, punchEvery: 3, crashAtEnd: true, propwash: 0 });
  const thr = throttlePct(log);
  const mask = badMask(log, thr);
  const r = analyzeAxisSteps('roll', log.setpoint[0], log.gyro[0], log.fs, thr, mask);
  check('exclude: saturated steps', r.detected.excluded.saturation > 0, JSON.stringify(r.detected.excluded));
  const n = log.rows;
  check('exclude: crash flagged incl. 200 ms before', (mask[n - 1] & BAD_GYRO_SAT) && (mask[n - Math.round(0.6 * log.fs)] & BAD_GYRO_SAT) && !(mask[Math.round(n / 2)] & BAD_GYRO_SAT));
  const idle = new Uint8Array(n).fill(BAD_IDLE);
  const ri = analyzeAxisSteps('roll', log.setpoint[0], log.gyro[0], log.fs, thr, idle);
  check('exclude: idle mask removes every step', ri.detected.n === 0 && ri.detected.excluded.idle > 0 && ri.source === 'wiener', JSON.stringify(ri.detected.excluded));
}

/* 5. noise: ridges tell motor noise from frame resonance */
{
  const log = synthFlight({ seconds: 40 });
  const thr = throttlePct(log);
  const nz = analyzeNoise(log, thr, badMask(log, thr), 5);
  const U = nz.gyroUnfilt;
  const motor = U.ridges.filter((r) => r.kind === 'motor').sort((a, b) => a.meanHz - b.meanHz)[0];
  const frame = U.ridges.find((r) => r.kind === 'frame' && near(r.meanHz, 145, 5));
  check('noise: unfiltered source = debug (GYRO_SCALED)', nz.unfiltSource === 'debug');
  check('noise: motor ridge slope ~4 Hz/%', motor && near(motor.slopeHzPerPct, 4, 0.8), motor ? `${f1(motor.slopeHzPerPct)} Hz/% ${f1(motor.hzAtLow)}-${f1(motor.hzAtHigh)}` : 'none');
  check('noise: frame ridge 145 Hz flat', frame && Math.abs(frame.slopeHzPerPct) < 0.2, frame ? `${f1(frame.meanHz)} Hz, slope ${f1(frame.slopeHzPerPct)}` : 'none');
  const pk = U.peaks.find((p) => near(p.hz, 145, 5));
  check('noise: 145 Hz peak is a frame resonance (>= 12 dB)', pk && pk.kind === 'frame' && pk.resonance, pk ? `+${f1(pk.prom)} dB ${pk.kind}` : 'none');
  check('noise: spectrogram shape', U.db.length === 20 && U.counts.some((c) => c > 0) && U.db.every((row, b) => (U.counts[b] ? row.length === U.spectrum.length : row.length === 0)));
  check('noise: filtered gyro quieter than unfiltered', nz.gyro.hfRms < U.hfRms / 3, `${f1(nz.gyro.hfRms)} vs ${f1(U.hfRms)}`);
  const b7 = frameBands(7);
  const b3 = frameBands(3);
  check('noise: frame bands scale with size', b7.frame[0] < 100 && b3.frame[0] > 100 && frameBands().propwash.join() === '20,90');
  {
    const mkR = (kind, a, b) => ({ kind, meanHz: (a + b) / 2, slopeHzPerPct: 0, hzAtLow: a, hzAtHigh: b, thrLow: 20, thrHigh: 60, maxProm: 14, points: [] });
    const sp = { ridges: [mkR('frame', 52, 54), mkR('frame', 150, 152), mkR('motor', 50, 200)], peaks: [{ hz: 53, prom: 14, resonance: true, kind: 'frame' }, { hz: 151, prom: 9, resonance: false, kind: 'frame' }] };
    markLow(sp, 0.8 * frameBands(5).frame[0]);
    check('noise: 53 Hz constant peak on a 5" is low, not frame', sp.peaks[0].kind === 'low' && sp.ridges[0].kind === 'low' && sp.peaks[1].kind === 'frame' && sp.ridges[1].kind === 'frame' && sp.ridges[2].kind === 'motor');
    check('i18n: low kind + lowPeak verdict text', !!en.atFlow.expert.noise.kind.low && !!pl.atFlow.expert.noise.kind.low && !!en.atFlow.basic.v.noise.lowPeak && !!pl.atFlow.basic.v.noise.lowPeak);
  }
  const noThr = analyzeNoise({ ...log, throttle: undefined, motorRange: undefined, settings: { ...log.settings, motorOutput: undefined } }, null, null);
  check('noise: without throttle only the average spectrum', noThr.gyro.counts.every((c) => c === 0) && noThr.gyro.spectrum.length > 0 && noThr.gyro.ridges.length === 0);
}

/* 6. filter delay + filter recommendations */
{
  const d70 = filterDelay(synthFlight({ seconds: 20, lpfHz: 70 }));
  const d200 = filterDelay(synthFlight({ seconds: 20, lpfHz: 200 }));
  check('delay: PT1 70 Hz ~2.2 ms', near(d70.ms, 1 / (2 * Math.PI * 70) * 1000, 0.4), f1(d70.ms));
  check('delay: PT1 200 Hz < 1 ms', d200.ms < 1, f1(d200.ms));
  const noU = synthFlight({ seconds: 10 });
  delete noU.gyroUnfilt;
  check('delay: no unfiltered gyro -> null', filterDelay(noU) === null);

  const recOf = (o) => {
    const log = synthFlight({ seconds: 30, ...o });
    const thr = throttlePct(log);
    const nz = analyzeNoise(log, thr, badMask(log, thr), 5);
    return recommendFilters(nz, log.settings, filterDelay(log), {});
  };
  const ids = (r) => r.advice.map((a) => a.id);
  const def = recOf({});
  check('filters: 3rd harmonic left -> harmonics 2 -> 3', def.rpm.harmonicsNeeded === 3 && def.cli.includes('set rpm_filter_harmonics = 3'), ids(def).join(','));
  check('filters: frame peak -> 1 notch, min = peak - 25', def.dynNotch.countNeeded === 1 && def.dynNotch.minHz === 120 && def.cli.includes('set dyn_notch_count = 1'), JSON.stringify(def.dynNotch));
  check('filters: delay > 2 ms warned', ids(def).includes('filters.delayHigh'));
  check('filters: rpm min Hz from the lowest motor ridge', def.rpm.minHz >= 120 && def.rpm.minHz <= 160, String(def.rpm.minHz));
  const off = recOf({ header: { dshot_bidir: '0' }, motor: { idleHz: 120, fullHz: 520, amp: 6, harmonics: [1, 0.6, 0.45], residual: [1, 1, 1] } });
  check('filters: RPM off + motor noise -> enable bidir DShot', ids(off).includes('filters.rpmEnable') && off.cli.includes('set dshot_bidir = ON'), ids(off).join(','));
  const clean = recOf({ header: { rpm_filter_harmonics: '3' }, motor: { idleHz: 120, fullHz: 520, amp: 2, harmonics: [1, 0.5], residual: [0, 0] }, frame: null, lpfHz: 0, whiteNoise: 0.4 });
  check('filters: clean -> raise gyro multiplier (slider + raw)', ids(clean).includes('filters.gyroRaise') && clean.sliderCli.includes('set simplified_gyro_filter_multiplier = 120') && clean.sliderCli.at(-1) === 'simplified_tuning apply' && clean.cli.some((c) => c.startsWith('set gyro_lpf1_dyn_min_hz = 300')), clean.sliderCli.join(' | '));
  check('filters: no fixed peaks with RPM on -> notch off', ids(clean).includes('filters.dynNotchOff') && clean.dynNotch.countNeeded === 0, ids(clean).join(','));
  check('filters: no 3rd harmonic -> 2 harmonics enough', ids(clean).includes('filters.rpmFewer'));
  const lpf1 = recOf({ header: { rpm_filter_harmonics: '3', pid_process_denom: '1' }, motor: { idleHz: 120, fullHz: 520, amp: 1, harmonics: [1], residual: [0] }, frame: null, lpfHz: 0, whiteNoise: 0.4 });
  check('filters: gyro rate = PID rate and quiet -> LPF1 off', ids(lpf1).includes('filters.gyroLpf1Off'), ids(lpf1).join(','));
  const noisy = recOf({ header: { rpm_filter_harmonics: '3' }, motor: { idleHz: 120, fullHz: 520, amp: 6, harmonics: [1, 0.6, 0.45], residual: [0.01, 0.01, 0.01] }, frame: null, lpfHz: 0, whiteNoise: 6 });
  check('filters: broadband noise -> lower gyro multiplier', ids(noisy).includes('filters.gyroLower') && noisy.sliders.some((s) => s.slider === 'gyroMultiplier' && s.to === 0.8), ids(noisy).join(','));
  // D-term rules on a hand-made noise analysis
  const bands = frameBands(5);
  const fake = (hf, lf) => ({ gyro: null, gyroUnfilt: null, dterm: { hfRms: hf, lfRms: lf, peaks: [], ridges: [] }, unfiltSource: null, bands });
  const s = parseLogSettings({ simplified_dterm_filter: '1', simplified_dterm_filter_multiplier: '100', dterm_lpf1_dyn_hz: '75,150' });
  const dn = recommendFilters(fake(20, 10), s, null, { hotMotors: true });
  const dl = dn.advice.find((a) => a.id === 'filters.dtermLower');
  check('filters: noisy D-term -> lower D filter multiplier, warn when motors hot', dl && dl.severity === 'warn' && dl.sliders[0].to === 0.8 && dl.cli.includes('set dterm_lpf1_dyn_min_hz = 60'), dl ? JSON.stringify(dl.cli) : 'none');
  check('filters: no unfiltered gyro -> ask for GYRO_SCALED', dn.advice.some((a) => a.id === 'filters.noUnfilt' && a.cli[0] === 'set debug_mode = GYRO_SCALED'));
}

/* 7. propwash */
{
  const pwOf = (o) => {
    const log = synthFlight({ seconds: 40, ...o });
    const thr = throttlePct(log);
    return detectPropwash(log, thr, badMask(log, thr), [20, 90]);
  };
  const sev = pwOf({ propwash: 25 });
  const none = pwOf({ propwash: 0 });
  const few = pwOf({ propwash: 25, punchEvery: 100 });
  check('propwash: bursts -> severe', sev.level === 'severe' && sev.events >= 3 && sev.ratio >= 5, `${sev.level} ${sev.ratio} (${sev.events} events, ${sev.baselineWindows} baseline)`);
  check('propwash: clean -> none', none.level === 'none' && none.ratio < 2, `${none.level} ${none.ratio}`);
  check('propwash: no chops -> insufficient', few.level === 'insufficient' && few.events < 3, `${few.level} ${few.events}`);
  const mod = pwOf({ propwash: 2 });
  check('propwash: weak bursts rank between', mod.ratio > none.ratio && mod.ratio < sev.ratio, `${none.ratio} < ${mod.ratio} < ${sev.ratio} (${mod.level})`);
  const log = synthFlight({ seconds: 10 });
  check('propwash: no throttle -> noThrottle', detectPropwash(log, null, null, [20, 90]).level === 'noThrottle');
}

/* 8. PID rules on hand-made step results */
{
  const M = (os, rise, extra = {}) => ({ rise, latency50: rise ? rise * 0.8 : null, latency5: 5, overshoot: os, peak: 1 + os / 100, peakTime: 40, settle2: 90, settle5: 60, ringing: 0, ssError: 0, undershoot: 0, bounceBack: null, ...extra });
  const ax = (axis, m, conf = 1) => ({ axis, wiener: { curve: null, windows: 30, metrics: m }, detected: { n: 20, excluded: { saturation: 0, crash: 0, idle: 0 }, metrics: m, curve: null, list: [] }, bySize: [], byThrottle: [], best: m, source: 'steps', confidence: conf, trackingDelayMs: 10, trackingCorr: 0.95 });
  const noise = { gyro: null, gyroUnfilt: null, dterm: null, unfiltSource: null, bands: frameBands(5) };
  const pwNone = { level: 'none', events: 5, ratio: 1.2, perAxis: [1.2, 1.2], band: [20, 90], baselineWindows: 10, eventTimes: [] };
  const hdr = { rollPID: '45,80,40', pitchPID: '47,84,46', yawPID: '45,80,0', d_min: '30,34,0', ff_weight: '120,125,120', simplified_pids_mode: '2', simplified_pi_gain: '100', simplified_i_gain: '100', simplified_d_gain: '100', simplified_dmax_gain: '100', simplified_feedforward_gain: '100', simplified_pitch_d_gain: '100', simplified_pitch_pi_gain: '100', tpa_rate: '65', iterm_relax: '1', iterm_relax_cutoff: '15', dshot_bidir: '1', dyn_idle_min_rpm: '0' };
  const S = (extra = {}) => parseLogSettings({ ...hdr, ...extra });
  const run = (steps, o = {}, st = S(), q = 90, pw = pwNone) => recommendPids({ steps, noise, propwash: pw, settings: st, quality: q }, o);
  const ids = (r) => r.advice.map((a) => a.key.replace('autotune2.', ''));

  const hot = run([ax('roll', M(30, 30)), ax('pitch', M(7, 35)), ax('yaw', M(2, 60))]);
  const rf = hot.axes[0].factors;
  check('pid: 30 % overshoot -> more D, less P', rf.d > 1.1 && rf.p < 1 && ids(hot).includes('pid.overshootSevere'), JSON.stringify(rf));
  check('pid: pitch ideal untouched', hot.axes[1].factors.d === 1 && hot.axes[1].factors.p === 1 && ids(hot).includes('pid.overshootIdeal'));
  check('pid: slider form preferred and applied', hot.preferred === 'sliders' && hot.sliderCli.some((c) => c.startsWith('set simplified_d_gain = 1')) && hot.sliderCli.at(-1) === 'simplified_tuning apply', hot.sliderCli.join(' | '));
  check('pid: raw form disables sliders first', hot.rawCli[0] === 'set simplified_pids_mode = OFF' && hot.rawCli.some((c) => c.startsWith('set d_roll = ')) && hot.rawCli.some((c) => c.startsWith('set d_min_roll = ')), hot.rawCli.join(' | '));
  const sugg = hot.axes[0].suggested;
  check('pid: raw values from the header PIDs', sugg.d === Math.round(40 * rf.d) && sugg.p === Math.round(45 * rf.p) && sugg.dLimit <= sugg.d, JSON.stringify(sugg));

  const guard = run([ax('roll', M(30, 30)), ax('pitch', M(7, 35)), ax('yaw', M(2, 60))], { hotMotors: true });
  check('pid: hot motors -> never more D', guard.axes.every((a) => a.factors.d <= 1 && a.factors.dLow <= 1) && ids(guard).includes('pid.heatGuardHot') && guard.axes[0].factors.p < hot.axes[0].factors.p, JSON.stringify(guard.axes[0].factors));
  const noisyNoise = { ...noise, dterm: { hfRms: 30, lfRms: 10, peaks: [], ridges: [] } };
  const guard2 = recommendPids({ steps: [ax('roll', M(30, 30)), ax('pitch', M(7, 35))], noise: noisyNoise, propwash: pwNone, settings: S(), quality: 90 }, {});
  check('pid: noisy D-term -> no D raise either', guard2.axes[0].factors.d <= 1 && ids(guard2).includes('pid.heatGuardNoise'));

  const poor = run([ax('roll', M(30, 30)), ax('pitch', M(30, 30)), ax('yaw', M(2, 60))], {}, S(), 25);
  check('pid: poor log -> no numeric change', poor.scale === 0 && poor.rawCli.length === 0 && poor.sliderCli.length === 0 && ids(poor).includes('pid.poorLog') && ids(poor).includes('pid.lowConfidence'), ids(poor).join(','));
  const half = run([ax('roll', M(30, 30), 0.5), ax('pitch', M(7, 35)), ax('yaw', M(2, 60))]);
  check('pid: lower confidence -> smaller change', half.axes[0].factors.d > 1 && half.axes[0].factors.d < hot.axes[0].factors.d, `${half.axes[0].factors.d} < ${hot.axes[0].factors.d}`);

  const slow = run([ax('roll', M(1, 110)), ax('pitch', M(1, 110)), ax('yaw', M(1, null, { latency50: 90 }))]);
  check('pid: slow rise -> more P and FF', slow.axes[0].factors.p > 1 && slow.axes[0].factors.f > 1 && ids(slow).includes('pid.slowRiseFf'), JSON.stringify(slow.axes[0].factors));
  check('pid: yaw never reaching 90 % counts as slow', ids(slow).includes('pid.yawSlow'));
  const ring = run([ax('roll', M(8, 30, { ringing: 4 })), ax('pitch', M(8, 30))]);
  check('pid: ringing -> more D', ring.axes[0].factors.d > 1 && ids(ring).includes('pid.ringing'));
  const ss = run([ax('roll', M(5, 30, { ssError: -9 })), ax('pitch', M(5, 30, { bounceBack: 14 }))]);
  check('pid: steady-state error -> more I; bounce-back -> iterm relax cutoff', ss.axes[0].factors.i > 1 && ids(ss).includes('pid.bounceBack') && ss.extraCli.includes('set iterm_relax_cutoff = 10'), ss.extraCli.join(' | '));
  const ratio = run([ax('roll', M(1, 40)), ax('pitch', M(8, 35))], {}, S({ rollPID: '40,80,40' }));
  check('pid: D/P above range with dull response -> less D', ratio.axes[0].factors.d < 1 && ids(ratio).includes('pid.ratioHigh'));

  const pwSevere = { ...pwNone, level: 'severe', ratio: 7, events: 6 };
  const pw = run([ax('roll', M(7, 30)), ax('pitch', M(7, 30))], {}, S({ iterm_relax_cutoff: '5' }), 90, pwSevere);
  check('pid: severe propwash -> D-min up (D max kept)', pw.axes[0].factors.dLow > 1.1 && pw.axes[0].factors.d === 1 && pw.axes[0].suggested.dLimit > 30 && pw.axes[0].suggested.d === 40 && ids(pw).includes('pid.propwashSevere'), JSON.stringify(pw.axes[0].suggested));
  check('pid: propwash + low relax cutoff -> 15', pw.extraCli.includes('set iterm_relax_cutoff = 15'));
  check('pid: propwash D-min boost maps to d_gain up, dmax_gain down', pw.sliders.find((s) => s.slider === 'd')?.to > 1 && pw.sliders.find((s) => s.slider === 'dmax')?.to < 1, JSON.stringify(pw.sliders));
  const pwHot = run([ax('roll', M(7, 30)), ax('pitch', M(7, 30))], { hotMotors: true }, S(), 90, pwSevere);
  check('pid: propwash with hot motors -> advice only', pwHot.axes[0].factors.dLow === 1 && ids(pwHot).includes('pid.propwashGuard'));

  const thrB = (os) => [{ id: 'low', lo: 0, hi: 35, n: 6, metrics: M(8, 30) }, { id: 'midThr', lo: 35, hi: 65, n: 6, metrics: M(8, 30) }, { id: 'high', lo: 65, hi: 101, n: 6, metrics: M(os, 30) }];
  const tpa = run([{ ...ax('roll', M(10, 30)), byThrottle: thrB(28) }, { ...ax('pitch', M(8, 30)), byThrottle: thrB(9) }]);
  check('pid: overshoot only at high throttle -> more TPA', ids(tpa).includes('pid.tpaMore') && tpa.extraCli.includes('set tpa_rate = 75'), tpa.extraCli.join(' | '));

  const idle = run([ax('roll', M(7, 30)), ax('pitch', M(7, 30))], { propInches: 5 });
  const di = idle.advice.find((a) => a.id === 'pid.dynIdle');
  check('pid: dynamic idle from prop size, marked approximate', di && di.approximate === true && di.cli[0] === 'set dyn_idle_min_rpm = 33', di ? di.cli[0] : 'none');
  const noBidir = run([ax('roll', M(7, 30)), ax('pitch', M(7, 30))], { propInches: 5 }, S({ dshot_bidir: '0' }));
  check('pid: dynamic idle needs bidir DShot', ids(noBidir).includes('pid.dynIdleNeedsBidir') && !noBidir.extraCli.some((c) => c.includes('dyn_idle')));
  check('pid: dyn idle table 3"/5"/7" + clamp', dynIdleFor(3) === 55 && dynIdleFor(5) === 33 && dynIdleFor(7) === 23 && dynIdleFor(2) === 55 && dynIdleFor(10) === 23 && DYN_IDLE_TABLE.length === 5, [3, 5, 7].map(dynIdleFor).join(','));

  const raw = run([ax('roll', M(30, 30)), ax('pitch', M(7, 35))], {}, S({ simplified_pids_mode: '0' }));
  check('pid: sliders OFF -> raw preferred, no mode switch line', raw.preferred === 'raw' && raw.sliders.length === 0 && raw.rawCli.length > 0 && !raw.rawCli.includes('set simplified_pids_mode = OFF'), raw.rawCli.join(' | '));
  const dmax = run([ax('roll', M(30, 30)), ax('pitch', M(7, 35))], {}, parseLogSettings({ 'Firmware revision': 'Betaflight 2025.12.0 (x) STM32H7', rollPID: '45,80,30', pitchPID: '47,84,34', yawPID: '45,80,0', d_max: '45,50,0' }));
  check('pid: 2025.x d_max scheme names', dmax.rawCli.some((c) => c.startsWith('set d_max_roll = ')) && dmax.rawCli.some((c) => c.startsWith('set d_roll = ')) && dmax.axes[0].suggested.dLimit >= dmax.axes[0].suggested.d, dmax.rawCli.join(' | '));
}

/* 9. candidate series */
{
  const hdr = (pi) => ({ simplified_pi_gain: String(Math.round(pi * 100)), simplified_i_gain: '0', simplified_feedforward_gain: '0', rollPID: `${Math.round(45 * pi)},0,40`, pitchPID: `${Math.round(47 * pi)},0,46`, ff_weight: '0,0,0' });
  const items = (pis) =>
    pis.map((pi, k) => {
      const log = synthFlight({ seconds: 20, seed: 300 + k, axes: piResponse(pi), header: hdr(pi), propwash: 0 });
      const thr = throttlePct(log);
      const mask = badMask(log, thr);
      return { index: k, settings: log.settings, steps: [0, 1].map((a) => analyzeAxisSteps(['roll', 'pitch'][a], log.setpoint[a], log.gyro[a], log.fs, thr, mask)) };
    });
  const four = compareSeries(items([0.6, 0.8, 1.0, 1.2]));
  check('series: PI sweep -> param pi, best 1.0', four.param === 'pi' && four.bestValue === 1 && four.edge === null && !four.ambiguous, `${four.param} best ${four.bestValue} scores ${four.sessions.map((s) => s.score).join('/')}`);
  check('series: best advice + slider CLI', four.cli.join(' | ') === 'set simplified_pi_gain = 100 | simplified_tuning apply' && four.advice.some((a) => a.key === 'autotune2.series.best'));
  check('series: I and FF were 0 -> no reminder', !four.advice.some((a) => a.id === 'series.iffNotZero'));
  const three = compareSeries(items([0.6, 0.8, 1.0]));
  check('series: best at the top of the range -> continue higher', three.edge === 'high' && three.advice.some((a) => a.id === 'series.edgeHigh'), `${three.bestValue} ${three.edge}`);

  // hand-made master and FF series
  const M = (os, rise, ringing = 0) => ({ rise, latency50: 20, latency5: 4, overshoot: os, peak: 1, peakTime: 30, settle2: 80, settle5: 50, ringing, ssError: 0, undershoot: 0, bounceBack: null });
  const ax = (axis, m, delay = 10, corr = 0.95) => ({ axis, best: m, source: 'steps', detected: { n: 20 }, trackingDelayMs: delay, trackingCorr: corr });
  const master = [1, 1.5, 2].map((v, k) => ({ index: k, settings: parseLogSettings({ simplified_pids_mode: '2', simplified_master_multiplier: String(v * 100), simplified_pi_gain: '90', simplified_d_gain: '80' }), steps: [ax('roll', M(8, 60 - k * 15)), ax('pitch', M(8, 60 - k * 15))] }));
  const ms = compareSeries(master);
  const trick = ms.advice.find((a) => a.id === 'series.doubleTrick');
  check('series: master best at 2.0 -> reset-master trick', ms.param === 'master' && ms.edge === 'high' && trick && trick.cli.join(' | ') === 'set simplified_master_multiplier = 100 | set simplified_d_gain = 160 | set simplified_pi_gain = 180 | simplified_tuning apply', trick ? trick.cli.join(' | ') : JSON.stringify(ms.sessions));
  const msHot = compareSeries(master, { hotMotors: true });
  check('series: hot motors -> no trick, stop here', !msHot.advice.some((a) => a.id === 'series.doubleTrick') && msHot.advice.some((a) => a.id === 'series.edgeHot'));
  const ffv = [0.5, 1, 1.5, 2];
  const delays = [12, 6, 3, 2.2];
  const oss = [5, 6, 8, 30];
  const ff = compareSeries(ffv.map((v, k) => ({ index: k, settings: parseLogSettings({ simplified_pids_mode: '2', simplified_feedforward_gain: String(v * 100) }), steps: [ax('roll', M(oss[k], 30), delays[k], 0.98), ax('pitch', M(oss[k], 30), delays[k], 0.98)] })));
  check('series: FF picks best tracking without overshoot', ff.param === 'ff' && ff.bestValue === 1.5 && ff.advice.some((a) => a.key === 'autotune2.series.bestFf'), `${ff.bestValue} ${ff.sessions.map((s) => s.score).join('/')}`);
  const same = compareSeries([0, 1].map((k) => ({ index: k, settings: parseLogSettings({ simplified_pi_gain: '100' }), steps: [ax('roll', M(8, 30)), ax('pitch', M(8, 30))] })));
  check('series: identical settings -> noParam', same.param === null && same.advice.some((a) => a.id === 'series.noParam'));
  check('series: procedure order', PROCEDURE.map((p) => p.id).join() === 'filters,piSeries,masterSeries,restoreI,ffSeries,dynIdle' && PROCEDURE[1].prepare.includes('set simplified_i_gain = 0') && PROCEDURE[4].acroOnly === true && nextProcedureStep('pi') === 'masterSeries');
}

/* 10. autotune() on the demo sessions: everything wired, keys translated, result clonable, old API still works */
{
  const sessions = synthDemoSessions();
  let lastP = 0;
  let mono = true;
  const r = autotune(sessions, { frameInches: 5 }, (p) => {
    if (p < lastP) mono = false;
    lastP = p;
  });
  check('autotune: longest session analysed', r.session === 4 && r.sessions.length === 5 && r.sessions.every((s) => s.usable), String(r.session));
  check('autotune: progress 0 -> 1, monotonic', mono && lastP === 1);
  check('autotune: settings + needs complete', r.settings?.simplified?.mode === 'rpy' && r.needs.advice.length === 0 && r.needs.unfiltered && r.needs.dterm);
  check('autotune: quality good', r.quality.label === 'good', String(r.quality.score));
  check('autotune: roll overshoot flagged, pitch fine', r.pids.advice.some((a) => a.id === 'pid.overshoot.roll' && a.severity !== 'ok') && r.pids.advice.some((a) => a.id === 'pid.overshoot.pitch' && a.severity === 'ok'));
  check('autotune: propwash found', r.propwash.level === 'severe' || r.propwash.level === 'moderate', `${r.propwash.level} ${r.propwash.ratio}`);
  check('autotune: TPA advice from the high-throttle steps', r.pids.advice.some((a) => a.id === 'pid.tpaMore'));
  check('autotune: filter advice (harmonics, notch, delay)', ['filters.rpmHarmonics', 'filters.dynNotch', 'filters.delayHigh'].every((id) => r.filters.advice.some((a) => a.id === id)));
  check('autotune: series = PI sweep, best 1.0, long flight left out', r.series?.param === 'pi' && r.series.bestValue === 1 && r.series.excluded.join() === '4' && r.nextStep === 'masterSeries', `${r.series?.param} ${r.series?.bestValue} excl ${r.series?.excluded}`);
  const all = [...r.filters.advice, ...r.pids.advice, ...(r.series?.advice ?? []), ...r.needs.advice];
  const walk = (d, k) => k.split('.').reduce((n, p) => (n && typeof n === 'object' ? n[p] : undefined), d);
  // every key any rule can emit (scan the engine sources' literal keys would need fs; instead collect from many runs)
  const runs = [r];
  const bare = synthFlight({ seconds: 15 });
  delete bare.gyroUnfilt;
  delete bare.axisD;
  delete bare.settings;
  delete bare.throttle;
  bare.rcFallback = true;
  bare.fs = 900;
  runs.push(autotune(bare, { propInches: 5, hotMotors: true }));
  const keys = new Set([...all, ...runs.flatMap((x) => [...x.filters.advice, ...x.pids.advice, ...x.needs.advice, ...(x.series?.advice ?? [])])].map((a) => a.key));
  for (const p of PROCEDURE) keys.add(p.key);
  const missing = [...keys].filter((k) => typeof walk(en, k) !== 'string' || typeof walk(pl, k) !== 'string');
  check('autotune: every emitted key exists in en and pl', missing.length === 0, `${keys.size} keys; missing ${missing.join(', ')}`);
  const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const mism = [...keys].filter((k) => placeholders(walk(en, k)) !== placeholders(walk(pl, k)));
  check('autotune: en/pl placeholders match', mism.length === 0, mism.join(', '));
  const used = all.filter((a) => a.params).filter((a) => placeholders(walk(en, a.key)).split(',').filter(Boolean).some((p) => !(p in a.params)));
  check('autotune: every placeholder gets a param', used.length === 0, used.map((a) => a.key).join(', '));
  check('autotune: bare log still works (needs list)', runs[1].needs.advice.length >= 4 && runs[1].series === null && runs[1].noise.gyroUnfilt === null, runs[1].needs.advice.map((a) => a.id).join(','));
  let cloned = null;
  try {
    cloned = structuredClone(r);
  } catch (e) {
    cloned = String(e);
  }
  check('autotune: result is structured-clone safe', typeof cloned === 'object' && cloned.version === 2);
  const old = recommend(r.analysis, r.analysis.headerPid ?? null, true);
  check('autotune: legacy recommend() works on result.analysis', old.axes.length === 3);
  check('autotune: demo run is fast', r.ms < 4000, `${r.ms} ms`);

  // single long log (5 min at 4 kHz)
  const big = synthFlight({ seconds: 300, fs: 4000, seed: 3 });
  const t0 = Date.now();
  const rb = autotune(big, {});
  const dt = Date.now() - t0;
  check('autotune: 5 min @ 4 kHz in reasonable time', dt < 20000 && rb.steps[0].detected.n > 100, `${dt} ms, ${rb.steps[0].detected.n} roll steps`);
}

assert.equal(fails, 0, `${fails} checks failed`);
console.log('autotune OK');
