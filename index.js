import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { loadServerEnv } from './lib/server/env.js';
import { createApiRouter } from './lib/server/routerLoader.js';
import { createSqliteDb } from './lib/server/sqliteDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { port, dbPath } = loadServerEnv({ cwd: __dirname });
const db = createSqliteDb({ dbPath });
const app = express();

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
    console.info(JSON.stringify({
      level: 'info',
      event: 'api_request',
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      householdId: req.headers['x-household-id'] ?? req.headers['x-household_id'] ?? null,
    }));
  });
  next();
});

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && /^https?:\/\/localhost:\d+$/.test(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }

  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, x-workspace-id, x-household-id, x-household_id');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

app.use(express.json());
app.use(express.raw({
  type: (req) => {
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    return contentType.startsWith('multipart/form-data') || contentType.startsWith('application/pdf');
  },
  limit: '10mb',
}));

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'raf-api',
  });
});

app.get('/api/v1/health', (_req, res) => {
  res.status(200).json({
    ok: true,
  });
});

const apiRootDir = path.join(__dirname, 'app', 'api', 'v1');
const aliases = [
  {
    path: '/allocation-categories',
    method: 'GET',
    file: path.join(apiRootDir, 'household', 'allocation-categories', 'route.js'),
  },
  {
    path: '/allocation-categories',
    method: 'PUT',
    file: path.join(apiRootDir, 'household', 'allocation-categories', 'route.js'),
  },
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
  console.error(JSON.stringify({
    level: 'error',
    event: 'api_error',
    status,
    message: error?.message ?? 'Internal Server Error',
  }));
  res.status(status).json({
    error: error?.message ?? 'Internal Server Error',
  });
});

app.listen(port, () => {
  console.log(`RAF API running on http://localhost:${port}`);
});
