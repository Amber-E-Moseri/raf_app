import { ImportHttpError, parseMoneyToCents } from './shared.js';

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Import DB adapter must implement transaction().');
  }
}

function validateApprovedRow(row) {
  if (!row.parsedDate || !row.parsedDescription || !row.parsedAmount || !row.parsedDirection) {
    throw new ImportHttpError(422, `import row ${row.id} is missing parsed values`);
  }

  if (!row.suggestedCategoryId && !row.suggestedDebtId) {
    throw new ImportHttpError(422, `import row ${row.id} requires a category or debt before approval`);
  }

  const amountCents = parseMoneyToCents(row.parsedAmount, 'parsedAmount');
  if (amountCents < 0 && row.parsedDirection !== 'credit') {
    throw new ImportHttpError(422, `import row ${row.id} has a negative amount without credit direction`);
  }

  if (row.suggestedDebtId) {
    if (row.parsedDirection !== 'debit') {
      throw new ImportHttpError(422, `import row ${row.id} debt payments must be debit transactions`);
    }

    if (amountCents <= 0) {
      throw new ImportHttpError(422, `import row ${row.id} debt payments must be positive`);
    }
  }
}

export async function approveImportBatch({ db, householdId, batchId }) {
  if (!householdId) {
    throw new ImportHttpError(400, 'householdId is required');
  }

  requireDbContract(db);

  return db.transaction(async (tx) => {
    const batch = await tx.getImportBatch({ householdId, batchId });
    if (!batch) {
      throw new ImportHttpError(404, 'import batch not found');
    }

    if (batch.status !== 'review') {
      throw new ImportHttpError(422, 'import batch must be in review status before approval');
    }

    const rows = await tx.listImportedRows({ householdId, batchId });
    let inserted = 0;
    let skipped = 0;
    let duplicates = 0;

    for (const row of rows) {
      if (row.status === 'duplicate') {
        duplicates += 1;
        continue;
      }

      if (row.status !== 'approved') {
        skipped += 1;
        continue;
      }

      validateApprovedRow(row);

      if (row.suggestedDebtId) {
        const debt = await tx.findDebtById({
          householdId,
          debtId: row.suggestedDebtId,
        });

        if (!debt) {
          throw new ImportHttpError(404, `linked debt not found for import row ${row.id}`);
        }
      }

      const transaction = await tx.insertTransaction({
        householdId,
        transactionDate: row.parsedDate,
        description: row.parsedDescription,
        merchant: row.parsedMerchant,
        amount: row.parsedAmount,
        direction: row.parsedDirection,
        categoryId: row.suggestedCategoryId,
        linkedDebtId: row.suggestedDebtId,
        source: 'import',
        importBatchId: batchId,
      });

      if (row.suggestedDebtId) {
        await tx.insertDebtPayment({
          householdId,
          debtId: row.suggestedDebtId,
          transactionId: transaction.id,
          paymentDate: row.parsedDate,
          amount: row.parsedAmount,
        });
      }

      inserted += 1;
    }

    await tx.updateImportBatch({
      householdId,
      batchId,
      status: 'approved',
    });

    return {
      inserted,
      skipped,
      duplicates,
    };
  });
}
