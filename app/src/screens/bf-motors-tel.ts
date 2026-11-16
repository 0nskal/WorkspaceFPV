/**
 * ESC tab, live motor telemetry strip: RPM per motor (bidirectional DShot or ESC sensor), temperature,
 * voltage, current and lost-frame percentage when the ESCs report them. Read-only polling of
 * MSP_MOTOR_TELEMETRY (API >= 1.42), falling back to the legacy MSP_ESC_SENSOR_DATA.
 */
import type { AppContext } from '../context';
import { t, fmtNum } from '../i18n';
import { MSPM, decodeEscSensor, decodeMotorTelemetry, telemetryActive, type MotorTel } from '../bf/motors';
import { makeIo } from '../bf/io-motors';

export interface MotorTelHandle {
  destroy(): void;
  latest(): MotorTel[];
}

const POLL_MS = 400;

export function mountMotorTelemetry(host: HTMLElement, ctx: AppContext, onData: (m: MotorTel[]) => void): MotorTelHandle {
  const io = makeIo(ctx);
  let latest: MotorTel[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let legacy = false;
  let seenAny = false;

  function paint(): void {
    const s = ctx.state.get();
    const connected = s.conn === 'connected';
    const cfg = s.config;
    const active = telemetryActive(latest);
    const cards = [0, 1, 2, 3]
      .map((i) => {
        const m = latest[i];
        const v = (x: number | null, d = 0, unit = '') => (x === null ? '—' : `${fmtNum(x, d)}${unit}`);
        const rpm = m && active ? fmtNum(m.rpm) : '—';
        const hot = m && active && m.tempC >= 60;
        const lost = m && active && m.invalidPct >= 2;
        return `<div class="bf-motors-card${m && active ? '' : ' off'}">
          <div class="bf-motors-card-h mono"><b>M${i + 1}</b><span class="${lost ? 'hot' : ''}" title="${t('bfMotors.lostTip')}">${m && active ? (legacy ? '' : `${t('bfMotors.lost')} ${fmtNum(m.invalidPct, 1)}%`) : ''}</span></div>
          <div class="bf-motors-rpm mono">${rpm}<small>${t('bfMotors.rpm')}</small></div>
          <div class="bf-motors-card-f mono"><span class="${hot ? 'hot' : ''}">${m && active ? v(m.tempC, 0, ' °C') : '—'}</span><span>${m && active && !legacy ? v(m.voltage, 1, ' V') : '—'}</span><span>${m && active && !legacy ? v(m.current, 1, ' A') : '—'}</span></div>
        </div>`;
      })
      .join('');
    let hint = '';
    if (!connected) hint = t('bfMotors.telNeedFc');
    else if (seenAny && !active) hint = cfg && !cfg.bidir && !cfg.useEscSensor ? t('bfMotors.telOffHint') : t('bfMotors.telZeroHint');
    host.innerHTML = `<div class="bf-motors-tel-h mono"><span>${t('bfMotors.telHead')}</span><span class="esc-key">${legacy ? 'MSP_ESC_SENSOR_DATA' : 'MSP_MOTOR_TELEMETRY'}</span></div><div class="bf-motors-cards">${cards}</div>${hint ? `<p class="bf-motors-hint mono">${hint}</p>` : ''}`;
  }

  async function tick(): Promise<void> {
    timer = null;
    if (disposed) return;
    const link = ctx.link();
    if (ctx.state.get().conn === 'connected' && link && !link.busy) {
      try {
        let list: MotorTel[] = [];
        if (!legacy) {
          const p = await io.tryRead(MSPM.MOTOR_TELEMETRY, undefined, 600);
          if (p) list = decodeMotorTelemetry(p);
          else {
            const e = await io.tryRead(MSPM.ESC_SENSOR_DATA, undefined, 600);
            if (e) {
              legacy = true;
              list = decodeEscSensor(e);
            }
          }
        } else {
          const e = await io.tryRead(MSPM.ESC_SENSOR_DATA, undefined, 600);
          if (e) list = decodeEscSensor(e);
        }
        if (disposed) return;
        seenAny = true;
        latest = list;
        onData(list);
        paint();
      } catch {
        /* next cycle */
      }
    }
    if (!disposed) timer = setTimeout(() => void tick(), POLL_MS);
  }

  paint();
  const off = ctx.state.subscribe(() => {
    if (ctx.state.get().conn !== 'connected') {
      latest = [];
      seenAny = false;
      onData([]);
    }
    paint();
  });
  timer = setTimeout(() => void tick(), 200);

  return {
    destroy() {
      disposed = true;
      off();
      if (timer) clearTimeout(timer);
    },
    latest: () => latest,
  };
}
