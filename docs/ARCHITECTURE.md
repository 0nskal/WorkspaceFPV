# WorkspaceFPV architecture: the Betaflight core

This document describes the shared Betaflight layer (`app/src/bf/`, `app/src/serial/`) that every FC-related tab builds on. Betaflight Configurator is GPL-3.0; nothing here is copied from it. Layouts are implemented from our own spec (`design/BETAFLIGHT-PARITY.md`).

## Layers

```
serial/port.ts      WebSerial transport (open, reconnect by VID:PID)
serial/msp.ts       MSP codec: v1, v1 jumbo, v2 (CRC-8 DVB-S2); MspClient = queue, 1 request in flight,
                    1 s timeout, optional retries; codes > 254 are sent as v2 automatically; MspError(kind)
serial/link.ts      SerialLink (FcLink): request(), cli(), expectReboot()
serial/demo*.ts     DemoLink: a simulated FC (BF 4.5.1, API 1.46); demo-bf.ts answers all core commands and
                    keeps SET values in memory
bf/codec.ts         tolerant byte Reader/Writer (short payloads read as 0, never throw)
bf/decode.ts        typed decoders + read-modify-write encoders for the core commands
bf/arming.ts        arming-disable flag tables per API version
bf/store.ts         BfData, BfStore, BfSession (= ctx.bf), the read-everything steps, saveSettings
bf/steps.ts         read steps of the other tabs (tuning, receiver, modes, blackbox, OSD) + their area names
bf/form.ts          declarative editable tab (fields, validation, red "changed" marks, Save bar, Ask AI)
fc/state.ts         FcStore (the older shared state: conn, info, config, status, telemetry)
fc/read.ts          readAll() = bf snapshot + first telemetry; the 100 ms telemetry loop; derives FcInfo/FcConfig from BfData
```

## The store: `ctx.bf`

`ctx.bf` is a `BfSession`. The data lives in `ctx.bf.get(): BfData` (typed values plus `raw: Map<stepId, Uint8Array>` and `unsupported: Set<stepId>`).

On connect `attach()` runs `bf.snapshot(link)`: API version, variant (anything but `BTFL` sets `supported=false`, CLI features only), version, build, board, STATUS_EX, UID, names, features, advanced/mixer/motor/arming/sensor/alignment/beeper/rx/failsafe/PID/battery/serial config. Steps are gated on the MSP API minor (`step.minApi/maxApi`), optional ones tolerate an error reply (`!`), 3 timeouts in a row abort. Progress (`bf.store.progress()` = `{done,total}`) drives "Reading configuration... 14/31" on the start screen. After the snapshot `FcState.info/config/status` are derived from the store (`deriveCore`), so there is one source of truth; the shared diagnosis reads real cell count, warning voltage and gyro rate from it.

```ts
const bf = ctx.bf.get();                    // BfData, never null; fields are null until read / when unsupported
ctx.bf.subscribe(() => render());           // fires on snapshot, refresh and status changes
await ctx.bf.refresh('battery');            // re-read one area (or an array); areas: ident, status, names, features, advanced,
                                            // mixer, motor, arming, sensors, alignment, beeper, rx, failsafe, pid, battery, serial
const att = await ctx.bf.read({ code: C.ATTITUDE, decode: (p, api) => decodeAttitude(p) }); // typed request, null = unsupported
await ctx.bf.send(C.ACC_CALIBRATION);       // raw request on the active link (throws on error)
ctx.bf.isArmed();                           // from STATUS_EX mode flags
```

### Adding commands from another module

```ts
registerBfStep({ id: 'osd', area: 'osd', code: 92, minApi: 44, apply: (d, p, api) => { d.ext.osd = decodeOsd(p, api); } });
```

Call it at module load (e.g. in your screen file). The step joins the connect-time snapshot and `refresh('osd')`; read the result with `ctx.bf.get().ext.osd` and the raw payload with `ctx.bf.get().raw.get('osd')`.

`bf/steps.ts` does this for the PID Tuning, Receiver, Modes, Blackbox and OSD tabs (`STEP.*` ids, `AREA.*` area lists). Those tabs keep their own decoders (they need the API version), so their steps only store the raw payload. The pattern every hand-written tab follows:

1. On mount render from `ctx.bf.get().raw` right away (the snapshot already read it; nobody presses "read").
2. `await ctx.bf.refresh(AREA.x)` in the background; re-render only when the payloads changed (`rawKey`) and nothing is being edited.
3. Save with `ctx.bf.saveSettings(writes, { reboot, areas: AREA.x })`, then decode from the store again.
4. Live data (RC channels, STATUS_EX mode bits, motor telemetry, dataflash reads) goes through `ctx.bf.send(code)`.

Raw sessions (4-way ESC interface, CRSF passthrough) use `ctx.link().raw(fn)` directly (`bf/hw-info.ts`); MSP is suspended meanwhile.

## Saving: `saveSettings`

