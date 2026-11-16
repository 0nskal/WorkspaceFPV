import type { AppContext, ScreenMount } from '../context';
import { partLabel } from '../fc/diagnose';
import { fmtDate, t } from '../i18n';
import { isDshot, motorPct, protocolName } from '../fc/state';
import { hasWebSerial } from '../serial/port';
import { MSP } from '../serial/msp';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { mountMotorConfig, type MotorCfgHandle } from './bf-motors-cfg';
import { mountMotorTelemetry, type MotorTelHandle } from './bf-motors-tel';

const SAFE_MAX = 30;
const TICK_MS = 100;

/* ---------- rysunek drona z gory (styl Rentgen) ---------- */
const VB_W = 600;
const VB_H = 620;
const CX = 300;
const CY = 320;
const INK = '#DCEFF8';
const HOT = '#FF4A2E';
const MOTORS = [
  { n: 1, x: CX + 175, y: CY + 165, out: 45 }, // M1 tyl-prawy
  { n: 2, x: CX + 175, y: CY - 165, out: -45 }, // M2 przod-prawy
  { n: 3, x: CX - 175, y: CY + 165, out: 135 }, // M3 tyl-lewy
  { n: 4, x: CX - 175, y: CY - 165, out: -135 }, // M4 przod-lewy
];
const f = (n: number) => +n.toFixed(2);

/** Kierunek obrotu: true = CW (patrzac z gory). Props in = domyslne ustawienie Betaflight. */
function spinsCw(motor: number, propsOut: boolean): boolean {
  const cwIn = motor === 2 || motor === 3;
  return propsOut ? !cwIn : cwIn;
}

function spinArrow(m: (typeof MOTORS)[number], cw: boolean): string {
  const r = 72;
  const a0 = ((m.out - 55) * Math.PI) / 180;
  const a1 = ((m.out + 55) * Math.PI) / 180;
  const p = (a: number): [number, number] => [m.x + r * Math.cos(a), m.y + r * Math.sin(a)];
  const [sx, sy] = p(cw ? a0 : a1);
  const [ex, ey] = p(cw ? a1 : a0);
  const sweep = cw ? 1 : 0;
  const end = cw ? a1 : a0;
  const dir = cw ? 1 : -1;
  const tx = -Math.sin(end) * dir;
  const ty = Math.cos(end) * dir;
  const rx = Math.cos(end);
  const ry = Math.sin(end);
  const tip = [ex + tx * 9, ey + ty * 9];
  const b1 = [ex + rx * 5.5, ey + ry * 5.5];
  const b2 = [ex - rx * 5.5, ey - ry * 5.5];
  const lbl = p(cw ? a0 - 0.2 : a1 + 0.2);
  return (
    `<path d="M${f(sx)} ${f(sy)} A${r} ${r} 0 0 ${sweep} ${f(ex)} ${f(ey)}" fill="none" stroke="${INK}" stroke-width="1.4" opacity=".85"/>` +
    `<polygon points="${f(tip[0])},${f(tip[1])} ${f(b1[0])},${f(b1[1])} ${f(b2[0])},${f(b2[1])}" fill="${INK}"/>` +
    `<text x="${f(lbl[0])}" y="${f(lbl[1] + 4)}" text-anchor="middle" class="esc-dirlbl">${cw ? 'CW' : 'CCW'}</text>`
  );
}

