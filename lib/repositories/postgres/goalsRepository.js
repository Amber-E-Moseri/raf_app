import { clone, isoNow, uuid } from './utils.js';

export function buildGoalsRepository(client, schema) {
  return {
    async listGoals({ householdId }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.goals
         WHERE workspace_id = $1
         ORDER BY name, id`,
        [householdId],
      );
      return result.rows.map((row) => clone(row.raw_json));
    },

    async insertGoal(payload) {
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
        `INSERT INTO ${schema}.goals
         (id, workspace_id, bucket_id, name, target_amount, target_date, notes, active, created_at, updated_at, raw_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [row.id, row.workspaceId, row.bucketId, row.name, row.targetAmount, row.targetDate ?? null, row.notes ?? null, row.active !== false, row.createdAt, row.updatedAt, row],
      );
      return clone(row);
    },

    async getGoalById({ householdId, goalId }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.goals
         WHERE workspace_id = $1 AND id = $2
         LIMIT 1`,
        [householdId, goalId],
      );
      return result.rows[0] ? clone(result.rows[0].raw_json) : null;
    },

    async updateGoal({ householdId, goalId, patch }) {
      const existing = await this.getGoalById({ householdId, goalId });
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: isoNow() };
      await client.query(
        `UPDATE ${schema}.goals
         SET bucket_id = $3, name = $4, target_amount = $5, target_date = $6, notes = $7, active = $8, updated_at = $9, raw_json = $10
         WHERE workspace_id = $1 AND id = $2`,
        [householdId, goalId, updated.bucketId, updated.name, updated.targetAmount, updated.targetDate ?? null, updated.notes ?? null, updated.active !== false, updated.updatedAt, updated],
      );
      return clone(updated);
    },

    async deleteGoal({ householdId, goalId }) {
      await client.query(
        `DELETE FROM ${schema}.goals WHERE workspace_id = $1 AND id = $2`,
        [householdId, goalId],
      );
      return true;
    },
  };
}
