/**
 * Kontrakt dla ekranow.
 *
 * Kazdy ekran (app/src/screens/<nazwa>.ts) eksportuje `mount`:
 *
 *   export const mount: ScreenMount = (el, ctx) => {
 *     el.innerHTML = '...';              // ekran rysuje sie w `el` (obszar po lewej od szuflady AI)
 *     const off = ctx.state.subscribe(() => { ... });   // zmiany strukturalne (polaczenie, konfiguracja, status)
 *     const offT = ctx.state.subscribeTelemetry(() => { ... }); // probki ~10 Hz (silniki, bateria, RSSI, gyro)
 *     return () => { off(); offT(); };   // sprzatanie przy zmianie zakladki
 *   };
 *
 * Ekran sam obsluguje stan "brak polaczenia" (ctx.state.get().conn !== 'connected').
 * Zmiany w FC robimy WYLACZNIE przez ctx.applyCommands (potwierdzenie + kopia + save + ponowne polaczenie).
 */
import type { Assistant } from './ai/assistant';
import type { Diagnosis } from './fc/diagnose';
import type { FcStore } from './fc/state';
import type { FcLink } from './serial/types';
import type { SettingsStore } from './settings';
import type { ConfirmOptions } from './ui/modal';

/** Screen id (hash route). The list of valid ids lives in screens/registry.ts. */
export type Route = string;

export interface ApplyOptions {
  /** Tytul okna potwierdzenia. */
  title?: string;
  /** Dodatkowy tekst ostrzezenia w oknie potwierdzenia (HTML zaufany). */
  note?: string;
}

export interface AppContext {
  /** Magazyn stanu FC (info, config, status, pid, telemetry, cells, diff, meta). */
  readonly state: FcStore;
  readonly settings: SettingsStore;
  readonly ai: Assistant;

  /** Aktywne polaczenie MSP/CLI (prawdziwe albo demo) lub null. */
  link(): FcLink | null;
  /** Wynik regul diagnostycznych dla biezacego stanu. */
  diagnosis(): Diagnosis;

  route(): Route;
  navigate(route: Route): void;

  /** WebSerial: wybor portu (wymaga gestu uzytkownika) i polaczenie. */
  connect(): Promise<void>;
  connectDemo(): Promise<void>;
  disconnect(): Promise<void>;
  /** Ponowny odczyt konfiguracji/statusu z FC (bez restartu). */
  refresh(): Promise<void>;

  /**
   * Bezpieczne zastosowanie komend CLI: okno potwierdzenia -> kopia `diff all` (plik + pamiec) ->
   * komendy -> `save` -> FC sie restartuje -> automatyczne ponowne polaczenie i odczyt.
   * Zwraca true, jesli zmiany zostaly zapisane.
   */
  applyCommands(commands: string[], options?: ApplyOptions): Promise<boolean>;
  /** Pobiera `diff all` z FC (uwaga: FC sie restartuje po wyjsciu z CLI) i zapisuje w state.diff. */
  fetchDiff(): Promise<string | null>;
  /** Pobiera ostatnia kopie ustawien jako plik .txt. Zwraca false, gdy nie ma kopii. */
  downloadBackup(): boolean;

  /** Otwiera szuflade AI i wysyla pytanie. */
  askAi(question: string): void;
  openDrawer(): void;

  toast(message: string, kind?: 'info' | 'error' | 'ok'): void;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

export type ScreenMount = (el: HTMLElement, ctx: AppContext) => () => void;
