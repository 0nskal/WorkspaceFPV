/** Builds the Autotune flow's FcFacts from the shared stores (ctx.state + ctx.bf). Reads only; nothing is sent to the FC. */
import type { AppContext } from '../context';
import { decodeBlackboxConfig, decodeFlashSummary, decodeSdSummary, loggingRateHz } from '../bf/blackbox';
import { debugModeName } from '../bf/motors';
import { STEP, rawOf } from '../bf/steps';
import { decodeFilterConfig } from '../bf/tuning';
import { boardDisplayName, firmwareName } from '../fc/board';
import { isDshot, protocolName } from '../fc/state';
import { emptyFacts, type FcFacts } from './parts';

export function readFacts(ctx: AppContext): FcFacts {
  const s = ctx.state.get();
  const f = emptyFacts();
  f.connected = s.conn === 'connected';
  f.demo = s.mode === 'demo';
  f.armed = !!s.status?.armed;
  if (!f.connected) return f;
  const bf = ctx.bf.get();
  const api = bf.api || s.info?.apiVersion.minor || 0;
  f.api = api;
  f.firmware = s.info ? firmwareName(s.info) : null;
  f.board = s.info ? boardDisplayName(s.info) : null;
  if (s.config) {
    f.protocol = protocolName(s.config.motorPwmProtocol);
    f.dshot = isDshot(s.config.motorPwmProtocol);
    f.bidir = s.config.bidir;
    f.motorCount = s.config.motorCount;
    f.motorPoles = s.config.motorPoles;
  }
  const bs = bf.batteryState;
  f.cells = bs && bs.cells > 0 ? bs.cells : s.cells;
  f.capacityMah = bf.battery?.capacityMah || bs?.capacityMah || null;
  f.vbat = s.telemetry?.vbat ?? bs?.volts ?? null;
  f.pid = s.pid ? { roll: [...s.pid.roll], pitch: [...s.pid.pitch], yaw: [...s.pid.yaw] } : null;
  const cyc = s.status?.cycleTimeUs ?? 0;
  f.pidLoopHz = cyc > 0 ? 1e6 / cyc : null;

  const bb = rawOf(bf, STEP.bbConfig);
  if (bb) {
    const c = decodeBlackboxConfig(bb, api);
    if (c.supported) {
      f.bbDevice = c.device;
      f.bbSampleRate = c.sampleRate;
      f.bbRateHz = cyc > 0 ? loggingRateHz(cyc, c.sampleRate) : null;
      f.bbDisabledMask = api >= 45 ? c.disabledMask : null;
    }
  }
  const fl = rawOf(bf, STEP.flash);
  if (fl) {
    const x = decodeFlashSummary(fl);
    f.flash = { supported: x.supported, total: x.totalSize, used: x.usedSize };
  }
  const sd = rawOf(bf, STEP.sdcard);
  if (sd) f.sdSupported = decodeSdSummary(sd).supported;

  if (bf.advanced) {
    f.debugIndex = bf.advanced.debugMode;
    const name = debugModeName(bf.advanced.debugMode, api);
    f.debugName = name.startsWith('#') ? null : name;
  }
  const flt = rawOf(bf, STEP.filter);
  if (flt) {
    const v = decodeFilterConfig(flt, api).values;
    f.rpmHarmonics = v['rpmHarmonics'] ?? null;
    f.dynNotchCount = v['dynNotchCount'] ?? null;
    f.gyroLpf1Hz = v['gyroLpf1Hz'] ?? null;
    f.dtermLpf1Hz = v['dtermLpf1Hz'] ?? null;
  }
  f.elrs = s.hw.elrs?.version ?? null;
  return f;
}
