// Test 4-way / EEPROM / CRSF / flows. Uruchom:
//   npx esbuild app/src/bf/test-esc-elrs.mjs --bundle --platform=node --format=esm --outfile=%TEMP%/esc-elrs-test.mjs && node %TEMP%/esc-elrs-test.mjs
import assert from 'node:assert/strict';
import { crc16Xmodem, crc8D5 } from './crc.ts';
import {
  ACK, CMD, FourWayClient, FourWayError, FourWayForbiddenError, FourWayParser, FourWayRequestParser, READ_ONLY_CMDS, decodeInitFlash, encodeRequest, encodeResponse,
} from './fourway.ts';
import { am32FileName, am32Sample, blheliSSample, bluejaySample, buildSilabs, garbageSample } from './esc-samples.ts';
import { decodeAm32, decodeSilabs, eepromLocation, mcuFromSignature, supportsBidir } from './esc-eeprom.ts';
import { CRSF, CrsfParser, buildDeviceInfo, buildFrame, buildLinkStats, buildPing, parseDeviceInfo } from './crsf.ts';
import { Msp2Parser, decodeSerialConfig, encodeMspV2, encodeMspV2Response, encodeSerialConfig } from './msp2.ts';
import { RawBuffer } from './raw-buffer.ts';
import { readEscInfo, EscFlowError } from './esc-flow.ts';
import { readElrsInfo, assertAllowedCli, passthroughCommand } from './elrs-flow.ts';
import { DemoRawDevice, demoEscs } from '../serial/demo-escelrs.ts';

