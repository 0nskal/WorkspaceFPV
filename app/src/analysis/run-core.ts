import { synthChirpLog } from './synth-chirp';
import { analyze } from './analyze';
import { autotune, type AutotuneOptions, type AutotuneResult } from './autotune';
import { LogError, parseCsv } from './parse';
import { looksLikeBbl, parseBbl, parseBblSessions } from '../bf/bbl';
import { synthDemoSessions, synthLog } from './synth';
import type { AnalysisResult, HeaderPid, LogData } from './types';

/** PIDs of the simulated FC (serial/demo.ts MSP_PID), written into the sample log as its header PIDs. */
export const DEMO_HEADER_PID: HeaderPid = { roll: [48, 82, 38], pitch: [52, 88, 42], yaw: [45, 90, 3] };

export type Source = { kind: 'demo' } | { kind: 'file'; file: File };
/** Worker request: a bare Source runs the legacy analysis, `op: 'autotune'` the auto-tune engine. */
export type AutotuneRequest = { op: 'autotune'; src: Source; opts?: AutotuneOptions };
export type WorkerReq = Source | AutotuneRequest;
export type WorkerMsg =
  | { type: 'progress'; frac: number }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'autotune'; result: AutotuneResult }
  | { type: 'error'; code: string; key: string; params?: Record<string, string | number> };

export async function processSource(src: Source, onProgress: (frac: number) => void): Promise<AnalysisResult> {
  if (src.kind === 'demo') {
    onProgress(0.2);
    // the sample log "was flown" with the demo FC's PIDs, so the header-vs-FC check stays quiet in demo mode
    const log = { ...synthLog(), headerPid: DEMO_HEADER_PID };
    onProgress(0.6);
    return analyze(log, ''); // the UI shows a localised name for the sample log
  }
  // .bbl/.bfl straight from the FC (or a flash dump) is decoded natively; everything else is CSV
  const head = new Uint8Array(await src.file.slice(0, 80).arrayBuffer());
  const log = looksLikeBbl(head) ? await parseBbl(src.file, (f) => onProgress(f * 0.7)) : await parseCsv(src.file, (f) => onProgress(f * 0.7));
  onProgress(0.75);
  return analyze(log, src.file.name);
}

/** Every flight of a source as analysis input: all sessions of a .bbl, one for CSV, the demo series for the sample. */
export async function loadSessions(src: Source, onProgress: (frac: number) => void): Promise<LogData[]> {
  if (src.kind === 'demo') {
    onProgress(0.5);
    return [...synthDemoSessions(), synthChirpLog()];
  }
  const head = new Uint8Array(await src.file.slice(0, 80).arrayBuffer());
  if (!looksLikeBbl(head)) return [await parseCsv(src.file, onProgress)];
  const sessions = await parseBblSessions(src.file, onProgress);
  const logs = sessions.map((s) => s.log).filter((l): l is LogData => !!l);
  if (!logs.length) {
    const e = sessions.find((s) => s.error)?.error;
    throw new LogError((e?.code as LogError['code']) ?? 'short', e?.key ?? 'at.err.tooShort', e?.params ?? { n: 0 });
  }
  return logs;
}

/** Auto-tune run: loads every session and calls autotune() (progress: 0-50 % loading, 50-100 % analysis). */
export async function processAutotune(src: Source, opts: AutotuneOptions, onProgress: (frac: number) => void): Promise<AutotuneResult> {
  const logs = await loadSessions(src, (f) => onProgress(f * 0.5));
  const name = src.kind === 'file' ? src.file.name : '';
  return autotune(logs, { ...opts, name }, (f) => onProgress(0.5 + f * 0.5));
}
