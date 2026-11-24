import { parentPort, workerData } from 'node:worker_threads';
import { PDFiumLibrary } from '@hyzyla/pdfium';
import sharp from 'sharp';
import { previewOffice } from './office.js';

const { mime, page } = workerData;
const bytes = Buffer.from(workerData.bytes);
const dimension = 1300;

async function pdfPreview() {
  const library = await PDFiumLibrary.init();
  try {
    const document = await library.loadDocument(bytes);
    try {
      const pages = document.getPageCount();
      if (page > pages) return null;
      const current = document.getPage(page - 1);
      const { originalWidth, originalHeight } = current.getOriginalSize();
      if (originalWidth < 1 || originalHeight < 1) throw new Error('Invalid PDF page dimensions.');
      const image = await current.render({
        renderFormFields: false,
        scale: Math.min(dimension / Math.max(originalWidth, originalHeight), 5),
        render: ({ data, width, height }) => sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer(),
      });
      return { kind: 'image', page, pages, width: image.width, height: image.height, data: Buffer.from(image.data).toString('base64') };
    } finally {
      document.destroy();
    }
  } finally {
    library.destroy();
  }
}

async function preview() {
  if (mime === 'application/pdf') return pdfPreview();
  if (mime.startsWith('image/')) {
    if (page !== 1) return null;
    const { data, info } = await sharp(bytes, { limitInputPixels: 25_000_000 }).autoOrient()
      .resize({ width: dimension, height: dimension, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
    return { kind: 'image', page, pages: 1, width: info.width, height: info.height, data: data.toString('base64') };
  }
  return previewOffice(bytes, mime, page);
}

try {
  parentPort.postMessage({ result: await preview() });
} catch {
  parentPort.postMessage({ error: true });
}
