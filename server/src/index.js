import express from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { auth, authenticate } from './auth.js';
import { organization } from './organization.js';
import { documents } from './documents.js';
import { db } from './database.js';

if (!process.env.DATABASE_URL || (process.env.JWT_SECRET?.length ?? 0) < 32) {
  throw new Error('Set DATABASE_URL and a random JWT_SECRET of at least 32 characters.');
}

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '512kb' }));
app.get('/health', async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/auth', auth);
app.use('/api', authenticate, organization, documents);
app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((error, _req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join(' · ') });
  }
  if (error.code === 'P2002') return res.status(409).json({ error: 'That value is already in use.' });
  if (error.name === 'MulterError') {
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Upload one file up to 20 MB.' });
  }
  const status = error.status >= 400 && (error.status < 500 || error.status === 503) ? error.status : 500;
  if (status === 500) console.error('Request failed', error.code ?? error.name);
  res.status(status).json({ error: status === 500 ? 'The server could not complete the request.' : error.message });
});
const listener = app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0', () => {
  console.log('DocuVault API on port ' + listener.address().port);
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => listener.close(() => db.$disconnect()));
}
