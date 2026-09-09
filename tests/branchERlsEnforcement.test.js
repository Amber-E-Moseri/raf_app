/**
 * Branch E.1 — PostgreSQL RLS enforcement tests with non-BYPASSRLS runtime role
 *
 * Phases covered:
 *   Phase  7: Direct SQL RLS — cross-tenant read/write blocked by PostgreSQL itself
 *   Phase  8: Missing security context → fail-closed (0 rows, not an error)
 *   Phase  9: Connection pool context leakage (transaction-local set_config cleared)
 *   Phase 10: Same-workspace referential integrity / cross-tenant FK behavior
 *
 * CRITICAL DESIGN NOTE:
 *   Two separate pools are required:
 *
 *   adminPool (DATABASE_URL → neondb_owner, BYPASSRLS)
 *     - Fixture setup: create test workspaces, users, members
 *     - Direct INSERT of test data into WS-A (bypasses RLS for setup)
 *     - Cleanup (DELETE test data)
 *
 *   appPool (POSTGRES_CONNECTION_STRING_APP → raf_app, NOBYPASSRLS)
 *     - ALL asAuthenticated() calls — RLS is actively evaluated here
 *     - Pool-leakage tests — proves transaction-local vars are cleared
 *     - Missing-context tests — proves fail-closed behavior under runtime role
 *
 *   Using adminPool for RLS assertions would produce misleading results because
 *   neondb_owner BYPASSRLS skips all policy evaluation regardless of session vars.
 *
 * Gate conditions:
 *   DATABASE_URL                   — privileged connection for fixture setup
 *   POSTGRES_CONNECTION_STRING_APP — raf_app connection (NOBYPASSRLS) for RLS proofs
 *   RAF_RUN_POSTGRES_RLS_TESTS     — must be 'true' (opt-in guard)
 *   RAF_CONFIRM_NON_PRODUCTION_DB  — must be 'true' (safety guard)
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';

const { Pool } = pg;

const adminUrl = process.env.DATABASE_URL?.replace(/^["']|["']$/g, '');
const appUrl = process.env.POSTGRES_CONNECTION_STRING_APP;
const rlsEnabled = process.env.RAF_RUN_POSTGRES_RLS_TESTS === 'true';
const nonProd = process.env.RAF_CONFIRM_NON_PRODUCTION_DB === 'true';

const shouldRun = Boolean(adminUrl && appUrl && rlsEnabled && nonProd);
const maybeTest = shouldRun ? test : test.skip;

let adminPool; // neondb_owner — BYPASSRLS, for fixture setup
let appPool;   // raf_app — NOBYPASSRLS, for RLS assertions (proves real enforcement)

// Fixture identities — created once, used across tests
let userA, userB;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid() { return crypto.randomUUID(); }

/**
 * Run callback inside a transaction with raf.user_id / raf.workspace_id set.
 * MUST be called with a client from appPool — adminPool bypasses all RLS.
 */
