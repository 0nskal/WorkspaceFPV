import { analyze } from './analyze';
import { parseCsv } from './parse';
import { looksLikeBbl, parseBbl } from '../bf/bbl';
import { synthLog } from './synth';
import type { AnalysisResult, HeaderPid } from './types';

/** PIDs of the simulated FC (serial/demo.ts MSP_PID), written into the sample log as its header PIDs. */
export const DEMO_HEADER_PID: HeaderPid = { roll: [48, 82, 38], pitch: [52, 88, 42], yaw: [45, 90, 3] };

export type Source = { kind: 'demo' } | { kind: 'file'; file: File };
export type WorkerMsg =
  | { type: 'progress'; frac: number }
  | { type: 'done'; result: AnalysisResult }
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
