import { MSP } from './msp';
import { DemoBf } from './demo-bf';
import { C } from '../bf/codes';
import { sleep } from './port';
import { DemoRawDevice } from './demo-escelrs';
import { demoCli, demoMsp } from './demo-motors';
import type { CliEntry, CliOptions, CliResult, CloseReason, FcLink, RawIo } from './types';
import { demoStatusModes, demoTuning } from './demo-tuning';
import { t as tr } from '../i18n';

/** Symulowany dron (SpeedyBee F405 V4, BF 4.5.1) z danymi z makiet. Odpowiada prawdziwymi ladunkami MSP. */
interface DemoConfig {
  protocol: number; // enum BF
  bidir: boolean;
  pidDenom: number;
  poles: number;
}

const PROTOCOLS = ['PWM', 'ONESHOT125', 'ONESHOT42', 'MULTISHOT', 'BRUSHED', 'DSHOT150', 'DSHOT300', 'DSHOT600', 'PROSHOT1000', 'DISABLED'];
const MOTOR_BASE = [62, 71, 58, 66]; // procenty z makiety

const bytes = (...n: number[]) => Uint8Array.from(n);
const str = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

function build(write: (dv: DataView) => void, size: number): Uint8Array {
  const buf = new Uint8Array(size);
  write(new DataView(buf.buffer));
  return buf;
}

export class DemoLink implements FcLink {
  readonly kind = 'demo' as const;
  readonly label = 'Demo';
  busy = false;
  private cfg: DemoConfig = { protocol: 6, bidir: false, pidDenom: 1, poles: 14 };
  private t0 = Date.now();
  private bf = new DemoBf(() => this.cfg, demoStatusModes);
  private closeCbs = new Set<(r: CloseReason) => void>();

  async request(cmd: number, payload?: Uint8Array): Promise<Uint8Array> {
    await sleep(4); // opoznienie "linii"
    if (this.busy) throw new Error(tr('serial.mspSuspended'));
    const t = (Date.now() - this.t0) / 1000;
    // Each tab group answers its own commands; MSP_STATUS_EX stays with the core (it merges modes/profiles itself).
    const tuned = cmd === C.STATUS_EX || cmd === C.EEPROM_WRITE ? null : demoTuning(cmd, payload, t); // tuning / receiver / modes (demo-tuning.ts)
    if (tuned) return tuned;
    const own = demoMsp(cmd, payload, this.cfg, t); // Motors / Blackbox / OSD tabs (demo-motors.ts)
    if (own) return own;
    const bfReply = this.bf.handle(cmd, payload, t); // Betaflight core tabs (serial/demo-bf.ts)
    if (bfReply) return bfReply;
    switch (cmd) {
      case MSP.API_VERSION:
        return bytes(0, 1, 46);
      case MSP.FC_VARIANT:
        return str('BTFL');
      case MSP.FC_VERSION:
        return bytes(4, 5, 1);
      case MSP.RAW_IMU:
        return build((dv) => {
          const g = (k: number) => Math.round(Math.sin(t * 2.3 + k) * 6 + Math.sin(t * 9 + k * 2) * 3);
          dv.setInt16(0, 12, true);
          dv.setInt16(2, -8, true);
          dv.setInt16(4, 2048, true);
          dv.setInt16(6, g(0), true);
          dv.setInt16(8, g(1), true);
          dv.setInt16(10, g(2), true);
        }, 18);
      case MSP.MOTOR:
        return build((dv) => {
          MOTOR_BASE.forEach((p, i) => {
            const pct = p + Math.sin(t * 1.7 + i) * 1.4;
            dv.setUint16(i * 2, Math.round(1000 + pct * 10), true);
          });
        }, 16);
      case MSP.ANALOG:
        return build((dv) => {
          dv.setUint8(0, 249); // 24.9 V
          dv.setUint16(1, 0, true);
          dv.setUint16(3, Math.round(880 + Math.sin(t) * 30), true); // RSSI ~86%
          dv.setInt16(5, 0, true);
          dv.setUint16(7, 2490, true);
        }, 9);
      case MSP.PID:
        return Uint8Array.from([48, 82, 38, 52, 88, 42, 45, 90, 3, ...new Array<number>(21).fill(0)]);
      case MSP.SET_MOTOR:
        void payload;
        return new Uint8Array(0);
      default:
        throw new Error(tr('serial.demoUnsupported', { cmd }));
    }
  }

