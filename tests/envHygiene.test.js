import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('.gitignore protects local env variants while preserving .env.example', async () => {
  const source = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');

  assert.match(source, /^\.env$/m);
  assert.match(source, /^\.env\.local$/m);
  assert.match(source, /^\.env\.\*$/m);
  assert.match(source, /^!\.env\.example$/m);
});

test('.env.example documents frontend API base URL', async () => {
  const source = await readFile(new URL('../.env.example', import.meta.url), 'utf8');

  assert.match(source, /VITE_API_BASE_URL=/);
  assert.match(source, /\/api\/v1/);
});
