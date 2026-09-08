import { clone, isoNow, uuid } from './utils.js';

export function buildIncomeRepository(client, schema) {
  return {
    async findIncomeByIdempotencyKey({ householdId, idempotencyKey }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.income_entries
         WHERE workspace_id = $1 AND idempotency_key = $2
         LIMIT 1`,
        [householdId, idempotencyKey],
      );
      return result.rows[0] ? clone(result.rows[0].raw_json) : null;
    },

    async insertIncomeEntry(payload) {
      const now = isoNow();
      const row = {
        id: uuid(),
        createdAt: now,
        updatedAt: now,
        ...payload,
        workspaceId: payload.workspaceId ?? payload.householdId,
        householdId: payload.householdId ?? payload.workspaceId,
      };
      await client.query(
        `INSERT INTO ${schema}.income_entries
         (id, workspace_id, source_name, amount, received_date, notes, idempotency_key, created_at, updated_at, raw_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [row.id, row.workspaceId, row.sourceName, row.amount, row.receivedDate, row.notes ?? null, row.idempotencyKey ?? null, row.createdAt, row.updatedAt, row],
      );
      return clone(row);
    },

    async listIncomeEntries({ householdId, from, to }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.income_entries
         WHERE workspace_id = $1
           AND received_date >= $2
           AND received_date <= $3
         ORDER BY received_date, id`,
        [householdId, from, to],
      );
      return result.rows.map((row) => clone(row.raw_json));
    },

    async getIncomeEntryById({ householdId, incomeId }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.income_entries
         WHERE workspace_id = $1 AND id = $2
         LIMIT 1`,
        [householdId, incomeId],
      );
      return result.rows[0] ? clone(result.rows[0].raw_json) : null;
    },

    async updateIncomeEntry({ householdId, incomeId, patch }) {
      const existing = await this.getIncomeEntryById({ householdId, incomeId });
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: isoNow() };
      await client.query(
        `UPDATE ${schema}.income_entries
         SET source_name = $3, amount = $4, received_date = $5, notes = $6, idempotency_key = $7, updated_at = $8, raw_json = $9
         WHERE workspace_id = $1 AND id = $2`,
        [householdId, incomeId, updated.sourceName, updated.amount, updated.receivedDate, updated.notes ?? null, updated.idempotencyKey ?? null, updated.updatedAt, updated],
      );
      return clone(updated);
    },

    async deleteIncomeEntry({ householdId, incomeId }) {
      await client.query(
        `DELETE FROM ${schema}.income_allocations WHERE workspace_id = $1 AND income_entry_id = $2`,
        [householdId, incomeId],
      );
      await client.query(
        `DELETE FROM ${schema}.income_entries WHERE workspace_id = $1 AND id = $2`,
        [householdId, incomeId],
      );
    },

    async insertIncomeAllocations(rows) {
      const now = isoNow();
      const inserted = [];
      for (const alloc of rows) {
        const row = {
          id: uuid(),
          createdAt: now,
          ...alloc,
          workspaceId: alloc.workspaceId ?? alloc.householdId,
          householdId: alloc.householdId ?? alloc.workspaceId,
        };
        await client.query(
          `INSERT INTO ${schema}.income_allocations
           (id, workspace_id, income_entry_id, allocation_category_id, allocated_amount, allocation_percent, created_at, raw_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [row.id, row.workspaceId, row.incomeEntryId, row.allocationCategoryId, row.allocatedAmount, row.allocationPercent, row.createdAt, row],
        );
        inserted.push(row);
      }
      return clone(inserted);
    },

    async deleteIncomeAllocationsByIncomeEntryId({ householdId, incomeEntryId }) {
      await client.query(
        `DELETE FROM ${schema}.income_allocations
         WHERE workspace_id = $1 AND income_entry_id = $2`,
        [householdId, incomeEntryId],
      );
    },

    async listIncomeAllocations({ householdId, incomeEntryId = null, from = null, to = null }) {
      const params = [householdId];
      let dateJoin = '';
      const filters = ['ia.workspace_id = $1'];

      if (incomeEntryId) {
        params.push(incomeEntryId);
        filters.push(`ia.income_entry_id = $${params.length}`);
      }

      if (from && to) {
        params.push(from, to);
        dateJoin = `JOIN ${schema}.income_entries ie_date ON ie_date.id = ia.income_entry_id AND ie_date.workspace_id = ia.workspace_id`;
        filters.push(`ie_date.received_date >= $${params.length - 1}`, `ie_date.received_date <= $${params.length}`);
      }

      const result = await client.query(
        `SELECT
           ia.raw_json,
           ac.raw_json->>'slug' AS slug,
           ac.raw_json->>'label' AS cat_label,
           ie.raw_json->>'receivedDate' AS received_date
         FROM ${schema}.income_allocations ia
         LEFT JOIN ${schema}.allocation_categories ac ON ac.id = ia.allocation_category_id
         LEFT JOIN ${schema}.income_entries ie ON ie.id = ia.income_entry_id AND ie.workspace_id = ia.workspace_id
         ${dateJoin}
         WHERE ${filters.join(' AND ')}
         ORDER BY ie.received_date NULLS LAST, ia.id`,
        params,
      );

      return result.rows.map((row) => {
        const base = clone(row.raw_json);
        return {
          ...base,
          slug: row.slug ?? null,
          label: row.cat_label ?? null,
          amount: base.allocatedAmount,
          receivedDate: row.received_date ?? null,
        };
      });
    },

    async listIncomeAllocationsBySlug({ householdId, slug, from, to }) {
      const all = await this.listIncomeAllocations({ householdId, from, to });
      return all.filter((row) => row.slug === slug);
    },
  };
}
