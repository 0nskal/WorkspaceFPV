/**
 * Demo FC data for the Motors / Blackbox / OSD / CLI tabs (hooked into demo.ts with one line each).
 * Simulated board: SpeedyBee F405 V4, BF 4.5.1 (API 1.46), 6S, ELRS on UART2 (CRSF), Bluejay ESCs, 16 MB dataflash.
 */
import { synthLog } from '../analysis/synth';
import { encodeFlashReadResponse, encodeFlashSummary, encodeBlackboxConfigRead, MSPB } from '../bf/blackbox';
import { encodeMotor3d, decodeMotor3d, encodeMotorTelemetry, featureOn, MOTOR_3D_DEFAULTS, MOTOR_FEATURE, MSPM } from '../bf/motors';
import { encodeOsdConfig, encodePos, MSPO, type OsdConfig } from '../bf/osd';

/** The part of the demo FC config that demo.ts owns (and the CLI path of demo.ts edits). */
export interface DemoCfgRef {
  protocol: number;
  bidir: boolean;
  pidDenom: number;
  poles: number;
}

/* ---------------- OSD defaults (30x16 PAL layout) ---------------- */
const pos = (x: number, y: number, on = true) => encodePos({ x, y, vis: [on, on, false], type: 0 });
function demoOsd(): OsdConfig {
  const items = new Array<number>(64).fill(pos(0, 0, false));
  items[0] = pos(2, 1); // rssi
  items[1] = pos(22, 14); // battery voltage
  items[2] = pos(14, 7); // crosshairs
  items[5] = pos(22, 15); // timer 1
  items[7] = pos(14, 15); // flight mode
  items[8] = pos(8, 13, false); // craft name
  items[9] = pos(2, 14); // throttle
  items[10] = pos(22, 1); // vtx channel
  items[11] = pos(14, 14, false); // current
  items[12] = pos(2, 15); // mAh
  items[15] = pos(2, 3, false); // altitude
  items[21] = pos(9, 11); // warnings
  items[22] = pos(22, 13); // avg cell
  items[29] = pos(11, 5); // disarmed
  items[35] = pos(2, 12, false); // esc temp
  items[46] = pos(2, 2); // link quality
  return {
    flags: 0x31, video: 1, units: 1, rssiAlarm: 20, capAlarm: 2200, altAlarm: 100,
    items,
    stats: [0, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    timers: [0x0100, 0x0111],
    warnings: 0b0000_0000_0000_0011_1111_1111, warningCount: 18,
    profileCount: 3, profile: 1, overlay: 0, camW: 24, camH: 11, lqAlarm: 70,
  };
}

/* ---------------- a real, decodable .bbl for the demo dataflash ---------------- */
const uvb = (v: number): number[] => {
  const o: number[] = [];
  let x = Math.floor(v);
  while (x >= 128) {
    o.push((x % 128) | 0x80);
    x = Math.floor(x / 128);
  }
  o.push(x);
  return o;
};
const svb = (v: number): number[] => uvb(v >= 0 ? v * 2 : -v * 2 - 1);
const fits = (v: number, bits: number) => v >= -(1 << (bits - 1)) && v < 1 << (bits - 1);
function tag23(v: number[]): number[] {
  if (v.every((x) => fits(x, 2))) return [((v[0]! & 3) << 4) | ((v[1]! & 3) << 2) | (v[2]! & 3)];
  if (v.every((x) => fits(x, 4))) return [0x40 | (v[0]! & 15), ((v[1]! & 15) << 4) | (v[2]! & 15)];
  if (v.every((x) => fits(x, 6))) return [0x80 | (v[0]! & 63), v[1]! & 63, v[2]! & 63];
  let lead = 0xc0;
  const body: number[] = [];
  v.forEach((x, i) => {
    if (fits(x, 8)) body.push(x & 255);
    else if (fits(x, 16)) {
      lead |= 1 << (i * 2);
      body.push(x & 255, (x >> 8) & 255);
    } else {
      lead |= 2 << (i * 2);
      body.push(x & 255, (x >> 8) & 255, (x >> 16) & 255);
    }
  });
  return [lead, ...body];
}
function tag4s16(v: number[]): number[] {
  let sel = 0;
  const body: number[] = [];
  v.forEach((x, i) => {
    if (x === 0) return;
    if (fits(x, 8)) {
      sel |= 2 << (i * 2);
      body.push(x & 255);
    } else {
      sel |= 3 << (i * 2);
      body.push((x >> 8) & 255, x & 255);
    }
  });
  return [sel, ...body];
}
function tag88(v: number[]): number[] {
  let tag = 0;
  const body: number[] = [];
  v.forEach((x, i) => {
    if (x !== 0) {
      tag |= 1 << i;
      body.push(...svb(x));
    }
  });
  return [tag, ...body];
}

const FIELDS = ['loopIteration', 'time', 'setpoint[0]', 'setpoint[1]', 'setpoint[2]', 'setpoint[3]', 'gyroADC[0]', 'gyroADC[1]', 'gyroADC[2]', 'motor[0]', 'motor[1]', 'motor[2]', 'motor[3]'];

function buildDemoBbl(): Uint8Array {
  const fs = 2000;
  const log = synthLog({ seconds: 14, fs, seed: 11 });
  const header = [
    'H Product:Blackbox flight data recorder by Nicholas Sherlock',
    'H Data version:2',
    'H I interval:32',
    'H P interval:1/1',
    `H Field I name:${FIELDS.join(',')}`,
    'H Field I signed:0,0,1,1,1,1,1,1,1,0,1,1,1',
    'H Field I predictor:0,0,0,0,0,0,0,0,0,11,5,5,5',
    'H Field I encoding:1,1,0,0,0,0,0,0,0,1,0,0,0',
    'H Field P predictor:6,2,1,1,1,1,3,3,3,3,3,3,3',
    'H Field P encoding:9,0,8,8,8,8,7,7,7,6,6,6,6',
    'H minthrottle:1070',
    'H maxthrottle:2000',
    'H motorOutput:48,2047',
    'H Firmware type:Betaflight',
    'H Firmware revision:Betaflight 4.5.1 (77d01ba3b) STM32F405',
    'H Firmware date:Jan  8 2025 10:23:01',
    'H Board information:SPBE SPEEDYBEEF405V4',
    'H Craft name:5" Freestyle',
    'H looptime:125',
    'H pid_process_denom:1',
    'H gyro_scale:0x3f800000',
    'H debug_mode:0',
    'H Log start datetime:2026-11-16T10:00:00.000+00:00',
  ].join('\n') + '\n';
  const out: number[] = [];
  for (let i = 0; i < header.length; i++) out.push(header.charCodeAt(i) & 0xff);
  let prev: number[] | null = null;
  let prev2: number[] | null = null;
  for (let k = 0; k < log.rows; k++) {
    const f = [k, Math.round(k * (1e6 / fs)), ...[0, 1, 2].map((a) => Math.round(log.setpoint[a]![k]!)), 1000 + Math.round((k / 40) % 1000), ...[0, 1, 2].map((a) => Math.round(log.gyro[a]![k]!)), ...[0, 1, 2, 3].map((m) => Math.round(log.motor[m]![k]!))];
    if (k % 32 === 0 || !prev || !prev2) {
      out.push(0x49, ...uvb(f[0]!), ...uvb(f[1]!), ...f.slice(2, 9).flatMap((v) => svb(v)), ...uvb(f[9]! - 48), ...svb(f[10]! - f[9]!), ...svb(f[11]! - f[9]!), ...svb(f[12]! - f[9]!));
      prev = prev2 = f;
    } else {
      const avg = (i: number) => Math.trunc((prev![i]! + prev2![i]!) / 2);
      const d = [f[1]! - (2 * prev[1]! - prev2[1]!), f[2]! - prev[2]!, f[3]! - prev[3]!, f[4]! - prev[4]!, f[5]! - prev[5]!, f[6]! - avg(6), f[7]! - avg(7), f[8]! - avg(8), f[9]! - avg(9), f[10]! - avg(10), f[11]! - avg(11), f[12]! - avg(12)];
      out.push(0x50, ...svb(d[0]!), ...tag4s16(d.slice(1, 5)), ...tag23(d.slice(5, 8)), ...tag88(d.slice(8, 12)));
      prev2 = prev;
      prev = f;
    }
  }
  out.push(0x45, 255, ...[...'End of log\0'].map((c) => c.charCodeAt(0)));
  return Uint8Array.from(out);
}

/* ---------------- state ---------------- */
const TOTAL = 16 * 1024 * 1024;
const st = {
  idle: 5.5,
  pwmRate: 480,
  debug: 0,
  reversed: false,
  /** Feature mask (the Motors tab answers FEATURE_CONFIG so ESC_SENSOR and MOTOR_CONFIG stay in sync):
   *  RX_SERIAL, TELEMETRY, LED_STRIP, OSD, AIRMODE, ESC_SENSOR, ANTI_GRAVITY. */
  features: ((1 << 3) | (1 << 7) | (1 << 10) | (1 << 16) | (1 << 18) | (1 << 22) | (1 << 27) | (1 << 28)) >>> 0,
  d3: { ...MOTOR_3D_DEFAULTS },
  mixer: 3,
  device: 1,
  sampleRate: 1,
  pRatio: 2,
  log: null as Uint8Array | null,
  used: 0,
  eraseUntil: 0,
  osd: demoOsd(),
  canvasHd: false,
};

function flash(): { log: Uint8Array; erasing: boolean } {
  const now = Date.now();
  if (st.eraseUntil && now >= st.eraseUntil) {
    st.eraseUntil = 0;
    st.log = new Uint8Array(0);
    st.used = 0;
  }
  if (!st.log) {
    st.log = buildDemoBbl();
    st.used = st.log.length;
  }
  return { log: st.log, erasing: st.eraseUntil > 0 };
}

const dv = (n: number) => {
  const b = new Uint8Array(n);
  return { b, v: new DataView(b.buffer) };
};

/** MSP responses for commands owned by these tabs, or null when the command is not ours. */
export function demoMsp(cmd: number, payload: Uint8Array | undefined, cfg: DemoCfgRef, t: number): Uint8Array | null {
  const p = payload ?? new Uint8Array(0);
  switch (cmd) {
    case MSPM.ADVANCED_CONFIG: {
      const { b, v } = dv(20);
      b[0] = 1;
      b[1] = cfg.pidDenom;
      b[3] = cfg.protocol;
      v.setUint16(4, st.pwmRate, true);
      v.setUint16(6, Math.round(st.idle * 100), true);
      b[9] = cfg.bidir ? 1 : 0;
      b[11] = 0;
      v.setUint16(13, 125, true);
      b[18] = st.debug;
      b[19] = 90;
      return b;
    }
    case MSPM.SET_ADVANCED_CONFIG:
      if (p.length >= 19) {
        const pv = new DataView(p.buffer, p.byteOffset, p.byteLength);
        cfg.pidDenom = p[1]!;
        cfg.protocol = p[3]!;
        st.pwmRate = pv.getUint16(4, true);
        st.idle = pv.getUint16(6, true) / 100;
        st.debug = p[18]!;
      }
      return new Uint8Array(0);
    case MSPM.MOTOR_CONFIG: {
      const { b, v } = dv(10);
      v.setUint16(0, 1070, true);
      v.setUint16(2, 2000, true);
      v.setUint16(4, 1000, true);
      b[6] = 4;
      b[7] = cfg.poles;
      b[8] = cfg.bidir ? 1 : 0;
      b[9] = featureOn(st.features, MOTOR_FEATURE.ESC_SENSOR) ? 1 : 0;
      return b;
    }
    case MSPM.SET_MOTOR_CONFIG:
      if (p.length >= 8) {
        cfg.poles = p[6]!;
        cfg.bidir = p[7] === 1;
      }
      return new Uint8Array(0);
    case MSPM.MIXER_CONFIG:
      return Uint8Array.of(st.mixer, st.reversed ? 1 : 0);
    case MSPM.SET_MIXER_CONFIG:
      if (p.length >= 2) {
        st.mixer = p[0]!;
        st.reversed = p[1] === 1;
      }
      return new Uint8Array(0);
    case MSPM.MOTOR_TELEMETRY: {
      const on = featureOn(st.features, MOTOR_FEATURE.ESC_SENSOR) || cfg.bidir;
      const base = [62, 71, 58, 66];
      return encodeMotorTelemetry(
        base.map((pct, i) => {
          if (!on) return { rpm: 0, invalidPct: 0, tempC: 0, voltage: 0, current: 0, mah: 0 };
          const thr = pct + Math.sin(t * 1.7 + i) * 1.4;
          return {
            rpm: Math.round(2400 + thr * 330 + Math.sin(t * 5 + i) * 90),
            invalidPct: i === 2 ? 0.8 + Math.abs(Math.sin(t)) * 0.4 : Math.abs(Math.sin(t + i)) * 0.15,
            tempC: 38 + i * 2 + (i === 1 ? 5 : 0),
            voltage: 24.9 - thr * 0.004,
            current: thr * 0.052,
            mah: Math.round(120 + t * 3 + i * 4),
          };
        }),
      );
    }
    case MSPM.FEATURE_CONFIG: {
      const { b, v } = dv(4);
      v.setUint32(0, st.features, true);
      return b;
    }
    case MSPM.SET_FEATURE_CONFIG:
      if (p.length >= 4) st.features = new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(0, true);
      return new Uint8Array(0);
    case MSPM.MOTOR_3D_CONFIG:
      return encodeMotor3d(st.d3);
    case MSPM.SET_MOTOR_3D_CONFIG: {
      const c = decodeMotor3d(p);
      if (c) st.d3 = c;
      return new Uint8Array(0);
    }
    case MSPM.EEPROM_WRITE:
      return new Uint8Array(0);
    case MSPM.REBOOT:
      return p[0] === 2 || p[0] === 3 ? Uint8Array.of(p[0]!, 1) : Uint8Array.of(p[0] ?? 0);

    case MSPB.DATAFLASH_SUMMARY: {
      const f = flash();
      return encodeFlashSummary({ ready: !f.erasing, supported: true, sectors: TOTAL / 4096, totalSize: TOTAL, usedSize: f.erasing ? st.log!.length : st.used });
    }
    case MSPB.DATAFLASH_READ: {
      const f = flash();
      const pv = new DataView(p.buffer, p.byteOffset, p.byteLength);
      const addr = pv.getUint32(0, true);
      const len = Math.min(pv.getUint16(4, true), 8192);
      return encodeFlashReadResponse(addr, f.log.subarray(Math.min(addr, f.log.length), Math.min(addr + len, f.log.length)));
    }
    case MSPB.DATAFLASH_ERASE:
      flash();
      st.eraseUntil = Date.now() + 2500;
      return new Uint8Array(0);
    case MSPB.SDCARD_SUMMARY:
      return new Uint8Array(11);
    case MSPB.BLACKBOX_CONFIG:
      return encodeBlackboxConfigRead({ device: st.device, rateNum: 1, rateDenom: 1, pRatio: st.pRatio, sampleRate: st.sampleRate, disabledMask: 0 }, 46);
    case MSPB.SET_BLACKBOX_CONFIG: {
      if (p.length >= 6) {
        st.device = p[0]!;
        st.pRatio = p[3]! | (p[4]! << 8);
        st.sampleRate = p[5]!;
      }
      return new Uint8Array(0);
    }

    case MSPO.OSD_CONFIG:
      return encodeOsdConfig(st.osd);
    case MSPO.OSD_CANVAS:
      return Uint8Array.of(53, 20);
    case MSPO.SET_OSD_CONFIG: {
      const o = st.osd;
      if (p[0] === 0xff) {
        const pv = new DataView(p.buffer, p.byteOffset, p.byteLength);
        o.video = p[1]!;
        o.units = p[2]!;
        o.rssiAlarm = p[3]!;
        o.capAlarm = pv.getUint16(4, true);
        o.altAlarm = pv.getUint16(8, true);
        if (p.length >= 20) {
          o.warnings = pv.getUint32(12, true);
          o.profile = p[16]!;
          o.overlay = p[17]!;
          o.camW = p[18]!;
          o.camH = p[19]!;
        }
        if (p.length >= 22) o.lqAlarm = pv.getUint16(20, true);
      } else if (p[0]! < 0xfe) {
        const word = p[1]! | (p[2]! << 8);
        if (p.length >= 4 && p[3] === 0) o.stats[p[0]!] = word & 0xff;
        else o.items[p[0]!] = word;
      }
      return new Uint8Array(0);
    }
    default:
      return null;
  }
}

/* ---------------- CLI ---------------- */
const SETTINGS: Array<[string, string, string]> = [
  ['acc_calibration', '0,0,0', ''],
  ['align_board_yaw', '0', 'Allowed range: -180 - 360'],
  ['anti_gravity_gain', '80', 'Allowed range: 1 - 250'],
  ['auto_disarm_delay', '5', 'Allowed range: 0 - 60'],
  ['bat_capacity', '1300', 'Allowed range: 0 - 20000'],
  ['blackbox_device', 'SPIFLASH', 'Allowed values: NONE, SPIFLASH, SDCARD, SERIAL'],
  ['blackbox_sample_rate', '1/2', 'Allowed values: 1/1, 1/2, 1/4, 1/8, 1/16'],
  ['craft_name', '5" Freestyle', ''],
  ['d_max_gain', '37', 'Allowed range: 0 - 100'],
  ['debug_mode', 'NONE', 'Allowed values: NONE, CYCLETIME, BATTERY, GYRO_FILTERED, GYRO_SCALED, DSHOT_RPM_TELEMETRY, RPM_FILTER, CHIRP'],
  ['dshot_bidir', 'OFF', 'Allowed values: OFF, ON'],
  ['dshot_idle_value', '550', 'Allowed range: 0 - 2000'],
  ['dyn_idle_min_rpm', '0', 'Allowed range: 0 - 200'],
  ['failsafe_delay', '15', 'Allowed range: 1 - 200'],
  ['failsafe_procedure', 'DROP', 'Allowed values: AUTO-LAND, DROP, GPS-RESCUE'],
  ['feedforward_transition', '0', 'Allowed range: 0 - 100'],
  ['gyro_lpf1_dyn_min_hz', '250', 'Allowed range: 0 - 1000'],
  ['gyro_lpf1_dyn_max_hz', '500', 'Allowed range: 0 - 1000'],
  ['gyro_lpf1_static_hz', '0', 'Allowed range: 0 - 1000'],
  ['gyro_lpf2_static_hz', '500', 'Allowed range: 0 - 1000'],
  ['i_decay', '4', 'Allowed range: 1 - 10'],
  ['iterm_relax', 'RP', 'Allowed values: OFF, RP, RPY, RP_INC, RPY_INC'],
  ['osd_units', 'METRIC', 'Allowed values: IMPERIAL, METRIC'],
  ['osd_rssi_alarm', '20', 'Allowed range: 0 - 100'],
  ['osd_cap_alarm', '2200', 'Allowed range: 1 - 20000'],
  ['pid_process_denom', '1', 'Allowed range: 1 - 16'],
  ['rc_smoothing', 'ON', 'Allowed values: OFF, ON'],
  ['rpm_filter_harmonics', '3', 'Allowed range: 0 - 3'],
  ['rpm_filter_min_hz', '100', 'Allowed range: 50 - 200'],
  ['serialrx_provider', 'CRSF', 'Allowed values: SPEK1024, SPEK2048, SBUS, SUMD, SUMH, XB-B, XB-B-RJ01, IBUS, JETIEXBUS, CRSF, SRXL, CUSTOM, FPORT, SRXL2, GHST'],
  ['small_angle', '180', 'Allowed range: 0 - 180'],
  ['tpa_rate', '65', 'Allowed range: 0 - 100'],
  ['vbat_max_cell_voltage', '435', 'Allowed range: 100 - 500'],
  ['vbat_min_cell_voltage', '330', 'Allowed range: 100 - 500'],
  ['vbat_warning_cell_voltage', '350', 'Allowed range: 100 - 500'],
  ['yaw_motors_reversed', 'OFF', 'Allowed values: OFF, ON'],
];
const PROTO = ['PWM', 'ONESHOT125', 'ONESHOT42', 'MULTISHOT', 'BRUSHED', 'DSHOT150', 'DSHOT300', 'DSHOT600', 'PROSHOT1000', 'DISABLED'];

function settingLines(cfg: DemoCfgRef): string[] {
  const rows = SETTINGS.map(([n, v, a]) => [n, v, a] as [string, string, string]);
  rows.push(['motor_pwm_protocol', PROTO[cfg.protocol] ?? 'DSHOT300', 'Allowed values: PWM, ONESHOT125, ONESHOT42, MULTISHOT, BRUSHED, DSHOT150, DSHOT300, DSHOT600, PROSHOT1000, DISABLED']);
  rows.push(['motor_poles', String(cfg.poles), 'Allowed range: 4 - 255']);
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return rows.map(([n, v, a]) => `${n} = ${n === 'dshot_bidir' ? (cfg.bidir ? 'ON' : 'OFF') : v}${a ? '\n' + a : ''}`);
}

/** CLI output for read-only commands, or null when the command is not handled here. */
export function demoCli(cmd: string, cfg: DemoCfgRef): string | null {
  const c = cmd.trim();
  const low = c.toLowerCase();
  if (low === 'version') return '# Betaflight / STM32F405 (S405) 4.5.1 Jan  8 2025 / 10:23:01 (77d01ba3b) MSP API: 1.46';
  if (low === 'status') return ['MCU F405 Clock=168MHz, Vref=3.30V, Core temp=38degC', 'Stack size: 2048, Stack address: 0x10010000', 'Config size: 3480, Max available config: 16384', 'Gyros detected: gyro 1 locked dma', 'GYRO=ICM42688P, ACC=ICM42688P, BARO=DPS310', 'OSD: MAX7456 (30 x 16)', 'System Uptime: 214 seconds, Current Time: 2026-11-16T10:00:00.000+00:00', 'CPU:14%, cycle time: 125, GYRO rate: 8000, RX rate: 250, System rate: 9', 'Arming disable flags: none'].join('\n');
  if (low === 'help') return 'Available commands:\n  adjrange  aux  beeper  bl  defaults  diff  dump  exit  feature  get  help  map  mixer  motor  name  profile  rateprofile  resource  save  serial  set  status  version';
  if (low === 'get' || low.startsWith('get ')) {
    const q = low.slice(3).trim();
    const lines = settingLines(cfg).filter((l) => l.split(' = ')[0]!.includes(q));
    return lines.length ? lines.join('\n') : 'Invalid name';
  }
  // the Autotune PID tab writes slider changes followed by this command
  if (low === 'simplified_tuning apply') return 'Applied simplified tuning.';
  if (low === 'dump' || low === 'dump all') return ['# dump', '', '# version', '# Betaflight / STM32F405 (S405) 4.5.1 Jan  8 2025 / 10:23:01 (77d01ba3b) MSP API: 1.46', '', '# name: 5" Freestyle', '', '# feature', 'feature -RX_PARALLEL_PWM', 'feature TELEMETRY', 'feature OSD', '', '# master', ...settingLines(cfg).map((l) => 'set ' + l.split('\n')[0]!)].join('\n');
  return null;
}
