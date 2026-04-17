import { extractImportedTransactionsFromPdf } from './lib/imports/bankStatementImports.js';

const sampleText = `Page1of3
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

async function run() {
  try {
    const rows = await extractImportedTransactionsFromPdf(Buffer.from('dummy'), {
      pdfTextExtractor: async () => sampleText,
    });
    console.log('rows', rows.length);
    console.log(JSON.stringify(rows, null, 2));
  } catch (error) {
    console.error('err', error);
  }
}

run();
