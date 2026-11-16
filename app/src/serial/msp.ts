import type { SerialTransport } from './port';
import { t } from '../i18n';

/** Numery komend MSP v1 uzywane przez Rotorlab. */
export const MSP = {
  API_VERSION: 1,
  FC_VARIANT: 2,
  FC_VERSION: 3,
  BOARD_INFO: 4,
  NAME: 10,
  RX_CONFIG: 44,
  ADVANCED_CONFIG: 90,
  STATUS: 101,
  RAW_IMU: 102,
  MOTOR: 104,
  ANALOG: 110,
  PID: 112,
  MOTOR_CONFIG: 131,
  SET_MOTOR: 214,
} as const;

export interface MspFrame {
  cmd: number;
  payload: Uint8Array;
  /** Ramka bledu ($M!). */
  error: boolean;
}

/** Buduje ramke zadania `$M<` [size][cmd][payload][xor]. */
export function encodeMspV1(cmd: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (payload.length > 254) throw new Error(t('serial.mspTooBig'));
  const out = new Uint8Array(6 + payload.length);
  out[0] = 0x24; // $
  out[1] = 0x4d; // M
  out[2] = 0x3c; // <
  out[3] = payload.length;
  out[4] = cmd;
  out.set(payload, 5);
  let crc = payload.length ^ cmd;
  for (const b of payload) crc ^= b;
  out[5 + payload.length] = crc;
  return out;
}

/** Buduje ramke odpowiedzi `$M>` (uzywane przez demo i testy). */
export function encodeMspResponse(cmd: number, payload: Uint8Array): Uint8Array {
  const f = encodeMspV1(cmd, payload);
  f[2] = 0x3e;
  return f;
}

type ParserState = 'idle' | 'm' | 'dir' | 'size' | 'cmd' | 'payload' | 'crc';

/** Strumieniowy parser odpowiedzi MSP v1 (`$M>` i `$M!`). */
export class MspParser {
  private s: ParserState = 'idle';
  private error = false;
  private size = 0;
  private cmd = 0;
  private buf = new Uint8Array(256);
  private pos = 0;
  private crc = 0;

  push(bytes: Uint8Array): MspFrame[] {
    const frames: MspFrame[] = [];
    for (const b of bytes) {
      switch (this.s) {
        case 'idle':
          if (b === 0x24) this.s = 'm';
          break;
        case 'm':
          this.s = b === 0x4d ? 'dir' : 'idle';
          break;
        case 'dir':
          if (b === 0x3e || b === 0x21) {
            this.error = b === 0x21;
            this.s = 'size';
          } else this.s = b === 0x24 ? 'm' : 'idle';
          break;
        case 'size':
          this.size = b;
          this.crc = b;
          this.s = 'cmd';
          break;
        case 'cmd':
          this.cmd = b;
          this.crc ^= b;
          this.pos = 0;
          this.s = this.size === 0 ? 'crc' : 'payload';
          break;
        case 'payload':
          this.buf[this.pos++] = b;
          this.crc ^= b;
          if (this.pos >= this.size) this.s = 'crc';
          break;
        case 'crc':
          if (b === this.crc) frames.push({ cmd: this.cmd, payload: this.buf.slice(0, this.size), error: this.error });
          this.s = 'idle';
          break;
      }
    }
    return frames;
  }

  reset(): void {
    this.s = 'idle';
  }
}

interface Pending {
  cmd: number;
  payload: Uint8Array;
  timeoutMs: number;
  resolve: (p: Uint8Array) => void;
  reject: (e: Error) => void;
}

/** Klient MSP: kolejka zadan (jedno w locie), timeout domyslnie 1 s, mozliwosc wstrzymania na czas CLI. */
export class MspClient {
  private parser = new MspParser();
  private queue: Pending[] = [];
  private current: Pending | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private suspended = false;
  private off: () => void;

  constructor(private transport: SerialTransport) {
    this.off = transport.onData((d) => this.onData(d));
  }

  request(cmd: number, payload: Uint8Array = new Uint8Array(0), timeoutMs = 1000): Promise<Uint8Array> {
    if (this.suspended) return Promise.reject(new Error(t('serial.mspSuspended')));
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, payload, timeoutMs, resolve, reject });
      this.pump();
    });
  }

  /** Wstrzymuje MSP (odrzuca kolejke) - na czas sesji CLI. */
  suspend(): void {
    this.suspended = true;
    this.failAll(new Error(t('serial.mspPaused')));
    this.parser.reset();
  }

  resume(): void {
    this.suspended = false;
    this.parser.reset();
  }

  dispose(): void {
    this.off();
    this.failAll(new Error(t('serial.closed')));
  }

  private failAll(err: Error): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const cur = this.current;
    this.current = null;
    cur?.reject(err);
    for (const q of this.queue.splice(0)) q.reject(err);
  }

  private pump(): void {
    if (this.current || this.suspended) return;
    const next = this.queue.shift();
    if (!next) return;
    this.current = next;
    this.timer = setTimeout(() => {
      this.timer = null;
      const cur = this.current;
      this.current = null;
      cur?.reject(new Error(t('serial.mspTimeout', { cmd: next.cmd })));
      this.pump();
    }, next.timeoutMs);
    this.transport.write(encodeMspV1(next.cmd, next.payload)).catch((e: unknown) => {
      if (this.current === next) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.current = null;
        next.reject(e instanceof Error ? e : new Error(String(e)));
        this.pump();
      }
    });
  }

  private onData(d: Uint8Array): void {
    if (this.suspended) return;
    for (const f of this.parser.push(d)) {
      const cur = this.current;
      if (!cur || f.cmd !== cur.cmd) continue; // spozniona/obca odpowiedz
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.current = null;
      if (f.error) cur.reject(new Error(t('serial.mspRejected', { cmd: cur.cmd })));
      else cur.resolve(f.payload);
      this.pump();
    }
  }
}

/* ---- pomocnicze dekodery ---- */
export const u16 = (dv: DataView, o: number) => dv.getUint16(o, true);
export const s16 = (dv: DataView, o: number) => dv.getInt16(o, true);
export const u32 = (dv: DataView, o: number) => dv.getUint32(o, true);
export const view = (p: Uint8Array) => new DataView(p.buffer, p.byteOffset, p.byteLength);
export const ascii = (p: Uint8Array, from = 0, to = p.length) =>
  String.fromCharCode(...p.subarray(from, to)).replace(/\0+$/, '');
