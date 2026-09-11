import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startIsolatedSqliteServer } from './helpers/isolatedSqliteServer.js';

import { createInMemoryDb } from '../lib/server/inMemoryDb.js';
import { POST as transferOwnershipRoute } from '../app/api/v1/workspaces/[id]/transfer-ownership/route.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
// Randomized rather than fixed so a leaked/leftover server process from an interrupted
// prior run can never be mistaken for this run's freshly spawned instance.
const port = 20000 + Math.floor(Math.random() * 20000);
const baseUrl = `http://localhost:${port}`;

let serverProcess;


async function request(pathname, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

async function jsonRequest(pathname, { method = 'GET', body, headers = {} } = {}) {
  return request(pathname, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  serverProcess = await startIsolatedSqliteServer({
    repoRoot,
    testName: 'raf-zero-coverage-routes',
    port,
    extraEnv: {
      STRIPE_WEBHOOK_SECRET: '',
    },
  });
});

after(async () => {
  await serverProcess?.stop();
});

test('scenarios walkthrough previews, requires confirmation, and applies a fixed-bill scenario', async () => {
  const today = new Date().toISOString().slice(0, 10);

  const income = await jsonRequest('/api/v1/income', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'zero-coverage-scenario-income' },
    body: {
      sourceName: 'Scenario Payroll',
      amount: '3000.00',
      receivedDate: today,
    },
  });
  assert.equal(income.response.status, 201);

  const preview = await jsonRequest('/api/v1/scenarios', {
    method: 'POST',
    body: {
      scenario: {
        type: 'income_drop',
        percentDrop: 10,
      },
    },
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.data.snapshot.incomeEntryCount >= 1, true);
  assert.equal(preview.data.delta.monthlyIncome.cents < 0, true);

  const pending = await jsonRequest('/api/v1/scenarios/apply', {
    method: 'POST',
    body: {
      scenario: {
        type: 'expense_increase',
        name: 'Scenario Insurance',
        amountCents: 12500,
      },
      confirmed: false,
    },
  });
  assert.equal(pending.response.status, 200);
  assert.equal(pending.data.requiresConfirmation, true);
  assert.equal(pending.data.changeSet[0].resource, 'fixedBill');

  const applied = await jsonRequest('/api/v1/scenarios/apply', {
    method: 'POST',
    body: {
      scenario: {
        type: 'expense_increase',
        name: 'Scenario Insurance',
        amountCents: 12500,
      },
      confirmed: true,
    },
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.data.changeCount, 1);
  assert.equal(applied.data.errors.length, 0);

  const fixedBills = await request('/api/v1/household/fixed-bills');
  assert.equal(fixedBills.response.status, 200);
  assert.equal(fixedBills.data.items.some((item) => item.name === 'Scenario Insurance'), true);
});

test('upcoming expenses walkthrough creates, lists, updates with PUT, filters, and deletes', async () => {
  const created = await jsonRequest('/api/v1/upcoming-expenses', {
    method: 'POST',
    body: {
      name: 'Annual insurance',
      amount: '420.50',
      expectedDate: '2026-10-15',
      category: 'insurance',
      priority: 'essential',
      confidence: 'expected',
      notes: 'Renewal notice',
    },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.amount, '420.50');

  const listed = await request('/api/v1/upcoming-expenses');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.data.items.some((item) => item.id === created.data.id), true);

  const updated = await jsonRequest(`/api/v1/upcoming-expenses/${created.data.id}`, {
    method: 'PUT',
    body: {
      amount: '399.99',
      status: 'archived',
    },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.amount, '399.99');
  assert.equal(updated.data.status, 'archived');

  const archived = await request('/api/v1/upcoming-expenses?status=archived');
  assert.equal(archived.response.status, 200);
  assert.equal(archived.data.items.some((item) => item.id === created.data.id), true);

  const deleted = await request(`/api/v1/upcoming-expenses/${created.data.id}`, { method: 'DELETE' });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.data.deleted, true);

  const afterDelete = await request(`/api/v1/upcoming-expenses/${created.data.id}`);
  assert.equal(afterDelete.response.status, 404);
});

test('financial account reconciliations walkthrough creates, lists, resolves with PUT, and deletes open rows', async () => {
  const account = await jsonRequest('/api/v1/financial-accounts', {
    method: 'POST',
    body: {
      name: 'Chequing',
      account_type: 'checking',
      current_balance: '1000.00',
      balance_as_of: '2026-09-01T00:00:00.000Z',
    },
  });
  assert.equal(account.response.status, 201);

  const reconciliation = await jsonRequest(`/api/v1/financial-accounts/${account.data.id}/reconciliations`, {
    method: 'POST',
    body: {
      reported_balance: '990.00',
      reported_as_of: '2026-09-02T00:00:00.000Z',
      source: 'statement',
      note: 'Statement balance',
    },
  });
  assert.equal(reconciliation.response.status, 201);
  assert.equal(reconciliation.data.discrepancy, '-10.00');
  assert.equal(reconciliation.data.status, 'open');

  const listed = await request(`/api/v1/financial-accounts/${account.data.id}/reconciliations`);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.data.items.some((item) => item.id === reconciliation.data.id), true);

  const resolved = await jsonRequest(`/api/v1/financial-accounts/${account.data.id}/reconciliations/${reconciliation.data.id}`, {
    method: 'PUT',
    body: {
      action: 'accept_reported_balance',
      note: 'Accepted statement',
    },
  });
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.data.status, 'resolved');
  assert.equal(resolved.data.resolved_action, 'accept_reported_balance');

  const deletable = await jsonRequest(`/api/v1/financial-accounts/${account.data.id}/reconciliations`, {
    method: 'POST',
    body: {
      reported_balance: '995.00',
      reported_as_of: '2026-09-03T00:00:00.000Z',
      source: 'manual',
    },
  });
  assert.equal(deletable.response.status, 201);

  const deleted = await request(`/api/v1/financial-accounts/${account.data.id}/reconciliations/${deletable.data.id}`, {
    method: 'DELETE',
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.data.deleted, true);

  const afterDelete = await request(`/api/v1/financial-accounts/${account.data.id}/reconciliations`);
  assert.equal(afterDelete.response.status, 200);
  assert.equal(afterDelete.data.items.some((item) => item.id === deletable.data.id), false);
});

