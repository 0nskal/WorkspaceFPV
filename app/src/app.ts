import { Assistant } from './ai/assistant';
import { buildContext } from './ai/prompts';
import { ROUTES, type AppContext, type ApplyOptions, type Route, type ScreenMount } from './context';
import { diagnose } from './fc/diagnose';
import { readAll, startTelemetry } from './fc/read';
import { FcStore, rssiPct, type FcState } from './fc/state';
import { BLOCKED_CLI } from './serial/cli';
import { DemoLink } from './serial/demo';
import { SerialLink } from './serial/link';
import { hasWebSerial } from './serial/port';
import type { CliEntry, FcLink } from './serial/types';
import { SettingsStore, loadBackup, saveBackup } from './settings';
import { downloadText, escapeHtml, stamp } from './ui/dom';
import { createDrawer, type Drawer } from './ui/drawer';
import { icon, logo } from './ui/icons';
import { confirmDialog, toast } from './ui/modal';
import { updatesApi } from './updates';
import * as esc from './screens/esc';
import * as autotune from './screens/autotune';
import * as elrs from './screens/elrs';
import * as ustawienia from './screens/ustawienia';
import * as warsztat from './screens/warsztat';

const SCREENS: Record<Route, { mount: ScreenMount }> = { warsztat, esc, autotune, elrs, ustawienia };

const TABS: Array<{ route: Route; label: string }> = [
  { route: 'warsztat', label: 'Warsztat' },
  { route: 'esc', label: 'ESC' },
  { route: 'autotune', label: 'Autotune PID' },
  { route: 'elrs', label: 'ELRS' },
];

const parseRoute = (): Route => {
  const h = location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(h) ? h : 'warsztat';
};

