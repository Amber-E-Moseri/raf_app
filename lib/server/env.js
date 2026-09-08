import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

function parseDotEnv(source) {
  const rows = String(source ?? '').split(/\r?\n/);
  const parsed = {};

  for (const row of rows) {
    const line = row.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex < 1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function loadEnvFile({ cwd = process.cwd(), filename = '.env' } = {}) {
  const envPath = path.join(cwd, filename);
  if (!fs.existsSync(envPath)) {
    return;
  }

  const parsed = parseDotEnv(fs.readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const serverEnvSchema = z.object({
  PORT: z.string().trim().optional(),
  RAF_DB_PATH: z.string({ required_error: 'RAF_DB_PATH is required' }).trim().min(1, 'RAF_DB_PATH is required'),
});

function parsePort(rawPort) {
  if (rawPort == null || String(rawPort).trim() === '') {
    return 3000;
  }

  const parsed = Number(rawPort);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535. Received "${rawPort}".`);
  }

  return parsed;
}

export function loadServerEnv({ cwd = process.cwd() } = {}) {
  loadEnvFile({ cwd });

  if (process.env.RAF_DB_PATH == null || String(process.env.RAF_DB_PATH).trim() === '') {
    throw new Error('Invalid server environment configuration:\n- RAF_DB_PATH is required');
  }

  const parsed = serverEnvSchema.safeParse({
    PORT: process.env.PORT,
    RAF_DB_PATH: process.env.RAF_DB_PATH,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `- ${issue.message}`).join('\n');
    throw new Error(`Invalid server environment configuration:\n${issues}`);
  }

  return {
    port: parsePort(parsed.data.PORT),
    dbPath: path.resolve(cwd, parsed.data.RAF_DB_PATH),
  };
}
