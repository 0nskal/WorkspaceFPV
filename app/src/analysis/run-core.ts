import { analyze } from './analyze';
import { parseCsv } from './parse';
import { synthLog } from './synth';
import type { AnalysisResult } from './types';

export type Source = { kind: 'demo' } | { kind: 'file'; file: File };
export type WorkerMsg =
  | { type: 'progress'; frac: number }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'error'; code: string; key: string; params?: Record<string, string | number> };

export async function processSource(src: Source, onProgress: (frac: number) => void): Promise<AnalysisResult> {
  if (src.kind === 'demo') {
    onProgress(0.2);
    const log = synthLog();
    onProgress(0.6);
    return analyze(log, ''); // the UI shows a localised name for the sample log
  }
  const log = await parseCsv(src.file, (f) => onProgress(f * 0.7));
  onProgress(0.75);
  return analyze(log, src.file.name);
}
