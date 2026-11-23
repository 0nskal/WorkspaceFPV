/**
 * Radio screen (beginner): a drawing of the radio follows the live RC channels, a four-line stick test ticks itself
 * off when each axis reaches both ends, and the switches show which flight modes they carry (ARM first).
 * Click a switch on the drawing and flip it on the real radio: the AUX channel that moves is remembered locally
 * (localStorage) and shown on the drawing. Read-only: nothing is written to the FC here.
 */
import type { AppContext, ScreenMount } from '../context';
import { C } from '../bf/codes';
import { rawOf, STEP } from '../bf/steps';
import { decodeBoxIds, decodeBoxNames, decodeModeRanges, FALLBACK_BOXES, isEmptyRange, stepToUs, type ModeRange } from '../bf/modes';
import { decodeRc, decodeRxMap, elrsLink, sticksFromRc, type Sticks } from '../bf/receiver';
import { escapeHtml } from '../ui/dom';
import { t, type Key } from '../i18n';
import { icon } from '../ui/icons';
import { radioArt, setControls, updateRadio, type ControlView } from '../ui/art-radio';
import './radio.css';

type Axis = 'throttle' | 'yaw' | 'pitch' | 'roll';
const AXES: Axis[] = ['throttle', 'yaw', 'pitch', 'roll'];
const ARM_ID = 0;
/** Which drawn control carries which AUX (0 = AUX1). Per browser, not per drone: it describes the radio. */
const MAP_KEY = 'workspacefpv.radioControls.v1';
/** A channel counts as moved when it changes by more than this (µs); sticks are not AUX channels. */
const MOVE_US = 220;
const LEARN_MS = 12000;

