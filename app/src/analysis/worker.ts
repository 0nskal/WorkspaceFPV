/** Web Worker: parsowanie logu + analiza poza watkiem UI. */
import { processSource, type Source, type WorkerMsg } from './run-core';

self.onmessage = async (e: MessageEvent<Source>) => {
  const post = (m: WorkerMsg) => (self as unknown as { postMessage(m: WorkerMsg): void }).postMessage(m);
  try {
    const result = await processSource(e.data, (frac) => post({ type: 'progress', frac }));
    post({ type: 'done', result });
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'error';
    post({ type: 'error', code, message: err instanceof Error ? err.message : String(err) });
  }
};
