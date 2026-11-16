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

/**
 * Raw byte access to the FC port for sessions that leave MSP (4-way ESC interface, CLI text, CRSF passthrough).
 * While a raw session runs the MSP client is suspended and `FcLink.busy` is true.
 */
export interface RawIo {
  write(data: Uint8Array): Promise<void>;
  /** Waits for n bytes; returns them or null on timeout (nothing consumed). */
  readExact(n: number, timeoutMs: number): Promise<Uint8Array | null>;
  /** Waits up to timeoutMs for data; returns (and consumes) everything buffered, possibly empty. */
  readSome(timeoutMs: number): Promise<Uint8Array>;
  /** Drops buffered input. */
  clear(): void;
  /** Declares that the FC is about to reset (the port will drop): the link reports 'reboot' and the app reconnects. */
  expectReboot(): void;
  /** Lowers DTR and closes the port (`serialpassthrough ... reset` makes the FC reset on DTR drop). Implies expectReboot. */
  dropDtrAndClose(): Promise<void>;
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
  /**
   * Raw session (see RawIo): MSP is suspended while `fn` runs and resumed afterwards, unless `fn` declared a reboot.
   * Optional: only links that can do raw access implement it (SerialLink and DemoLink do).
   */
  raw?<T>(fn: (io: RawIo) => Promise<T>): Promise<T>;
  onClose(cb: (reason: CloseReason) => void): () => void;
  close(): Promise<void>;
}

export interface PortIdentity {
  usbVendorId?: number;
  usbProductId?: number;
}
