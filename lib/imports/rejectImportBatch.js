import { ImportHttpError } from './shared.js';

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Import DB adapter must implement transaction().');
  }
}

export async function rejectImportBatch({ db, householdId, batchId }) {
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

    if (batch.status !== 'review') {
      throw new ImportHttpError(422, 'import batch must be in review status before rejection');
    }

    const rows = await tx.listImportedRows({ householdId, batchId });
    let rejected = 0;

    for (const row of rows) {
      if (row.status === 'rejected') {
        continue;
      }

      await tx.updateImportedRow({
        householdId,
        rowId: row.id,
        patch: { status: 'rejected' },
      });
      rejected += 1;
    }

    await tx.updateImportBatch({
      householdId,
      batchId,
      status: 'failed',
    });

    return {
      batchId,
      rejected,
    };
  });
}
