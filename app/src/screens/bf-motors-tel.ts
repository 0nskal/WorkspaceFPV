/**
 * ESC tab, live motor telemetry strip: RPM per motor (bidirectional DShot or ESC sensor), temperature,
 * voltage, current and lost-frame percentage when the ESCs report them. Read-only polling of
 * MSP_MOTOR_TELEMETRY (API >= 1.42), falling back to the legacy MSP_ESC_SENSOR_DATA.
 */
import type { AppContext } from '../context';
import { t } from '../i18n';
import { tip } from '../ui/tip';
import { MSPM, decodeEscSensor, decodeMotorTelemetry, telemetryActive, type MotorTel } from '../bf/motors';


export interface MotorTelHandle {
  destroy(): void;
  latest(): MotorTel[];
}

const POLL_MS = 400;

export function mountMotorTelemetry(host: HTMLElement, ctx: AppContext, onData: (m: MotorTel[]) => void): MotorTelHandle {
  /** Live poll through the Betaflight session; null when the FC rejects the command (older firmware) or times out. */
  const tryRead = (cmd: number): Promise<Uint8Array | null> => ctx.bf.send(cmd, undefined, 600).catch(() => null);
  let latest: MotorTel[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let legacy = false;
  let seenAny = false;

  /** The per-motor values are drawn by the motor tiles (esc.ts); this host only shows the source and a hint when RPM is missing. */
  function paint(): void {
    const s = ctx.state.get();
    const connected = s.conn === 'connected';
    const cfg = s.config;
    const active = telemetryActive(latest);
    let hint = '';
    if (!connected) hint = t('bfMotors.telNeedFc');
    else if (seenAny && !active) hint = cfg && !cfg.bidir && !cfg.useEscSensor ? t('bfMotors.telOffHint') : t('bfMotors.telZeroHint');
    const src = legacy ? 'MSP_ESC_SENSOR_DATA' : 'MSP_MOTOR_TELEMETRY';
    const html = `<span class="mt-tel-l">${t('bfMotors.telBlock')} ${tip('tips.motors.telemetry')}</span>${active ? `<span class="mt-tel-ok">${t('bfMotors.telLive')}</span>` : ''}${hint ? `<span class="mt-tel-hint">${hint}</span>` : ''}<span class="mt-tel-src mono" data-level="expert">${src}</span>`;
    if (host.dataset.sig !== html) {
      host.dataset.sig = html;
      host.innerHTML = html;
    }
  }

  async function tick(): Promise<void> {
    timer = null;
    if (disposed) return;
    const link = ctx.link();
    if (ctx.state.get().conn === 'connected' && link && !link.busy) {
      try {
        let list: MotorTel[] = [];
        if (!legacy) {
          const p = await tryRead(MSPM.MOTOR_TELEMETRY);
          if (p) list = decodeMotorTelemetry(p);
          else {
            const e = await tryRead(MSPM.ESC_SENSOR_DATA);
            if (e) {
              legacy = true;
              list = decodeEscSensor(e);
            }
          }
        } else {
          const e = await tryRead(MSPM.ESC_SENSOR_DATA);
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
