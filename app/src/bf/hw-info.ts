/**
 * Orchestrates reading ESC info (4-way) and the ELRS receiver version (CRSF passthrough) from the hardware.
 * Owns: preconditions (props off confirmation, battery, radio off, disarmed, motors idle), the raw session,
 * the wait for the automatic reconnect, auto-run once after connect, and the per-job status shown in the UI.
 * Results go to `state.hw` (read by diagnosis, drone view, AI context). Nothing here ever writes to the ESCs.
 */
import type { AppContext } from '../context';
import { decodeAnalog, decodeMotors, decodeStatus } from '../fc/read';
import { MSP } from '../serial/msp';
import { sleep } from '../serial/port';
import { getReconnectStatus } from '../serial/reconnect-status';
import { escapeHtml } from '../ui/dom';
import { t } from '../i18n';
import { ElrsFlowError, readElrsInfo, type ElrsStep } from './elrs-flow';
import { EscFlowError, readEscInfo } from './esc-flow';
import type { FcLink, RawIo } from '../serial/types';

/** The active link when it can run raw sessions (4-way ESC interface, CRSF passthrough); MSP goes through ctx.bf. */
type RawLink = FcLink & { raw<T>(fn: (io: RawIo) => Promise<T>): Promise<T> };
const rawLink = (ctx: AppContext): RawLink | null => {
  const l = ctx.link();
  return l && l.raw ? (l as RawLink) : null;
};

export type HwReason =
  | 'armed'
  | 'noRaw'
  | 'noBattery'
  | 'radioOn'
  | 'motorsActive'
  | 'declined'
  | 'notCrsf'
  | 'noUart'
  | 'noAnswer'
  | 'noAnswerSeen'
  | 'serialConfig'
  | 'cliFail'
  | 'passthroughFail'
  | 'escPassthrough'
  | 'escProtocol'
  | 'escStuck'
  | 'noEscAnswered'
  | 'reconnectFail'
  | 'error';

export interface HwJob {
  phase: 'idle' | 'checking' | 'running' | 'reconnecting' | 'done' | 'blocked' | 'error';
  /** Flow step id (i18n key suffix under bfInfo.step). */
  step?: string;
  index?: number;
  count?: number;
  reason?: HwReason;
  detail?: string;
}

const IDLE: HwJob = { phase: 'idle' };

/** Battery sanity: something above 2 V on the sense pin and a believable per-cell voltage. */
export function batteryPresent(vbat: number): boolean {
  if (!(vbat > 2)) return false;
  const cells = Math.min(8, Math.max(1, Math.ceil(vbat / 4.45)));
  const per = vbat / cells;
  return per >= 2.8 && per <= 4.5;
}

/** Arming-disable bit 2 = RX_FAILSAFE: the radio link is down (transmitter off). */
const FLAG_RX_FAILSAFE = 1 << 2;

export class HwInfo {
  esc: HwJob = IDLE;
  elrs: HwJob = IDLE;
  private cbs = new Set<() => void>();
  private busy = false;
  private escAttempted = false;
  private elrsAttempted = false;
  private batteryTicks = 0;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private lastConn: string;

  constructor(private ctx: AppContext) {
    this.lastConn = ctx.state.get().conn;
    ctx.state.subscribe(() => this.onState());
    ctx.state.subscribeTelemetry(() => this.onTelemetry());
  }

