import type { AutotuneOptions, AutotuneResult } from './autotune';
import { processAutotune, processSource, type Source, type WorkerMsg, type WorkerReq } from './run-core';
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

/** Runs one request in a Web Worker; when the worker does not start (e.g. file://) it computes on the main thread. */
function runInWorker<T>(req: WorkerReq, pick: (m: WorkerMsg) => T | undefined, local: () => Promise<T>, onProgress: (frac: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    let started = false;
    const fallback = () => {
      local().then(resolve, (err: unknown) => {
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
      if (m.type === 'progress') {
        onProgress(m.frac);
        return;
      }
      worker?.terminate();
      if (m.type === 'error') reject(new RunError(m.code, m.key, m.params));
      else {
        const v = pick(m);
        if (v === undefined) reject(new RunError('error', 'at.err.worker'));
        else resolve(v);
      }
    };
    worker.onerror = () => {
      worker?.terminate();
      if (started) reject(new RunError('error', 'at.err.worker'));
      else fallback();
    };
    worker.postMessage(req);
  });
}

/** Uruchamia analize w Web Workerze; gdy worker nie startuje (np. file://), liczy w watku glownym. */
export function runAnalysis(src: Source, onProgress: (frac: number) => void): Promise<AnalysisResult> {
  return runInWorker(src, (m) => (m.type === 'done' ? m.result : undefined), () => processSource(src, onProgress), onProgress);
}

/** Auto-tune engine (all sessions of the file, see analysis/autotune.ts) in the Web Worker, with progress. */
export function runAutotune(src: Source, opts: AutotuneOptions, onProgress: (frac: number) => void): Promise<AutotuneResult> {
  return runInWorker({ op: 'autotune', src, opts }, (m) => (m.type === 'autotune' ? m.result : undefined), () => processAutotune(src, opts, onProgress), onProgress);
}
