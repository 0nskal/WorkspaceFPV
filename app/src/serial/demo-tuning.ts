/**
 * Demo responses for the tuning / receiver / modes tabs (BF 4.5.1, API 1.46, SpeedyBee F405 V4, ELRS on UART2 CRSF).
 * Writes (SET_*) are kept in memory for the demo session so "save" and profile switching behave like a real FC.
 * Hooked into DemoLink.request() with one line; returns null for commands it does not own.
 */
import { encodeRc, encodeRxMap } from '../bf/receiver';
import { activeModeIds, flagsFromActiveIds, type ModeRange } from '../bf/modes';

const BOXES: [id: number, name: string][] = [
  [0, 'ARM'],
  [1, 'ANGLE'],
  [2, 'HORIZON'],
  [4, 'ANTI GRAVITY'],
  [13, 'BEEPER'],
  [19, 'OSD DISABLE'],
  [26, 'BLACKBOX'],
  [28, 'AIR MODE'],
  [35, 'FLIP OVER AFTER CRASH'],
  [36, 'PREARM'],
  [39, 'VTX PIT MODE'],
];
const BOX_IDS = BOXES.map((b) => b[0]);

const R = (slot: number, id: number, aux: number, loUs: number, hiUs: number): ModeRange => ({
  slot,
  id,
  aux,
  start: Math.round((loUs - 900) / 25),
  end: Math.round((hiUs - 900) / 25),
  logic: 0,
  linkedTo: 0,
});

function u16le(buf: Uint8Array, off: number, v: number): void {
  buf[off] = v & 255;
  buf[off + 1] = (v >> 8) & 255;
}

function makePid(k: number): Uint8Array {
  const base = [48, 82, 38, 52, 88, 42, 45, 90, 3, 50, 75, 0, 40, 0, 0];
  const delta = [0, 4, -4, 8][k]!;
  return Uint8Array.from(base.map((v, i) => (i < 9 && i % 3 !== 1 ? Math.max(0, v + delta) : v)));
}

function makeAdv(k: number): Uint8Array {
  const b = new Uint8Array(61);
  b[8] = 0; // ff transition
  u16le(b, 13, 0);
  u16le(b, 15, 0);
  b[17] = 60; // angle limit
  u16le(b, 21, 80); // anti gravity
  b[25] = 1; // iterm rotation
  b[27] = 1; // iterm relax RP
  b[28] = 1; // setpoint
  b[30] = 5; // throttle boost
  b[31] = 20;
  u16le(b, 32, 120 + k * 5);
  u16le(b, 34, 125 + k * 5);
  u16le(b, 36, 120 + k * 5);
  b[39] = 40;
  b[40] = 46;
  b[41] = 0;
  b[42] = 37;
  b[43] = 20;
  b[46] = 15;
  b[47] = 100;
  b[50] = 0;
  b[51] = 25;
  b[52] = 15;
  b[53] = 100;
  b[54] = 7;
  b[57] = 0; // TPA mode PD
  b[58] = 65;
  u16le(b, 59, 1350);
  return b;
}

/** type: 0 Betaflight, 3 Actual, 4 Quick; values as stored in MSP_RC_TUNING. */
function makeRc(type: number): Uint8Array {
  const b = new Uint8Array(24);
  const set = (rc: number[], ex: number[], sr: number[]) => {
    b[0] = rc[0]!; b[12] = rc[1]!; b[11] = rc[2]!;
    b[1] = ex[0]!; b[13] = ex[1]!; b[10] = ex[2]!;
    b[2] = sr[0]!; b[3] = sr[1]!; b[4] = sr[2]!;
  };
  if (type === 3) set([14, 14, 12], [20, 20, 15], [70, 70, 60]);
  else if (type === 4) set([45, 45, 40], [20, 20, 15], [80, 80, 70]);
  else set([100, 100, 100], [10, 10, 0], [70, 70, 70]);
  b[6] = 50;
  b[7] = 0;
  b[15] = 100; // throttle_limit_percent (firmware default)
  u16le(b, 16, 1998);
  u16le(b, 18, 1998);
  u16le(b, 20, 1998);
  b[22] = type;
  b[23] = 37;
  return b;
}

function makeFilter(): Uint8Array {
  const b = new Uint8Array(49);
  b[0] = 0;
  u16le(b, 1, 75); // dterm lpf1 static
  u16le(b, 3, 100); // yaw lpf
  b[17] = 0; // dterm lpf1 PT1
  u16le(b, 20, 0); // gyro lpf1 static (dynamic in use)
  u16le(b, 22, 500); // gyro lpf2
  b[24] = 0;
  b[25] = 0;
  u16le(b, 26, 150); // dterm lpf2
  b[28] = 0;
  u16le(b, 29, 250);
  u16le(b, 31, 500);
  u16le(b, 33, 75);
  u16le(b, 35, 150);
  u16le(b, 39, 300);
  u16le(b, 41, 100);
  b[43] = 0; // RPM filter off (bidirectional DShot is off in the demo)
  b[44] = 100;
  u16le(b, 45, 600);
  b[47] = 5;
  b[48] = 3;
  return b;
}

function makeRxConfig(): Uint8Array {
  const b = new Uint8Array(39);
  b[0] = 9; // CRSF
  u16le(b, 1, 1900);
  u16le(b, 3, 1500);
  u16le(b, 5, 1050);
  u16le(b, 8, 885);
  u16le(b, 10, 2115);
  u16le(b, 14, 1250);
  b[22] = 0;
  b[25] = 0; // setpoint cutoff: auto
  b[26] = 0;
  b[30] = 30;
  b[31] = 1;
  return b;
}

