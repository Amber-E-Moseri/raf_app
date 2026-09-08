import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const connectionString = process.env.DATABASE_URL ?? process.env.SUPABASE_DATABASE_URL;
const usesDeprecatedSupabaseDatabaseUrl = !process.env.DATABASE_URL && Boolean(process.env.SUPABASE_DATABASE_URL);
const confirmedNonProduction = process.env.RAF_CONFIRM_NON_PRODUCTION_DB === 'true';
const applyMigrations = process.env.RAF_VALIDATE_APPLY_MIGRATIONS === 'true';

if (!connectionString) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

if (!confirmedNonProduction) {
  console.error('Refusing to validate without RAF_CONFIRM_NON_PRODUCTION_DB=true.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: process.env.RAF_POSTGRES_SSL === 'false' || process.env.RAF_POSTGRES_SSL === '0'
    ? false
    : { rejectUnauthorized: false },
});

const migrationNames = fs.readdirSync(path.join(repoRoot, 'db', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right));

async function applyMigration(client, name) {
  const sql = fs.readFileSync(path.join(repoRoot, 'db', 'migrations', name), 'utf8');
  await client.query(sql);
}

async function scalar(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0]?.value;
}

async function main() {
  const client = await pool.connect();
  try {
    if (applyMigrations) {
      for (const name of migrationNames) {
        await applyMigration(client, name);
      }
    }

    const expectedGlobalTables = [
      'token_blacklist',
    ];
    const expectedTenantTables = [
      'workspaces',
      'workspace_members',
      'households',
      'financial_accounts',
      'account_reconciliations',
      'transactions',
      'income_entries',
      'income_allocations',
      'allocation_categories',
      'surplus_split_rules',
      'debts',
      'debt_payments',
      'debt_adjustments',
      'fixed_bills',
      'goals',
      'monthly_reviews',
      'import_batches',
      'imported_transaction_rows',
      'imported_transactions',
      'merchant_rules',
      'import_review_rules',
      'remi_conversations',
      'remi_messages',
      'pdf_import_quotas',
      'email_preferences',
      'email_send_log',
      'workspace_invitations',
      'workspace_activity',
    ];
    const expectedTables = [...expectedGlobalTables, ...expectedTenantTables];
    const forcedRlsTables = expectedTenantTables.filter((table) => !['workspaces', 'workspace_members'].includes(table));

    const missingTables = [];
    const rlsDisabled = [];
    const rlsNotForced = [];

    for (const table of expectedTables) {
      const exists = await scalar(client, `
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'raf' AND table_name = $1
        ) AS value
      `, [table]);
      if (!exists) {
        missingTables.push(table);
        continue;
      }

      if (expectedGlobalTables.includes(table)) {
        continue;
      }

      const rlsEnabled = await scalar(client, `
        SELECT relrowsecurity AS value
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'raf' AND c.relname = $1
      `, [table]);
      if (!rlsEnabled) {
        rlsDisabled.push(table);
      }

      if (forcedRlsTables.includes(table)) {
        const rlsForced = await scalar(client, `
          SELECT relforcerowsecurity AS value
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'raf' AND c.relname = $1
        `, [table]);
        if (!rlsForced) {
          rlsNotForced.push(table);
        }
      }
    }

    const moneyTypes = await client.query(`
      SELECT table_name, column_name, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'raf'
        AND column_name IN (
          'amount',
          'current_balance',
          'available_balance',
          'allocated_amount',
          'starting_balance',
          'minimum_payment',
          'monthly_payment',
          'target_amount',
          'expected_amount',
          'net_surplus'
        )
        AND data_type = 'numeric'
      ORDER BY table_name, column_name
    `);

    const helperSafety = await client.query(`
      SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'raf'
        AND p.proname IN ('current_app_user_id', 'current_workspace_id', 'has_workspace_membership', 'has_workspace_role')
      ORDER BY p.proname
    `);

    const helperText = await client.query(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'raf'
        AND p.proname IN ('current_app_user_id', 'current_workspace_id', 'has_workspace_membership', 'has_workspace_role')
      ORDER BY p.proname
    `);
    const providerSpecificHelpers = helperText.rows.filter((row) => /auth\.uid|auth\.jwt|request\.jwt/i.test(row.definition));

    const result = {
      ok: missingTables.length === 0 && rlsDisabled.length === 0 && rlsNotForced.length === 0 && helperSafety.rows.length === 4 && providerSpecificHelpers.length === 0,
      connectionVariable: usesDeprecatedSupabaseDatabaseUrl ? 'SUPABASE_DATABASE_URL (deprecated)' : 'DATABASE_URL',
      appliedMigrations: applyMigrations ? migrationNames : [],
      missingTables,
      rlsDisabled,
      rlsNotForced,
      numericColumnsValidated: moneyTypes.rows.length,
      providerSpecificHelpers: providerSpecificHelpers.map((row) => row.proname),
      rlsHelpers: helperSafety.rows.map((row) => ({
        name: row.proname,
        securityDefiner: row.prosecdef,
        config: row.proconfig,
      })),
    };

    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
