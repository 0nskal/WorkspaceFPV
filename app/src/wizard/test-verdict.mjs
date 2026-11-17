// Autotune PID: Basic-mode verdicts and the one-change plan, Expert apply units, round comparison: npm test
import { autotune } from '../analysis/autotune.ts';
import { synthDemoSessions, synthFlight } from '../analysis/synth.ts';
import { AREAS, applyUnits, basicPlan, compareRounds, mergeCommands, roundMetrics, selectedCommands, verdicts } from './verdict.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}
const light = (vs, id) => vs.find((v) => v.id === id);

// 1. mergeCommands: no duplicates, one "simplified_tuning apply" at the very end
{
  const m = mergeCommands([['set a = 1', 'simplified_tuning apply'], ['set b = 2', 'set a = 1', 'simplified_tuning apply'], ['set c = 3']]);
  check('merge: dedupe + apply last', m.join('|') === 'set a = 1|set b = 2|set c = 3|simplified_tuning apply', m.join('|'));
  check('merge: no apply when none given', mergeCommands([['set x = 1']]).join() === 'set x = 1');
}

// 2. demo flight (bouncy roll, propwash, slider tune): lights and a slider change set
const demo = autotune(synthDemoSessions(), { frameInches: 5 });
{
  const vs = verdicts(demo);
  check('verdicts: one per area, fixed order', vs.map((v) => v.id).join() === AREAS.join());
  check('verdicts: bouncy feel', light(vs, 'feel').code === 'bouncy' && light(vs, 'feel').light !== 'good', JSON.stringify(light(vs, 'feel')));
  check('verdicts: propwash not good', ['fair', 'bad'].includes(light(vs, 'propwash').light), light(vs, 'propwash').light);
  check('verdicts: good log', light(vs, 'log').light === 'good');
  const p = basicPlan(demo);
  check('plan: change with sliders', p.kind === 'change' && p.form === 'sliders', `${p.kind} ${p.form} ${p.reason}`);
  check('plan: slider CLI only, apply at the end', p.commands.every((c) => /^set simplified_/.test(c) || c === 'simplified_tuning apply') && p.commands[p.commands.length - 1] === 'simplified_tuning apply', p.commands.join(' | '));
  check('plan: no raw PID switch-off', !p.commands.some((c) => c.includes('simplified_pids_mode')));
  check('plan: explains damping', p.items.some((i) => i.code === 'moreDamping' || i.code === 'propwash'), p.items.map((i) => i.code).join());
  check('plan: never sends save', !p.commands.some((c) => /^save\b/.test(c)));
}

// 3. a poor log gives no change, but tells what to fly
{
  const short = synthFlight({ seconds: 6, seed: 3 });
  delete short.throttle;
  const r = autotune(short, {});
  const p = basicPlan(r);
  check('plan: poor log -> nothing', r.quality.label !== 'poor' || (p.kind === 'none' && p.reason === 'poorLog' && p.commands.length === 0 && p.flyAgain.length > 0), `${r.quality.label} ${r.quality.score} ${p.reason}`);
  // force the poor label to test the branch regardless of the synthetic score
  const forced = basicPlan({ ...r, quality: { ...r.quality, label: 'poor', score: 30, advice: ['moreRoll', 'noThrottle', 'longer'] } });
  check('plan: forced poor -> fly again list without noThrottle', forced.kind === 'none' && forced.flyAgain.join() === 'moreRoll,longer');
}

// 4. medium log is conservative: PIDs only, no filter sliders
{
  const r = { ...demo, quality: { ...demo.quality, label: 'ok', score: 60 } };
  const p = basicPlan(r);
  check('plan: medium log conservative', p.conservative && !p.commands.some((c) => /filter_multiplier/.test(c)), p.commands.join(' | '));
}

// 5. a clean, well-tuned flight: nothing to change
{
  const clean = synthFlight({ seconds: 40, seed: 11, axes: [{ overshootPct: 7, peakTime: 0.06 }, { overshootPct: 7, peakTime: 0.06 }, { overshootPct: 3, peakTime: 0.12 }], propwash: 0 });
  const r = autotune(clean, { frameInches: 5 });
  const vs = verdicts(r);
  check('clean: feel good', light(vs, 'feel').light === 'good', JSON.stringify(light(vs, 'feel')));
  const p = basicPlan({ ...r, filters: { ...r.filters, sliders: [] } });
  check('clean: no PID change', !p.commands.some((c) => /pi_gain|d_gain|p_roll|d_roll/.test(c)), p.commands.join(' | '));
}

// 6. Expert units: PID set + filter advice; raw form switches the sliders off; selection merges
{
  const s = applyUnits(demo, 'sliders');
  const raw = applyUnits(demo, 'raw');
  const pidS = s.find((u) => u.id === 'pid');
  const pidR = raw.find((u) => u.id === 'pid');
  check('units: pid set in both forms', !!pidS && !!pidR);
  check('units: raw form switches sliders off', pidR.commands[0] === 'set simplified_pids_mode = OFF', pidR.commands[0]);
  check('units: filter advice present', s.some((u) => u.group === 'filters'), s.map((u) => u.id).join());
  check('units: dyn idle (approximate) not ticked', s.filter((u) => u.id === 'pid.dynIdle').every((u) => !u.on));
  check('units: series advice not ticked', s.filter((u) => u.group === 'series').every((u) => !u.on));
  const sel = new Set(s.filter((u) => u.on).map((u) => u.id));
  const cmds = selectedCommands(s, sel);
  check('units: merged selection', cmds.length > 0 && cmds.filter((c) => c === 'simplified_tuning apply').length <= 1, String(cmds.length));
  check('units: empty selection', selectedCommands(s, new Set()).length === 0);
}

// 7. rounds: lower overshoot toward 8 %, less noise -> better
{
  const a = { overshoot: 24, rise: 40, ringing: 2, noise: 3, propwash: 4, quality: 80 };
  const b = { overshoot: 10, rise: 41, ringing: 1, noise: 2, propwash: 2, quality: 82 };
  const c = compareRounds(a, b);
  check('rounds: better', c.overall === 'better' && c.items.feel === 'better' && c.items.speed === 'same', JSON.stringify(c));
  const w = compareRounds(b, a);
  check('rounds: worse', w.overall === 'worse');
  const m = compareRounds(a, { ...b, rise: 60 });
  check('rounds: mixed', m.overall === 'mixed');
  check('rounds: unknown', compareRounds({ overshoot: null, rise: null, ringing: null, noise: null, propwash: null, quality: 0 }, b).overall === 'unknown');
  const rm = roundMetrics(demo);
  check('roundMetrics from engine', rm.overshoot !== null && rm.quality === demo.quality.score, JSON.stringify(rm));
}

if (fails) {
  console.log(`\n${fails} verdict check(s) failed`);
  process.exit(1);
}
console.log('verdict OK');
