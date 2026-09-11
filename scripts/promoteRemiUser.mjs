import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const { Client } = pg;

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function loadEnv(dir) {
  try {
    const lines = readFileSync(resolve(dir, '..', '.env'), 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (e) { console.error('Failed to load .env:', e.message); }
}

loadEnv(__dirname);

const connStr = process.env.POSTGRES_CONNECTION_STRING;
const client = new Client({ connectionString: connStr });
await client.connect();

// Inspect remi table schemas
for (const table of ['remi_conversations', 'remi_messages']) {
  const { rows } = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='raf' AND table_name=$1 ORDER BY ordinal_position`,
    [table]
  );
  console.log(`\n${table}:`, rows.map(r => `${r.column_name}(${r.data_type})`).join(', '));
}

await client.end();
