import type { PortIdentity } from './types';
import { setReconnectStatus, type ReconnectStatus } from './reconnect-status';
import { t } from '../i18n';

/** Czy przegladarka/Electron ma WebSerial. */
export function hasWebSerial(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type DataCb = (data: Uint8Array) => void;

/** Cienka nakladka na WebSerial: otwiera port, czyta w petli, emituje dane i zamkniecie. */
export class SerialTransport {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private dataCbs = new Set<DataCb>();
  private closeCbs = new Set<() => void>();
  private loop: Promise<void> | null = null;
  private closed = false;
  readonly identity: PortIdentity;

  constructor(readonly port: SerialPort) {
    const info = port.getInfo();
    this.identity = { usbVendorId: info.usbVendorId, usbProductId: info.usbProductId };
  }

  /** Pokazuje wybor portu (wymaga gestu uzytkownika). W Electronie wybor robi proces glowny. */
  static async request(): Promise<SerialTransport> {
    if (!hasWebSerial()) throw new Error(t('serial.noWebSerial'));
    const port = await navigator.serial.requestPort();
    return new SerialTransport(port);
  }

  /**
   * After an FC reboot (USB re-enumerates) waits for the same port to come back and reopens it, no user gesture needed.
   * Matches by VID/PID among the already permitted ports (Electron grants all serial devices, so getPorts() works there
   * too). Reports progress through reconnect-status.ts; throws after `timeoutMs`.
   */
  static async reopen(identity: PortIdentity, timeoutMs = 20000): Promise<SerialTransport> {
    const t0 = Date.now();
    let attempt = 0;
    let lastError: string | undefined;
    const report = (phase: ReconnectStatus['phase']) => setReconnectStatus({ phase, elapsedMs: Date.now() - t0, timeoutMs, attempt, lastError });
    report('waiting');
    await sleep(1000); // the FC has to disappear from the list first, then come back
    while (Date.now() - t0 < timeoutMs) {
      report('waiting');
      const ports = await navigator.serial.getPorts();
      const sameDevice = (p: SerialPort) => {
        const i = p.getInfo();
        return identity.usbVendorId === undefined ? true : i.usbVendorId === identity.usbVendorId && i.usbProductId === identity.usbProductId;
      };
      const match = ports.find((p) => sameDevice(p) && !p.readable);
      if (match) {
        attempt++;
        report('opening');
        try {
          const tr = new SerialTransport(match);
          await tr.open();
          report('done');
          setTimeout(() => setReconnectStatus(null), 3000);
          return tr;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e); // port not ready yet: retry
        }
      }
      await sleep(400);
    }
    report('failed');
    throw new Error(t('serial.noReturn'));
  }

  async open(baudRate = 115200): Promise<void> {
    await this.port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 });
    if (!this.port.readable || !this.port.writable) throw new Error(t('serial.portUnavailable'));
    // Betaflight's USB VCP only transmits while the host holds DTR high (some boards, e.g. GEPRC F722, stay silent
    // otherwise and every MSP request times out). The Configurator asserts it too. Best effort: not all drivers support it.
    await this.port.setSignals({ dataTerminalReady: true, requestToSend: true }).catch(() => undefined);
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    navigator.serial.addEventListener('disconnect', this.onDisconnect);
    this.loop = this.readLoop();
  }

  private onDisconnect = (e: Event) => {
    if (e.target === this.port) void this.finish();
  };

  private async readLoop(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length) for (const cb of this.dataCbs) cb(value);
      }
    } catch {
      /* port zniknal albo blad odczytu */
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
      void this.finish();
    }
  }

  private async finish(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    navigator.serial.removeEventListener('disconnect', this.onDisconnect);
    try {
      this.writer?.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      await this.port.close();
    } catch {
      /* ignore */
    }
    for (const cb of [...this.closeCbs]) cb();
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.closed || !this.writer) throw new Error(t('serial.portClosed'));
    await this.writer.write(data);
  }

  /** Lowers DTR (and RTS) so a FC running `serialpassthrough ... reset` reboots. Best effort. */
  async dropDtr(): Promise<void> {
    try {
      await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
    } catch {
      /* not supported by this driver: closing the port lowers DTR as well */
    }
  }

  onData(cb: DataCb): () => void {
    this.dataCbs.add(cb);
    return () => this.dataCbs.delete(cb);
  }

  onClose(cb: () => void): () => void {
    this.closeCbs.add(cb);
    return () => this.closeCbs.delete(cb);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    await this.loop;
    await this.finish();
  }
}
