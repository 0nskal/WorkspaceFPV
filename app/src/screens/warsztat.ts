/**
 * Drone (home) screen. Disconnected: how to connect, three steps, one button. Connected: the drawing of the quad
 * with the problem parts marked, and the rule results rewritten as plain tasks with a Fix button (CLI through
 * ctx.applyCommands: confirm, backup, save) or a link to the screen where it gets fixed.
 */
import { RX_PROVIDERS } from '../bf/decode';
import type { AppContext, ScreenMount } from '../context';
import { armingDesc, type Check, type Diagnosis, type Suggestion } from '../fc/diagnose';
import { boardDisplayName, firmwareName } from '../fc/board';
import { motorPct, protocolName, rssiPct, type FcState } from '../fc/state';
import { hasWebSerial } from '../serial/port';
import { escapeHtml } from '../ui/dom';
import { fmtDate, fmtNum, t, tn, type Key } from '../i18n';
import { ANCHORS, ART_H, ART_W, droneArt, spinProps, type DronePart, type PartState } from '../ui/art-drone';
import { icon } from '../ui/icons';
import { loadBackup } from '../settings';
import { isUsbOnly, powerCaused } from '../fc/power';
import { TOOL_LINKS } from './registry';
import './warsztat.css';

interface Issue {
  id: string;
  part: DronePart | null;
  sev: 'fail' | 'warn';
  title: string;
  desc: string;
  tech: string;
  fix?: Suggestion;
  route?: string;
}

const RADIO_FLAGS = new Set(['THROTTLE', 'ARM_SWITCH', 'NOPREARM', 'RX_FAILSAFE', 'FAILSAFE', 'BOXFAILSAFE']);
const SETUP_FLAGS = new Set(['ACC_CALIBRATION', 'ANGLE', 'NO_GYRO']);
const MOTOR_FLAGS = new Set(['MOTOR_PROTOCOL', 'RPMFILTER', 'DSHOT_TELEM', 'DSHOT_BITBANG', 'RUNAWAY_TAKEOFF']);

/** Rule result -> a task a beginner can act on. */
function toIssue(c: Check, d: Diagnosis): Issue | null {
  if (c.severity !== 'fail' && c.severity !== 'warn') return null;
  const sug = (id: string) => d.suggestions.find((s) => s.id === id);
  const base = { id: c.id, part: (c.part as DronePart | null) ?? null, sev: c.severity, tech: c.label } as const;
  const plain = (k: 'protocol' | 'bidir' | 'bidirNoFw' | 'bidirOnNoFw' | 'vbat' | 'motors' | 'armedStill' | 'cpu' | 'i2c') => ({
    title: t(`simple.plain.${k}.t` as Key),
    desc: t(`simple.plain.${k}.d` as Key),
  });
  switch (c.id) {
    case 'protocol':
      return { ...base, ...plain('protocol'), fix: sug('protocol') };
    case 'bidir': {
      const fix = sug('bidir');
      if (fix) return { ...base, ...plain('bidir'), fix };
      return { ...base, ...plain(c.severity === 'warn' ? 'bidirNoFw' : 'bidirOnNoFw'), route: 'esc' };
    }
    case 'vbat':
      return { ...base, ...plain('vbat') };
    case 'motors':
      return { ...base, ...plain('motors'), route: 'config' };
    case 'armed-motors':
      return { ...base, ...plain('armedStill'), route: 'esc' };
    case 'cpu':
      return { ...base, ...plain('cpu'), route: 'config' };
    case 'i2c':
      return { ...base, ...plain('i2c') };
  }
  if (c.id.startsWith('arm-')) {
    const name = c.id.slice(4);
    const how = `simple.plain.arm.${name}` as Key;
    const desc = t(how) === how ? t('simple.plain.arm.generic') : t(how);
    const route = RADIO_FLAGS.has(name) ? 'radio' : SETUP_FLAGS.has(name) ? 'setup' : MOTOR_FLAGS.has(name) ? 'esc' : undefined;
    return { ...base, title: t('simple.plain.armFlagHead', { what: armingDesc(name).replace(/^./, (ch) => ch.toLowerCase()) }), desc, route };
  }
  return { ...base, title: c.label, desc: c.detail ?? '' };
}

