import { processSource, type Source, type WorkerMsg } from './run-core';
import type { AnalysisResult } from './types';

export class RunError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Uruchamia analize w Web Workerze; gdy worker nie startuje (np. file://), liczy w watku glownym. */
export function runAnalysis(src: Source, onProgress: (frac: number) => void): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    let started = false;
    const fallback = () => {
      processSource(src, onProgress).then(resolve, (err: unknown) => reject(new RunError((err as { code?: string }).code ?? 'error', err instanceof Error ? err.message : String(err))));
    };
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      fallback();
      return;
    }
    worker.onmessage = (e: MessageEvent<WorkerMsg>) => {
      started = true;
      const m = e.data;
      if (m.type === 'progress') onProgress(m.frac);
      else {
        worker?.terminate();
        if (m.type === 'done') resolve(m.result);
        else reject(new RunError(m.code, m.message));
      }
    };
    worker.onerror = () => {
      worker?.terminate();
      if (started) reject(new RunError('error', 'Błąd analizy w tle.'));
      else fallback();
    };
    worker.postMessage(src);
  });
}