```ts
const res = await ctx.bf.saveSettings(writes, { reboot: true, areas: ['serial'] });
// writes: MspWrite[] = [{ code: C.SET_ARMING_CONFIG, payload, label?: 'SET_ARMING_CONFIG' }, ...]
// res: { ok, error?, rebooted }
```

Order: refuse while armed -> every SET (sequential, 2 attempts) -> 100 ms -> `MSP_EEPROM_WRITE` -> if `reboot`: `MSP_REBOOT(0)`, wait for the app to reconnect and re-read everything; else `refresh(areas)` (default all). Never call it without the user pressing Save. Build payloads with the `encodeX(value, raw)` functions from `bf/decode.ts`: they start from the fresh raw payload and patch only the fields you changed, so reserved/legacy bytes round-trip untouched.

Other session actions: `rebootTo('bootloader' | 'flashBootloader' | 'msc' | 'firmware')`, `resetConfig()` (MSP_RESET_CONF, caller must ask for typed confirmation, see `ConfirmOptions.requireText`), `setArmingDisabled(on)`.

Arming disable: with the setting `armingDisable` (default on) WorkspaceFPV sends `MSP_SET_ARMING_DISABLED [1]` after the snapshot and `[0]` on a clean disconnect (like the Configurator).

Demo mode: `DemoBf` applies SET commands to its in-memory payloads, so save + re-read shows the edit; the simulated reboot skips the disconnect.

## Editable tabs: `mountFormTab`

A tab is a `TabSpec` (see `screens/bf-config.ts`, `bf-power.ts`, `bf-failsafe.ts`, `bf-ports.ts`):

```ts
export const mount: ScreenMount = (el, ctx) => mountFormTab(el, ctx, {
  id, title, areas,                 // areas are refreshed when the tab opens and after saving
  ready: (bf) => bf.battery !== null,   // false -> "Not supported by this firmware"
  toDraft: (bf) => ({ key: value }),    // flat draft: number | string | boolean
  groups: (bf, draft) => Group[],       // fields (number/select/check/text/info), optional custom render()
  toWrites: (draft, bf) => MspWrite[],  // only what changed; use encodeX(value, bf.raw.get(stepId))
  needsReboot?, validate?, dynamic?, top?, live?,
});
```

The framework shows the value read from the FC, marks edited fields red, validates min/max, keeps Save disabled when invalid or armed, labels the button "Save and reboot" when `needsReboot` says so, and offers "Ask AI about this tab" (`ctx.askAi` with a text summary of all fields, unsaved edits flagged). Not-connected and unsupported states are handled for you.

## Adding a tab

1. `app/src/screens/bf-<area>.ts` exporting `mount`; decoders in `app/src/bf/<area>.ts`.
2. One line in `screens/registry.ts`; strings in `i18n/en/<area>.ts` + `i18n/pl/<area>.ts` (pl typed against en), one import and one property line in `i18n/en.ts` / `pl.ts`.
3. CSS appended in a `/* === bf-<area> === */` block.
4. Demo responses in `serial/demo-<area>.ts`, hooked into `demo.ts`.
5. A node test `app/src/bf/test-<area>.mjs` (see `test-core.mjs`, `test-session.mjs`).

## Tests

Every `app/src/bf/test-*.mjs` and `app/src/analysis/test.mjs` runs the same way:

```
npx esbuild app/src/bf/test-core.mjs --bundle --platform=node --format=esm --outfile=$TEMP/t.mjs && node $TEMP/t.mjs
```

`test-session.mjs` runs the snapshot/save/reset cycle against the demo FC and checks that every tab's data is read on connect. `test-firmware.mjs` holds reference values computed from a port of the firmware C code (rates for all five types, the throttle curve for 4.5 and 2025.12, arming flags, beepers, serial port ids, the STATUS_EX layout).

## Tab bar

`screens/registry.ts` orders the tabs like the Configurator and puts each in a `group` (overview, FC setup, tuning and logs, tools); the shell draws them in a second row under the top bar with a thin divider between groups.

## AI providers (`app/src/ai/`)

`Assistant` (assistant.ts) builds the same system prompt + drone context for every provider and streams through one interface: `AiProvider { id; available(): Promise<{ok, reason?}>; stream(messages, system, onText, signal): Promise<{text, stopReason}> }` (types.ts). Implementations in providers.ts: Anthropic API (SDK, cached context block), Gemini (`@google/genai`, loaded lazily; gemini-core.ts), Ollama (ollama-core.ts over an injectable `fetch`), Claude Code (desktop only).

Desktop-only paths run in the Electron main process (`electron/ai.ts`, IPC `ai:*`, bridge in `ai/bridge.ts`): Claude Code is spawned headless (`electron/claude-code.ts`: args array, prompt on stdin, empty temp cwd, no tools, `--setting-sources ""`, `ANTHROPIC_API_KEY` stripped from the env, output parsed by `ai/claude-stream.ts`); Ollama is called from main to avoid CORS. In the browser Ollama is called directly. `effectiveProvider()` picks the user's choice, else Claude Code (desktop, detected, no Anthropic key), else Anthropic. Tests: `app/src/ai/test-providers.mjs`.
