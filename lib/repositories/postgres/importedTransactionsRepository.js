import { clone, isoNow, uuid } from './utils.js';

export function buildImportedTransactionsRepository(client, schema) {
  return {
    async listImportedTransactions({ householdId, from } = {}) {
      const params = [householdId];
      let whereClause = 'WHERE workspace_id = $1';
      if (from != null) {
        params.push(from);
        whereClause += ` AND date >= $${params.length}`;
      }
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.imported_transactions
         ${whereClause}
         ORDER BY date, description, id`,
        params,
      );
      return result.rows.map((row) => clone(row.raw_json));
    },

    async insertImportedTransactions({ rows }) {
      if (!rows.length) return [];
      const now = isoNow();
      const inserted = rows.map((row) => ({
        id: uuid(),
        createdAt: now,
        updatedAt: now,
        normalizedDescription: row.normalizedDescription ?? null,
        linkedIncomeEntryId: row.linkedIncomeEntryId ?? null,
        linkedGoalId: row.linkedGoalId ?? null,
        ...row,
        workspaceId: row.workspaceId ?? row.householdId,
        householdId: row.householdId ?? row.workspaceId,
      }));

      for (const row of inserted) {
        await client.query(
          `INSERT INTO ${schema}.imported_transactions
           (id, workspace_id, account_id, date, amount, description, status, classification_type, linked_transaction_id, created_at, updated_at, raw_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            row.id,
            row.workspaceId,
            row.accountId ?? null,
            row.date,
            row.amount,
            row.description,
            row.status ?? 'unreviewed',
            row.classificationType ?? null,
            row.linkedTransactionId ?? null,
            row.createdAt,
            row.updatedAt,
            row,
          ],
        );
      }
      return clone(inserted);
    },

    async getImportedTransactionById({ householdId, importedTransactionId }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.imported_transactions
         WHERE workspace_id = $1 AND id = $2
         LIMIT 1`,
        [householdId, importedTransactionId],
      );
      return result.rows[0] ? clone(result.rows[0].raw_json) : null;
    },

    async updateImportedTransaction({ householdId, importedTransactionId, patch }) {
      const existing = await this.getImportedTransactionById({ householdId, importedTransactionId });
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: isoNow() };
      await client.query(
        `UPDATE ${schema}.imported_transactions
         SET date = $3, amount = $4, description = $5, status = $6, classification_type = $7, linked_transaction_id = $8, updated_at = $9, raw_json = $10
         WHERE workspace_id = $1 AND id = $2`,
        [
          householdId,
          importedTransactionId,
          updated.date,
          updated.amount,
          updated.description,
          updated.status ?? 'unreviewed',
          updated.classificationType ?? null,
          updated.linkedTransactionId ?? null,
          updated.updatedAt,
          updated,
        ],
      );
      return clone(updated);
    },

    async listImportReviewRules({ householdId }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.import_review_rules
         WHERE workspace_id = $1
         ORDER BY updated_at DESC NULLS LAST, match_value, id`,
        [householdId],
      );
      return result.rows.map((row) => clone(row.raw_json));
    },

    async findImportReviewRuleByNormalizedDescription({ householdId, normalizedDescription }) {
      const rules = await this.listImportReviewRules({ householdId });
      const matches = rules.filter((row) => {
        const matchType = row.matchType ?? 'contains';
        const matchValue = String(row.matchValue ?? row.normalizedDescription ?? '').trim();
        if (!matchValue) return false;
        if (matchType === 'contains') return normalizedDescription.includes(matchValue);
        return normalizedDescription === matchValue;
      });

      matches.sort(
        (left, right) =>
          Number(right.autoApply === true) - Number(left.autoApply === true)
          || String(right.matchValue ?? right.normalizedDescription ?? '').length
            - String(left.matchValue ?? left.normalizedDescription ?? '').length
          || (right.updatedAt ?? right.createdAt ?? '').localeCompare(left.updatedAt ?? left.createdAt ?? ''),
      );

      return matches[0] ?? null;
    },

    async touchImportReviewRule({ householdId, ruleId, usedAt = isoNow() }) {
      const result = await client.query(
        `SELECT raw_json FROM ${schema}.import_review_rules
         WHERE workspace_id = $1 AND id = $2
         LIMIT 1`,
        [householdId, ruleId],
      );
      if (!result.rows[0]) return null;
      const existing = clone(result.rows[0].raw_json);
      const updated = { ...existing, lastUsedAt: usedAt, updatedAt: isoNow() };
      await client.query(
        `UPDATE ${schema}.import_review_rules
         SET updated_at = $3, raw_json = $4
         WHERE workspace_id = $1 AND id = $2`,
        [householdId, ruleId, updated.updatedAt, updated],
      );
      return clone(updated);
    },

    async upsertImportReviewRule(payload) {
      const matchValue = String(payload.matchValue ?? payload.normalizedDescription ?? '');
      const matchType = payload.matchType ?? 'contains';
      const workspaceId = payload.workspaceId ?? payload.householdId;
      const householdId = payload.householdId ?? payload.workspaceId;

      const existing = await client.query(
        `SELECT raw_json FROM ${schema}.import_review_rules
         WHERE workspace_id = $1
           AND (raw_json->>'matchType' IS NULL OR raw_json->>'matchType' = $2)
           AND COALESCE(raw_json->>'matchValue', raw_json->>'normalizedDescription', '') = $3
         LIMIT 1`,
        [workspaceId, matchType, matchValue],
      );

      if (existing.rows[0]) {
        const prev = clone(existing.rows[0].raw_json);
        const updated = { ...prev, ...payload, updatedAt: isoNow() };
        await client.query(
          `UPDATE ${schema}.import_review_rules
           SET match_value = $3, auto_apply = $4, updated_at = $5, raw_json = $6
           WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, prev.id, updated.matchValue ?? updated.normalizedDescription ?? null, updated.autoApply === true, updated.updatedAt, updated],
        );
        return clone(updated);
      }

      const now = isoNow();
      const row = {
        id: uuid(),
        createdAt: now,
        updatedAt: now,
        ...payload,
        workspaceId,
        householdId,
      };
      await client.query(
        `INSERT INTO ${schema}.import_review_rules
         (id, workspace_id, rule_type, match_value, auto_apply, created_at, updated_at, raw_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [row.id, workspaceId, row.ruleType ?? 'suggestion', matchValue || null, row.autoApply === true, row.createdAt, row.updatedAt, row],
      );
      return clone(row);
    },
  };
}