function renderDroneSvg(opts: { hot: boolean; propsOut: boolean; hotText: string; film: string }): string {
  const { hot, propsOut } = opts;
  const arms = MOTORS.map((m) => {
    const ang = (Math.atan2(m.y - CY, m.x - CX) * 180) / Math.PI;
    const len = Math.hypot(m.x - CX, m.y - CY);
    return `<g transform="translate(${CX} ${CY}) rotate(${f(ang)})"><rect x="40" y="-9" width="${f(len - 40)}" height="18" fill="rgba(207,230,242,.12)" stroke="${INK}" stroke-width=".9"/><rect x="40" y="-9" width="${f(len - 40)}" height="18" fill="url(#esc-cf)"/><rect x="${f(len - 62)}" y="-3" width="26" height="6" rx="3" fill="rgba(7,11,16,.6)" stroke="${INK}" stroke-width=".6" opacity=".7"/><circle cx="${f(len - 22)}" cy="0" r="5" fill="rgba(7,11,16,.6)" stroke="${INK}" stroke-width=".7"/></g>`;
  }).join('');
  const props = MOTORS.map((m) => {
    const cw = spinsCw(m.n, propsOut);
    return (
      `<g data-m="${m.n - 1}">` +
      `<circle class="esc-disc" cx="${m.x}" cy="${m.y}" r="105" fill="rgba(207,230,242,.07)" stroke="${INK}" stroke-width=".9" stroke-dasharray="4 5" opacity="1"/>` +
      `<g transform="translate(${m.x} ${m.y}) rotate(${m.n * 37}) scale(1 ${cw ? 1 : -1})" opacity=".6">${[0, 120, 240].map((a) => `<use href="#esc-blade" transform="rotate(${a})"/>`).join('')}</g>` +
      spinArrow(m, cw) +
      `<circle class="esc-hub" cx="${m.x}" cy="${m.y}" r="26" fill="#0B1016" stroke="${INK}" stroke-width="1.2"/>` +
      `<g transform="translate(${m.x} ${m.y})"><use href="#esc-motor"/></g>` +
      `<text x="${m.x}" y="${m.y + 5}" text-anchor="middle" class="esc-mid">M${m.n}</text>` +
      `<text x="${m.x}" y="${m.y + 48}" text-anchor="middle" class="esc-pct" data-pct="${m.n - 1}">--</text>` +
      `<text x="${m.x}" y="${m.y + 66}" text-anchor="middle" class="esc-pct esc-rpm" data-rpm="${m.n - 1}"></text>` +
      `</g>`
    );
  }).join('');
  const bodyPts = '248,250 352,250 366,266 366,374 352,390 248,390 234,374 234,266';
  const body = `<polygon points="${bodyPts}" fill="rgba(207,230,242,.1)" stroke="${INK}" stroke-width="1" filter="url(#esc-glow)"/><polygon points="${bodyPts}" fill="url(#esc-cf)"/>` +
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sy]) => `<circle cx="${CX + sx * 54}" cy="${CY + sy * 58}" r="6.5" fill="rgba(207,230,242,.3)" stroke="${INK}" stroke-width=".7"/><circle cx="${CX + sx * 54}" cy="${CY + sy * 58}" r="3" fill="#0B1016" stroke="${INK}" stroke-width=".6"/>`).join('');
  const ink = hot ? HOT : INK;
  const mos = (x: number, y: number, left: boolean) =>
    `<g transform="translate(${x} ${y})"><rect width="12" height="9" fill="${hot ? 'rgba(255,74,46,.55)' : 'rgba(207,230,242,.22)'}" stroke="${ink}" stroke-width=".8"/><rect x="${left ? 12 : -4}" y="1" width="4" height="1.8" fill="${ink}" opacity=".7"/><rect x="${left ? 12 : -4}" y="3.6" width="4" height="1.8" fill="${ink}" opacity=".7"/><rect x="${left ? 12 : -4}" y="6.2" width="4" height="1.8" fill="${ink}" opacity=".7"/><rect x="${left ? 2 : 3}" y="1.6" width="7" height="2.6" fill="${hot ? 'rgba(255,120,90,.6)' : 'rgba(207,230,242,.4)'}"/></g>`;
  let mosAll = '';
  for (let i = 0; i < 4; i++) mosAll += mos(268, 291 + i * 15, true) + mos(320, 291 + i * 15, false);
  const board =
    `<rect x="262" y="284" width="76" height="72" fill="${hot ? 'rgba(255,74,46,.34)' : 'rgba(207,230,242,.2)'}" stroke="${ink}" stroke-width="1.3"${hot ? ' filter="url(#esc-hotglow)"' : ''}/>` +
    (hot ? `<circle cx="300" cy="320" r="52" fill="url(#esc-focus)"/>` : '') +
    mosAll +
    `<circle cx="300" cy="320" r="11" fill="#0B1016" stroke="${ink}" stroke-width="1.2"/><circle cx="300" cy="320" r="7" fill="none" stroke="${ink}" stroke-width=".6" opacity=".7"/><path d="M293 320H307" stroke="${ink}" stroke-width=".6" opacity=".7"/>`;
  const pads = [-1, 1]
    .map((sy) => [0, 1, 2].map((i) => `<rect x="${278 + i * 16}" y="${sy < 0 ? 280 : 358}" width="9" height="8" fill="${hot ? 'rgba(255,74,46,.45)' : 'rgba(207,230,242,.4)'}" stroke="${ink}" stroke-width=".7"/>`).join(''))
    .join('') +
    `<rect x="288" y="340" width="24" height="9" fill="rgba(207,230,242,.12)" stroke="${ink}" stroke-width=".7"/>` +
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${290 + i * 3}" y="342" width="1.8" height="5" fill="${ink}" opacity=".8"/>`).join('');
  const leader = hot
    ? `<line x1="266" y1="320" x2="22" y2="320" stroke="${HOT}" stroke-width="1"/><circle cx="266" cy="320" r="3" fill="${HOT}"/>` +
      `<rect x="22" y="283" width="7" height="7" fill="${HOT}"/><text x="36" y="290" class="esc-hotlbl">ESC</text>` +
      `<text x="22" y="312" class="esc-hottxt">${escapeHtml(opts.hotText)}</text>`
    : `<text x="300" y="418" text-anchor="middle" class="esc-sub">${escapeHtml(t('esc.boardLabel'))}</text>`;
  return `<svg class="esc-svg" viewBox="0 0 ${VB_W} ${VB_H}" role="img" aria-label="${escapeHtml(t('esc.droneAria'))}">
    <defs>
      <filter id="esc-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="esc-hotglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <pattern id="esc-cf" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0h3v3H0zM3 3h3v3H3z" fill="rgba(207,230,242,.11)"/></pattern>
      <path id="esc-blade" d="M17 -4C36 -20 66 -24 92 -11C101 -6 100 2 89 6C64 13 38 11 17 5Z" fill="rgba(207,230,242,.13)" stroke="${INK}" stroke-width=".8"/>
      <g id="esc-motor" fill="none" stroke="${INK}">${Array.from({ length: 12 }, (_, k) => `<rect x="17" y="-2.2" width="6.5" height="4.4" transform="rotate(${k * 30})" fill="rgba(255,160,100,.2)" stroke-width=".5" opacity=".8"/>`).join('')}<circle r="14.5" stroke-width=".5" stroke-dasharray="1.6 1.9" opacity=".7"/>${Array.from({ length: 6 }, (_, k) => `<path d="M24.6 0A24.6 24.6 0 0 1 22 7" transform="rotate(${k * 60 + 12})" stroke-width="1.3" opacity=".55"/>`).join('')}</g>
      <radialGradient id="esc-focus"><stop offset="0" stop-color="${HOT}" stop-opacity=".45"/><stop offset="1" stop-color="${HOT}" stop-opacity="0"/></radialGradient>
    </defs>
    <g class="esc-film">
      <line x1="${CX}" y1="62" x2="${CX}" y2="${VB_H - 14}" stroke="${INK}" stroke-width=".6" stroke-dasharray="3 7" opacity=".28"/>
      <line x1="12" y1="${CY}" x2="${VB_W - 12}" y2="${CY}" stroke="${INK}" stroke-width=".6" stroke-dasharray="3 7" opacity=".2"/>
      <path d="M${CX} 44V12M${CX - 6} 22l6-8 6 8" fill="none" stroke="${INK}" stroke-width="1" opacity=".8"/>
      <text x="${CX + 14}" y="24" class="esc-film-t">${escapeHtml(t('esc.film'))}</text>
      <text x="14" y="16" class="esc-film-t">L</text>
      <text x="14" y="${VB_H - 8}" class="esc-film-t">${escapeHtml(opts.film)}</text>
      <text x="${VB_W - 14}" y="${VB_H - 8}" text-anchor="end" class="esc-film-t">kV 60 · mAs 2</text>
    </g>
    ${arms}${body}${board}${pads}${props}${leader}
  </svg>`;
}

