import { Worker } from 'node:worker_threads';
import { fail } from './http.js';

let active = 0;
export async function renderPreview(bytes, mime, page) {
  if (active >= 2) throw fail(503, 'Preview capacity is busy. Try again shortly.');
  active++;
  try {
    const worker = new Worker(new URL('./preview-worker.js', import.meta.url), {
      workerData: { bytes, mime, page }, resourceLimits: { maxOldGenerationSizeMb: 96 },
    });
    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(fail(422, 'The preview took too long to render.')), 6000);
        worker.once('message', message => {
          clearTimeout(timer);
          if (message.error) reject(fail(422, 'This file could not be previewed.'));
          else if (!message.result) reject(fail(404, 'Preview page not found.'));
          else resolve(message.result);
        });
        worker.once('error', () => {
          clearTimeout(timer);
          reject(fail(422, 'This file could not be previewed.'));
        });
        worker.once('exit', () => {
          clearTimeout(timer);
          reject(fail(422, 'This file could not be previewed.'));
        });
      });
      return result;
    } finally {
      await worker.terminate();
    }
  } finally {
    active--;
  }
}
