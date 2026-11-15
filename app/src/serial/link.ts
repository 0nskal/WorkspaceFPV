import { SerialTransport } from './port';
import { MspClient } from './msp';
import { runCliSession } from './cli';
import type { CliOptions, CliResult, CloseReason, FcLink, PortIdentity } from './types';

/** Prawdziwe polaczenie z FC przez WebSerial: transport + MSP + CLI. */
export class SerialLink implements FcLink {
  readonly kind = 'serial' as const;
  readonly label = 'USB';
  busy = false;
  readonly identity: PortIdentity;
  private msp: MspClient;
  private closeCbs = new Set<(r: CloseReason) => void>();
  private rebootExpected = false;
  private userClosed = false;

  constructor(private transport: SerialTransport) {
    this.identity = transport.identity;
    this.msp = new MspClient(transport);
    transport.onClose(() => {
      this.msp.dispose();
      const reason: CloseReason = this.userClosed ? 'closed' : this.rebootExpected ? 'reboot' : 'lost';
      for (const cb of [...this.closeCbs]) cb(reason);
    });
  }

  /** Wybor portu przez uzytkownika (gest) i otwarcie. */
  static async connect(): Promise<SerialLink> {
    const t = await SerialTransport.request();
    await t.open();
    return new SerialLink(t);
  }

  /** Ponowne polaczenie z tym samym urzadzeniem po restarcie FC. */
  static async reconnect(identity: PortIdentity): Promise<SerialLink> {
    return new SerialLink(await SerialTransport.reopen(identity));
  }

  request(cmd: number, payload?: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
    return this.msp.request(cmd, payload, timeoutMs);
  }

  async cli(commands: string[], options?: CliOptions): Promise<CliResult> {
    this.busy = true;
    this.rebootExpected = true; // kazda sesja CLI konczy sie restartem FC (save albo exit)
    try {
      return await runCliSession(this.transport, this.msp, commands, options);
    } catch (e) {
      this.rebootExpected = false;
      throw e;
    } finally {
      this.busy = false;
    }
  }

  onClose(cb: (reason: CloseReason) => void): () => void {
    this.closeCbs.add(cb);
    return () => this.closeCbs.delete(cb);
  }

  async close(): Promise<void> {
    this.userClosed = true;
    await this.transport.close();
  }
}
