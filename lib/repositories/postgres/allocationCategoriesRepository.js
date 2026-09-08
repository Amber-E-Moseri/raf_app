import { clone, isoNow, uuid } from './utils.js';

function groupIntoSnapshots(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const snapshotId = row.snapshotId ?? row.id;
    if (!grouped.has(snapshotId)) grouped.set(snapshotId, []);
    grouped.get(snapshotId).push(row);
  }
  return [...grouped.entries()]
    .map(([snapshotId, snapshotRows]) => {
      const first = snapshotRows[0];
      return {
        snapshotId,
        effectiveFrom: first.effectiveFrom ?? null,
        supersededAt: first.supersededAt ?? null,
        items: [...snapshotRows]
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) || a.id.localeCompare(b.id))
          .map(clone),
      };
    })
    .sort((a, b) => (b.effectiveFrom ?? '') > (a.effectiveFrom ?? '') ? 1 : b.snapshotId > a.snapshotId ? 1 : -1);
}

export function buildAllocationCategoriesRepository(client, schema) {
  return {
    async listAllocationCategories({ householdId, asOf = null } = {}) {
      const targetDate = asOf ?? '9999-12-31';
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.allocation_categories
         WHERE workspace_id = $1
           AND snapshot_id = (
             SELECT snapshot_id FROM ${schema}.allocation_categories
             WHERE workspace_id = $1
               AND effective_from <= $2
               AND (superseded_at IS NULL OR superseded_at > $2)
             ORDER BY effective_from DESC, snapshot_id DESC
             LIMIT 1
           )
         ORDER BY sort_order, slug, id`,
        [householdId, targetDate],
      );
      return result.rows.map((row) => clone(row.raw_json));
    },

    async listAllocationCategorySnapshots({ householdId }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.allocation_categories
         WHERE workspace_id = $1
         ORDER BY effective_from DESC, snapshot_id DESC, sort_order, id`,
        [householdId],
      );
      return groupIntoSnapshots(result.rows.map((row) => clone(row.raw_json)));
    },

    async replaceAllocationCategories({ householdId, items, effectiveFrom }) {
      const now = isoNow();

      // Capture existing system/buffer flags by slug before superseding
      const existingResult = await client.query(
        `SELECT raw_json FROM ${schema}.allocation_categories
         WHERE workspace_id = $1 AND superseded_at IS NULL`,
        [householdId],
      );
      const existingBySlug = new Map(
        existingResult.rows.map((row) => [row.raw_json.slug, row.raw_json]),
      );

      // Supersede all currently active rows
      await client.query(
        `UPDATE ${schema}.allocation_categories
         SET superseded_at = $2, updated_at = $3
         WHERE workspace_id = $1 AND superseded_at IS NULL`,
        [householdId, effectiveFrom, now],
      );

      // Insert the new snapshot
      const nextSnapshotId = uuid();
      const inserted = [];
      for (const item of items) {
        const existing = existingBySlug.get(item.slug) ?? null;
        const row = {
          id: uuid(),
          workspaceId: householdId,
          householdId,
          snapshotId: nextSnapshotId,
          effectiveFrom,
          supersededAt: null,
          slug: item.slug,
          label: item.label,
          sortOrder: item.sortOrder,
          allocationPercent: item.allocationPercent,
          isSystem: existing?.isSystem === true,
          isActive: item.isActive !== false,
          isBuffer: item.slug === 'buffer',
          createdAt: now,
          updatedAt: now,
        };
        await client.query(
          `INSERT INTO ${schema}.allocation_categories
           (id, workspace_id, snapshot_id, slug, label, sort_order, allocation_percent, is_system, is_active, is_buffer, effective_from, superseded_at, created_at, updated_at, raw_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [row.id, householdId, nextSnapshotId, row.slug, row.label, row.sortOrder, row.allocationPercent, row.isSystem, row.isActive, row.isBuffer, effectiveFrom, null, now, now, row],
        );
        inserted.push(row);
      }

      return inserted.sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id),
      );
    },

    async listSurplusSplitRules({ householdId }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.surplus_split_rules
         WHERE workspace_id = $1
         ORDER BY sort_order, id`,
        [householdId],
      );
      return result.rows.map((row) => clone(row.raw_json));
    },

    async replaceSurplusSplitRules({ householdId, items }) {
      const now = isoNow();

      // Capture existing createdAt by id so we can preserve it for unchanged rows
      const existingResult = await client.query(
        `SELECT raw_json FROM ${schema}.surplus_split_rules WHERE workspace_id = $1`,
        [householdId],
      );
      const existingById = new Map(
        existingResult.rows.map((row) => [row.raw_json.id, row.raw_json]),
      );

      await client.query(`DELETE FROM ${schema}.surplus_split_rules WHERE workspace_id = $1`, [householdId]);

      const nextRows = [];
      for (const item of items) {
        const existing = item.id ? (existingById.get(item.id) ?? null) : null;
        const row = {
          id: item.id ?? uuid(),
          workspaceId: householdId,
          householdId,
          slug: item.slug,
          label: item.label,
          splitPercent: item.splitPercent,
          sortOrder: item.sortOrder,
          isActive: item.isActive !== false,
          destinationType: item.destinationType ?? 'bucket',
          destinationBucketSlug: item.destinationBucketSlug ?? null,
          destinationGoalId: item.destinationGoalId ?? null,
          destinationDebtId: item.destinationDebtId ?? null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        await client.query(
          `INSERT INTO ${schema}.surplus_split_rules
           (id, workspace_id, slug, label, split_percent, sort_order, is_active, destination_type, destination_bucket_slug, destination_goal_id, destination_debt_id, created_at, updated_at, raw_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [row.id, householdId, row.slug, row.label, row.splitPercent, row.sortOrder, row.isActive, row.destinationType, row.destinationBucketSlug, row.destinationGoalId, row.destinationDebtId, row.createdAt, now, row],
        );
        nextRows.push(row);
      }

      return nextRows.map(clone);
    },
  };
}
