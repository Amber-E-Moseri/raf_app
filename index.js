import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { createInMemoryDb } from './lib/server/inMemoryDb.js';
import { createApiRouter } from './lib/server/routerLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = 3000;

const db = createInMemoryDb();
const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && /^https?:\/\/localhost:\d+$/.test(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }

  res.header('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, x-household-id, x-household_id');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

app.use(express.json());

app.use((req, _res, next) => {
  if (!req.headers['x-household-id']) {
    req.headers['x-household-id'] = db.defaultHouseholdId;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'raf-api',
  });
});

const apiRootDir = path.join(__dirname, 'app', 'api', 'v1');
const aliases = [
  {
    path: '/monthly-review',
    method: 'POST',
    file: path.join(apiRootDir, 'monthly-reviews', 'route.js'),
  },
];

const apiRouter = await createApiRouter({
  apiRootDir,
  db,
  defaultHouseholdId: db.defaultHouseholdId,
  aliases,
});

app.use('/api/v1', apiRouter);

app.use((req, res) => {
  res.status(404).json({
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((error, _req, res, _next) => {
  const status = typeof error?.status === 'number' ? error.status : 500;
  res.status(status).json({
    error: error?.message ?? 'Internal Server Error',
  });
});

app.listen(port, () => {
  console.log(`RAF API running on http://localhost:${port}`);
});
