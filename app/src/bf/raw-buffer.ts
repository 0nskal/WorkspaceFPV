/** Byte buffer with awaitable reads, used for raw (non-MSP) sessions: 4-way interface, CLI text, CRSF. */
export class RawBuffer {
  private buf: Uint8Array = new Uint8Array(0);
  private waiters: Array<() => void> = [];

  push(data: Uint8Array): void {
    if (!data.length) return;
    const n = new Uint8Array(this.buf.length + data.length);
    n.set(this.buf);
    n.set(data, this.buf.length);
    this.buf = n;
    for (const w of this.waiters.splice(0)) w();
  }

  get size(): number {
    return this.buf.length;
  }

  clear(): void {
    this.buf = new Uint8Array(0);
  }

  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(done);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve();
      }, ms);
      this.waiters.push(done);
    });
  }

  /** Waits for n bytes; returns them (consumed) or null on timeout (nothing consumed). */
  async readExact(n: number, timeoutMs: number): Promise<Uint8Array | null> {
    const end = Date.now() + timeoutMs;
    while (this.buf.length < n) {
      const left = end - Date.now();
      if (left <= 0) return null;
      await this.wait(left);
    }
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }

  /** Waits for any data (up to timeoutMs), then a short grace so one burst arrives in one piece; consumes everything. */
  async readSome(timeoutMs: number, graceMs = 25): Promise<Uint8Array> {
    if (!this.buf.length) await this.wait(timeoutMs);
    if (this.buf.length && graceMs > 0) await this.wait(graceMs);
    const out = this.buf;
    this.buf = new Uint8Array(0);
    return out;
  }
}
