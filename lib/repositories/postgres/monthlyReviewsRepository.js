import { clone, isoNow, uuid } from './utils.js';

export function buildMonthlyReviewsRepository(client, schema) {
  return {
    async listMonthlyReviews({ householdId, from, to }) {
      const params = [householdId];
      let dateFilter = '';

      if (from && to) {
        params.push(from, to);
        dateFilter = ` AND review_month >= $2 AND review_month <= $3`;
      }

      const result = await client.query(
        `SELECT raw_json FROM ${schema}.monthly_reviews
         WHERE workspace_id = $1${dateFilter}
         ORDER BY review_month`,
        params,
      );
      return result.rows.map((row) => clone(row.raw_json));
    },

    async getMonthlyReviewByMonth({ householdId, reviewMonth }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.monthly_reviews
         WHERE workspace_id = $1 AND review_month = $2
         LIMIT 1`,
        [householdId, reviewMonth],
      );
      return result.rows[0] ? clone(result.rows[0].raw_json) : null;
    },

    async getMonthlyReviewById({ householdId, reviewId }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.monthly_reviews
         WHERE workspace_id = $1 AND id = $2
         LIMIT 1`,
        [householdId, reviewId],
      );
      return result.rows[0] ? clone(result.rows[0].raw_json) : null;
    },

    async insertMonthlyReview(payload) {
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
        `INSERT INTO ${schema}.monthly_reviews
         (id, workspace_id, review_month, status, net_surplus, created_at, updated_at, raw_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [row.id, row.workspaceId, row.reviewMonth, row.status ?? 'draft', row.netSurplus ?? null, row.createdAt, row.updatedAt, row],
      );
      return clone(row);
    },

    async updateMonthlyReview({ householdId, reviewId, patch }) {
      const existing = await this.getMonthlyReviewById({ householdId, reviewId });
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: isoNow() };
      await client.query(
        `UPDATE ${schema}.monthly_reviews
         SET review_month = $3, status = $4, net_surplus = $5, updated_at = $6, raw_json = $7
         WHERE workspace_id = $1 AND id = $2`,
        [householdId, reviewId, updated.reviewMonth, updated.status ?? 'draft', updated.netSurplus ?? null, updated.updatedAt, updated],
      );
      return clone(updated);
    },

    async deleteMonthlyReview({ householdId, reviewId }) {
      await client.query(
        `DELETE FROM ${schema}.monthly_reviews WHERE workspace_id = $1 AND id = $2`,
        [householdId, reviewId],
      );
    },
  };
}
