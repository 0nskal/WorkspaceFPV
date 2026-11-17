/** Web Worker: parsowanie logu + analiza poza watkiem UI. */
import { processAutotune, processSource, type WorkerMsg, type WorkerReq } from './run-core';

self.onmessage = async (e: MessageEvent<WorkerReq>) => {
  const post = (m: WorkerMsg) => (self as unknown as { postMessage(m: WorkerMsg): void }).postMessage(m);
  const progress = (frac: number) => post({ type: 'progress', frac });
  try {
    const req = e.data;
    if ('op' in req) post({ type: 'autotune', result: await processAutotune(req.src, req.opts ?? {}, progress) });
    else post({ type: 'done', result: await processSource(req, progress) });
  } catch (err) {
    const e = err as { code?: string; key?: string; params?: Record<string, string | number> };
    post({ type: 'error', code: e.code ?? 'error', key: e.key ?? 'at.err.generic', params: e.params });
  }
};