  subscribe(cb: () => void): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }

  get running(): boolean {
    return this.busy;
  }

  private emit(): void {
    for (const cb of [...this.cbs]) cb();
  }
  private setEsc(j: HwJob): void {
    this.esc = j;
    this.emit();
  }
  private setElrs(j: HwJob): void {
    this.elrs = j;
    this.emit();
  }

  /* ---------------- auto-run ---------------- */

  private onState(): void {
    const s = this.ctx.state.get();
    if (s.conn === 'disconnected' && this.lastConn !== 'disconnected') {
      this.escAttempted = false;
      this.elrsAttempted = false;
      this.batteryTicks = 0;
      this.esc = IDLE;
      this.elrs = IDLE;
      this.emit();
    }
    const justConnected = s.conn === 'connected' && this.lastConn !== 'connected';
    this.lastConn = s.conn;
    if (justConnected) this.scheduleAuto(1500);
  }

  private onTelemetry(): void {
    const tel = this.ctx.state.get().telemetry;
    this.batteryTicks = tel && batteryPresent(tel.vbat) ? this.batteryTicks + 1 : 0;
    if (this.batteryTicks === 10) this.scheduleAuto(300); // ~1 s of stable voltage
  }

  private scheduleAuto(ms: number): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      void this.autoTick();
    }, ms);
  }

  /** One automatic job at a time: ESC first (no reboot), then ELRS. Each is tried once per connection. */
  private async autoTick(): Promise<void> {
    const s = this.ctx.state.get();
    if (this.busy || s.conn !== 'connected' || !rawLink(this.ctx) || s.status?.armed) return;
    const cfg = this.ctx.settings.get();
    if (cfg.autoEscInfo && !this.escAttempted && this.batteryTicks >= 10) {
      this.escAttempted = true;
      await this.runEsc('auto');
    } else if (cfg.autoElrsInfo && !this.elrsAttempted && this.elrsCandidate()) {
      this.elrsAttempted = true;
      await this.runElrs('auto');
    } else return;
    this.scheduleAuto(800); // the next pending job, if any
  }

  /** Cheap pre-filter for the auto-run: only a UART CRSF receiver can answer (RX_CONFIG comes from the connect-time read). */
  private elrsCandidate(): boolean {
    return this.ctx.bf.get().rx?.serialRxProvider === 9;
  }

  /* ---------------- shared checks ---------------- */

  private async confirm(kind: 'esc' | 'elrs', source: 'auto' | 'manual'): Promise<boolean> {
    if (rawLink(this.ctx)?.kind === 'demo') return true; // nothing can happen in the demo
    const items = kind === 'esc' ? [t('bfInfo.confirm.esc1'), t('bfInfo.confirm.esc2'), t('bfInfo.confirm.esc3')] : [t('bfInfo.confirm.elrs1'), t('bfInfo.confirm.elrs2')];
    return this.ctx.confirm({
      title: kind === 'esc' ? t('bfInfo.confirm.escTitle') : t('bfInfo.confirm.elrsTitle'),
      confirmText: kind === 'esc' ? t('bfInfo.confirm.escGo') : t('bfInfo.confirm.elrsGo'),
      body: `<p>${kind === 'esc' ? t('bfInfo.confirm.escIntro') : t('bfInfo.confirm.elrsIntro')}</p>
        <ul class="bf-info-checklist">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
        <p class="save-note">${kind === 'esc' ? t('bfInfo.confirm.escNote') : t('bfInfo.confirm.elrsNote')}</p>
        ${source === 'auto' ? `<p class="mono">${t('bfInfo.confirm.autoNote')}</p>` : ''}`,
    });
  }

  private async armed(): Promise<boolean> {
    const io = rawLink(this.ctx);
    if (!io) return true;
    try {
      return decodeStatus(await this.ctx.bf.send(MSP.STATUS)).armed;
    } catch {
      return true; // cannot tell: do not touch the FC
    }
  }

  /** Re-reads status/battery after the confirmation (the user may just have done what the dialog asked). */
  private async escPreconditions(): Promise<HwReason | null> {
    const io = rawLink(this.ctx);
    if (!io) return 'noRaw';
    const demo = io.kind === 'demo';
    const apiMinor = this.ctx.state.get().info?.apiVersion.minor ?? 46;
    try {
      let st = decodeStatus(await this.ctx.bf.send(MSP.STATUS));
      if (st.armed) return 'armed';
      const analog = decodeAnalog(await this.ctx.bf.send(MSP.ANALOG), apiMinor);
      if (!batteryPresent(analog.vbat)) return 'noBattery';
      if (!demo) {
        // the failsafe flag appears a moment after the transmitter goes silent
        for (let i = 0; i < 12 && (st.armingDisableFlags & FLAG_RX_FAILSAFE) === 0; i++) {
          await sleep(500);
          st = decodeStatus(await this.ctx.bf.send(MSP.STATUS));
          if (st.armed) return 'armed';
        }
        if ((st.armingDisableFlags & FLAG_RX_FAILSAFE) === 0) return 'radioOn';
        const motors = decodeMotors(await this.ctx.bf.send(MSP.MOTOR), this.ctx.state.get().config?.motorCount ?? 4);
        if (motors.some((m) => m > 1100)) return 'motorsActive';
      }
    } catch {
      return 'error';
    }
    return null;
  }

  /* ---------------- ESC info ---------------- */

  async runEsc(source: 'auto' | 'manual' = 'manual'): Promise<void> {
    const io = rawLink(this.ctx);
    if (this.busy) return;
    if (!io || this.ctx.state.get().conn !== 'connected') return this.setEsc({ phase: 'blocked', reason: 'noRaw' });
    this.busy = true;
    try {
      this.setEsc({ phase: 'checking' });
      if (await this.armed()) return this.setEsc({ phase: 'blocked', reason: 'armed' });
      if (!(await this.confirm('esc', source))) return this.setEsc({ phase: 'blocked', reason: 'declined' });
      const reason = await this.escPreconditions();
      if (reason) return this.setEsc({ phase: 'blocked', reason });

      const demo = io.kind === 'demo';
      this.setEsc({ phase: 'running', step: 'passthrough' });
      const scan = await io.raw((rio) =>
        readEscInfo(rio, {
          settleMs: demo ? 150 : 1200,
          timeoutScale: demo ? 0.3 : 1,
          sleep: demo ? (ms) => sleep(Math.min(ms, 40)) : undefined,
          onProgress: (p) => this.setEsc({ phase: 'running', step: p.step, index: p.index, count: p.count }),
        }),
      );
      this.ctx.state.patch({ hw: { ...this.ctx.state.get().hw, esc: scan } });
      if (scan.escs.length > 0 && scan.escs.every((e) => e.status === 'no-response')) this.setEsc({ phase: 'blocked', reason: 'noEscAnswered' });
      else this.setEsc({ phase: 'done' });
    } catch (e) {
      const code = e instanceof EscFlowError ? e.code : null;
      this.setEsc({ phase: 'error', reason: code === 'passthrough' ? 'escPassthrough' : code === 'stuck' ? 'escStuck' : code === 'protocol' ? 'escProtocol' : 'error', detail: e instanceof Error ? e.message : String(e) });
    } finally {
      this.busy = false;
    }
  }

  /* ---------------- ELRS version ---------------- */

  async runElrs(source: 'auto' | 'manual' = 'manual'): Promise<void> {
    const io = rawLink(this.ctx);
    if (this.busy) return;
    if (!io || this.ctx.state.get().conn !== 'connected') return this.setElrs({ phase: 'blocked', reason: 'noRaw' });
    this.busy = true;
    try {
      this.setElrs({ phase: 'checking' });
      if (await this.armed()) return this.setElrs({ phase: 'blocked', reason: 'armed' });
      const rx = this.ctx.bf.get().rx; // read on connect; null = unknown, let the serial config decide
      if (rx && rx.serialRxProvider !== 9) return this.setElrs({ phase: 'blocked', reason: 'notCrsf' });
      if (!(await this.confirm('elrs', source))) return this.setElrs({ phase: 'blocked', reason: 'declined' });

      const demo = io.kind === 'demo';
      this.setElrs({ phase: 'running', step: 'config' });
      const res = await io.raw((rio) =>
        readElrsInfo(rio, {
          timeoutScale: demo ? 0.4 : 1,
          sleep: demo ? (ms) => sleep(Math.min(ms, 40)) : undefined,
          onProgress: (step: ElrsStep) => this.setElrs({ phase: 'running', step }),
        }),
      );
      if (res.kind === 'no-uart') return this.setElrs({ phase: 'blocked', reason: 'noUart' });

      // ok / no-answer both end with the FC reset: wait for the automatic reconnect
      if (res.kind === 'ok') this.ctx.state.patch({ hw: { ...this.ctx.state.get().hw, elrs: res.info } });
      this.setElrs({ phase: 'reconnecting', step: 'reconnecting' });
      const back = demo ? (await sleep(1400), true) : await this.waitReconnect(io);
      if (!back) return this.setElrs({ phase: 'error', reason: 'reconnectFail' });
      if (res.kind === 'ok') this.setElrs({ phase: 'done' });
      else this.setElrs({ phase: 'blocked', reason: res.sawCrsf ? 'noAnswerSeen' : 'noAnswer' });
    } catch (e) {
      const code = e instanceof ElrsFlowError ? e.code : null;
      const reason: HwReason = code === 'serialConfig' ? 'serialConfig' : code === 'cli' ? 'cliFail' : code === 'passthrough' ? 'passthroughFail' : 'error';
      this.setElrs({ phase: 'error', reason, detail: e instanceof Error ? e.message : String(e) });
      // a failed passthrough leaves the FC rebooting (exit): the app reconnects by itself
      if (code === 'passthrough' && io.kind !== 'demo') await this.waitReconnect(io).catch(() => false);
    } finally {
      this.busy = false;
    }
  }

  /** Waits until the app has a NEW connected link (handleClose -> reopen -> attach). false = gave up. */
  private waitReconnect(old: unknown, timeoutMs = 40000): Promise<boolean> {
    return new Promise((resolve) => {
      let sawGone = false;
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        resolve(v);
      };
      const check = () => {
        const s = this.ctx.state.get();
        if (s.conn !== 'connected') sawGone = true;
        if (s.conn === 'connected' && this.ctx.link() && this.ctx.link() !== old) finish(true);
        else if (s.conn === 'disconnected' && sawGone) finish(false); // reconnect gave up (error is on the start screen)
      };
      const off = this.ctx.state.subscribe(check);
      const timer = setTimeout(() => finish(false), timeoutMs);
      check();
    });
  }

  /** Text for the reconnect progress ("12 s of 20 s"), or null when no reconnect is running. */
  reconnectLine(): string | null {
    const r = getReconnectStatus();
    if (!r || r.phase === 'done') return null;
    if (r.phase === 'failed') return t('bfInfo.reconnect.failed');
    return t('bfInfo.reconnect.waiting', { s: Math.round(r.elapsedMs / 1000), max: Math.round(r.timeoutMs / 1000) });
  }
}

let instance: HwInfo | null = null;

/** Creates the controller once per app (called from createApp). */
export function initHwInfo(ctx: AppContext): HwInfo {
  instance = new HwInfo(ctx);
  return instance;
}

export function hwInfo(): HwInfo | null {
  return instance;
}
