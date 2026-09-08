import { IMPORT_BATCH_STATUS, ImportHttpError, formatImportBatchReview, formatImportRow, normalizeBatchStatus } from './shared.js';

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Import DB adapter must implement transaction().');
  }
}

export async function reviewImportBatch({ db, householdId, batchId }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  if (!batchId) {
    throw new ImportHttpError(400, 'batchId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const batch = await tx.getImportBatch({ householdId, batchId });
    if (!batch) {
      throw new ImportHttpError(404, 'import batch not found');
    }

    const status = normalizeBatchStatus(batch.status);
    if (status === IMPORT_BATCH_STATUS.UPLOADED) {
      throw new ImportHttpError(422, 'import batch must be parsed before review');
    }

    if (status === IMPORT_BATCH_STATUS.PARSING) {
      throw new ImportHttpError(409, 'import batch is currently parsing');
    }

    const rows = await tx.listImportedRows({ householdId, batchId });
    return formatImportBatchReview({
      batch,
      rows: rows.map(formatImportRow),
    });
  });
}
