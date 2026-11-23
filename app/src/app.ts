import { Assistant } from './ai/assistant';
import { refreshClaudeDetected } from './ai/providers';
import { buildContext } from './ai/prompts';
import type { AppContext, ApplyOptions, Route } from './context';
import { initHwInfo } from './bf/hw-info';
import { ALL_AREAS, BfSession } from './bf/store';
import { diagnose } from './fc/diagnose';
import { deriveCore, readAll, startTelemetry, statusFromEx } from './fc/read';
import { FcStore, rssiPct, type FcState } from './fc/state';
import { BLOCKED_CLI } from './serial/cli';
import { MspError } from './serial/msp';
import { DemoLink } from './serial/demo';
import { SerialLink } from './serial/link';
import { hasWebSerial } from './serial/port';
import type { CliEntry, FcLink } from './serial/types';
import { SettingsStore, loadBackup, saveBackup } from './settings';
import { getLang, onLanguageChange, t } from './i18n';
import { DEFAULT_SCREEN, SCREENS, SECTIONS, TOOL_LINKS, findScreen, screenVisible, sectionOf, type ToolLink } from './screens/registry';
import type { Part } from './fc/diagnose';
import { downloadText, escapeHtml, stamp } from './ui/dom';
import { createDrawer, type Drawer } from './ui/drawer';
import { icon, logo } from './ui/icons';
import { confirmDialog, toast } from './ui/modal';
import { applyModeAttrs, currentMode } from './ui/mode';
import { applyTheme } from './ui/theme';
import { boardDisplayName } from './fc/board';
import { initTips } from './ui/tip';
import { openSearch } from './ui/search';
import { ringElement } from './ui/snip';
import { updatesApi } from './updates';
const parseRoute = (): Route => {
  const h = location.hash.replace(/^#\/?/, '');
  return findScreen(h) ? h : DEFAULT_SCREEN;
};

export function createApp(root: HTMLElement): AppContext {
  const store = new FcStore();
  const settings = new SettingsStore();
  let link: FcLink | null = null;
  let stopTelemetry: (() => void) | null = null;
  let identity: { usbVendorId?: number; usbProductId?: number } | null = null;
  // the assistant panel starts closed so the tab gets the full width (toggle in the top bar, opens itself for AI answers)
  let drawerOpen = false;

  /** Betaflight configuration store + session (ctx.bf); the shared FcState core is derived from it. */
  const bf = new BfSession({
    link: () => link,
    watchReconnect: (ms) =>
      new Promise<boolean>((resolve) => {
        // Starts watching immediately: the connection drops (reboot) and must come back to 'connected'.
        let dropped = false;
        const done = (v: boolean) => {
          off();
          clearTimeout(to);
          resolve(v);
        };
        const off = store.subscribe(() => {
          const c = store.get().conn;
          if (c !== 'connected') dropped = true;
          else if (dropped) done(true);
        });
        const to = setTimeout(() => done(false), ms);
      }),
  });
  let coreKey = '';
  /** Keeps FcState.info/config/status in step with the Betaflight store (after saves, refreshes and status polls). */
  function syncCore(): void {
    if (!bf.store.isReady() || store.get().conn === 'disconnected') return;
    const d = bf.get();
    const { info, config } = deriveCore(d);
    const key = JSON.stringify([info, config]);
    if (key === coreKey) return;
    coreKey = key;
    store.patch({ info, config, status: d.status ? statusFromEx(d.status) : store.get().status });
  }
  bf.subscribe(syncCore);

  const ai = new Assistant(
    () => {
      const s = settings.get();
      return { provider: s.aiProvider, lang: getLang(), uiMode: s.uiMode || 'basic', anthropicKey: s.apiKey, anthropicModel: s.model, claudeCodeModel: s.claudeCodeModel, geminiKey: s.geminiKey, geminiModel: s.geminiModel, ollamaUrl: s.ollamaUrl, ollamaModel: s.ollamaModel };
    },
    () => buildContext(store.get(), store.get().conn === 'connected' ? diagnose(store.get(), bf.get()) : null, bf.get()),
  );

  void refreshClaudeDetected().then(() => ai.notify()); // the default provider in the desktop app depends on it

  /* ---------------- polaczenie ---------------- */

  /** Why the FC is rebooting (set by hw-info before the ELRS passthrough); used when it does not answer afterwards. */
  let rebootCause: 'elrs-passthrough' | null = null;
  /** Board of the FC that announced the passthrough reboot (the store is reset before the reconnect). */
  let lastBoard = '';

  async function attach(l: FcLink, opts: { afterReboot?: boolean } = {}): Promise<void> {
    stopTelemetry?.();
    link = l;
    if (l instanceof SerialLink) identity = l.identity;
    l.onClose((reason) => void handleClose(l, reason));
    store.patch({ conn: 'connecting', mode: l.kind, error: null });
    try {
      const data = await readAll(l, bf);
      coreKey = JSON.stringify([data.info, data.config]);
      rebootCause = null; // it came back: the reboot worked
      store.patch({ ...data, conn: 'connected', mode: l.kind, error: null });
      // Same safety as the Configurator: no arming while a tool is connected (released on disconnect).
      if (settings.get().armingDisable && bf.get().supported) void bf.setArmingDisabled(true);
      stopTelemetry = startTelemetry(l, store, bf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const timeout = e instanceof MspError && e.kind === 'timeout';
      const board = store.get().info?.boardName || lastBoard;
      await l.close().catch(() => undefined);
      link = null;
      bf.reset();
      let error = t('conn.readFail', { msg });
      if (timeout && (opts.afterReboot || rebootCause)) {
        // The FC did not reboot: after `serialpassthrough ... reset` it keeps forwarding to the receiver until power-cycled.
        error = rebootCause === 'elrs-passthrough' ? t('conn.stuckPassthrough') : t('conn.stuckAfterReboot');
        const known = settings.get().noDtrReset;
        if (rebootCause === 'elrs-passthrough' && board && !known.includes(board)) settings.set({ noDtrReset: [...known, board] });
      } else if (timeout) error += ' ' + t('conn.replugHint');
      rebootCause = null;
      store.reset({ error });
    }
  }

  async function handleClose(l: FcLink, reason: 'lost' | 'reboot' | 'closed'): Promise<void> {
    if (l !== link) return;
    stopTelemetry?.();
    stopTelemetry = null;
    link = null;
    if (reason === 'reboot' && identity) {
      store.patch({ conn: 'reconnecting' });
      try {
        await attach(await SerialLink.reconnect(identity), { afterReboot: true });
        toast(t('conn.reconnected'), 'ok');
      } catch (e) {
        store.reset({ error: e instanceof Error ? e.message : t('conn.reconnectFail') });
      }
    } else if (reason === 'lost') {
      store.reset({ error: t('conn.lostError') });
      toast(t('conn.lostToast'), 'error');
    } else {
      store.reset();
    }
  }

  async function connect(): Promise<void> {
    if (!hasWebSerial()) {
      store.patch({ error: t('conn.noWebSerial') });
      return;
    }
    store.patch({ conn: 'connecting', error: null });
    try {
      await attach(await SerialLink.connect());
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotFoundError') store.patch({ conn: 'disconnected', error: null }); // anulowano wybor portu
      else store.reset({ error: t('conn.openFail', { msg: e instanceof Error ? e.message : String(e) }) });
    }
  }

  async function connectDemo(): Promise<void> {
    if (link) await link.close().catch(() => undefined);
    await attach(new DemoLink());
  }

  async function disconnect(): Promise<void> {
    stopTelemetry?.();
    stopTelemetry = null;
    const l = link;
    if (l && settings.get().armingDisable && bf.get().supported) await bf.setArmingDisabled(false); // release the interlock on a clean disconnect
    link = null;
    store.reset();
    await l?.close().catch(() => undefined);
  }

  async function refresh(): Promise<void> {
    if (!link) return;
    try {
      await bf.refresh(ALL_AREAS);
      syncCore();
    } catch {
      /* the next telemetry reads repair the state */
    }
  }

  /* ---------------- kopie i zmiany ---------------- */

  function rememberBackup(text: string): void {
    const craft = store.get().info?.craftName || 'drone';
    store.patch({ diff: text, diffAt: Date.now() });
    saveBackup({ at: Date.now(), craft, text });
  }

  function downloadBackup(): boolean {
    const b = store.get().diff ? { text: store.get().diff as string, craft: store.get().info?.craftName || 'drone' } : loadBackup();
    if (!b) return false;
    const name = b.craft.replace(/[^\w-]+/g, '_') || 'drone';
    downloadText(`${t('backup.filePrefix')}-${name}-${stamp()}.txt`, b.text);
    return true;
  }

  async function fetchDiff(): Promise<string | null> {
    const l = link;
    if (!l) {
      toast(t('conn.connectFirst'), 'error');
      return null;
    }
    toast(t('backup.fetching'), 'info');
    try {
      const got: { text: string | null } = { text: null };
      await l.cli(['diff all'], { onEntry: (e: CliEntry) => (got.text = e.output) });
      if (got.text) {
        rememberBackup(got.text);
        if (l.kind === 'demo') await refresh();
      }
      return got.text;
    } catch (e) {
      toast(t('backup.fetchFail', { msg: e instanceof Error ? e.message : String(e) }), 'error');
      return null;
    }
  }

  async function applyCommands(commands: string[], options: ApplyOptions = {}): Promise<boolean> {
    const clean = commands.map((c) => c.trim()).filter((c) => c && !c.startsWith('#'));
    if (!clean.length) return false;
    const blocked = clean.filter((c) => BLOCKED_CLI.test(c));
    if (blocked.length) {
      toast(t('apply.blocked', { cmds: blocked.join(', ') }), 'error');
      return false;
    }
    const l = link;
    if (!l) {
      toast(t('conn.connectFirst'), 'error');
      return false;
    }
    const ok = await confirmDialog({
      title: options.title ?? t('apply.title'),
      confirmText: t('apply.confirm'),
      body: `<p>${t('apply.intro')}</p>
        <pre class="code">${escapeHtml(clean.join('\n'))}</pre>
        <p class="save-note">${t('apply.backupNote')}</p>
        ${options.note ? `<p>${options.note}</p>` : ''}
        <p class="warn-note">${t('apply.propsWarn')}</p>`,
    });
    if (!ok) return false;

    toast(t('apply.working'), 'info');
    try {
      const res = await l.cli(['diff all', ...clean], {
        save: true,
        stopOnError: true,
        onEntry: (e, i) => {
          if (i === 0 && e.command === 'diff all') {
            rememberBackup(e.output);
            downloadBackup();
          }
        },
      });
      if (!res.ok) {
        const bad = res.entries.find((e) => e.error);
        toast(t('apply.rejected', { cmd: bad?.command ?? '?', detail: bad?.output ? `: ${bad.output}` : '' }), 'error');
        if (l.kind === 'demo') await refresh();
        return false;
      }
      toast(t('apply.saved'), 'ok');
      if (l.kind === 'demo') await refresh();
      else {
        // Zwykle port sie zamyka i handleClose robi reconnect; jesli nie, odswiez recznie.
        setTimeout(() => {
          if (link === l && store.get().conn === 'connected') void refresh();
        }, 5000);
      }
      return true;
    } catch (e) {
      toast(t('apply.error', { msg: e instanceof Error ? e.message : String(e) }), 'error');
      return false;
    }
  }

  /* ---------------- UI: top bar, screen, drawer ---------------- */

  let screenEl!: HTMLElement;
  let bodyEl!: HTMLElement;
  let navEl!: HTMLElement;
  let connEl!: HTMLElement;

  /** Sidebar: the short beginner list first; Expert adds every Betaflight tab grouped like the Configurator, plus tool links. */
  function navHtml(): string {
    const mode = currentMode(settings);
    const item = (sc: (typeof SCREENS)[number], label: string) =>
      `<a href="#${sc.id}" data-route="${sc.id}" data-needs-fc="${sc.requiresConnection}">${icon(sc.icon, 19)}<span>${escapeHtml(label)}</span><b class="badge" hidden></b></a>`;
    const simple = SCREENS.filter((sc) => sc.simple && sc.nav !== false);
    let html = `<div class="sgrp">${simple.map((sc) => item(sc, t(sc.simple!))).join('')}</div>`;
    if (mode === 'expert') {
      const rest = SCREENS.filter((sc) => !sc.simple && sc.nav !== false && screenVisible(sc, mode));
      html += SECTIONS.map((sec) => {
        if (sec === 'tools') {
          const link = (l: ToolLink) => `<a class="ext" href="${l.url}" target="_blank" rel="noopener noreferrer" title="${t('nav.links.openExt')}">${icon(l.id === 'cp210x' || l.id === 'zadig' || l.id === 'impulserc' ? 'download' : 'external', 16)}<span>${t(l.labelKey)}</span></a>`;
          const drivers = new Set(['cp210x', 'zadig', 'impulserc']);
          return `<div class="sgrp"><div class="sgrp-h">${t('nav.tools')}</div>${TOOL_LINKS.filter((l) => !drivers.has(l.id)).map(link).join('')}<div class="sgrp-sub">${t('nav.links.driversHead')}</div>${TOOL_LINKS.filter((l) => drivers.has(l.id)).map(link).join('')}</div>`;
        }
        const list = rest.filter((sc) => sectionOf(sc.id) === sec);
        if (!list.length) return '';
        return `<div class="sgrp"><div class="sgrp-h">${t(`nav.${sec}`)}</div>${list.map((sc) => item(sc, t(sc.titleKey))).join('')}</div>`;
      }).join('');
    }
    return html + '<span class="nav-ind" aria-hidden="true"></span>';
  }

  /** Problem counters next to the tabs, from the rule results (red = failure, amber = warning). All of them also count on Drone. */
  const PART_ROUTE: Record<Part, string> = { esc: 'esc', motors: 'esc', rx: 'bf-receiver', battery: 'power', fc: 'setup' };
  function renderBadges(): void {
    const counts = new Map<string, { n: number; fail: boolean }>();
    const add = (r: string, fail: boolean) => {
      const e = counts.get(r) ?? { n: 0, fail: false };
      e.n++;
      e.fail ||= fail;
      counts.set(r, e);
    };
    if (store.get().conn === 'connected') {
      for (const c of diagnose(store.get(), bf.get()).checks) {
        if (c.severity !== 'fail' && c.severity !== 'warn') continue;
        add('warsztat', c.severity === 'fail');
        if (c.part && currentMode(settings) === 'expert') add(PART_ROUTE[c.part], c.severity === 'fail');
      }
    }
    navEl.querySelectorAll<HTMLElement>('a[data-route]').forEach((a) => {
      const b = a.querySelector<HTMLElement>('.badge');
      const e = counts.get(a.dataset.route ?? '');
      if (!b) return;
      b.hidden = !e;
      b.textContent = e ? String(e.n) : '';
      b.className = `badge${e?.fail ? ' fail' : ''}`;
      if (e) b.title = t('nav.problems', { n: e.n });
    });
  }

  function expertSwitchHtml(): string {
    const on = currentMode(settings) === 'expert';
    return `<button type="button" class="w-expert" role="switch" aria-checked="${on}" data-act="expert"><span>${t('simple.nav.expert')}</span><span class="w-toggle" aria-hidden="true"></span></button>`;
  }

  /** (Re)builds the whole shell: sidebar (bottom tab bar on phones), connection block, empty screen area. Called on start and on language change. */
  function buildShell(): void {
    root.innerHTML = `
    <div class="w-app">
      <aside class="w-rail">
        <div class="w-top">
          <div class="w-brand">${logo(26)}<span>${t('shell.brand')}</span></div>
          <div class="w-conn" aria-live="polite"></div>
          <button class="w-btn quiet w-top-set" data-act="settings" aria-label="${t('simple.nav.settings')}">${icon('settings', 20)}</button>
        </div>
        <nav class="nav" aria-label="${t('shell.tabsAria')}">${navHtml()}</nav>
        <div class="w-rail-foot">
          <button class="w-btn quiet" data-act="drawer">${icon('chat', 18)}${t('simple.nav.assistant')}</button>
          <button class="w-btn quiet" data-act="search">${icon('search', 18)}${t('simple.nav.search')}</button>
          <button class="w-btn quiet" data-act="settings">${icon('settings', 18)}${t('simple.nav.settings')}</button>
          ${expertSwitchHtml()}
        </div>
      </aside>
      <div class="body"><main class="screen" id="screen"></main></div>
    </div>`;
    screenEl = root.querySelector<HTMLElement>('#screen') as HTMLElement;
    bodyEl = root.querySelector<HTMLElement>('.body') as HTMLElement;
    navEl = root.querySelector<HTMLElement>('.nav') as HTMLElement;
    connEl = root.querySelector<HTMLElement>('.w-conn') as HTMLElement;
  }

  let current: Route = parseRoute();
  let unmount: (() => void) | null = null;

  const ctx: AppContext = {
    state: store,
    settings,
    ai,
    link: () => link,
    bf,
    diagnosis: () => diagnose(store.get(), bf.get()),
    route: () => current,
    navigate: (r) => {
      location.hash = r;
    },
    connect,
    connectDemo,
    disconnect,
    refresh,
    applyCommands,
    fetchDiff,
    downloadBackup,
    askAi: (q) => {
      ctx.openDrawer();
      void ai.ask(q);
    },
    openDrawer: () => {
      drawerOpen = true;
      syncLayout();
    },
    noteRebootCause: (c) => {
      rebootCause = c;
      if (c) lastBoard = store.get().info?.boardName || lastBoard;
    },
    toast,
    confirm: confirmDialog,
  };

  initHwInfo(ctx); // ESC info (4-way) + ELRS version (CRSF): preconditions, auto-run after connect, status

  let drawer: Drawer | null = null;

  function drawerVisible(): boolean {
    return drawerOpen && store.get().conn !== 'disconnected' && current !== 'ustawienia';
  }

  function syncLayout(): void {
    const show = drawerVisible();
    if (show && !drawer) {
      drawer = createDrawer(ctx);
      bodyEl.appendChild(drawer.el);
    } else if (!show && drawer) {
      drawer.destroy();
      drawer.el.remove();
      drawer = null;
      document.body.classList.remove('has-hot');
    }
    bodyEl.classList.toggle('with-drawer', show);
    // the panel button only makes sense once connected
    const btn = root.querySelector<HTMLElement>('[data-act="drawer"]');
    if (btn) {
      btn.hidden = store.get().conn === 'disconnected' || current === 'ustawienia';
      btn.setAttribute('aria-pressed', String(show));
    }
  }

  function mountScreen(): void {
    unmount?.();
    unmount = null;
    document.body.classList.remove('has-hot');
    screenEl.innerHTML = '';
    screenEl.dataset.route = current;
    const def = findScreen(current) ?? findScreen(DEFAULT_SCREEN);
    screenEl.classList.toggle('modern', !!def?.modern);
    screenEl.classList.toggle('legacy', !def?.modern);
    if (def && !screenVisible(def, currentMode(settings))) {
      // Expert-only tab opened in Basic mode (old link, AI pointer): say so instead of hiding it silently.
      screenEl.innerHTML = `<div class="expert-only"><p>${t('mode.expertOnly')}</p><button class="btn p" data-act="to-expert">${t('mode.expertOnlyAction')}</button></div>`;
    } else if (def) unmount = def.mount(screenEl, ctx);
    navEl.querySelectorAll<HTMLElement>('a').forEach((a) => {
      const on = a.dataset.route === current;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    moveIndicator();
    syncLayout();
    enterScreen();
  }

  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Slides the tab underline to the active tab (transform only; the first placement does not animate). */
  function moveIndicator(): void {
    const ind = navEl.querySelector<HTMLElement>('.nav-ind');
    if (!ind) return;
    const a = navEl.querySelector<HTMLElement>('a.on');
    ind.hidden = !a;
    if (!a) return;
    ind.style.transform = `translateY(${a.offsetTop}px)`;
    ind.style.height = `${a.offsetHeight}px`;
    if (!ind.classList.contains('ready')) requestAnimationFrame(() => ind.classList.add('ready'));
  }

  /** New tab content fades up 4px (WAAPI: runs on the compositor while the screen is still rendering). */
  function enterScreen(): void {
    if (reduceMotion()) return;
    screenEl.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 170, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }

  function connHtml(): string {
    const s = store.get();
    const on = s.conn === 'connected' || s.conn === 'reconnecting';
    const dot = s.conn === 'connected' ? 'on' : s.conn === 'disconnected' ? '' : 'wait';
    const title =
      s.conn === 'disconnected'
        ? t('simple.conn.off')
        : s.conn === 'connecting'
          ? t('simple.conn.connecting')
          : s.conn === 'reconnecting'
            ? t('simple.conn.reconnecting')
            : s.info?.craftName || boardDisplayName(s.info);
    const sub = s.conn === 'disconnected' ? t('simple.conn.offSub') : s.mode === 'demo' ? t('simple.conn.demo') : on && s.info ? `Betaflight ${s.info.version}` : '';
    const meters = on
      ? `<div class="w-conn-meters"><span><small>${t('simple.conn.battery')}</small><b data-m="vbat">—</b></span><span><small>${t('simple.conn.link')}</small><b data-m="rssi">—</b></span></div>`
      : '';
    const btn = on
      ? `<button class="w-btn" data-act="disconnect">${t('simple.conn.disconnect')}</button>`
      : `<button class="w-btn primary" data-act="connect" ${s.conn === 'connecting' || !hasWebSerial() ? 'disabled' : ''}>${icon('plug', 16)}${t('simple.conn.connect')}</button>`;
    return `<div class="w-conn-row"><i class="w-dot ${dot}" aria-hidden="true"></i><div class="w-conn-txt"><div class="w-conn-t">${escapeHtml(title)}</div>${sub ? `<div class="w-conn-sub">${escapeHtml(sub)}</div>` : ''}</div></div>${meters}${btn}`;
  }

  let connKey = '';
  function renderBar(): void {
    const s = store.get();
    const key = JSON.stringify([s.conn, s.mode, s.info?.craftName, s.info?.boardName, s.info?.version, getLang()]);
    if (key !== connKey) {
      connKey = key;
      connEl.innerHTML = connHtml();
      renderTelemetry();
    }
    navEl.classList.toggle('offline', s.conn !== 'connected' && s.conn !== 'reconnecting');
    renderBadges();
    syncLayout();
  }

  function renderTelemetry(): void {
    const tel = store.get().telemetry;
    const v = connEl.querySelector<HTMLElement>('[data-m="vbat"]');
    const r = connEl.querySelector<HTMLElement>('[data-m="rssi"]');
    if (!tel || !v || !r) return;
    v.textContent = `${tel.vbat.toFixed(1)} V`;
    r.textContent = `${rssiPct(tel.rssi)}%`;
  }

  /** Ctrl+K: find a tab or a setting; a setting opens its tab, scrolls to the bulb, rings it and opens the tip. */
  function search(): void {
    openSearch(currentMode(settings), (route, tipKey) => {
      if (route !== current) ctx.navigate(route);
      if (!tipKey) return;
      setTimeout(() => {
        const bulb = screenEl.querySelector<HTMLElement>(`.tip[data-tip="${tipKey}"]`);
        if (!bulb) return;
        bulb.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
        setTimeout(() => {
          ringElement(bulb.closest('label, .row, tr, .bf-field, .field, div') ?? bulb);
          bulb.focus();
        }, reduceMotion() ? 0 : 280);
      }, 260);
    });
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      search();
    }
  });

  /** Switches Basic/Expert: rebuilds the tab bar in place; an expert-only screen gets the "switch to Expert" note. */
  function setMode(m: 'basic' | 'expert'): void {
    if (currentMode(settings) === m && settings.get().uiMode) return;
    settings.set({ uiMode: m });
    navEl.innerHTML = navHtml();
    root.querySelector('.w-expert')?.setAttribute('aria-checked', String(m === 'expert'));
    renderBar();
    mountScreen();
    toast(t(m === 'basic' ? 'mode.toBasic' : 'mode.toExpert'), 'info');
  }

  root.addEventListener('click', (e) => {
    const modeBtn = (e.target as HTMLElement).closest<HTMLElement>('.mode-sw [data-mode]')?.dataset.mode;
    if (modeBtn === 'basic' || modeBtn === 'expert') {
      setMode(modeBtn);
      return;
    }
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'settings') ctx.navigate('ustawienia');
    else if (act === 'expert') setMode(currentMode(settings) === 'expert' ? 'basic' : 'expert');
    else if (act === 'connect') void connect();
    else if (act === 'disconnect') void disconnect();
    else if (act === 'search') search();
    else if (act === 'to-expert') setMode('expert');
    else if (act === 'drawer') {
      drawerOpen = !drawerOpen;
      syncLayout();
    }
  });

  store.subscribe(() => {
    if (store.get().conn === 'disconnected') bf.reset();
  });
  store.subscribe(renderBar);
  store.subscribeTelemetry(renderTelemetry);
  window.addEventListener('hashchange', () => {
    const r = parseRoute();
    if (r !== current) {
      current = r;
      mountScreen();
    }
  });

  // Language switch: rebuild the shell, drawer and current screen in place (no reload).
  onLanguageChange((lang) => {
    unmount?.();
    unmount = null;
    if (drawer) {
      drawer.destroy();
      drawer.el.remove();
      drawer = null;
    }
    buildShell();
    connKey = '';
    renderBar();
    mountScreen();
    window.workspacefpv?.setLanguage?.(lang);
  });

  // ?mode=basic|expert (screenshots, links from the docs) sets the interface mode without asking.
  const qMode = new URLSearchParams(location.search).get('mode');
  if (qMode === 'basic' || qMode === 'expert') settings.set({ uiMode: qMode });
  applyModeAttrs(settings);
  applyTheme(settings);
  settings.subscribe(() => {
    applyModeAttrs(settings);
    applyTheme(settings);
  });
  initTips();

  buildShell();
  renderBar();
  mountScreen();
  window.workspacefpv?.setLanguage?.(getLang());

  // ?demo=1 enters demo mode right away (for screenshots)
  if (new URLSearchParams(location.search).get('demo') === '1') void connectDemo();

  // Updates (Electron only): pass the setting to main and show a quiet toast when a new version is found automatically.
  const upd = updatesApi();
  if (upd) {
    void upd.setAutoCheck(settings.get().checkUpdates);
    upd.onStatus((s) => {
      if (s.state === 'available' && s.auto) toast(t('updateToast', { version: s.version }), 'info');
    });
  }

  return ctx;
}