let fails = 0;
function check(name, ok, info = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) fails++;
}
async function t(name, fn) {
  try {
    await fn();
    check(name, true);
  } catch (e) {
    check(name, false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  }
}
const hexs = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join(' ');
const noSleep = () => Promise.resolve();

/* ---------------- CRC ---------------- */
await t('CRC-16/XMODEM check value 0x31C3', () => assert.equal(crc16Xmodem(new TextEncoder().encode('123456789')), 0x31c3));
await t('CRC-8 poly 0xD5 check value (DVB-S2) 0xBC', () => assert.equal(crc8D5(new TextEncoder().encode('123456789')), 0xbc));
await t('CRC-8 D5 of ping body = 0x5A (spec)', () => assert.equal(crc8D5([0x28, 0xec, 0xc8]), 0x5a));

/* ---------------- 4-way frames ---------------- */
await t('4-way request: layout, dummy param, CRC big-endian', () => {
  const f = encodeRequest(CMD.TEST_ALIVE);
  assert.equal(f[0], 0x2f);
  assert.equal(f[1], 0x30);
  assert.equal(f[4], 1); // paramLen 1, never 0
  assert.equal(f.length, 8);
  const crc = crc16Xmodem(f.subarray(0, 6));
  assert.equal((f[6] << 8) | f[7], crc);
});
await t('4-way request/response round trip incl. addr and data', () => {
  const req = new FourWayRequestParser().push(encodeRequest(CMD.DEVICE_READ, [0x70], 0x1a00));
  assert.equal(req.length, 1);
  assert.deepEqual([req[0].cmd, req[0].addr, req[0].param[0], req[0].crcOk], [CMD.DEVICE_READ, 0x1a00, 0x70, true]);
  const data = Uint8Array.from({ length: 0x70 }, (_, i) => i);
  const rsp = new FourWayParser().push(encodeResponse(CMD.DEVICE_READ, 0x1a00, data, ACK.OK));
  assert.equal(rsp.length, 1);
  assert.deepEqual([rsp[0].cmd, rsp[0].addr, rsp[0].ack, rsp[0].data.length], [CMD.DEVICE_READ, 0x1a00, 0, 0x70]);
  assert.deepEqual(Array.from(rsp[0].data), Array.from(data));
});
await t('4-way response: 256 data bytes use outLen 0', () => {
  const d = new Uint8Array(256).fill(7);
  const f = encodeResponse(CMD.DEVICE_READ, 0, d, 0);
  assert.equal(f[4], 0);
  const r = new FourWayParser().push(f);
  assert.equal(r[0].data.length, 256);
});
await t('4-way parser: bad CRC dropped, garbage resync, split delivery', () => {
  const good = encodeResponse(CMD.INTERFACE_GET_NAME, 0, [1, 2, 3], 0);
  const bad = good.slice();
  bad[bad.length - 1] ^= 0xff;
  const p = new FourWayParser();
  assert.equal(p.push(bad).length, 0);
  const noise = Uint8Array.from([0x00, 0x2e, 0x99, 0x13, ...good]);
  const q = new FourWayParser();
  const a = q.push(noise.subarray(0, 6));
  const b = q.push(noise.subarray(6));
  assert.equal(a.length + b.length, 1);
});
await t('4-way ACK CRC error reported (request with wrong CRC -> ack 0x03)', () => {
  const rsp = new FourWayParser().push(encodeResponse(0x30, 0, [0], ACK.INVALID_CRC));
  assert.equal(rsp[0].ack, 0x03);
});
await t('4-way allow-list: write/erase/mode/verify commands refused before anything is sent', () => {
  for (const c of [CMD.DEVICE_ERASE_ALL, CMD.DEVICE_PAGE_ERASE, CMD.DEVICE_WRITE, CMD.DEVICE_C2CK_LOW, CMD.DEVICE_READ_EEPROM, CMD.DEVICE_WRITE_EEPROM, CMD.INTERFACE_SET_MODE, CMD.DEVICE_VERIFY, 0x00, 0xff]) {
    assert.throws(() => encodeRequest(c), FourWayForbiddenError, `cmd ${c.toString(16)}`);
  }
  assert.equal(READ_ONLY_CMDS.size, 8);
});
await t('4-way client: refuses forbidden command without writing', async () => {
  let wrote = 0;
  const io = { write: async () => void wrote++, readSome: async () => new Uint8Array(0), clear() {} };
  const c = new FourWayClient(io);
  await assert.rejects(() => c.call(CMD.DEVICE_WRITE, [1], 0), FourWayForbiddenError);
  assert.equal(wrote, 0);
});
await t('4-way client: timeout error after retries', async () => {
  let wrote = 0;
  const io = { write: async () => void wrote++, readSome: async (ms) => (await new Promise((r) => setTimeout(r, Math.min(ms, 20))), new Uint8Array(0)), clear() {} };
  const c = new FourWayClient(io, { timeoutMs: 40, attempts: 2 });
  await assert.rejects(() => c.call(CMD.TEST_ALIVE), (e) => e instanceof FourWayError && e.kind === 'timeout');
  assert.equal(wrote, 2);
});
await t('INIT_FLASH decode: signature low/high, boot byte, mode', () => {
  const i = decodeInitFlash(Uint8Array.from([0xb2, 0xe8, 0x06, 1]));
  assert.deepEqual(i, { signature: 0xe8b2, bootByte: 6, mode: 1 });
  assert.equal(decodeInitFlash(Uint8Array.from([1, 2])), null);
});

/* ---------------- EEPROM layouts ---------------- */
await t('Bluejay dump decodes (version, target, MCU string, fields)', () => {
  const s = decodeSilabs(bluejaySample());
  assert.equal(s.firmware, 'bluejay');
  assert.equal(s.firmwareName, 'Bluejay');
  assert.equal(s.version, '0.21');
  assert.equal(s.target, '#S_H_90#');
  assert.equal(s.mcuString, '#BLHELI$EFM8B21#');
  const f = Object.fromEntries(s.fields.map((x) => [x.id, x]));
  assert.equal(f.direction.value, 'normal');
  assert.equal(f.pwm.value, '48 kHz');
  assert.equal(f.timing.value, 'med');
  assert.equal(f.startupBeep.value, true);
  assert.equal(f.beaconDelay.value, 10);
  assert.equal(f.tempProtection.value, 100);
});
await t('Bluejay dynamic PWM (192) and reversed direction', () => {
  const s = decodeSilabs(buildSilabs({ main: 0, sub: 19, name: 'Bluejay', pwm: 192, direction: 2 }));
  const f = Object.fromEntries(s.fields.map((x) => [x.id, x]));
  assert.equal(f.pwm.value, 'dynamic');
  assert.equal(f.direction.value, 'reversed');
  assert.equal(s.version, '0.19');
});
await t('Bluejay patch number from NAME suffix', () => {
  const s = decodeSilabs(buildSilabs({ main: 0, sub: 21, name: 'Bluejay 0.21.1' }));
  assert.equal(s.version, '0.21.1');
});
await t('BLHeli_S dump decodes', () => {
  const s = decodeSilabs(blheliSSample());
  assert.equal(s.firmware, 'blheli_s');
  assert.equal(s.version, '16.7');
  assert.equal(s.fields.find((x) => x.id === 'pwm').value, '24 kHz');
  assert.ok(!s.fields.some((x) => x.id === 'dithering'));
});
await t('BLHeli_M (empty name, 16.8) recognised', () => {
  assert.equal(decodeSilabs(buildSilabs({ main: 16, sub: 8, name: '' })).firmware, 'blheli_m');
});
await t('erased / foreign settings page -> unknown layout, no crash', () => {
  assert.equal(decodeSilabs(garbageSample()).firmware, 'unknown');
  assert.equal(decodeSilabs(new Uint8Array(10)).firmware, 'unknown');
  assert.equal(decodeSilabs(buildSilabs({ main: 1, sub: 2, name: 'SomethingElse' })).firmware, 'unknown');
  assert.equal(decodeAm32(garbageSample()).firmware, 'unknown');
});
await t('AM32 dump decodes (version, file name, kV, timing in degrees)', () => {
  const s = decodeAm32(am32Sample(), am32FileName('FOXEER_F051'));
  assert.equal(s.firmware, 'am32');
  assert.equal(s.version, '2.16');
  assert.equal(s.target, 'FOXEER_F051');
  const f = Object.fromEntries(s.fields.map((x) => [x.id, x]));
  assert.equal(f.timing.value, 15);
  assert.equal(f.motorKv.value, 55 * 40 + 20);
  assert.equal(f.bidirMode.value, true);
  assert.equal(f.poles.value, 14);
});
await t('MCU table and EEPROM locations', () => {
  assert.equal(mcuFromSignature(0xe8b2, 1).name, 'EFM8BB21');
  assert.equal(mcuFromSignature(0x1f06, 4).family, 'arm');
  assert.equal(mcuFromSignature(0x1234, 4).name, '0x1234');
  assert.deepEqual(eepromLocation('silabs', 0xe8b2, 'silabs'), { addr: 0x1a00, len: 0xff });
  assert.equal(eepromLocation('silabs', 0xe8b5, 'silabs').addr, 0x3000);
  assert.equal(eepromLocation('arm', 0x1234, 'am32'), null);
});
await t('bidirectional DShot support per firmware', () => {
  assert.deepEqual(['bluejay', 'am32', 'blheli_32', 'blheli_s', 'unknown'].map(supportsBidir), ['yes', 'yes', 'yes', 'no', 'unknown']);
});

/* ---------------- CRSF ---------------- */
await t('CRSF ping frame = C8 04 28 EC C8 5A', () => assert.equal(hexs(buildPing()), 'c8 04 28 ec c8 5a'));
await t('CRSF DEVICE_INFO parses name/serial/version', () => {
  const frames = new CrsfParser().push(buildDeviceInfo('Generic 2400 RX', [3, 4, 3], 21));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, CRSF.TYPE_DEVICE_INFO);
  const d = parseDeviceInfo(frames[0].body);
  assert.equal(d.name, 'Generic 2400 RX');
  assert.equal(d.version, '3.4.3');
  assert.equal(d.serialText, 'ELRS');
  assert.equal(d.isElrs, true);
  assert.equal(d.fieldCount, 21);
  assert.equal(d.softwareVersion, 0x00030403);
});
await t('CRSF 4.x style (swapped addresses) and 4.1.0 version', () => {
  const d = parseDeviceInfo(new CrsfParser().push(buildDeviceInfo('RX', [4, 1, 0], 5, 0xc8, 0xec))[0].body);
  assert.equal(d.version, '4.1.0');
});
await t('CRSF stream: link stats + garbage + info, split into small chunks, bad CRC dropped', () => {
  const info = buildDeviceInfo('X', [3, 5, 3]);
  const bad = buildLinkStats();
  bad[bad.length - 1] ^= 1;
  const stream = Uint8Array.from([0x00, 0x13, ...buildLinkStats(), ...bad, 0xff, ...info]);
  const p = new CrsfParser();
  const got = [];
  for (let i = 0; i < stream.length; i += 3) got.push(...p.push(stream.subarray(i, i + 3)));
  assert.deepEqual(got.map((f) => f.type), [CRSF.TYPE_LINK_STATS, CRSF.TYPE_DEVICE_INFO]);
});
await t('CRSF DEVICE_INFO without NUL / too short -> null', () => {
  assert.equal(parseDeviceInfo(Uint8Array.from([0xec, 0xc8, 0x41, 0x42])), null);
  assert.equal(parseDeviceInfo(Uint8Array.from([1])), null);
  assert.equal(parseDeviceInfo(buildFrame(0xc8, 0x29, [0xec, 0xc8, 0x41, 0, 1, 2]).subarray(3, 9)), null);
});

