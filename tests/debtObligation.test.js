import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  derivePaymentObligation,
  deriveBalanceTrajectory,
  explainBalanceChange,
} from '../lib/raf/debts.js';

describe('Phase 2: Payment Obligations & Balance Trajectory', () => {
  describe('derivePaymentObligation', () => {
    const baseDebt = {
      id: 'debt-1',
      householdId: 'household-1',
      name: 'Credit Card',
      startingBalance: '5000.00',
      minimumPayment: '200.00',
      monthlyPayment: '400.00',
      apr: '19.99',
      statementDay: 15,
      paymentDueDay: 25,
    };

    it('aggregates multiple payments within an obligation period', () => {
      const payments = [
        { paymentDate: '2026-09-05', amount: '100.00' },
        { paymentDate: '2026-09-12', amount: '100.00' },
        { paymentDate: '2026-09-20', amount: '200.00' },
      ];

      const obligation = derivePaymentObligation({
        debt: baseDebt,
        payments,
        obligationMonth: '2026-09',
        asOfDate: '2026-09-20',
      });

      assert.ok(obligation);
      assert.equal(obligation.totalPaidToDate, '400.00');
      assert.equal(obligation.minimumSatisfied, true);
      assert.equal(obligation.planSatisfied, true);
    });

    it('returns in_progress before due date with partial payment', () => {
      const payments = [{ paymentDate: '2026-09-10', amount: '100.00' }];

      const obligation = derivePaymentObligation({
        debt: baseDebt,
        payments,
        obligationMonth: '2026-09',
        asOfDate: '2026-09-15',
      });

      assert.equal(obligation.status, 'in_progress');
      assert.equal(obligation.minimumSatisfied, false);
    });

    it('returns missed_payment after due date with no payment', () => {
      const obligation = derivePaymentObligation({
        debt: baseDebt,
        payments: [],
        obligationMonth: '2026-09',
        asOfDate: '2026-09-26',
      });

      assert.equal(obligation.status, 'missed_payment');
    });

    it('returns under_minimum after due date with partial payment', () => {
      const payments = [{ paymentDate: '2026-09-10', amount: '100.00' }];

      const obligation = derivePaymentObligation({
        debt: baseDebt,
        payments,
        obligationMonth: '2026-09',
        asOfDate: '2026-09-26',
      });

      assert.equal(obligation.status, 'under_minimum');
    });

    it('does not assume future obligation satisfaction from excess payment', () => {
      const sept = derivePaymentObligation({
        debt: baseDebt,
        payments: [{ paymentDate: '2026-09-10', amount: '600.00' }],
        obligationMonth: '2026-09',
        asOfDate: '2026-09-15',
      });

      const oct = derivePaymentObligation({
        debt: baseDebt,
        payments: [],
        obligationMonth: '2026-10',
        asOfDate: '2026-10-15',
      });

      assert.equal(sept.planSatisfied, true);
      assert.equal(oct.minimumSatisfied, false);
    });
  });

  describe('deriveBalanceTrajectory', () => {
    it('detects decreasing balance', () => {
      const trajectory = deriveBalanceTrajectory({
        openingBalanceCents: 500000,
        closingBalanceCents: 450000,
      });

      assert.equal(trajectory.trajectory, 'decreasing');
      assert.equal(trajectory.isDecreasing, true);
    });

    it('detects increasing balance', () => {
      const trajectory = deriveBalanceTrajectory({
        openingBalanceCents: 500000,
        closingBalanceCents: 550000,
      });

      assert.equal(trajectory.trajectory, 'increasing');
      assert.equal(trajectory.isIncreasing, true);
    });

    it('detects stable balance within tolerance', () => {
      const trajectory = deriveBalanceTrajectory({
        openingBalanceCents: 500000,
        closingBalanceCents: 500050,
      });

      assert.equal(trajectory.trajectory, 'stable');
      assert.equal(trajectory.isStable, true);
    });

    it('calculates percentage change correctly', () => {
      const trajectory = deriveBalanceTrajectory({
        openingBalanceCents: 100000,
        closingBalanceCents: 110000,
      });

      assert.equal(trajectory.percentageChange, 10);
    });

    it('applies tolerance of at least $1.00', () => {
      const trajectory = deriveBalanceTrajectory({
        openingBalanceCents: 1000,
        closingBalanceCents: 1050,
      });

      assert.ok(trajectory.tolerance >= 100);
    });
  });

  describe('explainBalanceChange', () => {
    it('explains balance change with all components', () => {
      const explanation = explainBalanceChange({
        openingBalanceCents: 500000,
        closingBalanceCents: 450000,
        paymentsThisPeriodCents: 100000,
        interestChargedCents: 5000,
        feesChargedCents: 1000,
        adjustmentsCents: 0,
      });

      assert.equal(explanation.openingBalance, '5000.00');
      assert.equal(explanation.closingBalance, '4500.00');
      assert.equal(explanation.payments, '-1000.00');
      assert.match(explanation.changeMessage, /You paid/);
    });

    it('handles zero payments', () => {
      const explanation = explainBalanceChange({
        openingBalanceCents: 500000,
        closingBalanceCents: 550000,
        paymentsThisPeriodCents: 0,
        interestChargedCents: 50000,
        feesChargedCents: 0,
        adjustmentsCents: 0,
      });

      assert.match(explanation.changeMessage, /increased/);
      assert.equal(explanation.closingBalance, '5500.00');
    });

    it('explains mixed signals (payment above plan, balance increasing)', () => {
      const explanation = explainBalanceChange({
        openingBalanceCents: 500000,
        closingBalanceCents: 520000,
        paymentsThisPeriodCents: 50000,
        interestChargedCents: 40000,
        feesChargedCents: 30000,
        adjustmentsCents: 0,
      });

      assert.equal(explanation.openingBalance, '5000.00');
      assert.equal(explanation.closingBalance, '5200.00');
      assert.equal(explanation.payments, '-500.00');
      assert.equal(explanation.interest, '400.00');
    });
  });

  describe('Edge cases', () => {
    it('handles 0% APR debt with above-plan payment', () => {
      const trajectory = deriveBalanceTrajectory({
        openingBalanceCents: 500000,
        closingBalanceCents: 450000,
      });

      assert.equal(trajectory.trajectory, 'decreasing');
    });

    it('handles already paid-off debt', () => {
      const obligation = derivePaymentObligation({
        debt: {
          id: 'debt-1',
          householdId: 'household-1',
          name: 'Paid Off',
          startingBalance: '0.01',
          minimumPayment: '0.00',
          monthlyPayment: '0.00',
          apr: '0',
          statementDay: 15,
          paymentDueDay: 25,
        },
        payments: [],
        obligationMonth: '2026-09',
        asOfDate: '2026-09-20',
      });

      assert.ok(obligation);
      assert.equal(obligation.minimumSatisfied, true);
    });

    it('handles debt with no minimum payment', () => {
      const obligation = derivePaymentObligation({
        debt: {
          id: 'debt-1',
          householdId: 'household-1',
          name: 'No Minimum',
          startingBalance: '5000.00',
          minimumPayment: '0.00',
          monthlyPayment: '100.00',
          apr: '5.00',
          statementDay: 15,
          paymentDueDay: 25,
        },
        payments: [],
        obligationMonth: '2026-09',
        asOfDate: '2026-09-26',
      });

      assert.equal(obligation.minimumSatisfied, true);
    });

    it('handles payment larger than remaining balance', () => {
      const explanation = explainBalanceChange({
        openingBalanceCents: 100000,
        closingBalanceCents: 0,
        paymentsThisPeriodCents: 150000,
        interestChargedCents: 0,
        feesChargedCents: 0,
        adjustmentsCents: 0,
      });

      assert.equal(explanation.closingBalance, '0.00');
    });
  });
});