const ROUTE_LABEL: Record<string, Key> = {
  radio: 'simple.nav.radio',
  esc: 'simple.nav.motors',
  setup: 'bfSetup.tab',
  config: 'bfConfig.tab',
};

/** Callout pill spots on the drawing (viewBox units), with the leader line going to ANCHORS[part]. */
const PILLS: Array<{ part: DronePart; x: number; y: number }> = [
  { part: 'motors', x: 820, y: 44 },
  { part: 'fc', x: 170, y: 512 },
  { part: 'esc', x: 860, y: 532 },
  { part: 'battery', x: 290, y: 990 },
  { part: 'rx', x: 760, y: 990 },
];

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  let view: 'start' | 'scene' | '' = '';
  let sceneKey = '';
  let stopSpin: (() => void) | null = null;
  const connected = () => ['connected', 'reconnecting'].includes(ctx.state.get().conn);

  /* ---------------- disconnected ---------------- */
  function progress(): string {
    const p = ctx.bf.store.progress();
    if (!p) return '';
    const pct = Math.round((p.done / Math.max(1, p.total)) * 100);
    return `<div class="ws2-progress" role="status"><span>${t('simple.start.reading', { done: p.done, total: p.total })}</span><i><b style="transform:scaleX(${pct / 100})"></b></i></div>`;
  }

  function renderStart(): void {
    const s = ctx.state.get();
    const busy = s.conn === 'connecting';
    const noSerial = !hasWebSerial();
    const app = !!window.workspacefpv;
    const bk = loadBackup();
    const driver = TOOL_LINKS.find((l) => l.id === 'cp210x');
    const step = (n: number, title: Key, desc: string) =>
      `<li><span class="ws2-n" aria-hidden="true">${n}</span><div><b>${t(title)}</b><p>${desc}</p></div></li>`;
    el.innerHTML = `<div class="w-page ws2 ws2-start">
      <div class="ws2-copy">
        <h1 class="w-h1">${t('simple.start.title')}</h1>
        <p class="w-lead">${t('simple.start.lead')}</p>
        <ol class="ws2-steps">
          ${step(1, 'simple.start.s1', t('simple.start.s1d'))}
          ${step(2, 'simple.start.s2', t('simple.start.s2d'))}
          ${step(3, 'simple.start.s3', app ? t('simple.start.s3dApp') : t('simple.start.s3d'))}
        </ol>
        <div class="ws2-actions">
          <button class="w-btn primary big" data-act="connect" ${busy || noSerial ? 'disabled' : ''}>${icon('plug', 18)}${busy ? t('simple.start.connecting') : t('simple.start.connect')}</button>
          <button class="w-btn quiet" data-act="demo" ${busy ? 'disabled' : ''}>${t('simple.start.demo')}</button>
        </div>
        ${busy ? progress() : ''}
        ${noSerial ? `<p class="w-note warn">${t('simple.start.noSerial')}</p>` : ''}
        ${s.error ? `<p class="w-note fail" role="alert">${escapeHtml(s.error)}</p>` : ''}
        ${!noSerial && driver ? `<p class="ws2-help">${t('simple.start.noPort')} <a href="${driver.url}" target="_blank" rel="noopener noreferrer">${t('simple.start.noPortHelp')}</a></p>` : ''}
        ${bk ? `<div class="ws2-backup"><div><b>${t('simple.start.backup')}</b><span>${escapeHtml(bk.craft || t('common.drone'))} · ${escapeHtml(fmtDate(new Date(bk.at)))}</span></div><button class="w-btn" data-act="backup">${icon('download', 16)}${t('simple.start.backupGet')}</button></div>` : ''}
      </div>
      <div class="ws2-art ws2-art-start">${droneArt({ label: t('simple.drone.aria') })}</div>
    </div>`;
  }

  /* ---------------- connected ---------------- */
  /** All tasks, failures first. */
  function issues(d: Diagnosis): Issue[] {
    const list = d.checks.map((c) => toIssue(c, d)).filter((x): x is Issue => !!x);
    return list.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'fail' ? -1 : 1));
  }
  /** With USB-only power, the tasks a missing battery explains go to `noBattery` (shown calm, not counted). */
  function grouped(d: Diagnosis): { real: Issue[]; noBattery: Issue[] } {
    const all = issues(d);
    if (!isUsbOnly(d.checks)) return { real: all, noBattery: [] };
    const waits = new Set(d.checks.filter(powerCaused).map((c) => c.id));
    return { real: all.filter((i) => !waits.has(i.id)), noBattery: all.filter((i) => waits.has(i.id)) };
  }

  function partStates(list: Issue[]): Partial<Record<DronePart, PartState>> {
    const out: Partial<Record<DronePart, PartState>> = {};
    for (const i of list) {
      if (!i.part) continue;
      if (out[i.part] !== 'fail') out[i.part] = i.sev;
    }
    return out;
  }

  function pillValue(part: DronePart, s: Readonly<FcState>): string {
    const bf = ctx.bf.get();
    const tel = s.telemetry;
    switch (part) {
      case 'fc':
        return boardDisplayName(s.info);
      case 'esc':
        return s.config ? protocolName(s.config.motorPwmProtocol).replace(/^DSHOT/, 'DShot') : '';
      case 'rx': {
        if (s.hw.elrs) return `ELRS ${s.hw.elrs.version}`;
        const prov = bf.rx && bf.rx.serialRxProvider > 0 ? (RX_PROVIDERS[bf.rx.serialRxProvider] ?? '') : '';
        return tel ? [prov, `${rssiPct(tel.rssi)}%`].filter(Boolean).join(' · ') : prov;
      }
      case 'battery': {
        if (!tel) return '';
        const cells = bf.batteryState?.cells || s.cells;
        return cells ? `${cells}S · ${fmtNum(tel.vbat, 1)} V` : t('simple.drone.usb');
      }
      case 'motors': {
        const m = tel?.motors.slice(0, 4).map(motorPct) ?? [];
        return m.some((v) => v > 0) ? m.map((v) => `${v}`).join(' · ') + ' %' : '';
      }
      default:
        return '';
    }
  }

  /** Leader lines (into the drawing's overlay, stopping at the part's ring) and the pills above the drawing. */
  function callouts(states: Partial<Record<DronePart, PartState>>): { lines: string; pills: string } {
    const s = ctx.state.get();
    const lines = PILLS.map((p) => {
      const a = ANCHORS[p.part];
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const k = a.r / Math.max(1, Math.hypot(dx, dy));
      return `<path class="d-line" d="M${p.x} ${p.y} L${(a.x + dx * k).toFixed(1)} ${(a.y + dy * k).toFixed(1)}" data-line="${p.part}"/>`;
    }).join('');
    const pills = PILLS.map((p) => {
      const st = states[p.part];
      const v = pillValue(p.part, s);
      return `<button class="ws2-pill${st ? ` ${st}` : ''}" data-pill="${p.part}" style="left:${((p.x / ART_W) * 100).toFixed(2)}%;top:${((p.y / ART_H) * 100).toFixed(2)}%">
        <i aria-hidden="true"></i><b>${t(`simple.drone.parts.${p.part}` as Key)}</b><span data-val="${p.part}">${escapeHtml(v)}</span></button>`;
    }).join('');
    return { lines, pills };
  }

  function issueHtml(i: Issue, k: number): string {
    const actions = [
      i.fix ? `<button class="w-btn primary" data-fix="${escapeHtml(i.fix.id)}">${icon('check', 16)}${t('simple.drone.fix')}</button>` : '',
      i.route ? `<button class="w-btn" data-go="${i.route}">${t(ROUTE_LABEL[i.route] ?? 'simple.drone.open')}${icon('arrowRight', 16)}</button>` : '',
      `<button class="w-btn quiet" data-ask="${escapeHtml(i.id)}">${t('simple.drone.ask')}</button>`,
    ].join('');
    return `<li class="ws2-issue ${i.sev}" data-issue="${escapeHtml(i.id)}" data-part="${i.part ?? ''}" style="--k:${k}">
      <span class="ws2-sev" aria-hidden="true">${icon(i.sev === 'fail' ? 'x' : 'alert', 16)}</span>
      <div class="ws2-issue-b">
        <h3>${escapeHtml(i.title)}</h3>
        ${i.desc ? `<p>${escapeHtml(i.desc)}</p>` : ''}
        ${i.fix?.caveat && i.id !== 'bidir' ? `<p class="ws2-caveat">${escapeHtml(i.fix.caveat)}</p>` : ''}
        <code class="ws2-tech">${escapeHtml(i.tech)}</code>
        <div class="ws2-issue-a">${actions}</div>
      </div>
    </li>`;
  }

  /** Calm group for what a missing battery explains: one sentence why, the items folded, no red. */
  function noBatteryHtml(list: Issue[]): string {
    return `<details class="ws2-nobat">
      <summary><span class="ws2-nobat-i" aria-hidden="true">${icon('battery', 18)}</span><span class="ws2-nobat-t"><b>${tn('simple.drone.noBatHead', list.length)}</b><span>${t('simple.drone.noBatLead')}</span></span></summary>
      <ul>${list.map((i) => `<li><b>${escapeHtml(i.title)}</b><code class="ws2-tech">${escapeHtml(i.tech)}</code></li>`).join('')}</ul>
    </details>`;
  }

  function renderScene(): void {
    const s = ctx.state.get();
    const d = ctx.diagnosis();
    const { real: list, noBattery } = grouped(d);
    const states = partStates(list);
    const oks = d.checks.filter((c) => c.severity === 'ok' || (c.severity === 'info' && c.id !== 'vbat'));
    const usbOnly = isUsbOnly(d.checks);
    const key = JSON.stringify([s.conn, list.map((i) => i.id + i.sev), noBattery.map((i) => i.id), oks.map((c) => c.label), usbOnly, s.info?.craftName, s.info?.boardName]);
    if (view === 'scene' && key === sceneKey) {
      updateLive();
      return;
    }
    const first = view !== 'scene';
    view = 'scene';
    sceneKey = key;
    stopSpin?.();
    const name = s.info?.craftName || boardDisplayName(s.info);
    const sub = [firmwareName(s.info), s.info?.craftName ? boardDisplayName(s.info) : ''].filter(Boolean).join(' · ');
    const nFix = list.length;
    const co = callouts(states);
    el.innerHTML = `<div class="w-page ws2 ws2-scene${first ? ' enter' : ''}">
      <header class="ws2-head">
        <h1 class="w-h1">${escapeHtml(name)}</h1>
        ${sub ? `<p class="ws2-sub">${escapeHtml(sub)}</p>` : ''}
      </header>
      <div class="ws2-grid">
        <div class="ws2-art-col">
          <div class="ws2-art ws2-art-scene">${droneArt({ label: t('simple.drone.aria'), states, overlay: co.lines })}${co.pills}</div>
          <p class="ws2-explain" data-explain aria-live="polite">${t('simple.explain.hint')}</p>
        </div>
        <section class="ws2-side" aria-live="polite">
          <div class="ws2-verdict ${nFix ? 'bad' : 'good'}">
            <span class="ws2-verdict-i" aria-hidden="true">${icon(nFix ? 'alert' : 'check', 22)}</span>
            <div><h2>${nFix ? tn('simple.drone.problems', nFix) : usbOnly ? t('simple.drone.usbOkTitle') : t('simple.drone.ready')}</h2><p>${nFix ? t('simple.drone.problemsLead') : usbOnly ? t('simple.drone.usbOkLead') : t('simple.drone.readyLead')}</p></div>
          </div>
          ${s.conn === 'reconnecting' ? `<p class="w-note warn" role="status">${t('simple.drone.reconnecting')}</p>` : ''}
          ${usbOnly && !noBattery.length ? `<p class="w-note">${icon('battery', 16)} ${t('simple.drone.usbOnly')}</p>` : ''}
          ${nFix ? `<ol class="ws2-issues">${list.map(issueHtml).join('')}</ol>` : ''}
          ${noBattery.length ? noBatteryHtml(noBattery) : ''}
          ${
            oks.length
              ? `<details class="ws2-oks"><summary>${t('simple.drone.okHead')} <span>${oks.length}</span></summary><ul>${oks
                  .map((c) => `<li>${icon('check', 15)}<span>${escapeHtml(c.label)}</span></li>`)
                  .join('')}</ul></details>`
              : ''
          }
          <div class="ws2-next">
            <h2 class="w-h2">${t('simple.drone.nextHead')}</h2>
            <div class="ws2-next-row">
              <button class="w-btn" data-go="radio">${icon('radio', 17)}${t('simple.drone.nextRadio')}</button>
              <button class="w-btn" data-go="esc">${icon('fan', 17)}${t('simple.drone.nextMotors')}</button>
            </div>
          </div>
        </section>
      </div>
    </div>`;
    const art = el.querySelector('.d-stage');
    if (art) stopSpin = spinProps(art, () => ctx.state.get().telemetry?.motors.slice(0, 4).map(motorPct) ?? null);
  }

  function updateLive(): void {
    const s = ctx.state.get();
    el.querySelectorAll<HTMLElement>('[data-val]').forEach((sp) => {
      const v = pillValue(sp.dataset.val as DronePart, s);
      if (sp.textContent !== v) sp.textContent = v;
    });
  }

  function render(): void {
    if (!connected()) {
      stopSpin?.();
      stopSpin = null;
      view = 'start';
      sceneKey = '';
      renderStart();
    } else renderScene();
  }

  /** "What does this part do": one sentence under the drawing for the hovered or clicked part. */
  function explainPart(part: string | null): void {
    const box = el.querySelector<HTMLElement>('[data-explain]');
    if (!box) return;
    if (!part) {
      box.innerHTML = t('simple.explain.hint');
      box.classList.remove('on');
      return;
    }
    box.innerHTML = `<b>${escapeHtml(t(`simple.drone.parts.${part}` as Key))}</b> ${escapeHtml(t(`simple.explain.parts.${part}` as Key))}`;
    box.classList.add('on');
  }

  function focusPart(part: string, on: boolean): void {
    el.querySelectorAll(`.d-ring[data-part="${part}"]`).forEach((g) => g.classList.toggle('focus', on));
    el.querySelector(`[data-line="${part}"]`)?.classList.toggle('on', on);
  }

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'connect') void ctx.connect();
    else if (act === 'demo') void ctx.connectDemo();
    else if (act === 'backup') ctx.downloadBackup();
    const go = target.closest<HTMLElement>('[data-go]')?.dataset.go;
    if (go) ctx.navigate(go);
    const fixId = target.closest<HTMLElement>('[data-fix]')?.dataset.fix;
    if (fixId) {
      const d = ctx.diagnosis();
      const sug = d.suggestions.find((x) => x.id === fixId);
      const issue = issues(d).find((i) => i.fix?.id === fixId);
      if (sug) void ctx.applyCommands(sug.commands, { title: issue?.title ?? sug.title, note: sug.caveat ? escapeHtml(sug.caveat) : undefined });
    }
    const askId = target.closest<HTMLElement>('[data-ask]')?.dataset.ask;
    if (askId) {
      const i = issues(ctx.diagnosis()).find((x) => x.id === askId);
      // a plain question; the drone's data and rule results already go to the assistant as context
      if (i) ctx.askAi(t('simple.drone.askQ', { title: i.title }));
    }
    const pill = target.closest<HTMLElement>('[data-pill]')?.dataset.pill;
    if (pill) explainPart(pill);
    if (pill) {
      const card = el.querySelector<HTMLElement>(`.ws2-issue[data-part="${pill}"]`);
      if (card) {
        card.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        card.classList.remove('ping');
        void card.offsetWidth;
        card.classList.add('ping');
      }
    }
  });
  // hovering a task or a pill lights up the part on the drawing
  el.addEventListener('pointerover', (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>('[data-issue], [data-pill]');
    const part = h?.dataset.part || h?.dataset.pill;
    if (part) focusPart(part, true);
    if (h?.dataset.pill) explainPart(h.dataset.pill);
  });
  el.addEventListener('pointerout', (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>('[data-issue], [data-pill]');
    const part = h?.dataset.part || h?.dataset.pill;
    if (part) focusPart(part, false);
  });

  const offState = ctx.state.subscribe(render);
  const offBf = ctx.bf.subscribe(() => {
    if (view === 'start') {
      const box = el.querySelector('.ws2-progress');
      if (box) box.outerHTML = progress();
      else if (ctx.state.get().conn === 'connecting') renderStart();
    } else render();
  });
  const offTel = ctx.state.subscribeTelemetry(() => {
    if (view === 'scene') updateLive();
  });
  render();

  return () => {
    offState();
    offBf();
    offTel();
    stopSpin?.();
  };
};
