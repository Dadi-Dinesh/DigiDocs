import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';

const root = resolve(process.env.STORAGE_DIR || 'vault');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const MAX_BYTES = 20 * 1024 * 1024;
const allowed = new Set(['pdf', 'docx', 'xlsx', 'jpg', 'png']);

export const storage = {
  async save(file) {
    const ext = extname(file?.originalname ?? '').slice(1).toLowerCase().replace(/^jpeg$/, 'jpg');
    const detected = file && allowed.has(ext) && await fileTypeFromBuffer(file.buffer).catch(() => null);
    if (!detected || ext !== detected.ext) {
      throw Object.assign(new Error('Select a valid PDF, DOCX, XLSX, JPG or PNG file.'), { status: 415 });
    }
    const storageKey = randomUUID();
    await mkdir(root, { recursive: true, mode: 0o700 });
    const path = resolve(root, storageKey);
    try {
      await writeFile(path, file.buffer, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') await unlink(path).catch(() => {});
      throw error;
    }
    return { storageKey, fileName: file.originalname, size: file.size, mime: detected.mime, sha256: sha256(file.buffer) };
  },
  read: key => readFile(resolve(root, key)),
  remove: key => unlink(resolve(root, key)),
};
