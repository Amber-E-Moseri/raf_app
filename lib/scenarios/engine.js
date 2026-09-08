import { formatCents } from '../raf/reporting.js';

function debtPayoffMonths(balanceCents, paymentCents, aprPct) {
  if (balanceCents <= 0) return 0;
  if (paymentCents <= 0) return Infinity;
  const monthlyRate = aprPct / 100 / 12;
  if (monthlyRate === 0) return Math.ceil(balanceCents / paymentCents);
  const interestPerMonth = balanceCents * monthlyRate;
  if (paymentCents <= interestPerMonth) return Infinity;
  return Math.ceil(-Math.log(1 - (monthlyRate * balanceCents) / paymentCents) / Math.log(1 + monthlyRate));
}

export function compute(snapshot) {
  const { monthlyIncomeCents, allocations, fixedBills, debts, goals } = snapshot;

  const totalAllocationPct = allocations.reduce((s, a) => s + parseFloat(a.allocationPercent), 0);
  const totalAllocatedCents = Math.round(monthlyIncomeCents * totalAllocationPct);
  const surplusCents = monthlyIncomeCents - totalAllocatedCents;

  const fixedBillsTotalCents = fixedBills.reduce((s, b) => s + b.expectedAmountCents, 0);
  const debtMinimumsCents = debts.reduce((s, d) => s + d.minimumPaymentCents, 0);

  const bufferAlloc = allocations.find((a) => a.isBuffer);
  const bufferAmountCents = bufferAlloc
    ? Math.round(monthlyIncomeCents * parseFloat(bufferAlloc.allocationPercent))
    : 0;

  const personalAlloc = allocations.find((a) => a.slug === 'personal_spending');
  const personalAmountCents = personalAlloc
    ? Math.round(monthlyIncomeCents * parseFloat(personalAlloc.allocationPercent))
    : 0;

  const monthlyFlexibilityCents = surplusCents + personalAmountCents;

  const debtPayoff = debts.map((d) => ({
    id: d.id,
    name: d.name,
    months: debtPayoffMonths(d.currentBalanceCents, d.minimumPaymentCents, d.aprPct),
    currentBalance: formatCents(d.currentBalanceCents),
    minimumPayment: formatCents(d.minimumPaymentCents),
  }));
  const maxDebtPayoffMonths = debtPayoff.length > 0
    ? Math.max(...debtPayoff.map((d) => (Number.isFinite(d.months) ? d.months : 999)))
    : 0;

  const goalCompletion = goals.map((g) => {
    const remaining = g.targetAmountCents - g.reservedAmountCents;
    const months = g.monthlyContributionCents > 0 && remaining > 0
      ? Math.ceil(remaining / g.monthlyContributionCents)
      : remaining <= 0 ? 0 : null;
    return {
      id: g.id,
      name: g.name,
      months,
      targetAmount: formatCents(g.targetAmountCents),
      reservedAmount: formatCents(g.reservedAmountCents),
      remainingAmount: formatCents(Math.max(0, remaining)),
      monthlyContribution: formatCents(g.monthlyContributionCents),
    };
  });

  const cashFlow12m = simulate12Months(snapshot);

  return {
    monthlyIncome: formatCents(monthlyIncomeCents),
    totalAllocated: formatCents(totalAllocatedCents),
    surplus: formatCents(surplusCents),
    bufferAmount: formatCents(bufferAmountCents),
    monthlyFlexibility: formatCents(monthlyFlexibilityCents),
    fixedBillsTotal: formatCents(fixedBillsTotalCents),
    debtMinimums: formatCents(debtMinimumsCents),
    debtPayoff,
    maxDebtPayoffMonths,
    goalCompletion,
    cashFlow12m,
    _cents: {
      monthlyIncome: monthlyIncomeCents,
      surplus: surplusCents,
      buffer: bufferAmountCents,
      monthlyFlexibility: monthlyFlexibilityCents,
    },
  };
}