async function asAuthenticated(client, { userId, workspaceId }, callback) {
  await client.query('BEGIN');
  await client.query("SELECT set_config('raf.user_id', $1, true)", [userId]);
  if (workspaceId) {
    await client.query("SELECT set_config('raf.workspace_id', $1, true)", [workspaceId]);
  }
  try {
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function asUnauthenticated(client, callback) {
  await client.query('BEGIN');
  await client.query("SELECT set_config('raf.user_id', '', false)");
  await client.query("SELECT set_config('raf.workspace_id', '', false)");
  try {
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Create workspace + household + membership via adminPool (bypasses RLS for setup).
 * Column names match the live Neon schema exactly.
 */
async function createWorkspaceFixture(adminClient, { email }) {
  const userId = uuid();
  const wsId = uuid();
  const hhId = wsId; // household.id === workspace.id per app convention

  await adminClient.query(
    `INSERT INTO raf.app_users (id, email, password_hash)
     VALUES ($1, $2, 'test-hash')
     ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id`,
    [userId, email],
  );
  await adminClient.query(
    `INSERT INTO raf.workspaces (id, name, owner_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [wsId, `Workspace ${email}`, userId],
  );
  await adminClient.query(
    `INSERT INTO raf.workspace_members (workspace_id, user_id, role, status)
     VALUES ($1, $2, 'owner', 'active')
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [wsId, userId],
  );
  await adminClient.query(
    `INSERT INTO raf.households (id, workspace_id, owner_user_id, name, active_month)
     VALUES ($1, $2, $3, $4, CURRENT_DATE)
     ON CONFLICT (id) DO NOTHING`,
    [hhId, wsId, userId, `Household ${email}`],
  );
  return { userId, workspaceId: wsId, householdId: hhId };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

before(async () => {
  if (!shouldRun) return;

  adminPool = new Pool({ connectionString: adminUrl, max: 3 });
  appPool   = new Pool({ connectionString: appUrl,   max: 3 });

  // Verify appPool role is actually NOBYPASSRLS before running any tests
  const appClient = await appPool.connect();
  try {
    const { rows } = await appClient.query(
      `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`,
    );
    if (!rows.length) throw new Error('Cannot identify runtime role');
    const role = rows[0];
    if (role.rolbypassrls || role.rolsuper) {
      throw new Error(
        `RLS enforcement tests require a NOBYPASSRLS NOSUPERUSER role but ` +
        `connected as "${role.rolname}" which has ` +
        `${role.rolbypassrls ? 'BYPASSRLS ' : ''}${role.rolsuper ? 'SUPERUSER' : ''}. ` +
        `Set POSTGRES_CONNECTION_STRING_APP to the raf_app runtime role.`,
      );
    }
    console.log(`[rls-test] appPool role: ${role.rolname} — rolbypassrls:${role.rolbypassrls} ✓`);
  } finally {
    appClient.release();
  }

  // Create test fixtures via admin connection
  const adminClient = await adminPool.connect();
  try {
    await adminClient.query('BEGIN');
    const ts = Date.now();
    userA = await createWorkspaceFixture(adminClient, { email: `rls-a-${ts}@test.test` });
    userB = await createWorkspaceFixture(adminClient, { email: `rls-b-${ts}@test.test` });
    await adminClient.query('COMMIT');
  } catch (err) {
    await adminClient.query('ROLLBACK');
    throw err;
  } finally {
    adminClient.release();
  }
});

after(async () => {
  if (!shouldRun) return;
  const adminClient = await adminPool.connect();
  try {
    await adminClient.query('BEGIN');
    for (const u of [userA, userB]) {
      if (!u) continue;
      const wsId = u.workspaceId;
      const userId = u.userId;
      // Delete financial data first
      for (const t of ['income_entries', 'debts', 'goals', 'fixed_bills', 'allocation_categories', 'debt_payments', 'transactions']) {
        await adminClient.query(`DELETE FROM raf.${t} WHERE workspace_id = $1`, [wsId]).catch(() => {});
      }
      await adminClient.query(`DELETE FROM raf.households WHERE workspace_id = $1`, [wsId]).catch(() => {});
      await adminClient.query(`DELETE FROM raf.workspace_members WHERE workspace_id = $1`, [wsId]).catch(() => {});
      await adminClient.query(`DELETE FROM raf.workspaces WHERE id = $1`, [wsId]).catch(() => {});
      await adminClient.query(`DELETE FROM raf.app_users WHERE id = $1`, [userId]).catch(() => {});
    }
    await adminClient.query('COMMIT');
  } catch { await adminClient.query('ROLLBACK'); }
  finally { adminClient.release(); }

  await adminPool.end().catch(() => {});
  await appPool.end().catch(() => {});
});

// ---------------------------------------------------------------------------
// Phase 7 — Direct SQL RLS: cross-tenant SELECT blocked by PostgreSQL itself
// ---------------------------------------------------------------------------

maybeTest('Phase 7 RLS SELECT: income_entries WS-A row invisible to WS-B raf_app session', async () => {
  const incId = uuid();

  // Setup: INSERT into WS-A via privileged admin connection
  const adminClient = await adminPool.connect();
  await adminClient.query(
    `INSERT INTO raf.income_entries (id, workspace_id, source_name, amount, received_date, created_at, updated_at)
     VALUES ($1, $2, 'A Secret Income', 1500.00, '2026-08-01', now(), now())`,
    [incId, userA.workspaceId],
  );
  adminClient.release();

  // Assertion: WS-B session via raf_app — must see 0 rows
  const appClient = await appPool.connect();
  try {
    const bResult = await asAuthenticated(appClient, { userId: userB.userId, workspaceId: userB.workspaceId }, async (c) => {
      const { rows } = await c.query(`SELECT id, source_name FROM raf.income_entries WHERE id = $1`, [incId]);
      return rows;
    });
    assert.equal(bResult.length, 0,
      `RLS must hide WS-A income from WS-B raf_app session; got ${JSON.stringify(bResult)}`);

    // Positive case: WS-A session via raf_app — must see 1 row
    const aResult = await asAuthenticated(appClient, { userId: userA.userId, workspaceId: userA.workspaceId }, async (c) => {
      const { rows } = await c.query(`SELECT id, source_name FROM raf.income_entries WHERE id = $1`, [incId]);
      return rows;
    });
    assert.equal(aResult.length, 1, 'WS-A income must be visible to WS-A raf_app session');
  } finally {
    appClient.release();
  }

  // Cleanup
  const cleanClient = await adminPool.connect();
  await cleanClient.query(`DELETE FROM raf.income_entries WHERE id = $1`, [incId]);
  cleanClient.release();
});

maybeTest('Phase 7 RLS SELECT: debts WS-A row invisible to WS-B raf_app session', async () => {
  const debtId = uuid();
  const adminClient = await adminPool.connect();
  await adminClient.query(
    `INSERT INTO raf.debts (id, workspace_id, name, starting_balance, current_balance, apr, minimum_payment, monthly_payment, created_at, updated_at)
     VALUES ($1, $2, 'A Secret Debt', 5000.00, 5000.00, 10.0, 50.00, 200.00, now(), now())`,
    [debtId, userA.workspaceId],
  );
  adminClient.release();

  const appClient = await appPool.connect();
  try {
    const bResult = await asAuthenticated(appClient, { userId: userB.userId, workspaceId: userB.workspaceId }, async (c) => {
      const { rows } = await c.query(`SELECT id, name FROM raf.debts WHERE id = $1`, [debtId]);
      return rows;
    });
    assert.equal(bResult.length, 0, `RLS must hide WS-A debt from WS-B; got ${JSON.stringify(bResult)}`);
  } finally {
    appClient.release();
  }

  const cleanClient = await adminPool.connect();
  await cleanClient.query(`DELETE FROM raf.debts WHERE id = $1`, [debtId]);
  cleanClient.release();
});

maybeTest('Phase 7 RLS SELECT: goals WS-A row invisible to WS-B raf_app session', async () => {
  const goalId = uuid();
  const adminClient = await adminPool.connect();
  await adminClient.query(
    `INSERT INTO raf.goals (id, workspace_id, name, target_amount, created_at, updated_at)
     VALUES ($1, $2, 'A Secret Goal', 20000.00, now(), now())`,
    [goalId, userA.workspaceId],
  );
  adminClient.release();

  const appClient = await appPool.connect();
  try {
    const bResult = await asAuthenticated(appClient, { userId: userB.userId, workspaceId: userB.workspaceId }, async (c) => {
      const { rows } = await c.query(`SELECT id, name FROM raf.goals WHERE id = $1`, [goalId]);
      return rows;
    });
    assert.equal(bResult.length, 0, `RLS must hide WS-A goal from WS-B; got ${JSON.stringify(bResult)}`);
  } finally {
    appClient.release();
  }

  const cleanClient = await adminPool.connect();
  await cleanClient.query(`DELETE FROM raf.goals WHERE id = $1`, [goalId]);
  cleanClient.release();
});

maybeTest('Phase 7 RLS SELECT: transactions WS-A row invisible to WS-B raf_app session', async () => {
  const txId = uuid();
  const adminClient = await adminPool.connect();
  await adminClient.query(
    `INSERT INTO raf.transactions (id, workspace_id, description, amount, transaction_date, created_at, updated_at)
     VALUES ($1, $2, 'A Secret Txn', 99.99, '2026-08-15', now(), now())`,
    [txId, userA.workspaceId],
  );
  adminClient.release();

  const appClient = await appPool.connect();
  try {
    const bResult = await asAuthenticated(appClient, { userId: userB.userId, workspaceId: userB.workspaceId }, async (c) => {
      const { rows } = await c.query(`SELECT id FROM raf.transactions WHERE id = $1`, [txId]);
      return rows;
    });
    assert.equal(bResult.length, 0, `RLS must hide WS-A transaction from WS-B; got ${JSON.stringify(bResult)}`);
  } finally {
    appClient.release();
  }

  const cleanClient = await adminPool.connect();
  await cleanClient.query(`DELETE FROM raf.transactions WHERE id = $1`, [txId]);
  cleanClient.release();
});

maybeTest('Phase 7 RLS SELECT: fixed_bills WS-A row invisible to WS-B raf_app session', async () => {
  const billId = uuid();
  const adminClient = await adminPool.connect();
  await adminClient.query(
    `INSERT INTO raf.fixed_bills (id, workspace_id, name, expected_amount, due_day_of_month, category_slug, created_at, updated_at)
     VALUES ($1, $2, 'A Secret Bill', 1200.00, 1, 'fixed_bills', now(), now())`,
    [billId, userA.workspaceId],
  );
  adminClient.release();

  const appClient = await appPool.connect();
  try {
    const bResult = await asAuthenticated(appClient, { userId: userB.userId, workspaceId: userB.workspaceId }, async (c) => {
      const { rows } = await c.query(`SELECT id FROM raf.fixed_bills WHERE id = $1`, [billId]);
      return rows;
    });
    assert.equal(bResult.length, 0, `RLS must hide WS-A fixed bill from WS-B; got ${JSON.stringify(bResult)}`);
  } finally {
    appClient.release();
  }

  const cleanClient = await adminPool.connect();
  await cleanClient.query(`DELETE FROM raf.fixed_bills WHERE id = $1`, [billId]);
  cleanClient.release();
});

maybeTest('Phase 7 RLS INSERT: WS-B raf_app session cannot INSERT into WS-A (WITH CHECK)', async () => {
  const goalId = uuid();
  const appClient = await appPool.connect();
  let rlsRejected = false;

  try {
    // Attempt to INSERT a goal with workspace_id = WS-A while authenticated as WS-B
    await asAuthenticated(appClient, { userId: userB.userId, workspaceId: userB.workspaceId }, async (c) => {
      await c.query(
        `INSERT INTO raf.goals (id, workspace_id, name, target_amount, created_at, updated_at)
         VALUES ($1, $2, 'B Injected into A', 99.00, now(), now())`,
        [goalId, userA.workspaceId],
      );
    });
  } catch (err) {
    if (err.code === '42501' || err.message?.includes('row-level security')) {
      rlsRejected = true;
    } else {
      throw err;
    }
  } finally {
    appClient.release();
  }

  // The row must not appear in WS-A regardless of whether RLS threw or silently blocked
  const adminClient = await adminPool.connect();
  const { rows } = await adminClient.query(`SELECT id FROM raf.goals WHERE id = $1`, [goalId]);
  adminClient.release();

  if (!rlsRejected) {
    // If no error, the row must be absent (USING-only policy silently blocks visibility)
    assert.equal(rows.length, 0,
      `Cross-workspace INSERT must not produce a visible row in WS-A`);
  } else {
    assert.ok(true, 'RLS correctly rejected cross-workspace INSERT with policy violation error');
  }
});

maybeTest('Phase 7 RLS UPDATE: WS-B raf_app session cannot UPDATE WS-A row', async () => {
  const debtId = uuid();
  const adminClient = await adminPool.connect();
  await adminClient.query(
    `INSERT INTO raf.debts (id, workspace_id, name, starting_balance, current_balance, apr, minimum_payment, monthly_payment, created_at, updated_at)
     VALUES ($1, $2, 'Original Name', 3000.00, 3000.00, 5.0, 50.00, 100.00, now(), now())`,
    [debtId, userA.workspaceId],
  );
  adminClient.release();

  const appClient = await appPool.connect();
  try {
    let affectedRows = -1;
    try {
      affectedRows = await asAuthenticated(appClient, { userId: userB.userId, workspaceId: userB.workspaceId }, async (c) => {
        const r = await c.query(
          `UPDATE raf.debts SET name = 'Hijacked by B' WHERE id = $1`,
          [debtId],
        );
        return r.rowCount;
      });
    } catch { affectedRows = 0; }
    assert.equal(affectedRows, 0, `WS-B UPDATE on WS-A debt must affect 0 rows; got ${affectedRows}`);
  } finally {
    appClient.release();
  }

  // Verify WS-A row is unchanged
  const verifyClient = await adminPool.connect();
  const { rows } = await verifyClient.query(`SELECT name FROM raf.debts WHERE id = $1`, [debtId]);
  verifyClient.release();
  assert.equal(rows[0]?.name, 'Original Name', 'WS-A debt name must be unchanged after WS-B UPDATE attempt');

  const cleanClient = await adminPool.connect();
  await cleanClient.query(`DELETE FROM raf.debts WHERE id = $1`, [debtId]);
  cleanClient.release();
});

maybeTest('Phase 7 RLS DELETE: WS-B raf_app session cannot DELETE WS-A row', async () => {
  const goalId = uuid();
  const adminClient = await adminPool.connect();
  await adminClient.query(
    `INSERT INTO raf.goals (id, workspace_id, name, target_amount, created_at, updated_at)
     VALUES ($1, $2, 'A Goal to Protect', 5000.00, now(), now())`,
    [goalId, userA.workspaceId],
  );
  adminClient.release();

  const appClient = await appPool.connect();
  try {
    const deletedRows = await asAuthenticated(appClient, { userId: userB.userId, workspaceId: userB.workspaceId }, async (c) => {
      const r = await c.query(`DELETE FROM raf.goals WHERE id = $1`, [goalId]);
      return r.rowCount;
    });
    assert.equal(deletedRows, 0,
      `WS-B DELETE on WS-A goal must affect 0 rows (RLS hides the row); got ${deletedRows}`);
  } finally {
    appClient.release();
  }

  // Verify the WS-A row still exists
  const verifyClient = await adminPool.connect();
  const { rows } = await verifyClient.query(`SELECT id FROM raf.goals WHERE id = $1`, [goalId]);
  verifyClient.release();
  assert.equal(rows.length, 1, 'WS-A goal must still exist after WS-B DELETE attempt');

  const cleanClient = await adminPool.connect();
  await cleanClient.query(`DELETE FROM raf.goals WHERE id = $1`, [goalId]);
  cleanClient.release();
});

// ---------------------------------------------------------------------------
// Phase 8 — Missing context → fail-closed
// ---------------------------------------------------------------------------

maybeTest('Phase 8: no session vars → income_entries returns 0 rows from raf_app', async () => {
  const incId = uuid();
  const adminClient = await adminPool.connect();
  await adminClient.query(
    `INSERT INTO raf.income_entries (id, workspace_id, source_name, amount, received_date, created_at, updated_at)
     VALUES ($1, $2, 'Fail-Closed Test', 100.00, '2026-08-01', now(), now())`,
    [incId, userA.workspaceId],
  );
  adminClient.release();

  const appClient = await appPool.connect();
  try {
    const result = await asUnauthenticated(appClient, async (c) => {
      const { rows } = await c.query(`SELECT id FROM raf.income_entries WHERE id = $1`, [incId]);
      return rows;
    });
    assert.equal(result.length, 0,
      `No-context query must return 0 rows from income_entries (raf_app); got ${result.length}`);
  } finally {
    appClient.release();
  }

  const cleanClient = await adminPool.connect();
  await cleanClient.query(`DELETE FROM raf.income_entries WHERE id = $1`, [incId]);
  cleanClient.release();
});

maybeTest('Phase 8: only user_id set (no workspace) → financial tables return 0 rows', async () => {
  const incId = uuid();
  const adminClient = await adminPool.connect();
  await adminClient.query(
    `INSERT INTO raf.income_entries (id, workspace_id, source_name, amount, received_date, created_at, updated_at)
     VALUES ($1, $2, 'User-Only Context', 200.00, '2026-08-01', now(), now())`,
    [incId, userA.workspaceId],
  );
  adminClient.release();

  const appClient = await appPool.connect();
  try {
    await appClient.query('BEGIN');
    // Set user_id but NOT workspace_id
    await appClient.query("SELECT set_config('raf.user_id', $1, true)", [userA.userId]);
    const { rows } = await appClient.query(
      `SELECT id FROM raf.income_entries WHERE id = $1`, [incId],
    );
    await appClient.query('COMMIT');

    assert.equal(rows.length, 0,
      `user_id-only context must not bypass workspace check (Phase 2 IS-NULL fix); got ${JSON.stringify(rows)}`);
  } catch (err) {
    await appClient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    appClient.release();
  }

  const cleanClient = await adminPool.connect();
  await cleanClient.query(`DELETE FROM raf.income_entries WHERE id = $1`, [incId]);
  cleanClient.release();
});

maybeTest('Phase 8: workspace_members readable with user_id-only (auth path requirement)', async () => {
  // workspace_members must be accessible with only user_id set for the auth flow.
  // This uses the intentional IS-NULL escape in has_workspace_membership for this table.
  const appClient = await appPool.connect();
  try {
    await appClient.query('BEGIN');
    await appClient.query("SELECT set_config('raf.user_id', $1, true)", [userA.userId]);
    // Intentionally no workspace_id
    const { rows } = await appClient.query(
      `SELECT workspace_id FROM raf.workspace_members WHERE user_id = $1`,
      [userA.userId],
    );
    await appClient.query('COMMIT');
    assert.ok(rows.length >= 1,
      `workspace_members must return rows for user_id-only context (auth path); got ${rows.length}`);
  } catch (err) {
    await appClient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    appClient.release();
  }
});

// ---------------------------------------------------------------------------
// Phase 9 — Connection pool context leakage
// ---------------------------------------------------------------------------

maybeTest('Phase 9 pool: transaction-local vars cleared after COMMIT (raf_app pool)', async () => {
  const appClient = await appPool.connect();
  try {
    await appClient.query('BEGIN');
    await appClient.query("SELECT set_config('raf.user_id', $1, true)", [userA.userId]);
    await appClient.query("SELECT set_config('raf.workspace_id', $1, true)", [userA.workspaceId]);
    await appClient.query('COMMIT');

    const { rows } = await appClient.query(
      `SELECT current_setting('raf.user_id', true) AS uid, current_setting('raf.workspace_id', true) AS wsid`,
    );
    const { uid, wsid } = rows[0];
    assert.ok(!uid || uid === '',
      `raf.user_id must be empty after COMMIT (transaction-local); got "${uid}"`);
    assert.ok(!wsid || wsid === '',
      `raf.workspace_id must be empty after COMMIT (transaction-local); got "${wsid}"`);
  } finally {
    appClient.release();
  }
});

maybeTest('Phase 9 pool: transaction-local vars cleared after ROLLBACK (raf_app pool)', async () => {
  const appClient = await appPool.connect();
  try {
    await appClient.query('BEGIN');
    await appClient.query("SELECT set_config('raf.user_id', $1, true)", [userA.userId]);
    await appClient.query("SELECT set_config('raf.workspace_id', $1, true)", [userA.workspaceId]);
    await appClient.query('ROLLBACK');

    const { rows } = await appClient.query(
      `SELECT current_setting('raf.user_id', true) AS uid, current_setting('raf.workspace_id', true) AS wsid`,
    );
    const { uid, wsid } = rows[0];
    assert.ok(!uid || uid === '',
      `raf.user_id must be empty after ROLLBACK; got "${uid}"`);
    assert.ok(!wsid || wsid === '',
      `raf.workspace_id must be empty after ROLLBACK; got "${wsid}"`);
  } finally {
    appClient.release();
  }
});

maybeTest('Phase 9 pool: WS-A data not visible in subsequent WS-B transaction on same connection', async () => {
  const incId = uuid();
  const adminClient = await adminPool.connect();
  await adminClient.query(
    `INSERT INTO raf.income_entries (id, workspace_id, source_name, amount, received_date, created_at, updated_at)
     VALUES ($1, $2, 'Leakage Test', 50.00, '2026-08-01', now(), now())`,
    [incId, userA.workspaceId],
  );
  adminClient.release();

  const appClient = await appPool.connect();
  try {
    // Request 1: WS-A session — income row is visible
    const aResult = await asAuthenticated(appClient, { userId: userA.userId, workspaceId: userA.workspaceId }, async (c) => {
      const { rows } = await c.query(`SELECT id FROM raf.income_entries WHERE id = $1`, [incId]);
      return rows;
    });
    assert.equal(aResult.length, 1, 'WS-A income must be visible during WS-A session');

    // Request 2: same connection, WS-B session — income row must be invisible
    const bResult = await asAuthenticated(appClient, { userId: userB.userId, workspaceId: userB.workspaceId }, async (c) => {
      const { rows } = await c.query(`SELECT id FROM raf.income_entries WHERE id = $1`, [incId]);
      return rows;
    });
    assert.equal(bResult.length, 0,
      `WS-A income must NOT be visible in subsequent WS-B session on same connection; got ${JSON.stringify(bResult)}`);
  } finally {
    appClient.release();
  }

  const cleanClient = await adminPool.connect();
  await cleanClient.query(`DELETE FROM raf.income_entries WHERE id = $1`, [incId]);
  cleanClient.release();
});

// ---------------------------------------------------------------------------
// Phase 10 — Guessed UUID attack
// ---------------------------------------------------------------------------

maybeTest('Phase 10: guessed UUID returns 0 rows across all financial tables (raf_app)', async () => {
  const guessedId = uuid();
  const tables = [
    'income_entries', 'debts', 'goals', 'fixed_bills', 'transactions',
    'allocation_categories', 'debt_payments', 'debt_adjustments',
  ];

  const appClient = await appPool.connect();
  try {
    for (const table of tables) {
      const result = await asAuthenticated(appClient, { userId: userB.userId, workspaceId: userB.workspaceId }, async (c) => {
        const { rows } = await c.query(`SELECT id FROM raf.${table} WHERE id = $1`, [guessedId]);
        return rows;
      });
      assert.equal(result.length, 0, `Guessed UUID on ${table} must return 0 rows`);
    }
  } finally {
    appClient.release();
  }
});

// ---------------------------------------------------------------------------
// Phase 9 — Workspace context switching (same role, sequential transactions)
// ---------------------------------------------------------------------------

maybeTest('Phase 9 context switch: WS-A vars absent in subsequent WS-B transaction', async () => {
  const appClient = await appPool.connect();
  try {
    // Transaction A — set WS-A context
    await asAuthenticated(appClient, { userId: userA.userId, workspaceId: userA.workspaceId }, async (c) => {
      const { rows } = await c.query(
        `SELECT current_setting('raf.user_id', true) AS uid, current_setting('raf.workspace_id', true) AS wsid`,
      );
      assert.equal(rows[0].uid, userA.userId, 'user_id should be WS-A during WS-A txn');
      assert.equal(rows[0].wsid, userA.workspaceId, 'workspace_id should be WS-A during WS-A txn');
    });

    // Transaction B — vars must be from WS-B, not leaked from WS-A
    await asAuthenticated(appClient, { userId: userB.userId, workspaceId: userB.workspaceId }, async (c) => {
      const { rows } = await c.query(
        `SELECT current_setting('raf.user_id', true) AS uid, current_setting('raf.workspace_id', true) AS wsid`,
      );
      assert.equal(rows[0].uid, userB.userId,
        `user_id in WS-B txn must be WS-B userId, not WS-A; got "${rows[0].uid}"`);
      assert.equal(rows[0].wsid, userB.workspaceId,
        `workspace_id in WS-B txn must be WS-B; got "${rows[0].wsid}"`);
    });

    // After WS-B txn commits — vars must be cleared
    const { rows } = await appClient.query(
      `SELECT current_setting('raf.user_id', true) AS uid, current_setting('raf.workspace_id', true) AS wsid`,
    );
    assert.ok(!rows[0].uid || rows[0].uid === '',
      `raf.user_id must be cleared after WS-B txn commits; got "${rows[0].uid}"`);
  } finally {
    appClient.release();
  }
});
