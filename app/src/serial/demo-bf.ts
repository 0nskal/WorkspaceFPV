/**
 * Demo responses for the Betaflight core tabs (BF 4.5.1, API 1.46, SpeedyBee F405 V4, 6S, ELRS on UART2 CRSF, Bluejay ESC).
 * SET commands write into the stored GET payloads (the demo's "RAM"), so a save + re-read shows the new values.
 * Hooked into DemoLink.request() with one line; returns undefined for commands it does not know.
 */
import { demoUsbOnly } from './demo-power';
import { Wr } from '../bf/codec';
import { C, TEXT } from '../bf/codes';
import { FEATURE, SERIAL_FN } from '../bf/decode';

/** The fields of the demo's CLI-backed config that MSP_ADVANCED_CONFIG / MSP_MOTOR_CONFIG expose. */
export interface DemoCfgRef {
  protocol: number;
  bidir: boolean;
  pidDenom: number;
  poles: number;
}

const bit = (n: number) => 1 << n;

/** Set command -> the GET command whose stored payload it replaces (identical layouts). */
const SET_TO_GET: Record<number, number> = {
  [C.SET_FEATURE_CONFIG]: C.FEATURE_CONFIG,
  [C.SET_BATTERY_CONFIG]: C.BATTERY_CONFIG,
  [C.SET_BOARD_ALIGNMENT_CONFIG]: C.BOARD_ALIGNMENT_CONFIG,
  [C.SET_MIXER_CONFIG]: C.MIXER_CONFIG,
  [C.SET_ARMING_CONFIG]: C.ARMING_CONFIG,
  [C.SET_FAILSAFE_CONFIG]: C.FAILSAFE_CONFIG,
  [C.SET_BEEPER_CONFIG]: C.BEEPER_CONFIG,
  [C.SET_ACC_TRIM]: C.ACC_TRIM,
  [C.SET_GPS_CONFIG]: C.GPS_CONFIG,
  [C.COMMON_SET_SERIAL_CONFIG]: C.COMMON_SERIAL_CONFIG,
};

export class DemoBf {
  private armDisabled = false;
  private store = new Map<number, Uint8Array>();
  private craft = '5" Freestyle';
  private pilot = 'OSKAR';

  constructor(
    private cfg: () => DemoCfgRef,
    /** Optional source of active modes and profile indices (the tuning/modes demo state). */
    private modes?: (t: number) => { modeFlags: number; pidProfile: number; rateProfile: number },
  ) {
    this.defaults();
  }

  get craftName(): string {
    return this.craft;
  }