  async cli(commands: string[], options: CliOptions = {}): Promise<CliResult> {
    this.busy = true;
    const pending: DemoConfig = { ...this.cfg };
    const entries: CliEntry[] = [];
    let transcript = '# ';
    try {
      await sleep(350);
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i].trim();
        if (!cmd) continue;
        await sleep(120);
        const entry: CliEntry = { command: cmd, output: '', error: false };
        const m = /^set\s+([a-z_0-9]+)\s*=\s*(\S+)$/i.exec(cmd);
        const extra = /^(diff|set)(\s|$)/i.test(cmd) ? null : demoCli(cmd, this.cfg); // get / dump / status / version / help (demo-motors.ts)
        if (extra !== null) {
          entry.output = extra;
        } else if (/^diff(\s+all)?$/i.test(cmd)) {
          entry.output = this.diffAll(this.cfg);
        } else if (m) {
          const [, name, raw] = m;
          const v = raw.toUpperCase();
          if (name.toLowerCase() === 'motor_pwm_protocol' && PROTOCOLS.includes(v)) {
            pending.protocol = PROTOCOLS.indexOf(v);
            entry.output = `motor_pwm_protocol set to ${v}`;
          } else if (name.toLowerCase() === 'dshot_bidir' && (v === 'ON' || v === 'OFF')) {
            pending.bidir = v === 'ON';
            entry.output = `dshot_bidir set to ${v}`;
          } else if (name.toLowerCase() === 'motor_poles' && /^\d+$/.test(v)) {
            pending.poles = Number(v);
            entry.output = `motor_poles set to ${v}`;
          } else {
            entry.output = /^[a-z_0-9]+$/i.test(name) ? `${name} set to ${raw}` : 'Invalid name';
          }
        } else if (/^get\s+/i.test(cmd)) {
          entry.output = cmd.replace(/^get\s+/i, '') + ' = (demo)';
        } else {
          entry.output = 'Invalid command';
          entry.error = true;
        }
        transcript += `${cmd}\n${entry.output}\n# `;
        entries.push(entry);
        options.onEntry?.(entry, i);
        if (entry.error && options.stopOnError) break;
      }
      const failed = entries.some((e) => e.error);
      const saved = !!options.save && !failed;
      if (saved) this.cfg = pending;
      await sleep(saved ? 1200 : 700); // "restart FC"
      return { ok: !failed, entries, transcript, saved };
    } finally {
      this.busy = false;
    }
  }

  /** Raw session against the byte-level simulator (4-way ESC interface, CRSF receiver): see demo-escelrs.ts. */
  async raw<T>(fn: (io: RawIo) => Promise<T>): Promise<T> {
    if (this.busy) throw new Error(tr('serial.mspSuspended'));
    this.busy = true;
    try {
      return await fn(new DemoRawDevice({ latencyMs: 6 }));
    } finally {
      this.busy = false;
    }
  }

  private diffAll(c: DemoConfig): string {
    return [
      '# diff all',
      '',
      '# version',
      '# Betaflight / STM32F405 (S405) 4.5.1 Jan  8 2025 / 10:23:01 (77d01ba3b) MSP API: 1.46',
      '# config: manufacturer_id: SPBE, board_name: SPEEDYBEEF405V4, version: 5c2d8a4e, date: 2024-11-02T09:14:55Z',
      '',
      '# name: 5" Freestyle',
      '',
      '# feature',
      'feature -RX_PARALLEL_PWM',
      'feature TELEMETRY',
      'feature OSD',
      '',
      '# serial',
      'serial 0 64 115200 57600 0 115200',
      'serial 1 1 115200 57600 0 115200',
      '',
      '# master',
      'set gyro_lpf1_static_hz = 0',
      `set motor_pwm_protocol = ${PROTOCOLS[c.protocol]}`,
      `set dshot_bidir = ${c.bidir ? 'ON' : 'OFF'}`,
      `set motor_poles = ${c.poles}`,
      `set pid_process_denom = ${c.pidDenom}`,
      'set vbat_min_cell_voltage = 330',
      'set vbat_warning_cell_voltage = 350',
      'set small_angle = 180',
      'set serialrx_provider = CRSF',
      '',
      '# profile 0',
      'set p_roll = 48',
      'set i_roll = 82',
      'set d_roll = 38',
      'set p_pitch = 52',
      'set i_pitch = 88',
      'set d_pitch = 42',
      'set p_yaw = 45',
      'set i_yaw = 90',
    ].join('\n');
  }

  /** The demo never really reboots: saveSettings simulates it, so there is nothing to prepare. */
  expectReboot(): void {}

  onClose(cb: (reason: CloseReason) => void): () => void {
    this.closeCbs.add(cb);
    return () => this.closeCbs.delete(cb);
  }

  async close(): Promise<void> {
    for (const cb of [...this.closeCbs]) cb('closed');
  }
}
