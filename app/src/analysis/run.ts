import { processSource, type Source, type WorkerMsg } from './run-core';
import type { AnalysisResult } from './types';

/** Analysis error; `key` is an i18n key (at.err.*) that the screen translates. */
export class RunError extends Error {
  constructor(
    public code: string,
    public key: string,
    public params?: Record<string, string | number>,
  ) {
    super(key);
  }
}

/** Uruchamia analize w Web Workerze; gdy worker nie startuje (np. file://), liczy w watku glownym. */
export function runAnalysis(src: Source, onProgress: (frac: number) => void): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    let started = false;
    const fallback = () => {
      processSource(src, onProgress).then(resolve, (err: unknown) => {
        const e = err as { code?: string; key?: string; params?: Record<string, string | number> };
        reject(new RunError(e.code ?? 'error', e.key ?? 'at.err.generic', e.params));
      });
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
        else reject(new RunError(m.code, m.key, m.params));
      }
    };
    worker.onerror = () => {
      worker?.terminate();
      if (started) reject(new RunError('error', 'at.err.worker'));
      else fallback();
    };
    worker.postMessage(src);
  });
}