test('billing webhook returns configured failure when Stripe webhook secret is absent', async () => {
  const result = await jsonRequest('/api/v1/billing/webhook', {
    method: 'POST',
    body: {
      id: 'evt_test',
      type: 'customer.subscription.updated',
    },
  });
  assert.equal(result.response.status, 503);
  assert.match(result.data.error, /not configured/i);
});

test('email preferences walkthrough reads defaults and updates with PUT', async () => {
  const defaults = await request('/api/v1/household/email-preferences');
  assert.equal(defaults.response.status, 200);
  assert.equal(defaults.data.remindersEnabled, true);

  const updated = await jsonRequest('/api/v1/household/email-preferences', {
    method: 'PUT',
    body: {
      remindersEnabled: false,
      preferredDay: 'friday',
      preferredHour: 17,
      timezone: 'America/Toronto',
      contactEmail: 'alerts@example.test',
      optedInBudgetAlerts: false,
    },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.remindersEnabled, false);
  assert.equal(updated.data.preferredDay, 'friday');
  assert.equal(updated.data.contactEmail, 'alerts@example.test');

  const invalid = await jsonRequest('/api/v1/household/email-preferences', {
    method: 'PUT',
    body: {
      preferredHour: 30,
    },
  });
  assert.equal(invalid.response.status, 400);
});

test('household subscription walkthrough reads quota status and updates tier with PUT', async () => {
  const status = await request('/api/v1/household/subscription');
  assert.equal(status.response.status, 200);
  assert.equal(status.data.tier, 'free');
  assert.equal(typeof status.data.remaining, 'number');

  const updated = await jsonRequest('/api/v1/household/subscription', {
    method: 'PUT',
    body: {
      tier: 'paid',
      expiresAt: '2027-01-01T00:00:00.000Z',
    },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.data.tier, 'paid');
  assert.equal(updated.data.expiresAt, '2027-01-01T00:00:00.000Z');

  const afterUpdate = await request('/api/v1/household/subscription');
  assert.equal(afterUpdate.response.status, 200);
  assert.equal(afterUpdate.data.tier, 'paid');

  const invalid = await jsonRequest('/api/v1/household/subscription', {
    method: 'PUT',
    body: {
      tier: 'enterprise',
    },
  });
  assert.equal(invalid.response.status, 400);
});

test('workspace transfer ownership route transfers owner role to another active member', async () => {
  const db = createInMemoryDb();
  const workspaceId = db.defaultHouseholdId;
  const newOwner = await db.transaction(async (tx) => {
    const user = await tx.createUser({
      id: 'new-owner-user',
      email: 'new-owner@example.test',
      passwordHash: null,
    });
    await tx.createWorkspaceMember({
      workspaceId,
      userId: user.id,
      role: 'admin',
      status: 'active',
    });
    return user;
  });

  const response = await transferOwnershipRoute(
    new Request(`http://localhost/api/v1/workspaces/${workspaceId}/transfer-ownership`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toUserId: newOwner.id }),
    }),
    {
      db,
      params: { id: workspaceId },
      userId: 'local-user',
      workspaceId,
      householdId: workspaceId,
      role: 'owner',
      workspace: {
        role: 'owner',
        workspaceId,
        householdId: workspaceId,
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const [oldOwnerMembership, newOwnerMembership, workspace] = await db.transaction(async (tx) => Promise.all([
    tx.getWorkspaceMember({ workspaceId, userId: 'local-user' }),
    tx.getWorkspaceMember({ workspaceId, userId: newOwner.id }),
    tx.getWorkspace({ workspaceId }),
  ]));
  assert.equal(oldOwnerMembership.role, 'admin');
  assert.equal(newOwnerMembership.role, 'owner');
  assert.equal(workspace.ownerUserId, newOwner.id);
});