function simulate12Months(snapshot) {
  const { monthlyIncomeCents, allocations, debts, goals, fixedBills } = snapshot;
  const totalAllocationPct = allocations.reduce((s, a) => s + parseFloat(a.allocationPercent), 0);

  let debtBalances = debts.map((d) => ({ ...d }));
  let goalBalances = goals.map((g) => ({ ...g }));

  const months = [];
  for (let m = 0; m < 12; m++) {
    const income = monthlyIncomeCents;
    const allocated = Math.round(income * totalAllocationPct);
    const surplus = income - allocated;

    // Apply debt payments (reduce balances)
    let debtPaidCents = 0;
    debtBalances = debtBalances.map((d) => {
      const payment = Math.min(d.minimumPaymentCents, d.currentBalanceCents);
      const interest = Math.round((d.currentBalanceCents * d.aprPct) / 100 / 12);
      const principal = Math.max(0, payment - interest);
      const newBalance = Math.max(0, d.currentBalanceCents - principal);
      debtPaidCents += payment;
      return { ...d, currentBalanceCents: newBalance };
    });

    // Apply goal contributions
    let goalSavedCents = 0;
    goalBalances = goalBalances.map((g) => {
      const contribution = Math.min(g.monthlyContributionCents, Math.max(0, g.targetAmountCents - g.reservedAmountCents));
      goalSavedCents += contribution;
      return { ...g, reservedAmountCents: g.reservedAmountCents + contribution };
    });

    const totalDebtBalance = debtBalances.reduce((s, d) => s + d.currentBalanceCents, 0);
    const totalGoalProgress = goalBalances.reduce((s, g) => s + g.reservedAmountCents, 0);

    months.push({
      month: m + 1,
      income: formatCents(income),
      allocated: formatCents(allocated),
      surplus: formatCents(surplus),
      debtPaid: formatCents(debtPaidCents),
      goalSaved: formatCents(goalSavedCents),
      totalDebtBalance: formatCents(totalDebtBalance),
      totalGoalProgress: formatCents(totalGoalProgress),
      netCashFlow: formatCents(surplus),
    });
  }

  return months;
}

export function applyScenario(snapshot, scenario) {
  const s = JSON.parse(JSON.stringify(snapshot));

  switch (scenario.type) {
    case 'extra_debt_payment': {
      const { debtId, extraAmountCents } = scenario;
      const debt = s.debts.find((d) => d.id === debtId);
      if (debt) debt.minimumPaymentCents += extraAmountCents;
      break;
    }

    case 'expense_increase': {
      const { name, amountCents, percentIncrease } = scenario;
      if (percentIncrease != null) {
        for (const bill of s.fixedBills) {
          bill.expectedAmountCents = Math.round(bill.expectedAmountCents * (1 + percentIncrease / 100));
        }
      } else {
        s.fixedBills.push({
          id: `_scenario_${Date.now()}`,
          name: name ?? 'New Expense',
          expectedAmountCents: amountCents ?? 0,
          expectedAmount: formatCents(amountCents ?? 0),
        });
      }
      break;
    }

    case 'income_drop': {
      const { percentDrop } = scenario;
      s.monthlyIncomeCents = Math.round(s.monthlyIncomeCents * (1 - percentDrop / 100));
      s.monthlyIncome = formatCents(s.monthlyIncomeCents);
      break;
    }

    case 'goal_savings': {
      const { goalId, monthlyContributionCents } = scenario;
      const goal = s.goals.find((g) => g.id === goalId);
      if (goal) goal.monthlyContributionCents = monthlyContributionCents;
      break;
    }

    case 'one_time_purchase': {
      const { amountCents } = scenario;
      // Reduce first-month income equivalent (reflected in simulation month 1)
      s._oneTimePurchaseCents = amountCents ?? 0;
      break;
    }

    case 'surplus_redirect': {
      const { targetSlug, amountCents } = scenario;
      const target = s.allocations.find((a) => a.slug === targetSlug);
      if (target) {
        const addPct = amountCents / Math.max(1, s.monthlyIncomeCents);
        target.allocationPercent = String(
          (parseFloat(target.allocationPercent) + addPct).toFixed(4),
        );
      }
      break;
    }

    case 'emergency_floor_change': {
      const { newBufferPct } = scenario;
      const buffer = s.allocations.find((a) => a.isBuffer);
      if (buffer) buffer.allocationPercent = String((newBufferPct / 100).toFixed(4));
      break;
    }

    default:
      break;
  }

  return s;
}

