/// <reference lib="webworker" />
// Worker de cadOptimize.ts: recibe el archivo, avisa cada paso y regresa el GLB aligerado.
import { optimizeCadBuffer } from './cadOptimize';

self.onmessage = async (e: MessageEvent<ArrayBuffer>) => {
  try {
    const r = await optimizeCadBuffer(new Uint8Array(e.data), {}, (step) => self.postMessage({ step }));
    self.postMessage({ done: r }, [r.glb.buffer]);
  } catch (err) {
    self.postMessage({ error: String((err as Error)?.message ?? err) });
  }
};
