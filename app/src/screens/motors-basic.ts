/**
 * Motors, Basic mode: a step-by-step motor check on the drone render. One motor at a time spins slowly for a moment,
 * the pilot answers two questions (right motor? right direction?) and gets a plain summary with what to fix.
 *
 * Safety (same rules as the Expert motor test in esc.ts):
 *   - nothing spins until "Props are off" is switched on, a battery is connected and the FC is not armed;
 *   - one motor, low throttle (SPIN_PCT), stops by itself after SPIN_MS;
 *   - STOP, Space, window blur, hidden tab, disconnect / reconnect and leaving the tab stop it at once (zeros sent);
 *   - the demo never sends MSP_SET_MOTOR, it only animates the drawing.
 */
import type { AppContext } from '../context';
import { pctToMotor } from '../bf/motors';
import { MSP } from '../serial/msp';
import { escapeHtml } from '../ui/dom';
import { t, type Key } from '../i18n';
import { icon } from '../ui/icons';
import { droneArt, MOTORS, spinProps } from '../ui/art-drone';
import { spinsCw } from './esc-quad';
import { directionBlock, setMotorDirection } from '../bf/dshot';
import './motors-basic.css';

const SPIN_PCT = 8;
const SPIN_MS = 2500;
const TICK_MS = 100;
/** Angle pointing away from the frame centre, per BF motor (SVG degrees, y down). */
const OUT = [45, -45, 135, -135];

type Which = 'ok' | 'other' | 'none';
type Dir = 'ok' | 'wrong';
interface Result {
  which: Which | null;
  dir: Dir | null;
}