  private defaults(): void {
    const s = this.store;
    s.set(C.FEATURE_CONFIG, new Wr().u32((bit(FEATURE.RX_SERIAL) | bit(FEATURE.GPS) | bit(FEATURE.TELEMETRY) | bit(FEATURE.LED_STRIP) | bit(FEATURE.OSD) | bit(FEATURE.AIRMODE) | bit(FEATURE.ANTI_GRAVITY)) >>> 0).done());
    s.set(C.MIXER_CONFIG, Uint8Array.of(3, 0)); // QUAD X, props in
    s.set(C.ARMING_CONFIG, Uint8Array.of(5, 0, 25));
    s.set(C.SENSOR_CONFIG, Uint8Array.of(0, 0, 0, 0));
    s.set(C.SENSOR_CONFIG_ACTIVE, Uint8Array.of(15, 15, 7, 3, 255));
    s.set(C.SENSOR_ALIGNMENT, Uint8Array.of(0, 0, 0, 1));
    s.set(C.GPS_CONFIG, Uint8Array.of(1, 1, 1, 1, 1, 1)); // UBLOX, EGNOS, auto config, auto baud, home point once, Galileo
    s.set(C.ACC_TRIM, new Wr().s16(0).s16(0).done());
    s.set(C.BOARD_ALIGNMENT_CONFIG, new Wr().s16(0).s16(0).s16(0).done());
    s.set(C.BEEPER_CONFIG, new Wr().u32(0).u8(1).u32(0).done());
    s.set(C.RX_CONFIG, new Wr().u8(9).u16(1900).u16(1500).u16(1050).u8(0).u16(885).u16(2115).u8(0).u8(0).u16(1250).bytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).done());
    s.set(C.FAILSAFE_CONFIG, new Wr().u8(15).u8(10).u16(1000).u8(0).u16(100).u8(0).done());
    const rxfail = new Wr();
    for (let i = 0; i < 16; i++) {
      if (i === 3) rxfail.u8(0).u16(1000); // throttle (internal order: roll, pitch, yaw, throttle)
      else if (i === 4) rxfail.u8(2).u16(1000); // AUX1 (arm) -> disarm on failsafe
      else if (i < 4) rxfail.u8(0).u16(1500);
      else rxfail.u8(1).u16(1500);
    }
    s.set(C.RXFAIL_CONFIG, rxfail.done());
    s.set(C.BATTERY_CONFIG, new Wr().u8(33).u8(44).u8(35).u16(1300).u8(1).u8(1).u16(330).u16(435).u16(350).done());
    s.set(C.VOLTAGE_METER_CONFIG, Uint8Array.of(1, 5, 10, 1, 110, 10, 1));
    s.set(C.CURRENT_METER_CONFIG, new Wr().u8(1).u8(6).u8(10).u8(1).s16(400).s16(0).done());
    // MSP2_COMMON_SERIAL_CONFIG: USB VCP, UART1 (Bluetooth MSP), UART2 (ELRS, CRSF), UART3 (DJI/VTX MSP), UART4 (ESC telemetry), UART5 (GPS), UART6 (free)
    const port = (w: Wr, id: number, mask: number, msp = 5, gps = 0, tel = 5, bb = 5) => w.u8(id).u32(mask).u8(msp).u8(gps).u8(tel).u8(bb);
    const sp = new Wr().u8(7);
    port(sp, 20, SERIAL_FN.MSP);
    port(sp, 0, SERIAL_FN.MSP);
    port(sp, 1, SERIAL_FN.RX_SERIAL);
    port(sp, 2, SERIAL_FN.MSP, 5);
    port(sp, 3, 0);
    port(sp, 4, SERIAL_FN.GPS, 5, 0);
    port(sp, 5, 0);
    s.set(C.COMMON_SERIAL_CONFIG, sp.done());
    s.set(C.ADVANCED_CONFIG, new Uint8Array(20));
  }

  /** The 20-byte MSP_ADVANCED_CONFIG built from the demo's CLI-backed config plus stored fields. */
  private advanced(): Uint8Array {
    const c = this.cfg();
    const base = this.store.get(C.ADVANCED_CONFIG) ?? new Uint8Array(20);
    const w = new Uint8Array(20);
    w.set(base);
    w[0] = 1;
    w[1] = c.pidDenom;
    w[3] = c.protocol;
    w[4] = 480 & 0xff;
    w[5] = 480 >> 8;
    w[6] = 550 & 0xff;
    w[7] = 550 >> 8;
    w[9] = c.bidir ? 1 : 0;
    w[19] = 33; // debug mode count
    return w;
  }

  private motorCfg(): Uint8Array {
    const c = this.cfg();
    return new Wr().u16(1070).u16(2000).u16(1000).u8(4).u8(c.poles).u8(c.bidir ? 1 : 0).u8(0).done();
  }

  private statusEx(t: number): Uint8Array {
    // MSP + ARM_SWITCH (bit 25 on API 1.46); on USB only also RX_FAILSAFE (2) and DSHOT_TELEM (20)
    const flags = (this.armDisabled ? bit(16) | bit(25) : 0) | (demoUsbOnly() ? bit(2) | bit(20) : 0);
    const m = this.modes?.(t) ?? { modeFlags: 0, pidProfile: 0, rateProfile: 0 };
    return new Wr()
      .u16(125) // cycle time us (8 kHz)
      .u16(demoUsbOnly() ? 18 : 0) // i2c errors (unpowered external compass on USB)
      .u16(0b101111) // ACC, BARO, MAG, GPS, GYRO
      .u32(m.modeFlags) // active flight modes (first 32 boxes)
      .u8(m.pidProfile) // PID profile
      .u16(14 + Math.round(Math.sin(t) * 2)) // CPU load
      .u8(4) // PID profile count (PID_PROFILE_COUNT)
      .u8(m.rateProfile) // rate profile
      .u8(0) // extra flight-mode bytes
      .u8(26) // arming flag count
      .u32(flags >>> 0)
      .u8(0) // config state
      .u16(41) // MCU temperature
      .done();
  }

  /** Simulated flight: the quad hovers in a park and circles slowly (about 18 m east-west, 12 m north-south) around its home point. */
  private fly(t: number): { east: number; north: number; courseDeg: number; speedCms: number } {
    const w = 0.15;
    const east = 18 * Math.sin(w * t);
    const north = 12 * Math.cos(w * t);
    const ve = 18 * w * Math.cos(w * t);
    const vn = -12 * w * Math.sin(w * t);
    return { east, north, courseDeg: (((Math.atan2(ve, vn) * 180) / Math.PI) + 360) % 360, speedCms: Math.round(Math.hypot(ve, vn) * 100) };
  }

  private rawGps(t: number): Uint8Array {
    const f = this.fly(t);
    const lat0 = 52.215;
    const lon0 = 21.035;
    const lat = lat0 + f.north / 111320;
    const lon = lon0 + f.east / (111320 * Math.cos((lat0 * Math.PI) / 180));
    const sats = this.sats(t).filter((c) => (c[2] & 8) !== 0).length;
    return new Wr().u8(2).u8(sats).u32(Math.round(lat * 1e7) >>> 0).u32(Math.round(lon * 1e7) >>> 0).u16(112).u16(f.speedCms).u16(Math.round(f.courseDeg * 10)).u16(Math.round(97 + Math.sin(t * 0.3) * 6)).done();
  }

  private compGps(t: number): Uint8Array {
    const f = this.fly(t);
    const dist = Math.hypot(f.east, f.north);
    const toHome = ((Math.atan2(-f.east, -f.north) * 180) / Math.PI + 360) % 360;
    return new Wr().u16(Math.round(dist)).u16(Math.round(toHome)).u8(1).done();
  }

  /** [gnss id, sat id, quality (low 3 bits) | used flag (8), C/N0 dB-Hz] for a mixed GPS/SBAS/Galileo/Glonass/BeiDou sky: 12 used, the rest searching or unusable. */
  private sats(t: number): Array<[number, number, number, number]> {
    const wob = (i: number, base: number) => Math.max(0, Math.round(base + Math.sin(t * 0.7 + i * 1.9) * 3));
    const rows: Array<[number, number, number, number]> = [];
    const add = (gnss: number, svid: number, q: number, used: boolean, cno: number) => rows.push([gnss, svid, q | (used ? 8 : 0), wob(rows.length, cno)]);
    add(0, 1, 3, false, 18);
    for (const [id, cno] of [[2, 38], [10, 42], [15, 36], [18, 40], [23, 45], [26, 39]] as const) add(0, id, 5, true, cno);
    add(1, 123, 3, false, 24);
    add(1, 136, 5, true, 34);
    add(2, 1, 1, false, 0);
    add(2, 15, 5, true, 37);
    add(6, 2, 4, false, 22);
    for (const [id, cno] of [[3, 35], [4, 33]] as const) add(6, id, 5, true, cno);
    add(6, 9, 4, false, 25);
    add(6, 10, 1, false, 0);
    add(6, 16, 5, true, 31);
    add(3, 6, 5, true, 30);
    add(3, 12, 5, true, 32);
    add(2, 24, 5, true, 41);
    add(6, 18, 4, false, 26);
    return rows;
  }

  private svInfo(t: number): Uint8Array {
    const rows = this.sats(t);
    const w = new Wr().u8(rows.length);
    for (const [g, id, q, c] of rows) w.u8(g).u8(id).u8(q).u8(c);
    return w.done();
  }

  /** Returns the demo reply for commands it owns, or undefined to let DemoLink handle (or reject) the command. */
  handle(cmd: number, payload: Uint8Array | undefined, t: number): Uint8Array | undefined {
    const p = payload ?? new Uint8Array(0);
    const setTarget = SET_TO_GET[cmd];
    if (setTarget !== undefined) {
      this.store.set(setTarget, p.slice());
      return new Uint8Array(0);
    }
    switch (cmd) {
      case C.BUILD_INFO:
        return new Wr().bytes([...'Jan  8 2025'].map((c) => c.charCodeAt(0))).bytes([...'10:23:01'].map((c) => c.charCodeAt(0))).bytes([...'77d01ba'].map((c) => c.charCodeAt(0))).u16(5).u16(7).u16(0).done();
      case C.BOARD_INFO:
        return new Wr()
          .bytes([...'S405'].map((c) => c.charCodeAt(0)))
          .u16(0) // hardware revision
          .u8(2) // board type: FC with MAX7456
          .u8(1 | 4 | 16 | 32) // VCP, unified target, supports + has custom defaults
          .pstr('SPEEDYBEEF405V4')
          .pstr('SPEEDYBEEF405V4')
          .pstr('SPBE')
          .bytes(new Array<number>(32).fill(0))
          .u8(3) // MCU type id
          .u8(2) // configured
          .u16(8000) // gyro sample rate
          .u32(0) // configuration problems
          .u8(3)
          .u8(1)
          .done();
      case C.STATUS_EX:
        return this.statusEx(t);
      case C.UID:
        return new Wr().u32(0x003a0021).u32(0x5137500c).u32(0x20383754).done();
      case C.GET_TEXT: {
        const type = p[0] ?? 0;
        const text = type === TEXT.CRAFT ? this.craft : type === TEXT.PILOT ? this.pilot : type === TEXT.PID_PROFILE ? 'FREESTYLE' : type === TEXT.RATE_PROFILE ? 'ACTUAL' : '';
        return new Wr().u8(type).pstr(text).done();
      }
      case C.SET_TEXT: {
        const type = p[0] ?? 0;
        const len = p[1] ?? 0;
        const text = String.fromCharCode(...p.subarray(2, 2 + len));
        if (type === TEXT.CRAFT) this.craft = text;
        else if (type === TEXT.PILOT) this.pilot = text;
        return new Uint8Array(0);
      }
      case C.SET_NAME:
        this.craft = String.fromCharCode(...p);
        return new Uint8Array(0);
      case C.NAME:
        return Uint8Array.from([...this.craft].map((c) => c.charCodeAt(0)));
      case C.ADVANCED_CONFIG:
        return this.advanced();
      case C.SET_ADVANCED_CONFIG: {
        const c = this.cfg();
        c.pidDenom = p[1] ?? c.pidDenom;
        c.protocol = p[3] ?? c.protocol;
        c.bidir = (p[9] ?? 0) === 1;
        this.store.set(C.ADVANCED_CONFIG, p.slice());
        return new Uint8Array(0);
      }
      case C.MOTOR_CONFIG:
        return this.motorCfg();
      case C.SET_RXFAIL_CONFIG: {
        const cur = this.store.get(C.RXFAIL_CONFIG);
        if (cur && p.length >= 4) {
          const o = p[0] * 3;
          cur[o] = p[1];
          cur[o + 1] = p[2];
          cur[o + 2] = p[3];
        }
        return new Uint8Array(0);
      }
      case C.SET_VOLTAGE_METER_CONFIG: {
        const cur = this.store.get(C.VOLTAGE_METER_CONFIG);
        if (cur && p.length >= 4) {
          cur[4] = p[1]; // scale
          cur[5] = p[2]; // divider value
          cur[6] = p[3]; // multiplier
        }
        return new Uint8Array(0);
      }
      case C.SET_CURRENT_METER_CONFIG: {
        const cur = this.store.get(C.CURRENT_METER_CONFIG);
        if (cur && p.length >= 5) cur.set(p.subarray(1, 5), 4);
        return new Uint8Array(0);
      }
      case C.BATTERY_STATE:
        return demoUsbOnly() ? new Wr().u8(0).u16(1300).u8(0).u16(0).s16(0).u8(0).u16(0).done() : new Wr().u8(6).u16(1300).u8(249).u16(0).s16(0).u8(0).u16(2490).done();
      case C.VOLTAGE_METERS:
        return Uint8Array.of(10, 249);
      case C.CURRENT_METERS:
        return new Wr().u8(10).u16(0).u16(0).done();
      case C.ATTITUDE:
        return new Wr().s16(Math.round(Math.sin(t * 0.9) * 120 + 6)).s16(Math.round(Math.cos(t * 0.7) * 90 - 4)).s16(Math.round((t * 12) % 360)).done();
      case C.SET_SENSOR_CONFIG: {
        const cur = this.store.get(C.SENSOR_CONFIG);
        if (cur) cur.set(p.subarray(0, 3), 0);
        return new Uint8Array(0);
      }
      case C.RAW_GPS:
        return this.rawGps(t);
      case C.COMP_GPS:
        return this.compGps(t);
      case C.GPS_SV_INFO:
        return this.svInfo(t);
      case C.COMPASS_CONFIG:
        return new Wr().s16(68).done(); // +6.8 deg declination
      case C.ALTITUDE:
        return new Wr().u32(Math.round(Math.sin(t * 0.4) * 35) >>> 0).s16(Math.round(Math.cos(t * 0.4) * 14)).done();
      case C.SET_ARMING_DISABLED:
        this.armDisabled = (p[0] ?? 0) === 1;
        return new Uint8Array(0);
      case C.ACC_CALIBRATION:
      case C.MAG_CALIBRATION:
      case C.EEPROM_WRITE:
        return new Uint8Array(0);
      case C.REBOOT:
        return Uint8Array.of(p[0] ?? 0);
      case C.RESET_CONF:
        this.store.clear();
        this.defaults();
        this.craft = 'BTFL';
        this.pilot = '';
        return Uint8Array.of(1);
      default:
        return this.store.get(cmd);
    }
  }
}
