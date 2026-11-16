/** Web Worker: parsowanie logu + analiza poza watkiem UI. */
import { processSource, type Source, type WorkerMsg } from './run-core';

self.onmessage = async (e: MessageEvent<Source>) => {
  const post = (m: WorkerMsg) => (self as unknown as { postMessage(m: WorkerMsg): void }).postMessage(m);
  try {
    const result = await processSource(e.data, (frac) => post({ type: 'progress', frac }));
    post({ type: 'done', result });
  } catch (err) {
    const e = err as { code?: string; key?: string; params?: Record<string, string | number> };
    post({ type: 'error', code: e.code ?? 'error', key: e.key ?? 'at.err.generic', params: e.params });
  }
};
