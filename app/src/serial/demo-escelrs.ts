/**
 * Byte-level simulation of the FC port for the raw sessions (demo mode and unit tests): MSP (v1 + v2) -> 4-way ESC
 * interface, and MSP -> CLI -> serialpassthrough -> CRSF receiver. The real flow code runs against it unchanged.
 * Demo drone: 4 ESCs (M1, M2, M4 Bluejay 0.21 on EFM8BB21; M3 answers but with a settings page we cannot decode),
 * ELRS 3.4.3 receiver on UART2 with serial RX.
 */
import { buildDeviceInfo, buildLinkStats, CrsfParser, CRSF } from '../bf/crsf';
import { bluejaySample, garbageSample } from '../bf/esc-samples';
import { CMD, ACK, FourWayRequestParser, encodeResponse } from '../bf/fourway';
import { MSP_SET_PASSTHROUGH, MSP2_COMMON_SERIAL_CONFIG, Msp2Parser, encodeMspV2Response, encodeSerialConfig } from '../bf/msp2';
import { RawBuffer } from '../bf/raw-buffer';
import { encodeMspResponse } from './msp';
import type { RawIo } from './types';

export interface DemoEsc {
  /** false = does not answer INIT_FLASH (no power / no bootloader). */
  answers: boolean;
  signature: number;
  bootByte: number;
  mode: number;
  /** EEPROM page content served by DEVICE_READ at `eepromAddr`. */
  eeprom: Uint8Array;
  eepromAddr: number;
}

export interface DemoDeviceOptions {
  escs?: DemoEsc[];
  elrs?: { name: string; version: [number, number, number] } | null;
  /** Serial ports reported by MSP2_COMMON_SERIAL_CONFIG. */
  ports?: Array<{ id: number; functionMask: number }>;
  /** Simulated per-message latency. */
  latencyMs?: number;
  /** DTR drop ends the passthrough and calls this (a demo has no real reboot). */
  onReset?: () => void;
  /** The FC never leaves 4-way (to test the "stuck" path). */
  stuckIn4way?: boolean;
}

export const demoEscs = (): DemoEsc[] => {
  const bj = (): DemoEsc => ({ answers: true, signature: 0xe8b2, bootByte: 0x06, mode: 1, eeprom: bluejaySample(), eepromAddr: 0x1a00 });
  return [bj(), bj(), { ...bj(), eeprom: garbageSample() }, bj()];
};

type Mode = 'msp' | '4way' | 'cli' | 'crsf';

/** Parser for MSP v1 REQUEST frames (`$M<`), the simulator's side of the link. */
class Msp1RequestParser {
  private buf: number[] = [];
  push(bytes: Uint8Array): Array<{ cmd: number; payload: Uint8Array }> {
    for (const b of bytes) this.buf.push(b);
    const out: Array<{ cmd: number; payload: Uint8Array }> = [];
    for (;;) {
      const s = this.buf.indexOf(0x24);
      if (s < 0) {
        this.buf = [];
        break;
      }
      if (s > 0) this.buf.splice(0, s);
      if (this.buf.length < 3) break;
      if (this.buf[1] !== 0x4d || this.buf[2] !== 0x3c) {
        this.buf.shift();
        continue;
      }
      if (this.buf.length < 5) break;
      const len = this.buf[3];
      if (this.buf.length < 6 + len) break;
      let x = 0;
      for (let i = 3; i < 5 + len; i++) x ^= this.buf[i];
      if (x === this.buf[5 + len]) {
        out.push({ cmd: this.buf[4], payload: Uint8Array.from(this.buf.slice(5, 5 + len)) });
        this.buf.splice(0, 6 + len);
      } else this.buf.shift();
    }
    return out;
  }
}

export class DemoRawDevice implements RawIo {
  private rx = new RawBuffer();
  private mode: Mode = 'msp';
  private msp1 = new Msp1RequestParser();
  private msp2 = new Msp2Parser(true);
  private fw = new FourWayRequestParser();
  private crsf = new CrsfParser();
  private cliLine = '';
  private initialised = new Set<number>();
  /** Every command byte seen by the 4-way simulator (tests assert no write/erase ever arrives). */
  readonly fourWayCmds: number[] = [];
  /** Every CLI line received. */
  readonly cliLines: string[] = [];
  rebootExpected = false;
  closed = false;
  private readonly o: Required<Omit<DemoDeviceOptions, 'onReset'>> & Pick<DemoDeviceOptions, 'onReset'>;

  constructor(opts: DemoDeviceOptions = {}) {
    this.o = {
      escs: opts.escs ?? demoEscs(),
      elrs: opts.elrs === undefined ? { name: 'Generic 2400 RX', version: [3, 4, 3] } : opts.elrs,
      ports: opts.ports ?? [
        { id: 20, functionMask: 1 },
        { id: 0, functionMask: 0 },
        { id: 1, functionMask: 1 << 6 },
      ],
      latencyMs: opts.latencyMs ?? 2,
      stuckIn4way: opts.stuckIn4way ?? false,
      onReset: opts.onReset,
    };
  }

  private reply(bytes: Uint8Array): void {
    setTimeout(() => this.rx.push(bytes), this.o.latencyMs);
  }