/* ---------- ekran ---------- */
export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  let view: 'empty' | 'main' | '' = '';
  let propsOut = false;
  let droneKey = '';
  let cfgHandle: MotorCfgHandle | null = null;
  let telHandle: MotorTelHandle | null = null;
  // test silnikow
  let propsOff = false; // zawsze odznaczone przy wejsciu
  let unlock = false;
  const vals = [0, 0, 0, 0];
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight = false;

  const q = <T extends Element = HTMLElement>(sel: string): T | null => el.querySelector<T>(sel);
  const maxPct = () => (unlock ? 100 : SAFE_MAX);
  const anyActive = () => vals.some((v) => v > 0);

  /* ----- test: wysylanie ----- */
  function payload(): Uint8Array {
    const b = new Uint8Array(16);
    const dv = new DataView(b.buffer);
    for (let i = 0; i < 8; i++) dv.setUint16(i * 2, i < 4 ? 1000 + vals[i] * 10 : 1000, true);
    return b;
  }

  function sendNow(): void {
    const link = ctx.link();
    if (!link || link.busy) return;
    if (ctx.state.get().mode === 'demo') return; // demo: symulacja po stronie UI
    if (inflight) return;
    inflight = true;
    link
      .request(MSP.SET_MOTOR, payload(), 400)
      .catch(() => undefined)
      .finally(() => {
        inflight = false;
      });
  }

  function startLoop(): void {
    if (timer) return;
    sendNow();
    timer = setInterval(() => {
      if (!propsOff || !anyActive()) {
        stopTest();
        return;
      }
      sendNow();
    }, TICK_MS);
  }

  function sendZeros(): void {
    const link = ctx.link();
    if (!link || link.busy || ctx.state.get().mode === 'demo') return;
    const zeros = new Uint8Array(16);
    const dv = new DataView(zeros.buffer);
    for (let i = 0; i < 8; i++) dv.setUint16(i * 2, 1000, true);
    for (let i = 0; i < 2; i++) link.request(MSP.SET_MOTOR, zeros, 400).catch(() => undefined);
  }

  function stopTest(): void {
    const was = anyActive() || timer !== null;
    if (timer) clearInterval(timer);
    timer = null;
    vals.fill(0);
    if (was) sendZeros();
    paintTest();
    paintMotors();
  }

  /* ----- malowanie ----- */
  function currentPct(): Array<number | null> {
    const s = ctx.state.get();
    if (s.mode === 'demo' && anyActive()) return vals.slice();
    const t = s.telemetry;
    return t ? t.motors.slice(0, 4).map(motorPct) : [null, null, null, null];
  }

  function paintMotors(): void {
    const pcts = currentPct();
    for (let i = 0; i < 4; i++) {
      const txt = q<SVGTextElement>(`[data-pct="${i}"]`);
      const g = q<SVGGElement>(`g[data-m="${i}"]`);
      const p = pcts[i];
      if (txt) txt.textContent = p === null ? '--' : `${p}%`;
      const rpmTxt = q<SVGTextElement>(`[data-rpm="${i}"]`);
      const tel = telHandle?.latest()[i];
      if (rpmTxt) rpmTxt.textContent = tel && tel.rpm > 0 ? `${tel.rpm} rpm` : '';
      if (g) {
        const disc = g.querySelector<SVGElement>('.esc-disc');
        const hub = g.querySelector<SVGElement>('.esc-hub');
        const on = (p ?? 0) > 0;
        const test = vals[i] > 0;
        disc?.setAttribute('fill', `rgba(${test ? '255,110,80' : '207,230,242'},${(0.06 + ((p ?? 0) / 100) * (test ? 0.3 : 0.12)).toFixed(3)})`);
        hub?.setAttribute('stroke', vals[i] > 0 ? HOT : INK);
        txt?.classList.toggle('on', test && on);
      }
    }
  }

  function paintTest(): void {
    const status = q('.esc-test-state');
    if (status) {
      status.textContent = !propsOff ? t('esc.stateLocked') : anyActive() ? t('esc.stateLive') : t('esc.stateReady');
      status.classList.toggle('live', propsOff && anyActive());
    }
    const warn = q('.esc-warn');
    if (warn) {
      warn.innerHTML = `${icon('alert', 18)}<span>${propsOff ? t('esc.warnOn') : t('esc.warnOff')}</span>`;
    }
    const max = maxPct();
    el.querySelectorAll<HTMLInputElement>('input.esc-range').forEach((r) => {
      const idx = r.dataset.m;
      r.disabled = !propsOff;
      r.max = String(max);
      const v = idx === 'all' ? Math.max(...vals) : vals[Number(idx)];
      r.value = String(v);
      const out = r.parentElement?.querySelector('.esc-val');
      if (out) out.textContent = `${v}%`;
      r.parentElement?.classList.toggle('dis', !propsOff);
      r.parentElement?.classList.toggle('live', v > 0);
    });
    const un = q<HTMLInputElement>('#esc-unlock');
    if (un) un.disabled = !propsOff;
    const stop = q<HTMLButtonElement>('.esc-stop');
    if (stop) stop.classList.toggle('armed', propsOff && anyActive());
  }

  function paintDrone(): void {
    const s = ctx.state.get();
    const d = ctx.diagnosis();
    const hot = d.focus === 'esc';
    let hotText = '';
    if (hot && s.config) {
      const bidirOff = isDshot(s.config.motorPwmProtocol) && !s.config.bidir ? ` · ${t('xray.bidirOff')}` : '';
      hotText = `${partLabel('esc')} · ${protocolName(s.config.motorPwmProtocol).replace(/^DSHOT/, 'DShot')}${bidirOff}`;
    }
    const film = `ROTORLAB · ${(s.info?.craftName || t('common.drone')).toUpperCase()} · ${fmtDate()}`;
    const key = JSON.stringify([hot, hotText, propsOut, film]);
    if (key === droneKey) return;
    droneKey = key;
    const box = q('.esc-art');
    if (box) box.innerHTML = renderDroneSvg({ hot, propsOut, hotText, film });
    paintMotors();
  }

  function paintOverlay(): void {
    const ov = q('.esc-overlay');
    if (ov) ov.hidden = ctx.state.get().conn !== 'reconnecting';
  }

  function paintPropsToggle(): void {
    el.querySelectorAll<HTMLButtonElement>('[data-props]').forEach((b) => {
      const on = (b.dataset.props === 'out') === propsOut;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /* ----- widoki ----- */
  function buildEmpty(): void {
    const s = ctx.state.get();
    const busy = s.conn === 'connecting';
    const noSerial = !hasWebSerial();
    el.innerHTML = `
      <div class="esc-empty">
        <div class="esc-empty-card">
          <div class="esc-empty-t mono">${t('esc.emptyTag')}</div>
          <h1>${t('esc.emptyTitle')}</h1>
          <p>${t('esc.emptyLead')}</p>
          <div class="start-btns">
            <button class="btn light" data-act="connect" ${busy || noSerial ? 'disabled' : ''}>${icon('plug', 16)}${busy ? t('common.connecting') : t('common.connect')}</button>
            <button class="btn ghost" data-act="demo" ${busy ? 'disabled' : ''}>${icon('play', 16)}${t('common.demo')}</button>
          </div>
          ${noSerial ? `<div class="start-msg warn">${t('conn.noWebSerial')}</div>` : ''}
          ${s.error ? `<div class="start-msg err" role="alert">${escapeHtml(s.error)}</div>` : ''}
        </div>
      </div>`;
    view = 'empty';
    droneKey = '';
    destroyBf();
  }

  function buildMain(): void {
    propsOff = false;
    unlock = false;
    vals.fill(0);
    droneKey = '';
    destroyBf();
    propsOut = false; // set from MSP_MIXER_CONFIG by the motor configuration panel
    const rows = [0, 1, 2, 3]
      .map(
        (i) =>
          `<label class="esc-slider dis"><span class="esc-sl-n mono">M${i + 1}</span><input class="esc-range" type="range" min="0" max="${SAFE_MAX}" step="1" value="0" data-m="${i}" disabled aria-label="${t('esc.motorPower', { n: i + 1 })}"><span class="esc-val mono">0%</span></label>`,
      )
      .join('');
    el.innerHTML = `
      <div class="esc">
        <div class="esc-left">
          <div class="esc-art"></div>
          <div class="bf-motors-tel"></div>
          <div class="esc-info">
            <div><small class="mono">${t('esc.infoView')}</small><b>${t('esc.infoViewVal')}</b></div>
            <div><small class="mono">${t('esc.infoProps')}</small>
              <span class="esc-tog"><button type="button" data-props="in" aria-pressed="true">props in</button><button type="button" data-props="out" aria-pressed="false">props out</button></span></div>
            <div><small class="mono">${t('esc.infoNumbering')}</small><b>${t('esc.infoNumberingVal')}</b></div>
          </div>
        </div>
        <div class="esc-side">
          <section class="esc-panel bf-motors-cfg"></section>
          <section class="esc-panel">
            <header><span class="mono">${t('esc.testHead')}</span><span class="mono esc-test-state">${t('esc.stateLocked')}</span></header>
            <label class="esc-check"><input type="checkbox" id="esc-propsoff"><span>${t('esc.propsOff')}</span></label>
            <div class="esc-warn" role="alert"></div>
            ${rows}
            <label class="esc-slider all dis"><span class="esc-sl-n">${t('esc.all')}</span><input class="esc-range" type="range" min="0" max="${SAFE_MAX}" step="1" value="0" data-m="all" disabled aria-label="${t('esc.allPower')}"><span class="esc-val mono">0%</span></label>
            <label class="esc-check small"><input type="checkbox" id="esc-unlock" disabled><span>${t('esc.unlock', { max: SAFE_MAX })}</span></label>
            <button type="button" class="esc-stop">${icon('stop', 20)}<span>${t('esc.stop')}</span><kbd class="mono">${t('esc.space')}</kbd></button>
          </section>
        </div>
        <div class="esc-overlay" hidden><div class="mono">${t('esc.restarting')}</div></div>
      </div>`;
    view = 'main';
    paintTest();
    // MSP-based motor configuration (protocol, bidir, idle, poles, direction) and live ESC telemetry
    const cfgHost = q('.bf-motors-cfg');
    const telHost = q('.bf-motors-tel');
    if (cfgHost)
      cfgHandle = mountMotorConfig(cfgHost, ctx, {
        onReversed: (v) => {
          propsOut = v;
          paintPropsToggle();
          paintDrone();
        },
        stopTest,
      });
    if (telHost) telHandle = mountMotorTelemetry(telHost, ctx, () => paintMotors());
  }

  function destroyBf(): void {
    cfgHandle?.destroy();
    telHandle?.destroy();
    cfgHandle = null;
    telHandle = null;
  }

  function sync(): void {
    paintDrone();
    paintPropsToggle();
    paintOverlay();
    paintMotors();
  }

  function render(): void {
    const s = ctx.state.get();
    if (s.conn !== 'connected' && s.conn !== 'reconnecting') {
      stopTest();
      if (view !== 'empty' || s.conn === 'connecting' || s.error) buildEmpty();
      return;
    }
    if (s.conn === 'reconnecting') stopTest();
    if (view !== 'main') buildMain();
    sync();
  }

  /* ----- zdarzenia ----- */
  function setAll(v: number): void {
    vals.fill(v);
  }

  el.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    const act = tg.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'connect') return void ctx.connect();
    if (act === 'demo') return void ctx.connectDemo();
    const pv = tg.closest<HTMLElement>('[data-props]');
    if (pv) {
      propsOut = pv.dataset.props === 'out';
      cfgHandle?.setReversed(propsOut); // the real setting (yaw_motors_reversed) is a pending edit saved from the config panel
      paintPropsToggle();
      paintDrone();
      return;
    }
    if (tg.closest('.esc-stop')) return stopTest();
  });

  el.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'esc-propsoff') {
      propsOff = t.checked;
      if (!propsOff) {
        stopTest();
        unlock = false;
        const un = q<HTMLInputElement>('#esc-unlock');
        if (un) un.checked = false;
      }
      paintTest();
    } else if (t.id === 'esc-unlock') {
      unlock = t.checked;
      if (!unlock) {
        for (let i = 0; i < 4; i++) vals[i] = Math.min(vals[i], SAFE_MAX);
      }
      paintTest();
    }
  });

  el.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.classList.contains('esc-range') || !propsOff) return;
    const v = Math.max(0, Math.min(maxPct(), Math.round(Number(t.value))));
    if (t.dataset.m === 'all') setAll(v);
    else vals[Number(t.dataset.m)] = v;
    paintTest();
    paintMotors();
    if (anyActive()) startLoop();
    else stopTest();
  });

  const onKey = (e: KeyboardEvent) => {
    if ((e.code === 'Space' || e.key === ' ') && (anyActive() || timer)) {
      e.preventDefault();
      stopTest();
    }
  };
  const onBlur = () => stopTest();
  const onVis = () => {
    if (document.hidden) stopTest();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);

  const off = ctx.state.subscribe(render);
  const offT = ctx.state.subscribeTelemetry(() => {
    if (view === 'main') paintMotors();
  });
  render();

  return () => {
    stopTest();
    destroyBf();
    off();
    offT();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVis);
  };
};