export function buildChangeSet(snapshot, scenario) {
  const changes = [];

  switch (scenario.type) {
    case 'extra_debt_payment': {
      const { debtId, extraAmountCents } = scenario;
      const debt = snapshot.debts.find((d) => d.id === debtId);
      if (debt) {
        changes.push({
          resource: 'debt',
          id: debtId,
          label: debt.name,
          field: 'minimumPayment',
          from: formatCents(debt.minimumPaymentCents),
          to: formatCents(debt.minimumPaymentCents + extraAmountCents),
          description: `Increase monthly payment on "${debt.name}" by ${formatCents(extraAmountCents)}`,
        });
      }
      break;
    }

    case 'expense_increase': {
      const { name, amountCents, percentIncrease } = scenario;
      if (percentIncrease != null) {
        for (const bill of snapshot.fixedBills) {
          const newAmount = Math.round(bill.expectedAmountCents * (1 + percentIncrease / 100));
          changes.push({
            resource: 'fixedBill',
            id: bill.id,
            label: bill.name,
            field: 'expectedAmount',
            from: formatCents(bill.expectedAmountCents),
            to: formatCents(newAmount),
            description: `Increase "${bill.name}" by ${percentIncrease}%`,
          });
        }
      } else {
        changes.push({
          resource: 'fixedBill',
          id: null,
          label: name ?? 'New Expense',
          field: null,
          from: null,
          to: formatCents(amountCents ?? 0),
          description: `Add new fixed bill "${name ?? 'New Expense'}" at ${formatCents(amountCents ?? 0)}/mo`,
        });
      }
      break;
    }

    case 'income_drop': {
      const { percentDrop } = scenario;
      changes.push({
        resource: 'note',
        id: null,
        label: 'Income',
        field: 'monthlyIncome',
        from: formatCents(snapshot.monthlyIncomeCents),
        to: formatCents(Math.round(snapshot.monthlyIncomeCents * (1 - percentDrop / 100))),
        description: `Simulated income drop of ${percentDrop}% — no automatic change applied`,
      });
      break;
    }

    case 'goal_savings': {
      const { goalId, monthlyContributionCents } = scenario;
      const goal = snapshot.goals.find((g) => g.id === goalId);
      if (goal) {
        changes.push({
          resource: 'note',
          id: goalId,
          label: goal.name,
          field: 'monthlyContribution',
          from: formatCents(goal.monthlyContributionCents),
          to: formatCents(monthlyContributionCents),
          description: `Set monthly contribution toward "${goal.name}" to ${formatCents(monthlyContributionCents)}`,
        });
      }
      break;
    }

    case 'one_time_purchase': {
      const { name, amountCents } = scenario;
      changes.push({
        resource: 'note',
        id: null,
        label: name ?? 'One-time Purchase',
        field: null,
        from: null,
        to: formatCents(amountCents ?? 0),
        description: `Record one-time expense "${name ?? 'Purchase'}" of ${formatCents(amountCents ?? 0)}`,
      });
      break;
    }

    case 'surplus_redirect': {
      const { targetSlug, amountCents } = scenario;
      const target = snapshot.allocations.find((a) => a.slug === targetSlug);
      if (target) {
        const addPct = amountCents / Math.max(1, snapshot.monthlyIncomeCents);
        const newPct = parseFloat(target.allocationPercent) + addPct;
        changes.push({
          resource: 'allocation',
          id: target.id,
          label: target.label,
          field: 'allocationPercent',
          from: target.allocationPercent,
          to: newPct.toFixed(4),
          description: `Redirect ${formatCents(amountCents)}/mo surplus to "${target.label}" allocation`,
        });
      }
      break;
    }

    case 'emergency_floor_change': {
      const { newBufferPct } = scenario;
      const buffer = snapshot.allocations.find((a) => a.isBuffer);
      if (buffer) {
        changes.push({
          resource: 'allocation',
          id: buffer.id,
          label: buffer.label,
          field: 'allocationPercent',
          from: buffer.allocationPercent,
          to: (newBufferPct / 100).toFixed(4),
          description: `Change emergency buffer allocation to ${newBufferPct}%`,
        });
      }
      break;
    }

    default:
      break;
  }

  return changes;
}