function loadMap(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(MAP_KEY) ?? '{}') as Record<string, number>;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function saveMap(m: Record<string, number>): void {
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(m));
  } catch {
    /* private mode: the mapping lives for this session only */
  }
}

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  let rc: number[] = [];
  let stale = 0;
  let poll: ReturnType<typeof setInterval> | null = null;
  let inflight = false;
  let disposed = false;
  let shown: 'off' | 'on' | '' = '';
  // per axis: lowest and highest value seen (-1..1)
  const seen: Record<Axis, { lo: number; hi: number }> = { throttle: { lo: 0, hi: 0 }, yaw: { lo: 0, hi: 0 }, pitch: { lo: 0, hi: 0 }, roll: { lo: 0, hi: 0 } };
  const resetSeen = () => AXES.forEach((a) => (seen[a] = { lo: 0, hi: 0 }));
  let ctlMap = loadMap();
  let learning: { ctl: string; base: number[]; timer: ReturnType<typeof setTimeout> } | null = null;

  const connected = () => ctx.state.get().conn === 'connected';
  const rxMap = (): number[] => {
    const raw = rawOf(ctx.bf.get(), STEP.rxMap);
    return raw ? decodeRxMap(raw) : [0, 1, 3, 2, 4, 5, 6, 7];
  };

  function modes(): { ranges: ModeRange[]; name: (id: number) => string } {
    const d = ctx.bf.get();
    const base = rawOf(d, STEP.modeRanges);
    const namesRaw = rawOf(d, STEP.boxNames);
    const idsRaw = rawOf(d, STEP.boxIds);
    const names = namesRaw ? decodeBoxNames(namesRaw) : [];
    const ids = idsRaw ? decodeBoxIds(idsRaw) : [];
    const byId = new Map<number, string>();
    ids.forEach((id, i) => names[i] && byId.set(id, names[i]!));
    const ranges = base ? decodeModeRanges(base, rawOf(d, STEP.modeRangesExtra) ?? undefined).filter((r) => !isEmptyRange(r)) : [];
    return { ranges, name: (id) => byId.get(id) ?? FALLBACK_BOXES[id] ?? `#${id}` };
  }

  function armHtml(): string {
    const { ranges } = modes();
    const arm = ranges.find((r) => r.id === ARM_ID);
    const armed = !!ctx.state.get().status?.armed;
    if (!arm) {
      return `<div class="rd-arm none"><span class="rd-arm-i">${icon('alert', 18)}</span><div><b>${t('simple.radio.armNone')}</b><button class="w-btn" data-go="bf-modes">${t('simple.radio.armNoneAct')}${icon('arrowRight', 16)}</button></div></div>`;
    }
    return `<div class="rd-arm ${armed ? 'armed' : ''}"><span class="rd-arm-i">${icon('shield', 18)}</span><div>
      <b>${t('simple.radio.armHead')}: ${escapeHtml(t('simple.radio.armOn', { aux: `AUX${arm.aux + 1}`, from: stepToUs(arm.start), to: stepToUs(arm.end) }))}</b>
      <span class="rd-state" data-armed>${armed ? t('simple.radio.armed') : t('simple.radio.disarmed')}</span></div></div>`;
  }

  function switchesHtml(): string {
    const { ranges, name } = modes();
    const n = Math.max(4, Math.min(8, rc.length - 4));
    return Array.from({ length: n }, (_, k) => {
      const mine = ranges.filter((r) => r.aux === k);
      const labels = [...new Set(mine.map((r) => name(r.id)))];
      return `<li data-aux="${k}"><span class="rd-aux">AUX${k + 1}</span><span class="rd-modes">${labels.length ? labels.map((l) => modeChip(l)).join('') : `<small>${t('simple.radio.noModes')}</small>`}</span><span class="rd-us w-mono" data-us="${k}">—</span></li>`;
    }).join('');
  }

  /** Mode name chip with a one-sentence "what it does" bubble on hover / focus (known modes only). */
  function modeChip(name: string): string {
    const key = `simple.explain.modes.${name.replace(/ /g, '_')}` as Key;
    const txt = t(key);
    const has = txt !== key;
    return `<em class="${name === 'ARM' ? 'arm' : ''}${has ? ' has-x' : ''}"${has ? ` tabindex="0" data-x="${escapeHtml(txt)}" aria-label="${escapeHtml(`${name}: ${txt}`)}"` : ''}>${escapeHtml(name)}</em>`;
  }

  function renderOff(): void {
    shown = 'off';
    el.innerHTML = `<div class="w-page rd">
      <h1 class="w-h1">${t('simple.radio.title')}</h1>
      <p class="w-lead">${t('simple.radio.off')}</p>
      <div class="rd-art rd-art-off">${radioArt(t('simple.radio.aria'))}</div>
      <div class="rd-off-a"><button class="w-btn primary big" data-act="connect">${icon('plug', 18)}${t('simple.start.connect')}</button></div>
    </div>`;
  }

  function renderOn(): void {
    shown = 'on';
    el.innerHTML = `<div class="w-page rd">
      <h1 class="w-h1">${t('simple.radio.title')}</h1>
      <p class="w-lead">${t('simple.radio.lead')}</p>
      <div class="rd-grid">
        <div>
          <div class="rd-art">${radioArt(t('simple.radio.aria'), t('simple.radio.ctlAria'))}</div>
          <p class="rd-learn" data-learn role="status">${learnText()}</p>
          <p class="rd-caption">${t('simple.radio.mode2')} <span data-link></span></p>
          <div class="w-note fail rd-nosig" data-nosig hidden><p>${t('simple.radio.noSignal')}</p><button class="w-btn" data-go="ports">${t('simple.ports.checkPort')}${icon('arrowRight', 16)}</button></div>
        </div>
        <div class="rd-side">
          <section class="w-card rd-test">
            <div class="rd-test-h"><h2 class="w-h2">${t('simple.radio.testHead')}</h2><button class="w-btn quiet" data-act="reset">${t('simple.radio.reset')}</button></div>
            <p class="rd-test-lead">${t('simple.radio.testLead')}</p>
            <ul class="rd-axes">${AXES.map((a) => `<li data-axis="${a}"><span class="rd-tick" aria-hidden="true">${icon('check', 15)}</span><span class="rd-ax-t">${t(`simple.radio.${a}` as Key)}</span><span class="rd-meter" aria-hidden="true"><i data-lo></i><i data-hi></i><b data-now></b></span></li>`).join('')}</ul>
            <p class="rd-allok" data-allok hidden>${icon('check', 16)} ${t('simple.radio.allOk')}</p>
            <p class="rd-hint">${t('simple.radio.wrongWay')}</p>
          </section>
          ${armHtml()}
          <section class="w-card rd-sw">
            <h2 class="w-h2">${t('simple.radio.switchesHead')}</h2>
            <ul data-switches>${switchesHtml()}</ul>
          </section>
        </div>
      </div>
    </div>`;
    updateLive();
  }

  /* ---------------- switch learning ---------------- */
  let learnMsg: 'idle' | 'wait' | 'done' | 'none' = 'idle';
  let learnedAux = -1;
  function learnText(): string {
    const mapped = Object.keys(ctlMap).length;
    if (learnMsg === 'wait') return `<b>${t('simple.radio.learnWait')}</b> <button class="w-btn quiet" data-act="learn-cancel">${t('simple.radio.learnCancel')}</button>`;
    if (learnMsg === 'done') return `${icon('check', 15)} ${escapeHtml(t('simple.radio.learnDone', { aux: `AUX${learnedAux + 1}` }))}`;
    if (learnMsg === 'none') return escapeHtml(t('simple.radio.learnNone'));
    return `${escapeHtml(t('simple.radio.learnHint'))}${mapped ? ` <button class="w-btn quiet" data-act="learn-clear">${t('simple.radio.learnClear')}</button>` : ''}`;
  }
  function showLearn(): void {
    const box = el.querySelector<HTMLElement>('[data-learn]');
    if (box) {
      box.innerHTML = learnText();
      box.dataset.state = learnMsg;
    }
    updateLive();
  }
  function startLearn(ctl: string): void {
    if (!connected() || rc.length < 5 || stale >= 3) {
      learnMsg = 'none';
      showLearn();
      return;
    }
    stopLearn();
    learning = {
      ctl,
      base: rc.slice(4, 12),
      timer: setTimeout(() => {
        learning = null;
        learnMsg = 'none';
        showLearn();
      }, LEARN_MS),
    };
    learnMsg = 'wait';
    showLearn();
  }
  function stopLearn(): void {
    if (learning) clearTimeout(learning.timer);
    learning = null;
  }
  /** Called on every RC sample while learning: the AUX channel that moved the most wins. */
  function checkLearn(): void {
    if (!learning) return;
    let best = -1;
    let bestDelta = MOVE_US;
    // AUX1..AUX8 only: with ELRS, channels 15/16 carry link quality and RSSI and move on their own
    rc.slice(4, 12).forEach((v, k) => {
      const d = Math.abs(v - (learning!.base[k] ?? v));
      if (d > bestDelta) {
        bestDelta = d;
        best = k;
      }
    });
    if (best < 0) return;
    const ctl = learning.ctl;
    stopLearn();
    // one control per channel and one channel per control
    for (const [c, k] of Object.entries(ctlMap)) if (k === best || c === ctl) delete ctlMap[c];
    ctlMap[ctl] = best;
    saveMap(ctlMap);
    learnedAux = best;
    learnMsg = 'done';
    showLearn();
  }

  function controlViews(): Record<string, ControlView> {
    const { ranges, name } = modes();
    const out: Record<string, ControlView> = {};
    for (const [ctl, k] of Object.entries(ctlMap)) {
      const mine = ranges.filter((r) => r.aux === k);
      const first = mine.find((r) => r.id === ARM_ID) ?? mine[0];
      const v = rc[4 + k];
      const active = mine.filter((r) => v !== undefined && v >= stepToUs(r.start) && v < stepToUs(r.end));
      out[ctl] = {
        text: `AUX${k + 1}${first ? ` · ${name(first.id)}` : ''}`,
        state: active.some((r) => r.id === ARM_ID) ? 'arm' : active.length ? 'on' : '',
      };
    }
    return out;
  }

  function axisValue(s: Sticks, a: Axis): number {
    return a === 'throttle' ? s.throttle * 2 - 1 : s[a];
  }

  function updateLive(): void {
    if (shown !== 'on') return;
    const svg = el.querySelector('.r-stage');
    const mid = ctx.bf.get().rx?.midRc || 1500;
    const has = rc.length >= 4 && stale < 3;
    const sticks = has ? sticksFromRc(rc, rxMap(), mid) : null;
    if (svg) {
      updateRadio(svg, sticks);
      setControls(svg, controlViews(), learning?.ctl ?? null);
    }
    // the switch row lights up while its value sits inside a mode range
    const { ranges } = modes();
    el.querySelectorAll<HTMLElement>('[data-aux]').forEach((li) => {
      const k = Number(li.dataset.aux);
      const v = rc[4 + k];
      const hit = has && v !== undefined && ranges.some((r) => r.aux === k && v >= stepToUs(r.start) && v < stepToUs(r.end));
      li.classList.toggle('on', hit);
      li.classList.toggle('arm-on', hit && ranges.some((r) => r.aux === k && r.id === ARM_ID && v! >= stepToUs(r.start) && v! < stepToUs(r.end)));
    });
    const nosig = el.querySelector<HTMLElement>('[data-nosig]');
    // CRSF sends no channels without a link; other receivers hold failsafe values. No data or no ELRS link = no signal.
    const prov = ctx.bf.get().rx?.serialRxProvider ?? 0;
    const link = has ? elrsLink(rc, prov) : null;
    if (nosig) nosig.hidden = has && !(link && link.lq === 0);
    const lq = el.querySelector<HTMLElement>('[data-link]');
    if (lq) lq.textContent = link ? `${t('simple.radio.link')}: ${Math.round(link.lq)}%` : '';
    if (sticks) {
      let all = true;
      for (const a of AXES) {
        const v = axisValue(sticks, a);
        seen[a].lo = Math.min(seen[a].lo, v);
        seen[a].hi = Math.max(seen[a].hi, v);
        const done = seen[a].lo < -0.9 && seen[a].hi > 0.9;
        all &&= done;
        const row = el.querySelector<HTMLElement>(`[data-axis="${a}"]`);
        if (!row) continue;
        row.classList.toggle('done', done);
        const pct = (x: number) => `${(((x + 1) / 2) * 100).toFixed(1)}%`;
        (row.querySelector('[data-lo]') as HTMLElement).style.width = `${((-seen[a].lo / 2) * 100).toFixed(1)}%`;
        (row.querySelector('[data-hi]') as HTMLElement).style.width = `${((seen[a].hi / 2) * 100).toFixed(1)}%`;
        (row.querySelector('[data-now]') as HTMLElement).style.left = pct(v);
      }
      const ok = el.querySelector<HTMLElement>('[data-allok]');
      if (ok) ok.hidden = !all;
    }
    el.querySelectorAll<HTMLElement>('[data-us]').forEach((sp) => {
      const v = rc[4 + Number(sp.dataset.us)];
      sp.textContent = has && v !== undefined ? String(v) : '—';
    });
    const st = el.querySelector<HTMLElement>('[data-armed]');
    if (st) {
      const armed = !!ctx.state.get().status?.armed;
      st.textContent = armed ? t('simple.radio.armed') : t('simple.radio.disarmed');
      st.closest('.rd-arm')?.classList.toggle('armed', armed);
    }
  }

  function startPoll(): void {
    if (poll) return;
    poll = setInterval(() => {
      if (inflight || disposed || !connected() || ctx.link()?.busy) return;
      inflight = true;
      ctx.bf
        .send(C.RC)
        .then((p) => {
          rc = decodeRc(p);
          stale = 0;
          checkLearn();
        })
        .catch(() => stale++)
        .finally(() => {
          inflight = false;
          if (!disposed) updateLive();
        });
    }, 80);
  }

  function stopPoll(): void {
    if (poll) clearInterval(poll);
    poll = null;
  }

  function render(): void {
    if (!connected()) {
      stopPoll();
      if (shown !== 'off') renderOff();
      return;
    }
    if (shown !== 'on') {
      renderOn();
      void ctx.bf.refresh(['rx', 'receiver', 'modes']).then(() => {
        if (!disposed && shown === 'on') {
          const list = el.querySelector('[data-switches]');
          if (list) list.innerHTML = switchesHtml();
          const old = el.querySelector('.rd-arm');
          if (old) old.outerHTML = armHtml();
          updateLive();
        }
      });
    }
    startPoll();
  }

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'connect') void ctx.connect();
    else if (act === 'reset') {
      resetSeen();
      el.querySelectorAll('[data-axis]').forEach((r) => r.classList.remove('done'));
      updateLive();
    }
    else if (act === 'learn-cancel') {
      stopLearn();
      learnMsg = 'idle';
      showLearn();
    } else if (act === 'learn-clear') {
      ctlMap = {};
      saveMap(ctlMap);
      learnMsg = 'idle';
      showLearn();
    }
    const go = target.closest<HTMLElement>('[data-go]')?.dataset.go;
    if (go) ctx.navigate(go);
    const ctl = target.closest<SVGGElement>('[data-ctl]')?.dataset.ctl;
    if (ctl) startLearn(ctl);
  });
  el.addEventListener('keydown', (e) => {
    const ctl = (e.target as Element).closest?.<SVGGElement>('[data-ctl]')?.dataset.ctl;
    if (ctl && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      startLearn(ctl);
    }
  });
  // hovering a switch row lights up its control on the drawing
  el.addEventListener('pointerover', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-aux]');
    const k = li ? Number(li.dataset.aux) : -1;
    el.querySelectorAll<SVGGElement>('[data-ctl]').forEach((g) => g.classList.toggle('hl', k >= 0 && ctlMap[g.dataset.ctl ?? ''] === k));
  });

  const off = ctx.state.subscribe(render);
  render();
  return () => {
    disposed = true;
    stopLearn();
    stopPoll();
    off();
  };
};
