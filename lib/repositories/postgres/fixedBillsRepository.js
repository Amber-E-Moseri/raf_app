import { clone, isoNow, uuid } from './utils.js';

export function buildFixedBillsRepository(client, schema) {
  return {
    async listFixedBills({ householdId }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.fixed_bills
         WHERE workspace_id = $1
         ORDER BY due_day_of_month, name, id`,
        [householdId],
      );
      return result.rows.map((row) => clone(row.raw_json));
    },

    async insertFixedBill(payload) {
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
        `INSERT INTO ${schema}.fixed_bills
         (id, workspace_id, name, category_slug, expected_amount, due_day_of_month, active, created_at, updated_at, raw_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [row.id, row.workspaceId, row.name, row.categorySlug, row.expectedAmount, row.dueDayOfMonth, row.active !== false, row.createdAt, row.updatedAt, row],
      );
      return clone(row);
    },

    async getFixedBillById({ householdId, fixedBillId }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.fixed_bills
         WHERE workspace_id = $1 AND id = $2
         LIMIT 1`,
        [householdId, fixedBillId],
      );
      return result.rows[0] ? clone(result.rows[0].raw_json) : null;
    },

    async updateFixedBill({ householdId, fixedBillId, patch }) {
      const existing = await this.getFixedBillById({ householdId, fixedBillId });
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: isoNow() };
      await client.query(
        `UPDATE ${schema}.fixed_bills
         SET name = $3, category_slug = $4, expected_amount = $5, due_day_of_month = $6, active = $7, updated_at = $8, raw_json = $9
         WHERE workspace_id = $1 AND id = $2`,
        [householdId, fixedBillId, updated.name, updated.categorySlug, updated.expectedAmount, updated.dueDayOfMonth, updated.active !== false, updated.updatedAt, updated],
      );
      return clone(updated);
    },
  };
}