export function mountMotorsBasic(el: HTMLElement, ctx: AppContext): () => void {
  let step: 'check' | 0 | 1 | 2 | 3 | 'done' = 'check';
  let propsOff = false;
  let spinning: number | null = null;
  let spunOnce = false;
  let spinEnd = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight = false;
  let stopSpinArt: (() => void) | null = null;
  const results: Result[] = [0, 1, 2, 3].map(() => ({ which: null, dir: null }));
  let shownConn = '';
  let lastReady = '';
  // per motor: how many times the direction was changed (odd = REVERSED was sent last, even = NORMAL)
  const flips = [0, 0, 0, 0];
  let flipping = false;

  const connected = () => ctx.state.get().conn === 'connected';
  const vbat = () => ctx.state.get().telemetry?.vbat ?? 0;
  const hasBattery = () => vbat() > 5;
  const armed = () => !!ctx.state.get().status?.armed;
  const demo = () => ctx.state.get().mode === 'demo';
  const propsOut = () => !!ctx.bf.get().mixer?.reversed;
  const ready = () => connected() && propsOff && hasBattery() && !armed();

  /* ---------------- sending ---------------- */
  function frame(motor: number | null): Uint8Array {
    const b = new Uint8Array(16);
    const dv = new DataView(b.buffer);
    for (let i = 0; i < 8; i++) dv.setUint16(i * 2, i === motor ? pctToMotor(SPIN_PCT) : 1000, true);
    return b;
  }
  function send(motor: number | null): void {
    const link = ctx.link();
    if (!link || link.busy || demo()) return;
    if (motor !== null && inflight) return;
    inflight = true;
    link
      .request(MSP.SET_MOTOR, frame(motor), 400)
      .catch(() => undefined)
      .finally(() => (inflight = false));
  }

  function spin(i: number): void {
    if (!ready() || spinning !== null) return;
    spinning = i;
    spinEnd = performance.now() + SPIN_MS;
    send(i);
    timer = setInterval(() => {
      if (!ready() || performance.now() >= spinEnd) {
        stop();
        return;
      }
      send(i);
    }, TICK_MS);
    paintPanel();
  }

  function stop(): void {
    const was = spinning !== null || timer !== null;
    if (timer) clearInterval(timer);
    timer = null;
    if (spinning !== null) spunOnce = true;
    spinning = null;
    if (was && !demo()) for (let k = 0; k < 2; k++) send(null);
    paintPanel();
  }

  /* ---------------- drawing ---------------- */
  function arrowSvg(i: number, cls: string): string {
    const m = MOTORS[i]!;
    const cw = spinsCw(i, propsOut());
    const r = 118;
    const rad = (d: number) => (d * Math.PI) / 180;
    const a0 = rad(OUT[i]! - 55);
    const a1 = rad(OUT[i]! + 55);
    const pt = (a: number) => [m.x + r * Math.cos(a), m.y + r * Math.sin(a)];
    const [sx, sy] = pt(cw ? a0 : a1);
    const [ex, ey] = pt(cw ? a1 : a0);
    const end = cw ? a1 : a0;
    // arrowhead: tangent at the end point
    const tx = -Math.sin(end) * (cw ? 1 : -1);
    const ty = Math.cos(end) * (cw ? 1 : -1);
    const nx = Math.cos(end);
    const ny = Math.sin(end);
    const h = 18;
    const head = `M${(ex! + tx * h).toFixed(1)} ${(ey! + ty * h).toFixed(1)} L${(ex! + nx * h * 0.6).toFixed(1)} ${(ey! + ny * h * 0.6).toFixed(1)} L${(ex! - nx * h * 0.6).toFixed(1)} ${(ey! - ny * h * 0.6).toFixed(1)} Z`;
    return `<g class="mb-arrow ${cls}"><path d="M${sx!.toFixed(1)} ${sy!.toFixed(1)} A${r} ${r} 0 0 ${cw ? 1 : 0} ${ex!.toFixed(1)} ${ey!.toFixed(1)}" /><path class="mb-head" d="${head}"/></g>`;
  }

  function overlay(): string {
    return MOTORS.map((m, i) => {
      const r = results[i]!;
      const bad = r.which === 'other' || r.which === 'none' || r.dir === 'wrong';
      const good = r.which === 'ok' && r.dir === 'ok';
      const cur = step === i;
      const cls = cur ? 'cur' : bad ? 'bad' : good ? 'good' : 'idle';
      const badge = `<g class="mb-badge ${cls}" transform="translate(${m.x} ${m.y})"><circle r="40"/><text text-anchor="middle" y="11">${i + 1}</text></g>`;
      return `${cur || step === 'done' || step === 'check' ? arrowSvg(i, cls) : ''}${badge}`;
    }).join('');
  }

  /* ---------------- panel ---------------- */
  const posName = (i: number) => t(`simple.motors.pos${i}` as Key);
  const dirName = (i: number) => (spinsCw(i, propsOut()) ? t('simple.motors.cw') : t('simple.motors.ccw'));

  function checkHtml(): string {
    const bat = hasBattery();
    const batRow = bat
      ? `<li class="ok">${icon('check', 16)}<span>${escapeHtml(t('simple.motors.batOk', { v: vbat().toFixed(1) }))}</span></li>`
      : `<li class="bad">${icon('x', 16)}<span>${t('simple.motors.batNo')}</span></li>`;
    return `<h2 class="w-h2">${t('simple.motors.checkHead')}</h2>
      <ul class="mb-checks">
        <li><button type="button" class="mb-props" role="switch" aria-checked="${propsOff}" data-act="props"><span class="w-toggle" aria-hidden="true"></span><span>${t('simple.motors.propsOff')}</span></button></li>
        ${batRow}
        ${armed() ? `<li class="bad">${icon('x', 16)}<span>${t('simple.motors.armed')}</span></li>` : ''}
      </ul>
      <p class="mb-note">${t('simple.motors.howItWorks')}</p>
      <button class="w-btn primary big" data-act="start" ${ready() ? '' : 'disabled'}>${t('simple.motors.start')}${icon('arrowRight', 18)}</button>`;
  }

  function stepHtml(i: number): string {
    const r = results[i]!;
    const spinBtn =
      spinning !== null
        ? `<button class="w-btn big mb-stop" data-act="stop">${icon('stop', 18)}${t('simple.motors.stop')}</button>`
        : `<button class="w-btn primary big" data-act="spin" ${ready() ? '' : 'disabled'}>${icon('play', 18)}${escapeHtml(t(spunOnce ? 'simple.motors.spinAgain' : 'simple.motors.spin', { n: i + 1 }))}</button>`;
    const q1 = spunOnce
      ? `<div class="mb-q"><p>${escapeHtml(t('simple.motors.q1', { n: i + 1 }))}</p><div class="mb-a">
          <button class="w-btn${r.which === 'ok' ? ' on' : ''}" data-which="ok">${t('simple.motors.yes')}</button>
          <button class="w-btn${r.which === 'other' ? ' on' : ''}" data-which="other">${t('simple.motors.other')}</button>
          <button class="w-btn${r.which === 'none' ? ' on' : ''}" data-which="none">${t('simple.motors.none')}</button></div></div>`
      : '';
    const q2 =
      spunOnce && r.which === 'ok'
        ? `<div class="mb-q"><p>${escapeHtml(t('simple.motors.q2', { dir: dirName(i) }))}</p><div class="mb-a">
          <button class="w-btn${r.dir === 'ok' ? ' on' : ''}" data-dir="ok">${t('simple.motors.yes')}</button>
          <button class="w-btn${r.dir === 'wrong' ? ' on' : ''}" data-dir="wrong">${t('simple.motors.no')}</button></div></div>`
        : '';
    const block = directionBlock(ctx);
    const fix =
      spunOnce && r.which === 'ok' && r.dir === 'wrong'
        ? `<div class="mb-q mb-flip"><p>${escapeHtml(t('simple.motors.flipLead'))}</p>
          ${block && block !== 'notConnected' ? `<p class="w-note warn">${escapeHtml(t(`simple.motors.flipBlock_${block}` as Key))}</p>` : ''}
          <div class="mb-a"><button class="w-btn primary" data-act="flip" ${block || flipping ? 'disabled' : ''}>${escapeHtml(t(flips[i]! ? 'simple.motors.flipAgain' : 'simple.motors.flip'))}</button>
          <button class="w-btn quiet" data-act="skip">${t('simple.motors.flipSkip')}</button></div></div>`
        : '';
    return `<p class="mb-step">${escapeHtml(t('simple.motors.stepOf', { n: i + 1 }))}</p>
      <h2 class="w-h2">${escapeHtml(t('simple.motors.stepHead', { n: i + 1, pos: posName(i) }))}</h2>
      <p class="mb-lead">${escapeHtml(t('simple.motors.stepLead', { dir: dirName(i) }))}</p>
      <div class="mb-spin">${spinBtn}</div>
      ${!ready() && spinning === null ? `<p class="w-note warn">${t('simple.motors.notReady')}</p>` : ''}
      ${q1}${q2}${fix}`;
  }

  function doneHtml(): string {
    const rows = results
      .map((r, i) => {
        const key: Key =
          r.which === 'none' ? 'simple.motors.resNone' : r.which === 'other' ? 'simple.motors.resOther' : r.dir === 'wrong' ? 'simple.motors.resDir' : 'simple.motors.resOk';
        const ok = key === 'simple.motors.resOk';
        return `<li class="${ok ? 'ok' : 'bad'}">${icon(ok ? 'check' : 'x', 16)}<span><b>${escapeHtml(t('simple.motors.motorN', { n: i + 1 }))}</b> ${escapeHtml(t(key))}</span></li>`;
      })
      .join('');
    const anyOther = results.some((r) => r.which === 'other');
    const anyNone = results.some((r) => r.which === 'none');
    const anyDir = results.some((r) => r.which === 'ok' && r.dir === 'wrong');
    const allOk = !anyOther && !anyNone && !anyDir;
    const fixes = [anyOther ? t('simple.motors.fixOrder') : '', anyNone ? t('simple.motors.fixNone') : '', anyDir ? t('simple.motors.fixDir') : ''].filter(Boolean);
    return `<h2 class="w-h2">${allOk ? t('simple.motors.allOk') : t('simple.motors.someBad')}</h2>
      <ul class="mb-res">${rows}</ul>
      ${allOk ? `<p class="mb-lead">${t('simple.motors.allOkLead')}</p>` : fixes.map((f) => `<p class="mb-fix">${f}</p>`).join('')}
      <div class="mb-a">
        <button class="w-btn" data-act="restart">${t('simple.motors.restart')}</button>
        ${allOk ? '' : `<button class="w-btn quiet" data-act="ask">${t('simple.drone.ask')}</button>`}
      </div>`;
  }

  function paintPanel(): void {
    const panel = el.querySelector<HTMLElement>('[data-mb-panel]');
    const over = el.querySelector<SVGGElement>('[data-mb-over]');
    if (over) over.innerHTML = overlay();
    if (!panel) return;
    panel.innerHTML = step === 'check' ? checkHtml() : step === 'done' ? doneHtml() : stepHtml(step);
    el.querySelector('.mb-art')?.classList.toggle('spinning', spinning !== null);
  }

  function renderOff(): void {
    el.innerHTML = `<div class="w-page mb">
      <h1 class="w-h1">${t('simple.nav.motors')}</h1>
      <p class="w-lead">${t('simple.motors.off')}</p>
      <div class="mb-off-a"><button class="w-btn primary big" data-act="connect">${icon('plug', 18)}${t('simple.start.connect')}</button></div>
    </div>`;
  }

  function renderOn(): void {
    stopSpinArt?.();
    el.innerHTML = `<div class="w-page mb">
      <h1 class="w-h1">${t('simple.nav.motors')}</h1>
      <p class="w-lead">${t('simple.motors.lead')}</p>
      <div class="mb-grid">
        <div class="mb-art">${droneArt({ label: t('simple.drone.aria'), overlay: '<g data-mb-over></g>' })}</div>
        <section class="w-card mb-panel" data-mb-panel aria-live="polite"></section>
      </div>
    </div>`;
    const art = el.querySelector('.d-stage');
    if (art) stopSpinArt = spinProps(art, () => [0, 1, 2, 3].map((i) => (i === spinning ? 40 : 0)));
    paintPanel();
  }

  function render(): void {
    const s = ctx.state.get();
    if (s.conn !== 'connected') stop();
    const key = s.conn === 'connected' ? 'on' : 'off';
    if (key !== shownConn) {
      shownConn = key;
      if (key === 'on') renderOn();
      else {
        stopSpinArt?.();
        stopSpinArt = null;
        renderOff();
      }
    } else if (key === 'on' && spinning === null) paintPanel();
  }

  function next(): void {
    if (typeof step === 'number') {
      step = step < 3 ? ((step + 1) as 0 | 1 | 2 | 3) : 'done';
      spunOnce = false;
    }
    paintPanel();
  }

  el.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    const act = tg.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'connect') return void ctx.connect();
    if (act === 'props') {
      propsOff = !propsOff;
      if (!propsOff) stop();
      return paintPanel();
    }
    if (act === 'start' && ready()) {
      step = 0;
      spunOnce = false;
      return paintPanel();
    }
    if (act === 'spin' && typeof step === 'number') return spin(step);
    if (act === 'stop') return stop();
    if (act === 'restart') {
      stop();
      results.forEach((r) => ((r.which = null), (r.dir = null)));
      step = 'check';
      return paintPanel();
    }
    if (act === 'ask') {
      const bad = results.map((r, i) => (r.which === 'ok' && r.dir === 'ok' ? '' : `M${i + 1}: ${r.which === 'ok' ? 'wrong direction' : r.which}`)).filter(Boolean);
      return ctx.askAi(t('simple.motors.askQ', { list: bad.join(', ') }));
    }
    const which = tg.closest<HTMLElement>('[data-which]')?.dataset.which as Which | undefined;
    if (which && typeof step === 'number') {
      stop();
      results[step]!.which = which;
      results[step]!.dir = null;
      if (which !== 'ok') return next();
      return paintPanel();
    }
    const dir = tg.closest<HTMLElement>('[data-dir]')?.dataset.dir as Dir | undefined;
    if (dir && typeof step === 'number') {
      results[step]!.dir = dir;
      // wrong direction: stay on this motor and offer to reverse it in the ESC
      return dir === 'ok' ? next() : paintPanel();
    }
    if (act === 'skip') return next();
    if (act === 'flip' && typeof step === 'number' && !flipping) {
      const i = step;
      const reversed = flips[i]! % 2 === 0;
      void ctx
        .confirm({ title: t('simple.motors.flipConfirmTitle', { n: i + 1 }), body: escapeHtml(t('simple.motors.flipConfirmBody')), confirmText: t('simple.motors.flip') })
        .then(async (ok) => {
          if (!ok) return;
          stop();
          flipping = true;
          paintPanel();
          try {
            await setMotorDirection(ctx, i, reversed);
            flips[i]!++;
            results[i]!.dir = null;
            spunOnce = false;
            ctx.toast(t('simple.motors.flipDone', { n: i + 1 }), 'ok');
          } catch (e) {
            ctx.toast(t('simple.motors.flipFail', { msg: e instanceof Error ? e.message : String(e) }), 'error');
          } finally {
            flipping = false;
            paintPanel();
          }
        });
      return;
    }
  });

  const onKey = (e: KeyboardEvent) => {
    if ((e.code === 'Space' || e.key === ' ') && spinning !== null) {
      e.preventDefault();
      stop();
    }
  };
  const onBlur = () => stop();
  const onVis = () => {
    if (document.hidden) stop();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  const off = ctx.state.subscribe(render);
  // battery voltage and arming state change the checklist
  const offT = ctx.state.subscribeTelemetry(() => {
    if (shownConn === 'on' && (step === 'check' || typeof step === 'number') && spinning === null) {
      const k = `${hasBattery()}${armed()}`;
      if (k !== lastReady) {
        lastReady = k;
        paintPanel();
      }
    }
  });
  render();

  return () => {
    stop();
    stopSpinArt?.();
    off();
    offT();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVis);
  };
}
