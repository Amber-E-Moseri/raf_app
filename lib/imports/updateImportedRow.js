import { z } from 'zod';

import {
  IMPORT_BATCH_STATUS,
  IMPORT_ROW_STATUSES,
  ImportHttpError,
  assertImportRowStatusTransition,
  formatImportRow,
  normalizeOptionalString,
  normalizeRowStatus,
} from './shared.js';

const importedRowPatchSchema = z
  .object({
    categoryId: z.union([z.string(), z.null()]).optional(),
    debtId: z.union([z.string(), z.null()]).optional(),
    status: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at least one editable field is required',
      });
    }

    if (value.status && !IMPORT_ROW_STATUSES.has(value.status)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'must be pending, approved, duplicate, skipped, or rejected',
      });
    }
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

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Import DB adapter must implement transaction().');
  }
}

export function parseImportedRowPatch(input) {
  const parsedInput = parseWithSchema(importedRowPatchSchema, input);

  const patch = {};
  if ('categoryId' in parsedInput) {
    patch.suggestedCategoryId = normalizeOptionalString(parsedInput.categoryId);
  }

  if ('debtId' in parsedInput) {
    patch.suggestedDebtId = normalizeOptionalString(parsedInput.debtId);
  }

  if ('status' in parsedInput) {
    patch.status = parsedInput.status.toLowerCase();
  }

  return patch;
}

export async function updateImportedRow({ db, householdId, rowId, input }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  if (!rowId) {
    throw new ImportHttpError(400, 'rowId is required');
  }

  requireDbContract(db);
  const patch = parseImportedRowPatch(input);

  return db.transaction(async (tx) => {
    const existingRow = await tx.getImportedRow({ householdId, rowId });
    if (!existingRow) {
      throw new ImportHttpError(404, 'import row not found');
    }

    const batch = await tx.getImportBatch({ householdId, batchId: existingRow.batchId });
    if (!batch) {
      throw new ImportHttpError(404, 'import batch not found');
    }

    if (String(batch.status ?? '').trim().toLowerCase() !== IMPORT_BATCH_STATUS.REVIEW) {
      throw new ImportHttpError(422, 'import row can only be edited while batch is in review status');
    }

    const nextStatus = patch.status ? normalizeRowStatus(patch.status) : null;
    if (nextStatus) {
      assertImportRowStatusTransition({
        currentStatus: existingRow.status ?? 'pending',
        nextStatus,
      });
    }

    const nextCategoryId = Object.prototype.hasOwnProperty.call(patch, 'suggestedCategoryId')
      ? patch.suggestedCategoryId
      : existingRow.suggestedCategoryId;
    const nextDebtId = Object.prototype.hasOwnProperty.call(patch, 'suggestedDebtId')
      ? patch.suggestedDebtId
      : existingRow.suggestedDebtId;
    if (nextStatus === 'approved' && !nextCategoryId && !nextDebtId) {
      throw new ImportHttpError(422, `import row ${existingRow.id} requires a category or debt before approval`);
    }

    const updatedRow = await tx.updateImportedRow({
      householdId,
      rowId,
      patch,
    });

    return formatImportRow(updatedRow);
  });
}
