import type { SerialTransport } from './port';
import type { MspClient } from './msp';
import type { CliEntry, CliOptions, CliResult } from './types';
import { sleep } from './port';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Komendy, ktorych Rotorlab nie wysyla do FC (zbyt ryzykowne bez osobnej decyzji uzytkownika). */
export const BLOCKED_CLI = /^(defaults|bl|dfu|bootloader|msc|flash_erase|flash_write|exit|save)(\s|$)/i;

/** Prompt CLI Betaflight to "# " na poczatku linii na koncu bufora. */
const atPrompt = (s: string) => /(^|\n)# $/.test(s);

const looksLikeError = (cmd: string, out: string) => {
  if (/^(diff|dump|get|help|status|version|tasks)(\s|$)/i.test(cmd)) return false;
  return /invalid|error|parse error|unknown|not found|out of range/i.test(out);
};

class Collector {
  buf = '';
  private waiters: Array<() => void> = [];
  private off: () => void;
  constructor(transport: SerialTransport) {
    this.off = transport.onData((d) => {
      this.buf += dec.decode(d, { stream: true });
      for (const w of this.waiters.splice(0)) w();
    });
  }
  /** Czeka az bufor skonczy sie promptem; zwraca zebrany tekst (i czysci bufor) albo null przy braku odpowiedzi. */
  async untilPrompt(timeoutMs: number): Promise<string | null> {
    const t0 = Date.now();
    while (!atPrompt(this.buf)) {
      const left = timeoutMs - (Date.now() - t0);
      if (left <= 0) {
        this.buf = '';
        return null;
      }
      await new Promise<void>((r) => {
        const t = setTimeout(r, Math.min(left, 100));
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }
    const out = this.buf;
    this.buf = '';
    return out;
  }
  dispose(): void {
    this.off();
  }
}

/** Wchodzi w CLI Betaflight (`#`), wykonuje komendy linia po linii, konczy `save` lub `exit`. */
export async function runCliSession(
  transport: SerialTransport,
  msp: MspClient,
  commands: string[],
  options: CliOptions = {},
): Promise<CliResult> {
  msp.suspend();
  const col = new Collector(transport);
  const entries: CliEntry[] = [];
  let transcript = '';
  let saved = false;
  try {
    await transport.write(enc.encode('#'));
    let banner = await col.untilPrompt(3000);
    if (banner === null) {
      await transport.write(enc.encode('\r\n#'));
      banner = await col.untilPrompt(3000);
    }
    if (banner === null) throw new Error('FC nie odpowiada w trybie CLI.');
    transcript += banner;

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i].trim();
      if (!cmd) continue;
      await transport.write(enc.encode(cmd + '\n'));
      const slow = /^(diff|dump)(\s|$)/i.test(cmd);
      const raw = await col.untilPrompt(slow ? 30000 : 8000);
      if (raw === null) throw new Error(`Brak odpowiedzi FC na: ${cmd}`);
      transcript += raw;
      const lines = raw.replace(/\r/g, '').split('\n');
      if (lines[0]?.trim() === cmd) lines.shift(); // echo komendy
      while (lines.length && (lines[lines.length - 1] === '# ' || lines[lines.length - 1] === '')) lines.pop();
      const entry: CliEntry = { command: cmd, output: lines.join('\n'), error: false };
      entry.error = looksLikeError(cmd, entry.output);
      entries.push(entry);
      options.onEntry?.(entry, i);
      if (entry.error && options.stopOnError) break;
    }

    const failed = entries.some((e) => e.error);
    if (options.save && !failed) {
      await transport.write(enc.encode('save\n'));
      saved = true;
    } else {
      await transport.write(enc.encode('exit\n'));
    }
    await sleep(300); // FC restartuje sie - port sam sie zamknie
    return { ok: !failed, entries, transcript, saved };
  } finally {
    col.dispose();
    msp.resume();
  }
}
