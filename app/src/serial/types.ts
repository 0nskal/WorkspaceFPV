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
  /**
   * MSP request; returns the reply payload. Queued (one in flight), default timeout 1 s, `attempts` = tries
   * on timeout (default 1). Codes above 254 go out as MSP v2 automatically. Rejects with MspError.
   */
  request(cmd: number, payload?: Uint8Array, timeoutMs?: number, attempts?: number): Promise<Uint8Array>;
  /**
   * Call right before MSP_REBOOT: tells the link how to treat the coming disconnect.
   * 'reconnect' = normal reboot, the app re-opens the port and re-reads; 'leave' = bootloader/MSC, no reconnect.
   */
  expectReboot(kind: 'reconnect' | 'leave'): void;
  /** Wchodzi w tryb CLI, wykonuje komendy, konczy `save` albo `exit`. FC po tym sie restartuje. */
  cli(commands: string[], options?: CliOptions): Promise<CliResult>;
  onClose(cb: (reason: CloseReason) => void): () => void;
  close(): Promise<void>;
}

export interface PortIdentity {
  usbVendorId?: number;
  usbProductId?: number;
}
