/** Strumieniowy parser CSV z blackbox_decode / Blackbox Explorer. Dziala w Web Workerze i w Node (Blob.stream()). */
import { hasGyroScaledDebug, parseLogSettings } from './settings';
import type { LogData } from './types';

/** Parse error: `key` is an i18n key (at.err.*), translated by the UI thread (this code also runs in a Web Worker). */
export class LogError extends Error {
  constructor(
    public code: 'binary' | 'columns' | 'short' | 'empty',
    public key: string,
    public params?: Record<string, string | number>,
  ) {
    super(key);
  }
}

class Col {
  buf: Float32Array;
  n = 0;
  constructor(cap = 1 << 16) {
    this.buf = new Float32Array(cap);
  }
  push(v: number): void {
    if (this.n === this.buf.length) {
      const nb = new Float32Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.n++] = v;
  }
  done(): Float32Array {
    return this.buf.subarray(0, this.n);
  }
}

class TimeCol {
  buf = new Float64Array(1 << 16);
  n = 0;
  push(v: number): void {
    if (this.n === this.buf.length) {
      const nb = new Float64Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.n++] = v;
  }
}

const norm = (s: string) => s.trim().replace(/^"+|"+$/g, '').trim().toLowerCase();

export async function parseCsv(file: Blob, onProgress: (frac: number) => void): Promise<LogData> {
  const reader = file.stream().getReader();
  const dec = new TextDecoder('utf-8');
  const size = file.size || 1;
  let read = 0;
  let carry = '';
  let first = true;
  let headerDone = false;
  let headerLines = 0;

  let timeIdx = -1;
  const time = new TimeCol();
  const sp = [new Col(), new Col(), new Col()];
  const gy = [new Col(), new Col(), new Col()];
  const mo: Col[] = [];
  let thr: Col | null = null;
  let rcFallback = false;
  // optional groups (auto-tune engine): D-term, unfiltered gyro, debug
  const groups: Record<'axisD' | 'gyroUnfilt' | 'debug', Col[]> = { axisD: [], gyroUnfilt: [], debug: [] };
  // header rows above the column names ("H key:value" or a two-cell "key","value" row of a Blackbox Explorer export)
  const info: Record<string, string> = {};
  // [indeks kolumny, funkcja zapisu] posortowane rosnaco
  let want: { idx: number; push: (v: number) => void }[] = [];
  let lastProg = 0;

  const setupHeader = (line: string): boolean => {
    const names = line.split(',').map(norm);
    const t = names.indexOf('time (us)') >= 0 ? names.indexOf('time (us)') : names.findIndex((n) => n === 'time');
    if (t < 0) return false;
    timeIdx = t;
    const find = (n: string) => names.indexOf(n);
    const missing: string[] = [];
    const w: typeof want = [{ idx: t, push: (v) => time.push(v) }];
    for (let a = 0; a < 3; a++) {
      let si = find(`setpoint[${a}]`);
      if (si < 0) {
        si = find(`rccommand[${a}]`);
        if (si >= 0) rcFallback = true;
      }
      if (si < 0) missing.push(`setpoint[${a}]`);
      else w.push({ idx: si, push: (v) => sp[a]!.push(v) });
      let gi = find(`gyroadc[${a}]`);
      if (gi < 0) gi = find(`gyro[${a}]`);
      if (gi < 0) missing.push(`gyroADC[${a}]`);
      else w.push({ idx: gi, push: (v) => gy[a]!.push(v) });
    }
    for (let m = 0; m < 8; m++) {
      const mi = find(`motor[${m}]`);
      if (mi < 0) break;
      const c = new Col();
      mo.push(c);
      w.push({ idx: mi, push: (v) => c.push(v) });
    }
    const ti = find('rccommand[3]');
    if (ti >= 0) {
      const c = new Col();
      thr = c;
      w.push({ idx: ti, push: (v) => c.push(v) });
    }
    const opt: [keyof typeof groups, string, number, number][] = [
      ['axisD', 'axisd', 3, 2],
      ['gyroUnfilt', 'gyrounfilt', 3, 3],
      ['debug', 'debug', 4, 3],
    ];
    for (const [g, prefix, count, min] of opt) {
      const idx: number[] = [];
      for (let k = 0; k < count; k++) {
        const c = find(`${prefix}[${k}]`);
        if (c < 0) break;
        idx.push(c);
      }
      if (idx.length < min) continue;
      for (const c of idx) {
        const col = new Col();
        groups[g].push(col);
        w.push({ idx: c, push: (v) => col.push(v) });
      }
    }
    if (missing.length) throw new LogError('columns', 'at.err.missingCols', { cols: missing.join(', ') });
    w.sort((a, b) => a.idx - b.idx);
    want = w;
    return true;
  };

  const parseLine = (line: string): void => {
    let col = 0;
    let start = 0;
    let wi = 0;
    const len = line.length;
    const bad = { v: false };
    while (wi < want.length) {
      let end = line.indexOf(',', start);
      if (end < 0) end = len;
      if (col === want[wi]!.idx) {
        const v = parseFloat(line.substring(start, end));
        if (Number.isNaN(v)) bad.v = true;
        else want[wi]!.push(v);
        wi++;
      }
      if (end >= len) break;
      start = end + 1;
      col++;
    }
    // niepelny wiersz -> wyrownaj dlugosci kolumn
    if (wi < want.length || bad.v) {
      const n = time.n;
      void n;
    }
  };

  const headerRow = (line: string): void => {
    const h = /^H ([^:]+):(.*)$/.exec(line);
    if (h) {
      info[h[1]!.trim()] = h[2]!.trim();
      return;
    }
    // "key","value with, commas" or key,value
    const kv = /^\s*"([^"]+)"\s*,\s*"?(.*?)"?\s*$/.exec(line) ?? /^\s*([^,"]+?)\s*,\s*(.*?)\s*$/.exec(line);
    if (kv) info[kv[1]!.trim()] = kv[2]!;
  };

  const processText = (text: string): void => {
    let pos = 0;
    while (pos < text.length) {
      const nl = text.indexOf('\n', pos);
      if (nl < 0) {
        carry = text.substring(pos);
        return;
      }
      let line = text.substring(pos, nl);
      pos = nl + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line) continue;
      if (!headerDone) {
        if (++headerLines > 300) throw new LogError('binary', 'at.err.noHeader');
        if (line.includes(',') && setupHeader(line)) headerDone = true;
        else headerRow(line);
        continue;
      }
      if (line.charCodeAt(0) === 0x48 && line.charCodeAt(1) === 0x20) continue; // linie "H ..." wewnatrz
      parseLine(line);
    }
    carry = '';
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    if (first) {
      first = false;
      const head = value.subarray(0, 512);
      let nul = 0;
      for (let i = 0; i < head.length; i++) if (head[i] === 0) nul++;
      const txt = new TextDecoder().decode(head);
      if (nul > 0 || txt.startsWith('H Product:') || (!txt.includes(',') && !txt.includes('\n'))) {
        void reader.cancel();
        throw new LogError('binary', 'at.err.notCsv');
      }
    }
    processText(carry + dec.decode(value, { stream: true }));
    const frac = read / size;
    if (frac - lastProg > 0.02) {
      lastProg = frac;
      onProgress(Math.min(0.98, frac));
    }
  }
  if (carry) processText(carry + '\n');
  if (!headerDone) throw new LogError('columns', 'at.err.noTimeCol');

  // wyrownanie dlugosci (wiersze z brakami): przycinamy do najkrotszej
  const cols: { n: number }[] = [time, ...sp, ...gy, ...mo, ...(thr ? [thr] : []), ...groups.axisD, ...groups.gyroUnfilt, ...groups.debug];
  const n = Math.min(...cols.map((c) => c.n));
  if (n < 1000) throw new LogError('short', 'at.err.tooShort', { n });
  void timeIdx;

  // fs z mediany roznic czasu
  const dts: number[] = [];
  const step = Math.max(1, Math.floor(n / 20000));
  for (let i = step; i < n; i += step) {
    const d = (time.buf[i]! - time.buf[i - step]!) / step;
    if (d > 0) dts.push(d);
  }
  dts.sort((a, b) => a - b);
  const dt = dts[dts.length >> 1] ?? 0;
  if (!(dt > 0)) throw new LogError('short', 'at.err.noRate');
  const fs = 1e6 / dt;
  onProgress(1);
  const cut = (c: Col) => c.done().subarray(0, n);
  const rcScale = 1; // rcCommand [-500..500] ~ deg/s (przyblizenie)
  const spOut = sp.map((c) => {
    const a = cut(c);
    if (!rcFallback) return a;
    const b = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) b[i] = a[i]! * rcScale;
    return b;
  });
  const out: LogData = { fs, rows: n, duration: (time.buf[n - 1]! - time.buf[0]!) / 1e6, setpoint: spOut, gyro: gy.map(cut), motor: mo.map(cut), rcFallback };
  const thrCol = thr as Col | null; // assigned inside setupHeader (TypeScript cannot see it)
  if (thrCol) out.throttle = cut(thrCol);
  if (groups.axisD.length) out.axisD = groups.axisD.map(cut);
  if (groups.debug.length) out.debug = groups.debug.map(cut);
  if (Object.keys(info).length) {
    const settings = parseLogSettings(info);
    out.settings = settings;
    if (settings.pid) out.headerPid = settings.pid;
    if (settings.motorOutput) out.motorRange = settings.motorOutput;
  }
  if (groups.gyroUnfilt.length) out.gyroUnfilt = groups.gyroUnfilt.map(cut);
  else if (out.debug && hasGyroScaledDebug(out.settings)) out.gyroUnfilt = out.debug.slice(0, 3);
  return out;
}
