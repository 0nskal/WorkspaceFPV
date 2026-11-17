/** Autotune PID, Basic mode result: traffic lights, the one recommended change, Apply / Undo, fly again and compare. */
import { t } from '../i18n';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { tip } from '../ui/tip';
import { AREAS, basicPlan, compareRounds, verdicts, type AreaVerdict, type BasicPlan, type CompareItem } from '../wizard/verdict';
import { btn, chip, h2, k, type ViewModel } from './autotune-flow';

/** Why Apply is not possible right now (null = it is). */
export function basicApplyBlock(vm: ViewModel, plan: BasicPlan): string | null {
  if (plan.kind !== 'change') return null;
  if (vm.run?.sample && !vm.facts.demo) return 'sample';
  if (!vm.facts.connected) return 'needFc';
  if (vm.facts.armed) return 'armed';
  if (vm.mismatch.length) return 'mismatch';
  if (!vm.st.backup) return 'needBackup';
  return null;
}

const LIGHT_ICON: Record<AreaVerdict['light'], string> = { good: 'check', fair: 'alert', bad: 'alert', unknown: 'minus' };

function light(v: AreaVerdict): string {
  return `<li class="bz-light ${v.light}">
      <span class="bz-dot" aria-hidden="true">${icon(LIGHT_ICON[v.light], 16)}</span>
      <div><b>${t(k(`atFlow.basic.areas.${v.id}`))}</b><span class="bz-word">${t(k(`atFlow.basic.light.${v.light}`))}</span>
      <p>${escapeHtml(t(k(`atFlow.basic.v.${v.id}.${v.code}`), v.params))}</p></div></li>`;
}

function compare(vm: ViewModel): string {
  const rs = vm.rounds;
  if (rs.length < 2) return '';
  const prev = rs[rs.length - 2]!;
  const cur = rs[rs.length - 1]!;
  const c = compareRounds(prev.metrics, cur.metrics);
  const kind = c.overall === 'better' ? 'ok' : c.overall === 'worse' ? 'err' : 'info';
  // tiny before/after bars: overshoot distance from the target, smaller is better
  const bar = (label: string, a: number | null, b: number | null, max: number) =>
    a === null || b === null
      ? ''
      : `<div class="bz-ba"><span>${label}</span><span class="bz-bars" aria-hidden="true"><i class="a" style="width:${Math.min(100, (a / max) * 100).toFixed(0)}%"></i><i class="b" style="width:${Math.min(100, (b / max) * 100).toFixed(0)}%"></i></span></div>`;
  const items = (Object.keys(c.items) as CompareItem[]).filter((x) => c.items[x] !== null);
  return `<div class="pw-panel bz-compare"><div class="pw-cap mono">${t('atFlow.basic.compare.title')} ${tip('tips.autotune.bCompare')}</div>
      <p class="pw-msg ${kind}">${t(k(`atFlow.basic.compare.${c.overall}`))}</p>
      <ul class="bz-trends">${items.map((x) => `<li class="${c.items[x]}">${t(k(`atFlow.basic.compare.item.${x}`))}: <b>${t(k(`atFlow.basic.compare.trend.${c.items[x]}`))}</b></li>`).join('')}</ul>
      <div class="bz-legend"><span><i class="a"></i>${t('atFlow.basic.compare.before')}</span><span><i class="b"></i>${t('atFlow.basic.compare.after')}</span></div>
      ${bar(t('atFlow.basic.compare.item.feel'), prev.metrics.overshoot, cur.metrics.overshoot, Math.max(30, prev.metrics.overshoot ?? 0, cur.metrics.overshoot ?? 0))}
      ${bar(t('atFlow.basic.compare.item.propwash'), prev.metrics.propwash, cur.metrics.propwash, Math.max(6, prev.metrics.propwash ?? 0, cur.metrics.propwash ?? 0))}
    </div>`;
}

