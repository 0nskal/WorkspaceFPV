/**
 * Blackbox tab: logging device / rate / debug mode, dataflash summary, log download over MSP
 * (MSP_DATAFLASH_READ, uncompressed), erase with confirmation and reboot into mass-storage mode.
 * A downloaded log can go straight to the Autotune tab (native .bbl decoder, see bf/bbl.ts).
 */
import type { AppContext, ScreenMount } from '../context';
import { fmtNum, t } from '../i18n';
import {
  BB_DEVICES,
  MSPB,
  SAMPLE_RATES,
  decodeBlackboxConfig,
  decodeFlashRead,
  decodeFlashSummary,
  decodeMscReply,
  decodeSdSummary,
  encodeBlackboxConfig,
  encodeFlashRead,
  fmtBytes,
  loggingRateHz,
  logFileName,
  type BlackboxConfig,
  type FlashSummary,
  type SdSummary,
} from '../bf/blackbox';
import { summarizeBbl, type BblSummary } from '../bf/bbl';
import { HANDOFF_ROUTE, setPendingLog } from '../bf/log-handoff';
import { AREA, errMsg, rawOf, STEP } from '../bf/steps';
import type { MspWrite } from '../bf/store';
import { MSPM, DEBUG_MODES_45, decodeAdvancedConfig, encodeAdvancedConfig, debugModeName, type AdvancedConfig } from '../bf/motors';
import { bindConnect, downloadBytes, emptyHtml, sleep } from '../bf/ui-bits';
import { escapeHtml } from '../ui/dom';
import { icon } from '../ui/icons';
import { intro, tip } from '../ui/tip';
import './bf-blackbox.css';

/**
 * Bytes requested per MSP_DATAFLASH_READ. Betaflight builds with flash have a 4096 + 16 byte MSP reply buffer
 * (msp_serial.h MSP_PORT_DATAFLASH_BUFFER_SIZE) and answer with an MSP v1 jumbo frame; smaller builds clamp the
 * length themselves, and the loop below always advances by what actually came back.
 */
const CHUNK = 4096;

type Dl =
  | { phase: 'idle' }
  | { phase: 'run'; bytes: number; total: number; speed: number; t0: number; cancel: boolean }
  | { phase: 'done'; name: string; size: number; data: Uint8Array; info: BblSummary; secs: number }
  | { phase: 'error'; msg: string };