  /* ---------- RawIo ---------- */
  async write(data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('closed');
    switch (this.mode) {
      case 'msp':
        return this.onMsp(data);
      case '4way':
        return this.on4way(data);
      case 'cli':
        return this.onCli(data);
      case 'crsf':
        return this.onCrsf(data);
    }
  }
  readExact(n: number, timeoutMs: number): Promise<Uint8Array | null> {
    return this.rx.readExact(n, timeoutMs);
  }
  readSome(timeoutMs: number): Promise<Uint8Array> {
    return this.rx.readSome(timeoutMs, 5);
  }
  clear(): void {
    this.rx.clear();
  }
  expectReboot(): void {
    this.rebootExpected = true;
  }
  async dropDtrAndClose(): Promise<void> {
    this.rebootExpected = true;
    this.closed = true;
    this.o.onReset?.();
  }

  /* ---------- MSP ---------- */
  private onMsp(data: Uint8Array): void {
    for (const f of this.msp1.push(data)) {
      if (f.cmd === 1) this.reply(encodeMspResponse(1, Uint8Array.from([0, 1, 46])));
      else if (f.cmd === MSP_SET_PASSTHROUGH) {
        this.reply(encodeMspResponse(MSP_SET_PASSTHROUGH, Uint8Array.from([this.o.escs.length])));
        this.mode = '4way';
        this.fw = new FourWayRequestParser();
      }
    }
    // v2 requests share the stream: feed the v2 parser as well
    for (const f of this.msp2.push(data)) {
      if (f.code === MSP2_COMMON_SERIAL_CONFIG) this.reply(encodeMspV2Response(f.code, encodeSerialConfig(this.o.ports)));
    }
    if (data.length && data[0] === 0x23 /* '#' */) {
      this.mode = 'cli';
      this.cliLine = '';
      this.reply(new TextEncoder().encode("\r\nEntering CLI Mode, type 'exit' to return, or 'help'\r\n\r\n# "));
    }
  }

  /* ---------- 4-way ---------- */
  private on4way(data: Uint8Array): void {
    for (const r of this.fw.push(data)) {
      if (!r.crcOk) {
        this.reply(encodeResponse(r.cmd, r.addr, [0], ACK.INVALID_CRC));
        continue;
      }
      this.fourWayCmds.push(r.cmd);
      const out = (d: ArrayLike<number>, ack: number = ACK.OK) => this.reply(encodeResponse(r.cmd, r.addr, d, ack));
      switch (r.cmd) {
        case CMD.TEST_ALIVE:
          out([0]);
          break;
        case CMD.INTERFACE_GET_NAME:
          out([...'m4wFCIntf'].map((c) => c.charCodeAt(0)));
          break;
        case CMD.INTERFACE_EXIT:
          out([0]);
          if (!this.o.stuckIn4way) {
            this.mode = 'msp';
            this.msp1 = new Msp1RequestParser();
            this.msp2 = new Msp2Parser(true);
          }
          break;
        case CMD.DEVICE_RESET:
          this.initialised.delete(r.param[0]);
          out([0]);
          break;
        case CMD.DEVICE_INIT_FLASH: {
          const esc = this.o.escs[r.param[0]];
          if (!esc) out([0], ACK.INVALID_CHANNEL);
          else if (!esc.answers) out([0], ACK.GENERAL_ERROR);
          else {
            this.initialised.add(r.param[0]);
            out([esc.signature & 0xff, esc.signature >> 8, esc.bootByte, esc.mode]);
          }
          break;
        }
        case CMD.DEVICE_READ: {
          const idx = [...this.initialised][0];
          const esc = idx === undefined ? undefined : this.o.escs[idx];
          const len = r.param[0] === 0 ? 256 : r.param[0];
          if (!esc) out([0], ACK.GENERAL_ERROR);
          else {
            const off = r.addr - esc.eepromAddr;
            const chunk = new Uint8Array(len).fill(0xff);
            if (off >= 0) chunk.set(esc.eeprom.subarray(off, off + len));
            out(chunk);
          }
          break;
        }
        default:
          out([0], ACK.INVALID_CMD);
      }
    }
  }

  /* ---------- CLI ---------- */
  private onCli(data: Uint8Array): void {
    for (const b of data) {
      if (b === 0x0a || b === 0x0d) {
        const line = this.cliLine.trim();
        this.cliLine = '';
        if (!line || line === '#') continue;
        this.cliLines.push(line);
        if (/^serialpassthrough\s/.test(line)) {
          this.mode = 'crsf';
          this.crsf = new CrsfParser();
          this.reply(new TextEncoder().encode(`${line}\r\nPort1: 1 \r\nPort2: 20 \r\nPort1 is already open, setting baud = 420000.\r\nForwarding, power cycle or drop DTR to exit.\r\n`));
        } else if (line === 'exit') {
          this.rebootExpected = true;
          this.closed = true;
          this.o.onReset?.();
        } else this.reply(new TextEncoder().encode(`${line}\r\n# `));
      } else this.cliLine += String.fromCharCode(b);
    }
  }

  /* ---------- CRSF receiver behind the passthrough ---------- */
  private onCrsf(data: Uint8Array): void {
    for (const f of this.crsf.push(data)) {
      if (f.type === CRSF.TYPE_DEVICE_PING && this.o.elrs) {
        this.reply(buildLinkStats());
        this.reply(buildDeviceInfo(this.o.elrs.name, this.o.elrs.version));
      }
    }
  }
}