/* ---------------- MSP v2 ---------------- */
await t('MSP v2 request/response round trip and serial config', () => {
  const cfg = encodeSerialConfig([{ id: 20, functionMask: 1 }, { id: 1, functionMask: 1 << 6 }]);
  const f = new Msp2Parser().push(encodeMspV2Response(0x1009, cfg));
  assert.equal(f.length, 1);
  assert.equal(f[0].code, 0x1009);
  assert.deepEqual(decodeSerialConfig(f[0].payload), [{ id: 20, functionMask: 1 }, { id: 1, functionMask: 64 }]);
  const rq = new Msp2Parser(true).push(encodeMspV2(0x1009));
  assert.equal(rq[0].code, 0x1009);
});
await t('serial config decode tolerates longer records', () => {
  const p = Uint8Array.from([1, 5, 0x40, 0, 0, 0, 0, 0, 0, 0, 9, 9]);
  assert.deepEqual(decodeSerialConfig(p), [{ id: 5, functionMask: 0x40 }]);
});
await t('RawBuffer readExact / readSome', async () => {
  const b = new RawBuffer();
  setTimeout(() => b.push(Uint8Array.from([1, 2, 3])), 10);
  assert.deepEqual(Array.from(await b.readExact(3, 200)), [1, 2, 3]);
  assert.equal(await b.readExact(1, 20), null);
  assert.equal((await b.readSome(20)).length, 0);
});