export function createApp(root: HTMLElement): AppContext {
  const store = new FcStore();
  const settings = new SettingsStore();
  let link: FcLink | null = null;
  let stopTelemetry: (() => void) | null = null;
  let identity: { usbVendorId?: number; usbProductId?: number } | null = null;
  let drawerOpen = true;

  const ai = new Assistant(
    () => ({ apiKey: settings.get().apiKey, model: settings.get().model }),
    () => buildContext(store.get(), store.get().conn === 'connected' ? diagnose(store.get()) : null),
  );

  /* ---------------- polaczenie ---------------- */

  const mergeMeta = (mode: 'serial' | 'demo' | null): FcState['meta'] => {
    const v = settings.get().elrsVersion.trim();
    return { elrsVersion: v || (mode === 'demo' ? '3.4.3' : undefined) };
  };

  async function attach(l: FcLink): Promise<void> {
    stopTelemetry?.();
    link = l;
    if (l instanceof SerialLink) identity = l.identity;
    l.onClose((reason) => void handleClose(l, reason));
    store.patch({ conn: 'connecting', mode: l.kind, error: null });
    try {
      const data = await readAll(l);
      store.patch({ ...data, conn: 'connected', mode: l.kind, meta: mergeMeta(l.kind), error: null });
      stopTelemetry = startTelemetry(l, store);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await l.close().catch(() => undefined);
      link = null;
      store.reset({ error: `Nie udało się odczytać FC: ${msg}. Sprawdź kabel USB i czy to płytka z Betaflight.` });
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
        await attach(await SerialLink.reconnect(identity));
        toast('FC połączony ponownie.', 'ok');
      } catch (e) {
        store.reset({ error: e instanceof Error ? e.message : 'Nie udało się połączyć ponownie.' });
      }
    } else if (reason === 'lost') {
      store.reset({ error: 'Połączenie z FC zostało utracone (odłączono kabel?).' });
      toast('Utracono połączenie z FC.', 'error');
    } else {
      store.reset();
    }
  }

  async function connect(): Promise<void> {
    if (!hasWebSerial()) {
      store.patch({ error: 'Ta przeglądarka nie obsługuje WebSerial. Użyj Chrome/Edge albo aplikacji na Windows.' });
      return;
    }
    store.patch({ conn: 'connecting', error: null });
    try {
      await attach(await SerialLink.connect());
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotFoundError') store.patch({ conn: 'disconnected', error: null }); // anulowano wybor portu
      else store.reset({ error: `Nie udało się otworzyć portu: ${e instanceof Error ? e.message : String(e)}` });
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
    link = null;
    store.reset();
    await l?.close().catch(() => undefined);
  }

  async function refresh(): Promise<void> {
    if (!link) return;
    try {
      store.patch(await readAll(link));
    } catch {
      /* kolejne odczyty telemetrii naprawia stan */
    }
  }

  /* ---------------- kopie i zmiany ---------------- */

  function rememberBackup(text: string): void {
    const craft = store.get().info?.craftName ?? 'dron';
    store.patch({ diff: text, diffAt: Date.now() });
    saveBackup({ at: Date.now(), craft, text });
  }

  function downloadBackup(): boolean {
    const b = store.get().diff ? { text: store.get().diff as string, craft: store.get().info?.craftName ?? 'dron' } : loadBackup();
    if (!b) return false;
    const name = b.craft.replace(/[^\w-]+/g, '_') || 'dron';
    downloadText(`rotorlab-kopia-${name}-${stamp()}.txt`, b.text);
    return true;
  }

  async function fetchDiff(): Promise<string | null> {
    const l = link;
    if (!l) {
      toast('Najpierw połącz się z FC.', 'error');
      return null;
    }
    toast('Pobieram konfigurację (diff all). FC zrestartuje się po wyjściu z CLI.', 'info');
    try {
      const got: { text: string | null } = { text: null };
      await l.cli(['diff all'], { onEntry: (e: CliEntry) => (got.text = e.output) });
      if (got.text) {
        rememberBackup(got.text);
        if (l.kind === 'demo') await refresh();
      }
      return got.text;
    } catch (e) {
      toast(`Nie udało się pobrać konfiguracji: ${e instanceof Error ? e.message : String(e)}`, 'error');
      return null;
    }
  }

  async function applyCommands(commands: string[], options: ApplyOptions = {}): Promise<boolean> {
    const clean = commands.map((c) => c.trim()).filter((c) => c && !c.startsWith('#'));
    if (!clean.length) return false;
    const blocked = clean.filter((c) => BLOCKED_CLI.test(c));
    if (blocked.length) {
      toast(`Rotorlab nie wysyła tych komend: ${blocked.join(', ')}. Wykonaj je ręcznie w CLI, jeśli wiesz, co robisz.`, 'error');
      return false;
    }
    const l = link;
    if (!l) {
      toast('Najpierw połącz się z FC.', 'error');
      return false;
    }
    const ok = await confirmDialog({
      title: options.title ?? 'Zastosować zmiany w FC?',
      confirmText: 'Zastosuj w FC',
      body: `<p>Komendy, które wyślę do FC:</p>
        <pre class="code">${escapeHtml(clean.join('\n'))}</pre>
        <p class="save-note"><strong>Najpierw zapiszę kopię ustawień</strong> (<code>diff all</code>) i pobiorę ją jako plik. Potem zastosuję komendy i zapiszę konfigurację (<code>save</code>). FC zrestartuje się, a Rotorlab połączy się ponownie.</p>
        ${options.note ? `<p>${options.note}</p>` : ''}
        <p class="warn-note">Zdejmij śmigła, zanim cokolwiek zmienisz w układzie napędowym.</p>`,
    });
    if (!ok) return false;

    toast('Zapisuję kopię i stosuję zmiany…', 'info');
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
        toast(`FC odrzucił komendę „${bad?.command ?? '?'}”${bad?.output ? `: ${bad.output}` : ''}. Zmiany nie zostały zapisane.`, 'error');
        if (l.kind === 'demo') await refresh();
        return false;
      }
      toast('Zapisano w FC. Restartuję i łączę ponownie…', 'ok');
      if (l.kind === 'demo') await refresh();
      else {
        // Zwykle port sie zamyka i handleClose robi reconnect; jesli nie, odswiez recznie.
        setTimeout(() => {
          if (link === l && store.get().conn === 'connected') void refresh();
        }, 5000);
      }
      return true;
    } catch (e) {
      toast(`Błąd podczas zapisu: ${e instanceof Error ? e.message : String(e)}`, 'error');
      return false;
    }
  }

  /* ---------------- UI: pasek, ekran, szuflada ---------------- */

  root.innerHTML = `
    <header class="bar">
      <div class="brand">${logo(24)}Rotorlab</div>
      <div class="sep"></div>
      <div class="st"><i></i><span class="st-t">Niepołączono</span></div>
      <div class="sep dn-sep"></div>
      <div class="dn"></div>
      <nav class="nav" aria-label="Zakładki"></nav>
      <div class="tel">
        <svg class="gyro" width="98" height="22" viewBox="0 0 98 22" aria-hidden="true"><polyline fill="none" stroke="#CFE6F2" stroke-width="1.1" points=""/></svg>
        <span class="rssi">RSSI <b>—</b></span>
        <button class="ib" data-act="settings" title="Ustawienia" aria-label="Ustawienia">${icon('settings', 17)}</button>
        <button class="ib" data-act="drawer" title="Pokaż/ukryj asystenta" aria-label="Asystent AI">${icon('panel', 17)}</button>
      </div>
    </header>
    <div class="body"><main class="screen" id="screen"></main></div>`;

  const screenEl = root.querySelector<HTMLElement>('#screen') as HTMLElement;
  const bodyEl = root.querySelector<HTMLElement>('.body') as HTMLElement;
  const navEl = root.querySelector<HTMLElement>('.nav') as HTMLElement;
  const stT = root.querySelector<HTMLElement>('.st-t') as HTMLElement;
  const stI = root.querySelector<HTMLElement>('.st i') as HTMLElement;
  const dnEl = root.querySelector<HTMLElement>('.dn') as HTMLElement;
  const rssiEl = root.querySelector<HTMLElement>('.rssi b') as HTMLElement;
  const gyroLine = root.querySelector<SVGPolylineElement>('.gyro polyline') as SVGPolylineElement;

  navEl.innerHTML = TABS.map((t) => `<a href="#${t.route}" data-route="${t.route}">${t.label}</a>`).join('');

  let current: Route = parseRoute();
  let unmount: (() => void) | null = null;

  const ctx: AppContext = {
    state: store,
    settings,
    ai,
    link: () => link,
    diagnosis: () => diagnose(store.get()),
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
    toast,
    confirm: confirmDialog,
  };

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
    // przycisk panelu ma sens tylko po polaczeniu
    const btn = root.querySelector<HTMLElement>('[data-act="drawer"]');
    if (btn) btn.hidden = store.get().conn === 'disconnected' || current === 'ustawienia';
  }

  function mountScreen(): void {
    unmount?.();
    unmount = null;
    document.body.classList.remove('has-hot');
    screenEl.innerHTML = '';
    screenEl.dataset.route = current;
    unmount = SCREENS[current].mount(screenEl, ctx);
    navEl.querySelectorAll<HTMLElement>('a').forEach((a) => a.classList.toggle('on', a.dataset.route === current));
    syncLayout();
  }

  function renderBar(): void {
    const s = store.get();
    const text: Record<FcState['conn'], string> = {
      disconnected: 'Niepołączono',
      connecting: 'Łączenie…',
      connected: s.mode === 'demo' ? 'Tryb demo' : `Połączono · ${link?.label ?? 'USB'}`,
      reconnecting: 'Ponowne łączenie…',
    };
    stT.textContent = text[s.conn];
    stI.className = s.conn === 'connected' ? 'on' : s.conn === 'disconnected' ? '' : 'wait';
    dnEl.textContent = s.conn === 'connected' || s.conn === 'reconnecting' ? s.info?.craftName ?? '' : '';
    (root.querySelector('.dn-sep') as HTMLElement).hidden = !dnEl.textContent;
    if (s.conn === 'disconnected') {
      rssiEl.textContent = '—';
      gyroLine.setAttribute('points', '');
    }
    syncLayout();
  }

  const gyro: number[] = [];
  function renderTelemetry(): void {
    const t = store.get().telemetry;
    if (!t) return;
    rssiEl.textContent = `${rssiPct(t.rssi)}%`;
    gyro.push(Math.hypot(...t.gyro));
    if (gyro.length > 45) gyro.shift();
    const max = Math.max(20, ...gyro);
    gyroLine.setAttribute('points', gyro.map((g, i) => `${(i * 2.2).toFixed(1)},${(20.5 - Math.min(19, (g / max) * 19)).toFixed(1)}`).join(' '));
  }

  root.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'settings') ctx.navigate('ustawienia');
    else if (act === 'drawer') {
      drawerOpen = !drawerOpen;
      syncLayout();
    }
  });

  store.subscribe(renderBar);
  store.subscribeTelemetry(renderTelemetry);
  settings.subscribe(() => {
    store.patch({ meta: mergeMeta(store.get().mode) });
  });
  window.addEventListener('hashchange', () => {
    const r = parseRoute();
    if (r !== current) {
      current = r;
      mountScreen();
    }
  });

  renderBar();
  mountScreen();

  // ?demo=1 od razu wchodzi w tryb demo (do zrzutow ekranu)
  if (new URLSearchParams(location.search).get('demo') === '1') void connectDemo();

  // Aktualizacje (tylko Electron): przekaz ustawienie do main i pokaz dyskretny toast po automatycznym wykryciu nowej wersji.
  const upd = updatesApi();
  if (upd) {
    void upd.setAutoCheck(settings.get().checkUpdates);
    upd.onStatus((s) => {
      if (s.state === 'available' && s.auto) toast(`Dostępna wersja ${s.version} – Ustawienia → Aktualizacje`, 'info');
    });
  }

  return ctx;
}
