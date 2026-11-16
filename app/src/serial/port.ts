import type { PortIdentity } from './types';
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

  /** Po restarcie FC (USB sie rozlacza) czeka na ten sam port, bez gestu uzytkownika. */
  static async reopen(identity: PortIdentity, timeoutMs = 15000): Promise<SerialTransport> {
    const t0 = Date.now();
    await sleep(1200); // FC musi najpierw zniknac z listy, potem wrocic
    while (Date.now() - t0 < timeoutMs) {
      const ports = await navigator.serial.getPorts();
      const match = ports.find((p) => {
        const i = p.getInfo();
        return i.usbVendorId === identity.usbVendorId && i.usbProductId === identity.usbProductId && !p.readable;
      });
      if (match) {
        try {
          const t = new SerialTransport(match);
          await t.open();
          return t;
        } catch {
          /* port jeszcze nie gotowy */
        }
      }
      await sleep(500);
    }
    throw new Error(t('serial.noReturn'));
  }

  async open(baudRate = 115200): Promise<void> {
    await this.port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 });
    if (!this.port.readable || !this.port.writable) throw new Error(t('serial.portUnavailable'));
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