export function basicResult(vm: ViewModel): string {
  const run = vm.run;
  if (!run) return `${h2(t('atFlow.basic.result.title'))}<p class="pw-empty">${t('atFlow.block.needLog')}</p>`;
  const res = run.res;
  const vs = verdicts(res);
  const plan = basicPlan(res);
  const block = basicApplyBlock(vm, plan);
  const lights = `<ul class="bz-lights" aria-label="${escapeHtml(t('atFlow.basic.result.lightsAria'))}">${AREAS.map((id) => light(vs.find((v) => v.id === id)!)).join('')}</ul>`;
  let planHtml: string;
  if (plan.kind === 'none') {
    const fly = plan.flyAgain.length ? `<ul class="pw-notes">${plan.flyAgain.map((a) => `<li class="warn"><i></i>${t(k(`atFlow.import.advice.${a}`))}</li>`).join('')}</ul>` : '';
    planHtml = `<div class="bz-plan ${plan.reason === 'allGood' ? 'ok' : 'warn'}"><h3>${t('atFlow.basic.result.planTitle')} ${tip('tips.autotune.bResult')}</h3>
        <p>${t(k(`atFlow.basic.result.none.${plan.reason}`))}</p>${fly}
        <div class="pw-btns">${btn('fly-again', t('atFlow.basic.result.flyAgain'), 'light', { icon: 'play', big: true })}</div></div>`;
  } else {
    const applied = !!vm.rounds[vm.rounds.length - 1]?.applied.length;
    const why = block ? `<p class="pw-why">${t(k(`atFlow.basic.result.block.${block}`))}</p>` : '';
    planHtml = `<div class="bz-plan"><h3>${t('atFlow.basic.result.planTitle')} ${tip('tips.autotune.bResult')}</h3>
        <ul class="bz-what">${plan.items.map((it) => `<li>${icon('arrowRight', 14)}<span>${t(k(`atFlow.basic.what.${it.code}`))}</span></li>`).join('')}</ul>
        ${plan.conservative ? `<p class="pw-hint">${t('atFlow.basic.result.conservative')}</p>` : ''}
        ${applied ? `<p class="pw-msg ok">${t('atFlow.basic.result.applied')}</p>` : ''}
        <div class="pw-btns">
          ${btn('basic-apply', t('atFlow.basic.result.apply'), applied ? 'ghost' : 'light', { icon: 'arrowUp', disabled: !!block, big: !applied })}${tip('tips.autotune.bApply')}
          ${btn('restore', t('atFlow.basic.result.undo'), 'ghost', { arg: vm.st.backup ?? '', disabled: !vm.st.backup || !vm.facts.connected || vm.facts.armed })}${tip('tips.autotune.bUndo')}
          ${btn('fly-again', t('atFlow.basic.result.flyAgain'), applied ? 'light' : 'ghost', { icon: 'play' })}
        </div>${why}
        ${!vm.st.backup && block === 'needBackup' ? `<div class="pw-btns">${btn('goto', t('atFlow.basic.result.toBackup'), 'ghost', { arg: 'backup', icon: 'shield' })}</div>` : ''}
        <details class="pw-more"${vm.ui.details ? ' open' : ''} data-details><summary>${t('atFlow.basic.details')}</summary>
          <p class="pw-hint">${t(plan.form === 'raw' ? 'atFlow.basic.result.formRaw' : 'atFlow.basic.result.formSliders')}</p>
          <div class="at-cmd mono">${plan.commands.map((c) => `<div>${escapeHtml(c)}</div>`).join('')}</div>
          <div class="pw-btns">${btn('copy-basic', t('atFlow.propose.copy'), 'ghost', { icon: 'copy' })}</div>
        </details></div>`;
  }
  const notes = plan.notes.length ? `<ul class="pw-notes bz-notes">${plan.notes.map((n) => `<li class="info"><i></i>${t(k(`atFlow.basic.note.${n.code}`))}</li>`).join('')}</ul>` : '';
  const file = `<div class="pw-file"><span class="at-sq"></span><span class="mono">${escapeHtml(run.name)}</span>${run.sample ? chip('info', t('atFlow.basic.result.sampleChip')) : ''}
      <span class="pw-btns">${btn('pick', t('at.pickOther'), 'ghost', { icon: 'download' })}</span></div>`;
  return `${h2(t('atFlow.basic.result.title'), t('atFlow.basic.result.lead'), 'tips.autotune.bLights')}
    ${file}${lights}${planHtml}${notes}${compare(vm)}
    <p class="pw-hint bz-expert">${t('atFlow.basic.result.expertHint')}</p>`;
}