export const mount: ScreenMount = (el: HTMLElement, ctx: AppContext) => {
  /** One request through the Betaflight session; null on an error reply or timeout. */
  const tryRead = (cmd: number, payload?: Uint8Array, timeoutMs = 1000): Promise<Uint8Array | null> => ctx.bf.send(cmd, payload, timeoutMs).catch(() => null);
  const root = document.createElement('div');
  root.className = 'bf-blackbox';
  el.appendChild(root);
  let disposed = false;
  let flash: FlashSummary | null = null;
  let sd: SdSummary | null = null;
  let cfg: BlackboxConfig | null = null;
  let adv: AdvancedConfig | null = null;
  let device = 0;
  let rate = 0;
  let debug = 0;
  let loadState: 'idle' | 'loading' | 'ready' | 'unsupported' = 'idle';
  let dl: Dl = { phase: 'idle' };
  let erasing: { t0: number } | null = null;
  let saving = false;
  let connKey = '';
  const offConn = bindConnect(root, ctx);

  const minor = () => ctx.bf.get().api || 46;
  const armed = () => !!ctx.state.get().status?.armed;
  const pidUs = () => ctx.state.get().status?.cycleTimeUs ?? 0;

  /* ---------- load ---------- */
  /** Decodes what the Betaflight store read (on connect, or by the refresh below). */
  function fromStore(): void {
    const d = ctx.bf.get();
    const f = rawOf(d, STEP.flash);
    const s = rawOf(d, STEP.sdcard);
    const c = rawOf(d, STEP.bbConfig);
    const a = rawOf(d, STEP.advanced);
    flash = f ? decodeFlashSummary(f) : null;
    sd = s ? decodeSdSummary(s) : null;
    cfg = c ? decodeBlackboxConfig(c, minor()) : null;
    adv = a ? decodeAdvancedConfig(a) : null;
    if (cfg) {
      device = cfg.device;
      rate = cfg.sampleRate;
    }
    if (adv) debug = adv.debugMode;
  }

  /** Shows the connect-time summary at once, then re-reads it (the flash fills up while flying). */
  async function load(): Promise<void> {
    fromStore();
    loadState = cfg ? 'ready' : 'loading';
    paint();
    await ctx.bf.refresh(AREA.blackbox);
    if (disposed || saving || dirty()) return;
    fromStore();
    loadState = cfg ? 'ready' : 'unsupported';
    paint();
  }

  const dirty = () => !!cfg && (device !== cfg.device || rate !== cfg.sampleRate || (!!adv && debug !== adv.debugMode));

  /* ---------- view ---------- */
  function flashPanel(): string {
    const f = flash;
    const used = f?.usedSize ?? 0;
    const total = f?.totalSize ?? 0;
    const pct = total ? Math.min(100, (used / total) * 100) : 0;
    const supported = !!f && f.supported && total > 0;
    const running = dl.phase === 'run';
    let body = '';
    if (!supported) {
      body = `<p class="bf-blackbox-msg">${sd && sd.supported ? t('bfBlackbox.sdOnly') : t('bfBlackbox.noFlash')}</p>`;
    } else {
      body = `
        <div class="bf-blackbox-use">
          <div class="bf-blackbox-use-n"><b class="mono">${fmtBytes(used)}</b><span class="mono">/ ${fmtBytes(total)}</span><em class="mono">${fmtNum(pct, 1)}%</em></div>
          <div class="bf-blackbox-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="${t('bfBlackbox.flashUsed')}"><i style="width:${pct.toFixed(1)}%"></i></div>
          <div class="bf-blackbox-use-s"><span>${t('bfBlackbox.flashUsed')}</span><span>${f!.ready ? t('bfBlackbox.ready') : t('bfBlackbox.busy')}</span></div>
        </div>
        ${dl.phase === 'run' ? runBlock(dl) : ''}
        ${dl.phase === 'error' ? `<p class="bf-blackbox-err" role="alert">${escapeHtml(dl.msg)}</p>` : ''}
        ${dl.phase === 'done' ? doneBlock(dl) : ''}
        ${erasing ? `<p class="bf-blackbox-msg" data-erasing>${t('bfBlackbox.erasing', { s: Math.round((Date.now() - erasing.t0) / 1000) })}</p>` : ''}
        <div class="bf-blackbox-actions">
          ${running ? `<button type="button" class="btn ghost" data-act="cancel">${icon('x', 16)}${t('bfBlackbox.cancel')}</button>` : `<button type="button" class="btn amber" data-act="download" ${used === 0 || !f!.ready || !!erasing ? 'disabled' : ''}>${icon('download', 16)}${t('bfBlackbox.download')}</button>`}${running ? '' : tip('tips.blackbox.download')}
          <button type="button" class="btn danger" data-act="erase" ${running || !!erasing || used === 0 ? 'disabled' : ''}>${icon('trash', 16)}${t('bfBlackbox.erase')}</button>${tip('tips.blackbox.erase')}
          <button type="button" class="btn ghost" data-act="msc" ${running || !!erasing ? 'disabled' : ''} title="${escapeHtml(t('bfBlackbox.mscTip'))}">${icon('plug', 16)}${t('bfBlackbox.msc')}</button>${tip('tips.blackbox.msc')}
        </div>
        <p class="bf-blackbox-note">${t('bfBlackbox.downloadNote')}</p>`;
    }
    return `<section class="bf-panel"><header><span class="bf-legend">${t('bfBlackbox.flashHead')} ${tip('tips.blackbox.flash')}</span></header>${body}</section>`;
  }

  function runBlock(d: Extract<Dl, { phase: 'run' }>): string {
    const pct = d.total ? (d.bytes / d.total) * 100 : 0;
    return `<div class="bf-blackbox-run" data-run>
      <div class="bf-blackbox-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="${t('bfBlackbox.progress')}"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="bf-blackbox-run-s mono"><span data-run-bytes>${fmtBytes(d.bytes)} / ${fmtBytes(d.total)}</span><span data-run-speed>${fmtNum(d.speed / 1024, 0)} kB/s</span><span data-run-pct>${fmtNum(pct, 0)}%</span></div>
    </div>`;
  }

  function doneBlock(d: Extract<Dl, { phase: 'done' }>): string {
    const i = d.info;
    const rows = [
      [t('bfBlackbox.file'), d.name],
      [t('bfBlackbox.size'), `${fmtBytes(d.size)} · ${fmtNum(d.secs, 1)} s`],
      [t('bfBlackbox.firmware'), i.firmware || t('common.unknown')],
      [t('bfBlackbox.craft'), i.craft || '—'],
      [t('bfBlackbox.logs'), String(i.logs)],
    ]
      .map(([k, v]) => `<dt>${escapeHtml(k!)}</dt><dd>${escapeHtml(v!)}</dd>`)
      .join('');
    return `<div class="bf-blackbox-done" role="status">
      <div class="bf-blackbox-done-t">${icon('check', 14)} ${t('bfBlackbox.downloaded')}</div>
      <dl class="v1-kv">${rows}</dl>
      <div class="bf-blackbox-actions">
        <button type="button" class="btn amber" data-act="analyse" ${i.logs ? '' : 'disabled'}>${icon('chart', 16)}${t('bfBlackbox.analyse')}</button>
        <button type="button" class="btn ghost" data-act="save-again">${icon('download', 16)}${t('bfBlackbox.saveAgain')}</button>
      </div>
      ${i.logs ? '' : `<p class="bf-blackbox-err">${t('bfBlackbox.notBbl')}</p>`}
    </div>`;
  }

  function configPanel(): string {
    if (!cfg) return '';
    const b = cfg;
    const canFlash = !!flash && flash.supported;
    const canSd = !!sd && sd.supported;
    const devs = BB_DEVICES.map((d) => {
      const off = (d.id === 1 && !canFlash && b.device !== 1) || (d.id === 2 && !canSd && b.device !== 2);
      return `<option value="${d.id}" ${device === d.id ? 'selected' : ''} ${off ? 'disabled' : ''}>${t(`bfBlackbox.dev.${d.key}` as 'bfBlackbox.dev.none')}</option>`;
    }).join('');
    const supportsRate = minor() >= 44;
    const rateOpts = SAMPLE_RATES.map((r) => {
      const hz = loggingRateHz(pidUs(), r);
      return `<option value="${r}" ${r === rate ? 'selected' : ''}>1/${2 ** r}${hz ? ` · ${fmtNum(hz / 1000, hz >= 1000 ? 1 : 2)} kHz` : ''}</option>`;
    }).join('');
    const names = minor() === 46 && adv ? DEBUG_MODES_45.slice(0, Math.max(adv.debugCount, 1)) : null;
    const debugField = adv
      ? names
        ? `<select data-f="debug" aria-label="${t('bfBlackbox.debug')}">${names.map((n, i) => `<option value="${i}" ${i === debug ? 'selected' : ''}>${i} · ${n}</option>`).join('')}</select>`
        : `<input type="number" min="0" max="${Math.max(adv.debugCount - 1, 0) || 255}" step="1" value="${debug}" data-f="debug" aria-label="${t('bfBlackbox.debug')}"><span class="bf-unit">${escapeHtml(debugModeName(debug, minor()))}</span>`
      : '';
    const changed = {
      dev: device !== b.device,
      rate: rate !== b.sampleRate,
      debug: !!adv && debug !== adv.debugMode,
    };
    const list: string[] = [];
    if (changed.dev) list.push(t('bfBlackbox.chDevice', { to: t(`bfBlackbox.dev.${BB_DEVICES[device]?.key ?? 'none'}` as 'bfBlackbox.dev.none') }));
    if (changed.rate) list.push(t('bfBlackbox.chRate', { to: `1/${2 ** rate}` }));
    if (changed.debug) list.push(t('bfBlackbox.chDebug', { to: debugModeName(debug, minor()) }));
    const row = (chg: boolean, ctl: string, label: string, tk: 'tips.blackbox.device' | 'tips.blackbox.rate' | 'tips.blackbox.debug', key: string, keyTip = '') =>
      `<div class="bf-row${chg ? ' chg' : ''}"><div class="bf-ctl">${ctl}</div><label class="bf-lbl">${label} <small class="mono bf-blackbox-key" title="${escapeHtml(keyTip)}">${key}</small></label>${tip(tk)}</div>`;
    return `<section class="bf-panel"><header><span class="bf-legend">${t('bfBlackbox.cfgHead')}</span></header>
      ${row(changed.dev, `<select data-f="dev" aria-label="${t('bfBlackbox.device')}">${devs}</select>`, t('bfBlackbox.device'), 'tips.blackbox.device', 'blackbox_device')}
      ${row(changed.rate, supportsRate ? `<select id="bf-bb-rate" data-f="rate" aria-label="${t('bfBlackbox.rate')}">${rateOpts}</select>` : `<span class="mono">${t('bfBlackbox.rateLegacy', { d: b.rateDenom })}</span>`, t('bfBlackbox.rate'), 'tips.blackbox.rate', 'blackbox_sample_rate', t('bfBlackbox.rateTip'))}
      ${row(changed.debug, debugField || `<span class="mono">${t('bfBlackbox.noValue')}</span>`, t('bfBlackbox.debug'), 'tips.blackbox.debug', 'debug_mode', t('bfBlackbox.debugTip'))}
      ${armed() ? `<p class="bf-blackbox-err" role="alert">${t('bfBlackbox.armed')}</p>` : ''}
      <div class="bf-blackbox-save">
        <span class="bf-blackbox-pending${list.length ? ' has' : ''}">${list.length ? escapeHtml(list.join(' · ')) : t('esc.noChanges')}</span>
        <button type="button" class="btn ghost" data-act="ask">${icon('chip', 16)}${t('bfBlackbox.askAi')}</button>
        <button type="button" class="btn ghost" data-act="revert" ${list.length === 0 || saving ? 'disabled' : ''}>${t('bfMotors.revert')}</button>
        <button type="button" class="btn amber" data-act="save" ${list.length === 0 || saving || armed() ? 'disabled' : ''}>${icon('check', 16)}${t('bfBlackbox.save')}</button>
      </div></section>
      <section class="bf-panel"><header><span class="bf-legend">${t('bfBlackbox.mscHead')}</span></header><p class="bf-blackbox-note">${t('bfBlackbox.mscExplain')}</p></section>`;
  }

  function paint(): void {
    if (disposed) return;
    const s = ctx.state.get();
    if (s.conn !== 'connected') {
      root.innerHTML = emptyHtml(ctx, t('bfBlackbox.emptyTag'), t('bfBlackbox.emptyTitle'), t('bfBlackbox.emptyLead'));
      return;
    }
    if (loadState === 'loading' || loadState === 'idle') {
      root.innerHTML = `<p class="bf-blackbox-msg">${t('bfBlackbox.loading')}</p>`;
      return;
    }
    const head = `<header class="bf-head"><h2>${t('bfBlackbox.title')}</h2><span class="bf-blackbox-sub">${t('bfBlackbox.sub')}</span></header>`;
    if (loadState === 'unsupported') {
      root.innerHTML = `<div class="bf-blackbox-page">${head}<div class="bf-body"><p class="bf-blackbox-msg">${t('bfBlackbox.unsupported')}</p></div></div>`;
      return;
    }
    root.innerHTML = `<div class="bf-blackbox-page">${head}
      <div class="bf-body">${intro('tips.blackbox.intro')}
      <div class="bf-blackbox-cols"><div class="bf-blackbox-col">${configPanel()}</div><div class="bf-blackbox-col">${flashPanel()}</div></div></div></div>`;
  }

  function paintRun(): void {
    if (dl.phase !== 'run') return;
    const pct = dl.total ? (dl.bytes / dl.total) * 100 : 0;
    const bar = root.querySelector<HTMLElement>('.bf-blackbox-bar i');
    if (bar) bar.style.width = `${pct.toFixed(1)}%`;
    const set = (sel: string, txt: string) => {
      const n = root.querySelector<HTMLElement>(sel);
      if (n) n.textContent = txt;
    };
    set('[data-run-bytes]', `${fmtBytes(dl.bytes)} / ${fmtBytes(dl.total)}`);
    set('[data-run-speed]', `${fmtNum(dl.speed / 1024, 0)} kB/s`);
    set('[data-run-pct]', `${fmtNum(pct, 0)}%`);
    root.querySelector('.bf-blackbox-bar')?.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  /* ---------- actions ---------- */
  async function download(): Promise<void> {
    if (!flash || dl.phase === 'run') return;
    if (armed()) return ctx.toast(t('bfBlackbox.armed'), 'error');
    const total = flash.usedSize;
    const chunkSize = CHUNK;
    const run: Extract<Dl, { phase: 'run' }> = { phase: 'run', bytes: 0, total, speed: 0, t0: performance.now(), cancel: false };
    dl = run;
    paint();
    const parts: Uint8Array[] = [];
    const win: Array<[number, number]> = [[run.t0, 0]];
    let addr = 0;
    let lastPaint = 0;
    try {
      while (addr < total) {
        if (run.cancel) throw new Error(t('bfBlackbox.cancelled'));
        let got: Uint8Array | null = null;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 3 && !got; attempt++) {
          try {
            const reply = await ctx.bf.send(MSPB.DATAFLASH_READ, encodeFlashRead(addr, Math.min(chunkSize, total - addr)), 2000);
            const ch = decodeFlashRead(reply, addr);
            if (ch.ok) got = ch.data;
            else if (ch.reason === 'compressed') throw new Error(t('bfBlackbox.compressed'));
            else lastErr = new Error(t('bfBlackbox.badReply'));
          } catch (e) {
            lastErr = e;
            if (e instanceof Error && e.message === t('bfBlackbox.compressed')) throw e;
            await sleep(60);
          }
        }
        if (!got) throw lastErr instanceof Error ? lastErr : new Error(t('bfBlackbox.badReply'));
        if (got.length === 0) break; // end of flash
        parts.push(got);
        addr += got.length;
        run.bytes = addr;
        const now = performance.now();
        win.push([now, addr]);
        while (win.length > 2 && now - win[0]![0] > 1500) win.shift();
        const w0 = win[0]!;
        run.speed = now > w0[0] ? ((addr - w0[1]) / (now - w0[0])) * 1000 : 0;
        if (now - lastPaint > 90) {
          lastPaint = now;
          paintRun();
          await sleep(0);
        }
        if (disposed) return;
      }
      const data = new Uint8Array(addr);
      let o = 0;
      for (const p of parts) {
        data.set(p, o);
        o += p.length;
      }
      const name = logFileName();
      const secs = (performance.now() - run.t0) / 1000;
      dl = { phase: 'done', name, size: data.length, data, info: summarizeBbl(data, false), secs };
      downloadBytes(name, data);
      ctx.toast(t('bfBlackbox.savedFile', { name }), 'ok');
    } catch (e) {
      dl = { phase: 'error', msg: e instanceof Error ? e.message : String(e) };
    }
    paint();
  }

  async function erase(): Promise<void> {
    if (!flash || erasing || dl.phase === 'run') return;
    if (armed()) return ctx.toast(t('bfBlackbox.armed'), 'error');
    const ok = await ctx.confirm({
      title: t('bfBlackbox.eraseTitle'),
      danger: true,
      confirmText: t('bfBlackbox.erase'),
      body: `<p>${t('bfBlackbox.eraseBody', { used: fmtBytes(flash.usedSize) })}</p><p class="warn-note">${t('bfBlackbox.eraseWarn')}</p>`,
    });
    if (!ok) return;
    try {
      await ctx.bf.send(MSPB.DATAFLASH_ERASE, new Uint8Array(0), 5000);
    } catch (e) {
      return ctx.toast(t('bfBlackbox.eraseFail', { msg: errMsg(e) }), 'error');
    }
    erasing = { t0: Date.now() };
    paint();
    const tick = setInterval(() => {
      const n = root.querySelector('[data-erasing]');
      if (n && erasing) n.textContent = t('bfBlackbox.erasing', { s: Math.round((Date.now() - erasing.t0) / 1000) });
    }, 500);
    try {
      // erase takes up to minutes on big chips; the FC may answer slowly meanwhile, so silence is not a failure
      const until = Date.now() + 5 * 60_000;
      while (!disposed && Date.now() < until) {
        await sleep(1000);
        const f = await tryRead(MSPB.DATAFLASH_SUMMARY, undefined, 4000);
        if (f) {
          const s = decodeFlashSummary(f);
          flash = s;
          if (s.ready && s.usedSize === 0) break;
        }
      }
      dl = { phase: 'idle' };
      ctx.toast(t('bfBlackbox.erased'), 'ok');
    } finally {
      clearInterval(tick);
      erasing = null;
      paint();
    }
  }

  async function msc(): Promise<void> {
    const ok = await ctx.confirm({
      title: t('bfBlackbox.mscTitle'),
      confirmText: t('bfBlackbox.mscGo'),
      body: `<p>${t('bfBlackbox.mscBody')}</p><p class="save-note">${t('bfBlackbox.mscReturn')}</p>`,
    });
    if (!ok) return;
    try {
      const link = ctx.link();
      const r = decodeMscReply(await ctx.bf.send(MSPB.REBOOT, Uint8Array.of(2), 3000));
      if (!r.ready) return ctx.toast(t('bfBlackbox.mscNotReady'), 'error');
      link?.expectReboot('leave'); // the FC re-enumerates as a USB drive: report a plain close, no reconnect attempt
      ctx.toast(t('bfBlackbox.mscDone'), 'ok');
    } catch (e) {
      ctx.toast(t('bfBlackbox.mscFail', { msg: errMsg(e) }), 'error');
    }
  }

  async function save(): Promise<void> {
    if (!cfg || saving || !dirty()) return;
    const parts: string[] = [];
    if (device !== cfg.device) parts.push(t('bfBlackbox.chDevice', { to: t(`bfBlackbox.dev.${BB_DEVICES[device]?.key ?? 'none'}` as 'bfBlackbox.dev.none') }));
    if (rate !== cfg.sampleRate) parts.push(t('bfBlackbox.chRate', { to: `1/${2 ** rate}` }));
    if (adv && debug !== adv.debugMode) parts.push(t('bfBlackbox.chDebug', { to: debugModeName(debug, minor()) }));
    const ok = await ctx.confirm({ title: t('bfBlackbox.confirmTitle'), confirmText: t('bfBlackbox.save'), body: `<p>${t('bfBlackbox.confirmIntro')}</p><pre class="code">${escapeHtml(parts.join('\n'))}</pre>` });
    if (!ok) return;
    saving = true;
    paint();
    const writes: MspWrite[] = [];
    if (device !== cfg.device || rate !== cfg.sampleRate) writes.push({ code: MSPB.SET_BLACKBOX_CONFIG, payload: encodeBlackboxConfig(cfg, { device, sampleRate: rate }, minor()), label: 'SET_BLACKBOX_CONFIG' });
    if (adv && debug !== adv.debugMode) writes.push({ code: MSPM.SET_ADVANCED_CONFIG, payload: encodeAdvancedConfig(adv, { debugMode: debug }), label: 'SET_ADVANCED_CONFIG' });
    const res = await ctx.bf.saveSettings(writes, { areas: AREA.blackbox });
    saving = false;
    if (res.ok) ctx.toast(t('bfBlackbox.saved'), 'ok');
    else ctx.toast(t('bfBlackbox.saveFail', { msg: res.error ?? '' }), 'error');
    if (disposed) return;
    fromStore();
    paint();
  }

  function summary(): string {
    if (!cfg) return '';
    return t('bfBlackbox.aiSummary', {
      device: t(`bfBlackbox.dev.${BB_DEVICES[cfg.device]?.key ?? 'none'}` as 'bfBlackbox.dev.none'),
      rate: `1/${2 ** cfg.sampleRate}`,
      hz: fmtNum(loggingRateHz(pidUs(), cfg.sampleRate), 0),
      debug: adv ? debugModeName(adv.debugMode, minor()) : '?',
      used: flash ? fmtBytes(flash.usedSize) : '?',
      total: flash ? fmtBytes(flash.totalSize) : '?',
    });
  }

  root.addEventListener('click', (e) => {
    const tg = e.target as HTMLElement;
    const act = tg.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'download') void download();
    else if (act === 'cancel' && dl.phase === 'run') dl.cancel = true;
    else if (act === 'erase') void erase();
    else if (act === 'msc') void msc();
    else if (act === 'save') void save();
    else if (act === 'revert' && cfg) {
      device = cfg.device;
      rate = cfg.sampleRate;
      if (adv) debug = adv.debugMode;
      paint();
    } else if (act === 'ask') ctx.askAi(summary());
    else if (act === 'save-again' && dl.phase === 'done') downloadBytes(dl.name, dl.data);
    else if (act === 'analyse' && dl.phase === 'done') {
      setPendingLog(new File([dl.data as BlobPart], dl.name, { type: 'application/octet-stream' }));
      ctx.navigate(HANDOFF_ROUTE);
    }
  });
  root.addEventListener('change', (e) => {
    const el2 = e.target as HTMLInputElement | HTMLSelectElement;
    const f = el2.dataset.f;
    if (f === 'dev') device = Number(el2.value);
    else if (f === 'rate') rate = Number(el2.value);
    else if (f === 'debug') debug = Math.max(0, Math.min(255, Math.round(Number(el2.value) || 0)));
    else return;
    paint();
  });

  const off = ctx.state.subscribe(() => {
    const s = ctx.state.get();
    const key = s.conn;
    if (key === connKey) return;
    connKey = key;
    if (key === 'connected') void load();
    else {
      loadState = 'idle';
      dl = { phase: 'idle' };
      paint();
    }
  });
  connKey = ctx.state.get().conn;
  if (connKey === 'connected') void load();
  else paint();

  return () => {
    disposed = true;
    if (dl.phase === 'run') dl.cancel = true;
    off();
    offConn();
    root.remove();
  };
};
