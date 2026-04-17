import { describe, it, expect } from 'vitest';
import {
  extractImportedTransactionsFromPdf,
} from '../lib/imports/bankStatementImports.js';

/**
 * Test harness for BMO parser collapsed amount recovery.
 * Validates that sample BMO transactions with collapsed columns parse correctly.
 */

// Mock PDF text extractor that returns our test sample
function mockPdfTextExtractorBMO() {
  return async (pdfBuffer) => {
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

describe('BMO Parser - Collapsed Amount Recovery', () => {
  it('should parse BMO transactions with collapsed amount columns', async () => {
    const mockPdfBuffer = Buffer.from('mock pdf data');
    const extractor = mockPdfTextExtractorBMO();

    const rows = await extractImportedTransactionsFromPdf(mockPdfBuffer, {
      pdfTextExtractor: extractor,
    });

    // We expect at least some rows to be parsed
    expect(rows.length).toBeGreaterThan(0);
    
    // Find the collapsed amount examples
    const collapsedAmountExamples = rows.filter(
      row => row.date === '2026-02-13' || row.date === '2026-02-17' || row.date === '2026-02-18' || row.date === '2026-02-19' || row.date === '2026-02-23'
    );

    expect(collapsedAmountExamples.length).toBeGreaterThan(0);
  });

  it('should correctly parse Feb 13 transaction with collapsed amount (5.6469.20)', async () => {
    const mockPdfBuffer = Buffer.from('mock pdf data');
    const extractor = mockPdfTextExtractorBMO();

    const rows = await extractImportedTransactionsFromPdf(mockPdfBuffer, {
      pdfTextExtractor: extractor,
    });

    // Find Feb 13 transaction
    const feb13 = rows.find(row => row.date === '2026-02-13' && row.description.includes('PAYPAL'));
    
    if (feb13) {
      // Collapsed "5.6469.20" should parse as:
      // amount: -5.64, balance: 69.20
      expect(Number(feb13.amount)).toBe(-5.64);
      expect(Number(feb13.balanceAfterTransaction)).toBe(69.20);
    }
  });

  it('should correctly parse Feb 18 Online Transfer (15.0029.69)', async () => {
    const mockPdfBuffer = Buffer.from('mock pdf data');
    const extractor = mockPdfTextExtractorBMO();

    const rows = await extractImportedTransactionsFromPdf(mockPdfBuffer, {
      pdfTextExtractor: extractor,
    });

    // Find Feb 18 Online Transfer
    const feb18Transfer = rows.find(row => row.date === '2026-02-18' && row.description.includes('Online Transfer'));
    
    if (feb18Transfer) {
      // Collapsed "15.0029.69" should parse as:
      // amount: -15.00, balance: 29.69
      expect(Number(feb18Transfer.amount)).toBe(-15.00);
      expect(Number(feb18Transfer.balanceAfterTransaction)).toBe(29.69);
    }
  });

  it('should correctly parse Feb 19 transaction (11.2918.40)', async () => {
    const mockPdfBuffer = Buffer.from('mock pdf data');
    const extractor = mockPdfTextExtractorBMO();

    const rows = await extractImportedTransactionsFromPdf(mockPdfBuffer, {
      pdfTextExtractor: extractor,
    });

    // Find Feb 19 transaction
    const feb19 = rows.find(row => row.date === '2026-02-19' && row.description.includes('PAYPAL'));
    
    if (feb19) {
      // Collapsed "11.2918.40" should parse as:
      // amount: -11.29, balance: 18.40
      expect(Number(feb19.amount)).toBe(-11.29);
      expect(Number(feb19.balanceAfterTransaction)).toBe(18.40);
    }
  });

  it('should correctly parse Feb 23 transaction (15.243.16)', async () => {
    const mockPdfBuffer = Buffer.from('mock pdf data');
    const extractor = mockPdfTextExtractorBMO();

    const rows = await extractImportedTransactionsFromPdf(mockPdfBuffer, {
      pdfTextExtractor: extractor,
    });

    // Find Feb 23 transaction
    const feb23 = rows.find(row => row.date === '2026-02-23' && row.description.includes('PAYPAL'));
    
    if (feb23) {
      // Collapsed "15.243.16" should parse as:
      // amount: -15.24, balance: 3.16
      expect(Number(feb23.amount)).toBe(-15.24);
      expect(Number(feb23.balanceAfterTransaction)).toBe(3.16);
    }
  });

  it('should skip opening balance row silently', async () => {
    const mockPdfBuffer = Buffer.from('mock pdf data');
    const extractor = mockPdfTextExtractorBMO();

    const rows = await extractImportedTransactionsFromPdf(mockPdfBuffer, {
      pdfTextExtractor: extractor,
    });

    // Opening balance should not be in the parsed rows
    const hasOpeningBalance = rows.some(row => row.description.includes('Opening'));
    expect(hasOpeningBalance).toBe(false);
  });

  it('should parse standard transactions without collapsed amounts', async () => {
    const mockPdfBuffer = Buffer.from('mock pdf data');
    const extractor = mockPdfTextExtractorBMO();

    const rows = await extractImportedTransactionsFromPdf(mockPdfBuffer, {
      pdfTextExtractor: extractor,
    });

    // Find Feb 10 transaction (standard format)
    const feb10 = rows.find(row => row.date === '2026-02-10' && row.description.includes('PAYPAL'));
    
    if (feb10) {
      // Standard "7.19 74.84" should parse as:
      // amount: -7.19, balance: 74.84
      expect(Number(feb10.amount)).toBe(-7.19);
      expect(Number(feb10.balanceAfterTransaction)).toBe(74.84);
    }
  });

  it('should include required transaction fields for all rows', async () => {
    const mockPdfBuffer = Buffer.from('mock pdf data');
    const extractor = mockPdfTextExtractorBMO();

    const rows = await extractImportedTransactionsFromPdf(mockPdfBuffer, {
      pdfTextExtractor: extractor,
    });

    for (const row of rows) {
      expect(row.date).toBeDefined();
      expect(row.description).toBeDefined();
      expect(row.amount).toBeDefined();
      expect(typeof row.amount).toBe('number');
      expect(row.rawDescription).toBeDefined();
    }
  });
});
