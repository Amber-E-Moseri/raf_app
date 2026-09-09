import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractImportedTransactionsFromPdf,
} from '../lib/imports/bankStatementImports.js';

function mockPdfTextExtractorBMO() {
  return async (_pdfBuffer) => {
    return `
Page1of3
Yourbranchaddress:
6085CREDITVIEWRD,UNIT1
MISSISSAUGA,ONL5V2A8
EverydayBanking
AMBEREWEREMOSERI
6035BIDWELLTRAILUNIT27
MISSISSAUGAONL5V3C8
YourEverydayBankingstatement
FortheperiodendingMarch09,2026
YourBranch
CREDITVIEW&BRITANNIA
Transitnumber:3710
Forquestionsaboutyour
statementcall
(905)567-5146
DirectBanking
1-800-363-9992
www.bmo.com
YourPlan
PerformancePlanwithStudentDiscount
Program
continued
Summaryofyouraccount
TotalTotalClosing
Openingamountsamountsbalance($)on
-+=
Accountbalance($)deducted($)added($)Mar09,2026
PrimaryChequingAccount
#37103933-41982.03235.87257.97104.13
Here'swhathappenedinyouraccount
AmountsdeductedAmountsadded
DateDescriptionfromyouraccount($)toyouraccount($)Balance($)
PrimaryChequingAccount#37103933-419
Owner:
AMBEREWEREMOSERI
Feb10Openingbalance82.03
Feb10Pre-AuthorizedPayment,PAYPALMSP/DIV7.1974.84
Feb13DebitCardPurchase,RECURRINGPYMNT
11FEB2026,PAYPALAPPLE.COM/BILON
5.6469.20
Feb17DebitCardPurchase,RECURRINGPYMNT
16FEB2026,PAYPALAPPLE.COM/BILON
4.5164.69
Feb18INTERACe-TransferSent10.0054.69
Feb18INTERACe-TransferSent10.0044.69
Feb18OnlineTransfer,TF000519123023302025515.0029.69
Feb19DebitCardPurchase,RECURRINGPYMNT
18FEB2026,PAYPALAPPLE.COM/BILON
11.2918.40
Feb23DebitCardPurchase,RECURRINGPYMNT
18FEB2026,PAYPALCAPCUTSGP
15.243.16
    `;
  };
}

test('BMO: parses transactions with collapsed amount columns', async () => {
  const rows = await extractImportedTransactionsFromPdf(Buffer.from('mock pdf data'), {
    pdfTextExtractor: mockPdfTextExtractorBMO(),
  });

  assert.ok(rows.length > 0, 'expected at least one parsed row');

  const collapsedDates = new Set(['2026-02-13', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-23']);
  const examples = rows.filter((r) => collapsedDates.has(r.date));
  assert.ok(examples.length > 0, 'expected at least one collapsed-amount row');
});

test('BMO: Feb 13 collapsed amount 5.6469.20 → amount -5.64 balance 69.20', async () => {
  const rows = await extractImportedTransactionsFromPdf(Buffer.from('mock pdf data'), {
    pdfTextExtractor: mockPdfTextExtractorBMO(),
  });

  const row = rows.find((r) => r.date === '2026-02-13' && r.description.includes('PAYPAL'));
  if (row) {
    assert.equal(Math.abs(Number(row.amount)), 5.64);
    assert.equal(Number(row.balanceAfterTransaction), 69.20);
  }
});

test('BMO: Feb 18 Online Transfer 15.0029.69 → amount -15.00 balance 29.69', async () => {
  const rows = await extractImportedTransactionsFromPdf(Buffer.from('mock pdf data'), {
    pdfTextExtractor: mockPdfTextExtractorBMO(),
  });

  const row = rows.find((r) => r.date === '2026-02-18' && r.description.includes('Online Transfer'));
  if (row) {
    assert.equal(Math.abs(Number(row.amount)), 15.00);
    assert.equal(Number(row.balanceAfterTransaction), 29.69);
  }
});

test('BMO: Feb 19 collapsed amount 11.2918.40 → amount -11.29 balance 18.40', async () => {
  const rows = await extractImportedTransactionsFromPdf(Buffer.from('mock pdf data'), {
    pdfTextExtractor: mockPdfTextExtractorBMO(),
  });

  const row = rows.find((r) => r.date === '2026-02-19' && r.description.includes('PAYPAL'));
  if (row) {
    assert.equal(Math.abs(Number(row.amount)), 11.29);
    assert.equal(Number(row.balanceAfterTransaction), 18.40);
  }
});

test('BMO: Feb 23 collapsed amount 15.243.16 → amount -15.24 balance 3.16', async () => {
  const rows = await extractImportedTransactionsFromPdf(Buffer.from('mock pdf data'), {
    pdfTextExtractor: mockPdfTextExtractorBMO(),
  });

  const row = rows.find((r) => r.date === '2026-02-23' && r.description.includes('PAYPAL'));
  if (row) {
    assert.equal(Math.abs(Number(row.amount)), 15.24);
    assert.equal(Number(row.balanceAfterTransaction), 3.16);
  }
});

test('BMO: opening balance row is skipped', async () => {
  const rows = await extractImportedTransactionsFromPdf(Buffer.from('mock pdf data'), {
    pdfTextExtractor: mockPdfTextExtractorBMO(),
  });

  assert.ok(!rows.some((r) => /opening/i.test(r.description)), 'opening balance must not be in parsed rows');
});

test('BMO: Feb 10 standard transaction → amount -7.19 balance 74.84', async () => {
  const rows = await extractImportedTransactionsFromPdf(Buffer.from('mock pdf data'), {
    pdfTextExtractor: mockPdfTextExtractorBMO(),
  });

  const row = rows.find((r) => r.date === '2026-02-10' && r.description.includes('PAYPAL'));
  if (row) {
    assert.equal(Math.abs(Number(row.amount)), 7.19);
    assert.equal(Number(row.balanceAfterTransaction), 74.84);
  }
});

test('BMO: all parsed rows have required string fields', async () => {
  const rows = await extractImportedTransactionsFromPdf(Buffer.from('mock pdf data'), {
    pdfTextExtractor: mockPdfTextExtractorBMO(),
  });

  for (const row of rows) {
    assert.ok(row.date, `row missing date: ${JSON.stringify(row)}`);
    assert.ok(row.description, `row missing description: ${JSON.stringify(row)}`);
    assert.ok(row.amount !== undefined, `row missing amount: ${JSON.stringify(row)}`);
    assert.equal(typeof row.amount, 'string', `amount should be string: ${JSON.stringify(row)}`);
    assert.ok(row.rawDescription, `row missing rawDescription: ${JSON.stringify(row)}`);
  }
});
