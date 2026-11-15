import type { AppContext, ScreenMount } from '../context';
import { PART_LABEL, type Diagnosis, type Part } from '../fc/diagnose';
import { boardDisplayName, firmwareName } from '../fc/board';
import { isDshot, motorPct, protocolName, rssiPct, type FcState } from '../fc/state';
import { hasWebSerial } from '../serial/port';
import { plDate, escapeHtml } from '../ui/dom';
import { ENTRY_Y, VIEW_H, VIEW_W, renderDrone, updateMotorBars, type XrayLabels } from '../ui/drone-xray';
import { icon, logo } from '../ui/icons';

function buildLabels(s: Readonly<FcState>, d: Diagnosis): XrayLabels {
  const t = s.telemetry;
  const craft = (s.info?.craftName ?? 'DRON').toUpperCase();
  const elrs = s.meta.elrsVersion;
  const rxProblem = d.checks.find((c) => c.part === 'rx' && (c.severity === 'fail' || c.severity === 'warn'));
  const focusCheck = d.focus ? d.checks.find((c) => c.part === d.focus && (c.severity === 'fail' || c.severity === 'warn')) : undefined;
  let hotText: string | undefined;
  if (d.focus && d.focus !== 'motors') {
    const friendly = (n: string) => n.replace(/^DSHOT/, 'DShot');
    const extra = d.focus === 'esc' && s.config ? friendly(protocolName(s.config.motorPwmProtocol)) : '';
    const bidirOff = d.focus === 'esc' && s.config && isDshot(s.config.motorPwmProtocol) && !s.config.bidir ? 'bidir OFF' : '';
    hotText = [PART_LABEL[d.focus], extra, bidirOff, d.focus !== 'esc' ? focusCheck?.label : ''].filter(Boolean).join(' · ');
  }
  return {
    filmTop: `ROTORLAB · ${craft} · ${plDate()}`,
    filmBottom: 'kV 60 · mAs 2',
    fcTitle: boardDisplayName(s.info),
    fcSub: firmwareName(s.info),
    rxTitle: elrs ? `ELRS ${elrs}` : t ? `Sygnał ${rssiPct(t.rssi)}%` : 'Brak danych',
    rxSub: rxProblem?.label,
    batteryText: t ? (s.cells ? `${s.cells}S ${t.vbat.toFixed(1)} V` : `${t.vbat.toFixed(1)} V (USB)`) : '—',
    motors: t ? t.motors.slice(0, 4).map(motorPct) : null,
    hotText,
  };
}

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  const ro = new ResizeObserver(() => positionTab());
  let stage: HTMLElement | null = null;
  let renderedKey = '';
  let view: 'start' | 'scene' | '' = '';

  function positionTab() {
    if (!stage) return;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    const scale = Math.min(w / VIEW_W, h / VIEW_H);
    const y = (h - VIEW_H * scale) / 2 + ENTRY_Y * scale - 14;
    document.documentElement.style.setProperty('--tab-y', `${y.toFixed(1)}px`);
  }

  /* ---------- ekran startowy ---------- */
  function renderStart(): void {
    const s = ctx.state.get();
    const busy = s.conn === 'connecting';
    const noSerial = !hasWebSerial();
    el.innerHTML = `
      <div class="start">
        <div class="start-art" aria-hidden="true">${renderDrone({ highlight: null, bare: true, labels: emptyLabels() })}</div>
        <div class="start-card">
          <div class="start-brand">${logo(28)}<span>Rotorlab</span></div>
          <h1>Diagnoza i naprawa drona FPV</h1>
          <p>Podłącz płytkę FC kablem USB. Rotorlab odczyta konfigurację Betaflight, sprawdzi ją regułami i pomoże naprawić problem z asystentem AI.</p>
          <div class="start-btns">
            <button class="btn light" data-act="connect" ${busy || noSerial ? 'disabled' : ''}>${icon('plug', 16)}${busy ? 'Łączenie…' : 'Połącz z FC'}</button>
            <button class="btn ghost" data-act="demo" ${busy ? 'disabled' : ''}>${icon('play', 16)}Tryb demo</button>
          </div>
          ${noSerial ? `<div class="start-msg warn">Ta przeglądarka nie obsługuje WebSerial. Użyj Chrome/Edge albo aplikacji na Windows.</div>` : ''}
          ${s.error ? `<div class="start-msg err" role="alert">${escapeHtml(s.error)}</div>` : ''}
          <div class="start-foot mono">Bez drona? Tryb demo pokazuje symulowanego quada 5" z problemem w ESC.</div>
        </div>
      </div>`;
    stage = null;
    document.body.classList.remove('has-hot');
  }

  function emptyLabels(): XrayLabels {
    return { filmTop: '', filmBottom: '', fcTitle: '', fcSub: '', rxTitle: '', batteryText: '', motors: null };
  }

  /* ---------- scena ---------- */
  function renderScene(): void {
    const s = ctx.state.get();
    const d = ctx.diagnosis();
    const labels = buildLabels(s, d);
    const key = JSON.stringify([d.focus, { ...labels, motors: null }, s.conn]);
    if (view !== 'scene' || !stage) {
      el.innerHTML = `<div class="stage"></div><div class="overlay" hidden></div>`;
      stage = el.querySelector('.stage');
      if (stage) ro.observe(stage);
      renderedKey = '';
      view = 'scene';
    }
    if (!stage) return;
    if (key !== renderedKey) {
      stage.innerHTML = renderDrone({ highlight: d.focus, labels });
      renderedKey = key;
    }
    updateMotorBars(stage, labels.motors);
    document.body.classList.toggle('has-hot', d.focus !== null);
    const overlay = el.querySelector<HTMLElement>('.overlay');
    if (overlay) {
      overlay.hidden = s.conn !== 'reconnecting';
      overlay.innerHTML = s.conn === 'reconnecting' ? `<div class="mono">FC się restartuje. Łączę ponownie…</div>` : '';
    }
    positionTab();
  }

  function render(): void {
    const s = ctx.state.get();
    const wantScene = s.conn === 'connected' || s.conn === 'reconnecting';
    if (!wantScene) {
      view = 'start';
      renderedKey = '';
      renderStart();
    } else {
      if (view === 'start') view = '';
      renderScene();
    }
  }

  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'connect') void ctx.connect();
    else if (act === 'demo') void ctx.connectDemo();
  });

  const offState = ctx.state.subscribe(render);
  const offTel = ctx.state.subscribeTelemetry(() => {
    if (view !== 'scene' || !stage) return;
    const t = ctx.state.get().telemetry;
    updateMotorBars(stage, t ? t.motors.slice(0, 4).map(motorPct) : null);
  });
  render();

  return () => {
    offState();
    offTel();
    ro.disconnect();
    document.body.classList.remove('has-hot');
  };
};
