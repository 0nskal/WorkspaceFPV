/** Tolerant little-endian reader/writer for MSP payloads. A decoder never throws on short payloads: missing bytes read as 0. */

export class Rd {
  o = 0;
  private dv: DataView;
  constructor(readonly p: Uint8Array) {
    this.dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  }
  get left(): number {
    return Math.max(0, this.p.length - this.o);
  }
  has(n: number): boolean {
    return this.left >= n;
  }
  u8(): number {
    return this.o < this.p.length ? this.p[this.o++] : (this.o++, 0);
  }
  s8(): number {
    const v = this.u8();
    return v > 127 ? v - 256 : v;
  }
  u16(): number {
    if (!this.has(2)) {
      this.o += 2;
      return 0;
    }
    const v = this.dv.getUint16(this.o, true);
    this.o += 2;
    return v;
  }
  s16(): number {
    if (!this.has(2)) {
      this.o += 2;
      return 0;
    }
    const v = this.dv.getInt16(this.o, true);
    this.o += 2;
    return v;
  }
  u32(): number {
    if (!this.has(4)) {
      this.o += 4;
      return 0;
    }
    const v = this.dv.getUint32(this.o, true);
    this.o += 4;
    return v;
  }
  str(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) {
      const c = this.u8();
      if (c) s += String.fromCharCode(c);
    }
    return s;
  }
  /** Length-prefixed string. */
  pstr(): string {
    return this.str(this.u8());
  }
  bytes(n: number): Uint8Array {
    const out = this.p.slice(this.o, this.o + n);
    this.o += n;
    return out;
  }
  skip(n: number): void {
    this.o += n;
  }
}

export class Wr {
  private b: number[] = [];
  u8(v: number): this {
    this.b.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    this.b.push(v & 0xff, (v >> 8) & 0xff);
    return this;
  }
  s16(v: number): this {
    return this.u16(v < 0 ? v + 65536 : v);
  }
  u32(v: number): this {
    this.b.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    return this;
  }
  pstr(s: string): this {
    this.u8(s.length);
    for (const c of s) this.b.push(c.charCodeAt(0) & 0xff);
    return this;
  }
  bytes(a: ArrayLike<number>): this {
    for (let i = 0; i < a.length; i++) this.b.push(a[i] & 0xff);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.b);
  }
}

/** Copy of `raw` grown to at least `len` bytes (zero padded): the base for read-modify-write encoders. */
export function patchBase(raw: Uint8Array | undefined, len: number): Uint8Array {
  const out = new Uint8Array(Math.max(len, raw?.length ?? 0));
  if (raw) out.set(raw);
  return out;
}

export const view = (p: Uint8Array): DataView => new DataView(p.buffer, p.byteOffset, p.byteLength);

export const hex = (p: Uint8Array): string => [...p].map((b) => b.toString(16).padStart(2, '0')).join(' ');
export const fromHex = (s: string): Uint8Array => Uint8Array.from(s.trim().split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16)));
