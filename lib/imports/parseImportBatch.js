import { z } from 'zod';

import { matchMerchantRule, normalizeMerchant } from './merchantRules.js';
import { ImportHttpError, formatImportRow, normalizeIsoDate, normalizeMoney, parseDirection } from './shared.js';

const columnMapSchema = z.object({
  columnMap: z.object({
    date: z.string().trim().min(1, 'is required'),
    description: z.string().trim().min(1, 'is required'),
    merchant: z.string().trim().optional().nullable(),
    amount: z.string().trim().min(1, 'is required'),
    direction: z.string().trim().optional().nullable(),
  }),
});

function parseWithSchema(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new ImportHttpError(400, `${path} ${issue.message}`);
  }

  return result.data;
}

export function parseColumnMap(input) {
  const parsed = parseWithSchema(columnMapSchema, input);
  return {
    date: parsed.columnMap.date,
    description: parsed.columnMap.description,
    merchant: parsed.columnMap.merchant || null,
    amount: parsed.columnMap.amount,
    direction: parsed.columnMap.direction || null,
  };
}

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Import DB adapter must implement transaction().');
  }
}

function getMappedRawRow(row, columnMap) {
  const rawData = row.rawData ?? row.raw_data ?? null;
  if (rawData && typeof rawData === 'object') {
    return {
      rawDate: rawData[columnMap.date] ?? null,
      rawDescription: rawData[columnMap.description] ?? null,
      rawMerchant: columnMap.merchant ? rawData[columnMap.merchant] ?? null : null,
      rawAmount: rawData[columnMap.amount] ?? null,
      rawDirection: columnMap.direction ? rawData[columnMap.direction] ?? null : null,
    };
  }

  return {
    rawDate: row.rawDate,
    rawDescription: row.rawDescription,
    rawMerchant: row.rawMerchant,
    rawAmount: row.rawAmount,
    rawDirection: row.rawDirection,
  };
}

function parseRow(row, columnMap, merchantRules) {
  const mappedRow = getMappedRawRow(row, columnMap);
  const parsedDate = normalizeIsoDate(mappedRow.rawDate, 'rawDate');
  const parsedDescription = String(mappedRow.rawDescription ?? '').trim();
  if (!parsedDescription) {
    throw new ImportHttpError(422, 'rawDescription is required');
  }

  const parsedAmount = normalizeMoney(mappedRow.rawAmount, 'rawAmount');
  const parsedMerchant = String(mappedRow.rawMerchant ?? '').trim() || null;
  const parsedDirection = parseDirection(mappedRow.rawDirection);
  const rule = matchMerchantRule(merchantRules, parsedMerchant);

  return {
    rawDate: mappedRow.rawDate == null ? null : String(mappedRow.rawDate).trim(),
    rawDescription: parsedDescription,
    rawMerchant: parsedMerchant,
    rawAmount: mappedRow.rawAmount == null ? null : String(mappedRow.rawAmount).trim(),
    rawDirection: mappedRow.rawDirection == null ? null : String(mappedRow.rawDirection).trim() || null,
    parsedDate,
    parsedDescription,
    parsedMerchant,
    parsedAmount,
    parsedDirection,
    suggestedCategoryId: rule?.categoryId ?? null,
    suggestedByRuleId: rule?.id ?? null,
    suggestionReason: rule ? `merchant_rule:${rule.matchType}:${rule.matchValue}` : null,
    normalizedMerchant: normalizeMerchant(parsedMerchant),
  };
}

export async function parseImportBatch({ db, householdId, batchId, input }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);
  const columnMap = parseColumnMap(input);

  return db.transaction(async (tx) => {
    const batch = await tx.getImportBatch({ householdId, batchId });
    if (!batch) {
      throw new ImportHttpError(404, 'import batch not found');
    }

    await tx.updateImportBatch({
      householdId,
      batchId,
      status: 'parsing',
    });

    const rawRows = await tx.listImportedRows({ householdId, batchId });
    const merchantRules = await tx.listMerchantRules({ householdId });

    const parsedRows = [];
    for (const row of rawRows) {
      const parsed = parseRow(row, columnMap, merchantRules);
      const duplicateTransaction = await tx.findDuplicateTransaction({
        householdId,
        parsedDate: parsed.parsedDate,
        parsedAmount: parsed.parsedAmount,
        normalizedMerchant: parsed.normalizedMerchant,
      });

      const persisted = await tx.updateImportedRow({
        householdId,
        rowId: row.id,
        patch: {
          rawDate: parsed.rawDate,
          rawDescription: parsed.rawDescription,
          rawMerchant: parsed.rawMerchant,
          rawAmount: parsed.rawAmount,
          rawDirection: parsed.rawDirection,
          parsedDate: parsed.parsedDate,
          parsedDescription: parsed.parsedDescription,
          parsedMerchant: parsed.parsedMerchant,
          parsedAmount: parsed.parsedAmount,
          parsedDirection: parsed.parsedDirection,
          suggestedCategoryId: parsed.suggestedCategoryId,
          suggestedDebtId: null,
          suggestedByRuleId: parsed.suggestedByRuleId,
          suggestionReason: parsed.suggestionReason,
          status: duplicateTransaction ? 'duplicate' : 'pending',
          duplicateOfId: duplicateTransaction?.id ?? null,
          duplicateReason: duplicateTransaction
            ? `matched_existing_transaction:${duplicateTransaction.id}`
            : null,
        },
      });

      parsedRows.push(formatImportRow(persisted));
    }

    await tx.updateImportBatch({
      householdId,
      batchId,
      status: 'review',
      rowCount: parsedRows.length,
    });

    return {
      batchId,
      rows: parsedRows,
    };
  });
}