const st = {
  pidProfile: 0,
  rateProfile: 0,
  pid: [makePid(0), makePid(1), makePid(2), makePid(3)],
  adv: [makeAdv(0), makeAdv(1), makeAdv(2), makeAdv(3)],
  rc: [makeRc(3), makeRc(0), makeRc(4), makeRc(0)],
  filter: makeFilter(),
  rx: makeRxConfig(),
  rxMap: Uint8Array.from([0, 1, 3, 2, 4, 5, 6, 7]) as Uint8Array,
  deadband: Uint8Array.from([0, 0, 40, 0x32, 0x00]),
  rssi: 0,
  ranges: [R(0, 0, 0, 1700, 2100), R(1, 28, 0, 1700, 2100), R(2, 26, 0, 1700, 2100), R(3, 1, 1, 1700, 2100), R(4, 2, 1, 1300, 1700), R(5, 13, 2, 1700, 2100), R(6, 35, 3, 1700, 2100)] as ModeRange[],
};

const SLOTS = 20;
const enc = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

function rcChannels(t: number): number[] {
  const wave = (f: number, ph = 0) => Math.sin(t * f + ph);
  const stick = (v: number) => Math.round(1500 + v * 500);
  const ch = new Array<number>(16).fill(1000);
  const [a, e, r, th] = [stick(wave(0.9) * 0.42), stick(wave(0.7, 1) * 0.35), stick(wave(0.45, 2) * 0.5), Math.round(1000 + (0.5 + 0.35 * wave(0.3, 0.5)) * 1000)];
  // AETR: roll, pitch, throttle, yaw by channel index (rx map 0,1,3,2)
  ch[st.rxMap[0]!] = a;
  ch[st.rxMap[1]!] = e;
  ch[st.rxMap[2]!] = r;
  ch[st.rxMap[3]!] = th;
  ch[4] = 1000; // AUX1 (arm switch) disarmed
  const tri = Math.abs(((t / 7) % 2) - 1); // slow 0..1..0 sweep of AUX2
  ch[5] = Math.round(1000 + tri * 1000);
  ch[6] = 1000;
  ch[7] = 1000;
  ch[14] = Math.round(1000 + Math.min(100, 97 + wave(1.3) * 2.5) * 10); // LQ %
  ch[15] = Math.round(1000 + (0.83 + wave(0.8) * 0.04) * 1000); // RSSI
  return ch;
}

/** Active flight-mode flags and profile indices for the core's MSP_STATUS_EX reply (demo-bf.ts). */
export function demoStatusModes(t: number): { modeFlags: number; pidProfile: number; rateProfile: number } {
  const flags = flagsFromActiveIds(BOX_IDS, activeModeIds(st.ranges, rcChannels(t)));
  return { modeFlags: flags >>> 0, pidProfile: st.pidProfile, rateProfile: st.rateProfile };
}

export function demoTuning(cmd: number, payload: Uint8Array | undefined, t: number): Uint8Array | null {
  const p = payload ?? new Uint8Array(0);
  const none = new Uint8Array(0);
  switch (cmd) {
    case 44:
      return st.rx.slice();
    case 45:
      st.rx = p.slice();
      return none;
    case 50:
      return Uint8Array.from([st.rssi]);
    case 51:
      st.rssi = p[0] ?? 0;
      return none;
    case 64:
      return st.rxMap.slice();
    case 65:
      st.rxMap = encodeRxMap(Array.from(p), st.rxMap);
      return none;
    case 68:
      return Uint8Array.from([0]);
    case 92:
      return st.filter.slice();
    case 93:
      st.filter = p.slice();
      return none;
    case 94:
      return st.adv[st.pidProfile]!.slice();
    case 95:
      st.adv[st.pidProfile] = p.slice();
      return none;
    case 105:
      return encodeRc(rcChannels(t));
    case 111:
      return st.rc[st.rateProfile]!.slice();
    case 204:
      st.rc[st.rateProfile] = p.slice();
      return none;
    case 112:
      return st.pid[st.pidProfile]!.slice();
    case 202:
      st.pid[st.pidProfile] = p.slice();
      return none;
    case 116:
      return enc(BOXES.map((b) => b[1]).join(';') + ';');
    case 119:
      return Uint8Array.from(BOX_IDS);
    case 125:
      return st.deadband.slice();
    case 218:
      st.deadband = p.slice();
      return none;
    case 210: {
      const v = p[0] ?? 0;
      if (v & 0x80) st.rateProfile = Math.min(3, v & 0x7f);
      else st.pidProfile = Math.min(3, v);
      return none;
    }
    case 34: {
      const b = new Uint8Array(SLOTS * 4);
      st.ranges.forEach((r) => b.set([r.id, r.aux, r.start, r.end], r.slot * 4));
      return b;
    }
    case 238: {
      const b = new Uint8Array(1 + SLOTS * 3);
      b[0] = SLOTS;
      st.ranges.forEach((r) => b.set([r.id, r.logic, r.linkedTo], 1 + r.slot * 3));
      return b;
    }
    case 35: {
      const [slot, id, aux, start, end, logic = 0, linkedTo = 0] = p;
      if (slot === undefined || slot >= SLOTS) return none;
      const next = st.ranges.filter((r) => r.slot !== slot);
      if (start !== end) next.push({ slot, id: id!, aux: aux!, start: start!, end: end!, logic, linkedTo });
      st.ranges = next.sort((a, b) => a.slot - b.slot);
      return none;
    }
    case 250:
      return none;
    default:
      return null;
  }
}