/* ---------------- flows against the simulator ---------------- */
const fast = { sleep: noSleep, settleMs: 0, timeoutScale: 0.4 };
const ALLOWED = new Set([0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x37, 0x3a]);

await t('ESC flow: 4 ESCs (3 Bluejay + 1 unknown layout), read-only, exits cleanly', async () => {
  const dev = new DemoRawDevice();
  const steps = [];
  const scan = await readEscInfo(dev, { ...fast, onProgress: (p) => steps.push(p.step) });
  assert.equal(scan.count, 4);
  assert.equal(scan.interfaceName, 'm4wFCIntf');
  assert.deepEqual(scan.escs.map((e) => e.firmware), ['bluejay', 'bluejay', 'unknown', 'bluejay']);
  assert.equal(scan.escs[0].settings.version, '0.21');
  assert.equal(scan.escs[0].mcuName, 'EFM8BB21');
  assert.equal(scan.escs[2].note, 'unknownLayout');
  assert.equal(scan.escs[2].status, 'ok');
  assert.ok(scan.escs[2].rawHead.startsWith('ff ff'));
  assert.ok(dev.fourWayCmds.every((c) => ALLOWED.has(c)), 'only allow-listed commands on the wire: ' + dev.fourWayCmds.map((c) => c.toString(16)));
  assert.ok(!dev.fourWayCmds.some((c) => [0x38, 0x39, 0x3b, 0x3e].includes(c)));
  assert.equal(dev.fourWayCmds.filter((c) => c === CMD.DEVICE_RESET).length, 4, 'every initialised ESC restarted');
  assert.equal(dev.fourWayCmds.at(-1), CMD.INTERFACE_EXIT);
  assert.deepEqual([steps[0], steps.at(-1)], ['passthrough', 'verify']);
});
await t('ESC flow: no battery -> every ESC no-response (ack 0x0F), still exits', async () => {
  const dev = new DemoRawDevice({ escs: demoEscs().map((e) => ({ ...e, answers: false })) });
  const scan = await readEscInfo(dev, fast);
  assert.ok(scan.escs.every((e) => e.status === 'no-response' && e.ack === ACK.GENERAL_ERROR));
  assert.equal(dev.fourWayCmds.at(-1), CMD.INTERFACE_EXIT);
});
await t('ESC flow: AM32 and BLHeli_32 (boot pin) classification', async () => {
  const am32 = { answers: true, signature: 0x1f06, bootByte: 0x02, mode: 4, eeprom: am32Sample(), eepromAddr: 0x7c00 };
  const b32 = { answers: true, signature: 0x1f06, bootByte: 0x55, mode: 4, eeprom: new Uint8Array(0xb0), eepromAddr: 0x7c00 };
  const dev = new DemoRawDevice({ escs: [am32, b32] });
  const scan = await readEscInfo(dev, fast);
  assert.equal(scan.escs[0].firmware, 'am32');
  assert.equal(scan.escs[0].settings.version, '2.16');
  assert.equal(scan.escs[1].firmware, 'blheli_32');
  assert.equal(scan.escs[1].note, 'blheli32');
  assert.equal(scan.escs[1].settings, undefined);
});
await t('ESC flow: FC that never leaves 4-way -> EscFlowError stuck', async () => {
  const dev = new DemoRawDevice({ stuckIn4way: true });
  await assert.rejects(() => readEscInfo(dev, fast), (e) => e instanceof EscFlowError && e.code === 'stuck');
});
await t('ELRS flow: version from DEVICE_INFO, CLI allow-list, DTR drop', async () => {
  let reset = false;
  const dev = new DemoRawDevice({ onReset: () => (reset = true) });
  const steps = [];
  const r = await readElrsInfo(dev, { sleep: noSleep, timeoutScale: 0.5, onProgress: (s) => steps.push(s) });
  assert.equal(r.kind, 'ok');
  assert.equal(r.info.version, '3.4.3');
  assert.equal(r.info.name, 'Generic 2400 RX');
  assert.equal(r.info.serial, 'ELRS');
  assert.equal(r.info.portId, 1);
  assert.deepEqual(dev.cliLines, [passthroughCommand(1)]);
  assert.equal(passthroughCommand(1), 'serialpassthrough 1 420000 rxtx reset');
  assert.ok(reset && dev.rebootExpected);
  assert.deepEqual(steps, ['config', 'cli', 'passthrough', 'ping', 'reset']);
});
await t('ELRS flow: no serial-RX UART (SPI receiver) -> no-uart, nothing changed', async () => {
  const dev = new DemoRawDevice({ ports: [{ id: 20, functionMask: 1 }] });
  const r = await readElrsInfo(dev, { sleep: noSleep, timeoutScale: 0.5 });
  assert.equal(r.kind, 'no-uart');
  assert.equal(dev.cliLines.length, 0);
  assert.equal(dev.rebootExpected, false);
  assert.equal(dev.closed, false);
});
await t('ELRS flow: silent receiver -> no-answer', async () => {
  const dev = new DemoRawDevice({ elrs: null });
  const r = await readElrsInfo(dev, { sleep: noSleep, timeoutScale: 0.2, pingAttempts: 3 });
  assert.equal(r.kind, 'no-answer');
  assert.equal(r.sawCrsf, false);
});
await t('ELRS CLI allow-list', () => {
  for (const ok of ['#', 'exit', 'serialpassthrough 1 420000 rxtx reset']) assert.doesNotThrow(() => assertAllowedCli(ok));
  for (const bad of ['save', 'defaults', 'bl', 'dfu', 'set motor_pwm_protocol = PWM', 'serialpassthrough 1 420000 rxtx reset; save', 'flash_erase']) assert.throws(() => assertAllowedCli(bad));
});

console.log(fails ? `\n${fails} FAILED` : '\nall tests passed');
process.exit(fails ? 1 : 0);
