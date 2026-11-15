/** Wspolne typy warstwy komunikacji z FC (prawdziwy port albo demo). */

export interface CliEntry {
  command: string;
  output: string;
  /** true, gdy FC odpowiedzial bledem (Invalid / ERROR / Parse error). */
  error: boolean;
}

export interface CliResult {
  ok: boolean;
  entries: CliEntry[];
  /** Pelny transkrypt sesji. */
  transcript: string;
  /** Czy sesja zakonczyla sie zapisem (save) i restartem FC. */
  saved: boolean;
}

export interface CliOptions {
  /** Wyslij `save` na koncu (FC sie restartuje). Bez tego sesja konczy `exit` (zmiany odrzucone, FC tez sie restartuje). */
  save?: boolean;
  /** Wolane po kazdej wykonanej komendzie (np. aby od razu zapisac kopie z `diff all`). */
  onEntry?: (entry: CliEntry, index: number) => void;
  /** Przerwij sesje (bez save) po pierwszym bledzie komendy. */
  stopOnError?: boolean;
}

export type CloseReason = 'lost' | 'reboot' | 'closed';

export interface FcLink {
  readonly kind: 'serial' | 'demo';
  /** Krotki opis do paska: "USB" / "Demo". */
  readonly label: string;
  /** Prawda w trakcie sesji CLI (telemetria MSP wstrzymana). */
  readonly busy: boolean;
  /** Zapytanie MSP v1; zwraca payload odpowiedzi. Kolejkowane, timeout domyslnie 1 s. */
  request(cmd: number, payload?: Uint8Array, timeoutMs?: number): Promise<Uint8Array>;
  /** Wchodzi w tryb CLI, wykonuje komendy, konczy `save` albo `exit`. FC po tym sie restartuje. */
  cli(commands: string[], options?: CliOptions): Promise<CliResult>;
  onClose(cb: (reason: CloseReason) => void): () => void;
  close(): Promise<void>;
}

export interface PortIdentity {
  usbVendorId?: number;
  usbProductId?: number;
}
