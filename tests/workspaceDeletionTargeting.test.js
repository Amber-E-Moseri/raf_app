import test from 'node:test';
import assert from 'node:assert/strict';

import { deleteWorkspace, MembersError } from '../lib/collaboration/members.js';
import { createInMemoryDb } from '../lib/server/inMemoryDb.js';

test('deleteWorkspace deletes only the requested workspace and preserves other owned workspace data', async () => {
  const db = createInMemoryDb();
  const owner = await db.transaction((tx) => tx.createUser({
    email: 'owner-delete-target@test.local',
    passwordHash: 'hash',
  }));

  const personal = await db.transaction((tx) => tx.createWorkspace({
    ownerUserId: owner.id,
    name: 'Personal',
    type: 'personal',
  }));
  const family = await db.transaction((tx) => tx.createWorkspace({
    ownerUserId: owner.id,
    name: 'Family',
    type: 'household',
  }));
  const sideBusiness = await db.transaction((tx) => tx.createWorkspace({
    ownerUserId: owner.id,
    name: 'Side Business',
    type: 'household',
  }));
  await db.transaction(async (tx) => {
    await tx.createWorkspaceMember({ workspaceId: personal.id, userId: owner.id, role: 'owner' });
    await tx.createWorkspaceMember({ workspaceId: family.id, userId: owner.id, role: 'owner' });
    await tx.createWorkspaceMember({ workspaceId: sideBusiness.id, userId: owner.id, role: 'owner' });
  });

  await db.transaction((tx) => tx.insertTransaction({
    householdId: personal.id,
    transactionDate: '2026-03-01',
    description: 'Personal transaction',
    amount: '10.00',
    direction: 'debit',
    categoryId: null,
    source: 'manual',
  }));
  await db.transaction((tx) => tx.insertTransaction({
    householdId: family.id,
    transactionDate: '2026-03-01',
    description: 'Family transaction',
    amount: '20.00',
    direction: 'debit',
    categoryId: null,
    source: 'manual',
  }));
  await db.transaction((tx) => tx.insertTransaction({
    householdId: sideBusiness.id,
    transactionDate: '2026-03-01',
    description: 'Side business transaction',
    amount: '30.00',
    direction: 'debit',
    categoryId: null,
    source: 'manual',
  }));

  await deleteWorkspace({ db, workspaceId: family.id, requestingUserId: owner.id });

  const remainingWorkspaces = await db.transaction((tx) => tx.listWorkspacesForUser({ userId: owner.id }));
  assert.deepEqual(
    remainingWorkspaces.map((workspace) => workspace.name).sort(),
    ['Personal', 'Side Business'],
  );
  assert.equal(await db.transaction((tx) => tx.getWorkspace({ workspaceId: family.id })), null);

  const personalTransactions = await db.transaction((tx) => tx.listTransactions({
    householdId: personal.id,
    from: '2026-03-01',
    to: '2026-03-31',
  }));
  const sideBusinessTransactions = await db.transaction((tx) => tx.listTransactions({
    householdId: sideBusiness.id,
    from: '2026-03-01',
    to: '2026-03-31',
  }));
  const familyTransactions = await db.transaction((tx) => tx.listTransactions({
    householdId: family.id,
    from: '2026-03-01',
    to: '2026-03-31',
  }));

  assert.equal(personalTransactions.items.length, 1);
  assert.equal(sideBusinessTransactions.items.length, 1);
  assert.equal(familyTransactions.items.length, 0);
});

test('deleteWorkspace denies non-owners and guessed workspace ids', async () => {
  const db = createInMemoryDb();
  const owner = await db.transaction((tx) => tx.createUser({ email: 'owner@test.local', passwordHash: 'hash' }));
  const nonOwner = await db.transaction((tx) => tx.createUser({ email: 'member@test.local', passwordHash: 'hash' }));
  const workspace = await db.transaction((tx) => tx.createWorkspace({
    ownerUserId: owner.id,
    name: 'Owned Household',
    type: 'household',
  }));
  await db.transaction((tx) => tx.createWorkspaceMember({ workspaceId: workspace.id, userId: owner.id, role: 'owner' }));

  await assert.rejects(
    () => deleteWorkspace({ db, workspaceId: workspace.id, requestingUserId: nonOwner.id }),
    (error) => error instanceof MembersError && error.status === 403,
  );

  await assert.rejects(
    () => deleteWorkspace({ db, workspaceId: 'workspace_guess', requestingUserId: owner.id }),
    (error) => error instanceof MembersError && error.status === 403,
  );
});
