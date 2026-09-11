import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { formatCurrency, formatIsoDate } from "../../lib/format";
import type { Debt, DebtPaymentPaceAcknowledgement } from "../../lib/types";

interface PaymentPaceInsightProps {
  debt: Debt;
  acknowledged?: boolean;
  pendingAction?: DebtPaymentPaceAcknowledgement["action"] | null;
  onUpdatePlan: () => void;
  onKeepPlan: () => void;
  onAcknowledgeOnetime: () => void;
}

function observedBasisLabel(value?: string | null) {
  switch (value) {
    case "three_month_average":
      return "Recent pace, 3-month average";
    case "latest_completed_month":
      return "Recent pace, latest completed month";
    default:
      return "This month's pace";
  }
}

const noticeClass =
  "space-y-4 rounded-2xl border border-[var(--border-color)] bg-[var(--surface-elevated)] p-4";

/**
 * Renders the three independent debt-intelligence signals for one debt, in priority order:
 *   1. a balance-growing warning (whenever the balance rose this period), then
 *   2. the payment-pace insight (above plan / well below plan).
 * A rising balance always wins the top slot and strips any "you're paying it down" framing
 * from an above-plan payment.
 */
export function PaymentPaceInsight({
  debt,
  acknowledged = false,
  pendingAction = null,
  onUpdatePlan,
  onKeepPlan,
  onAcknowledgeOnetime,
}: PaymentPaceInsightProps) {
  const trajectory = debt.balanceTrajectory;
  const explanation = debt.balanceExplanation;
  const balanceGrowing = trajectory?.trajectory === "increasing";

  const insight = debt.paymentInsight;
  const paceVisible = Boolean(insight) && !acknowledged
    && (insight!.type === "above_plan_payment" || insight!.type === "below_plan_warning");

  if (!balanceGrowing && !paceVisible) {
    return null;
  }

  const disabled = Boolean(pendingAction);

  return (
    <div className="space-y-3">
      {balanceGrowing ? (
        <div className={noticeClass}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning">Balance is growing</Badge>
            <span className="text-sm font-semibold text-[var(--text-strong)]">
              {formatCurrency(debt.openingBalance)} &rarr; {formatCurrency(debt.closingBalance)} this period
            </span>
          </div>
          {explanation ? (
            <>
              <p className="text-sm text-[var(--text-muted)]">{explanation.changeMessage}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-[var(--text-muted)]">Payments</dt>
                  <dd className="text-[var(--text-strong)]">{formatCurrency(explanation.payments)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Interest</dt>
                  <dd className="text-[var(--text-strong)]">{formatCurrency(explanation.interest)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Fees</dt>
                  <dd className="text-[var(--text-strong)]">{formatCurrency(explanation.fees)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">New charges or borrowing</dt>
                  <dd className="text-[var(--text-strong)]">{formatCurrency(explanation.newActivity)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--text-muted)]">Adjustments</dt>
                  <dd className="text-[var(--text-strong)]">{formatCurrency(explanation.adjustments)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              The balance rose by about {formatCurrency(String((trajectory!.absoluteChange / 100).toFixed(2)))} this period.
            </p>
          )}
        </div>
      ) : null}

      {paceVisible && insight!.type === "above_plan_payment" ? (
        <AbovePlanBlock
          insight={insight!}
          balanceGrowing={balanceGrowing}
          disabled={disabled}
          pendingAction={pendingAction}
          onUpdatePlan={onUpdatePlan}
          onKeepPlan={onKeepPlan}
          onAcknowledgeOnetime={onAcknowledgeOnetime}
        />
      ) : null}

      {paceVisible && insight!.type === "below_plan_warning" ? (
        <BelowPlanBlock
          insight={insight!}
          disabled={disabled}
          pendingAction={pendingAction}
          onKeepPlan={onKeepPlan}
          onAcknowledgeOnetime={onAcknowledgeOnetime}
        />
      ) : null}
    </div>
  );
}

interface AbovePlanBlockProps {
  insight: NonNullable<Debt["paymentInsight"]>;
  balanceGrowing: boolean;
  disabled: boolean;
  pendingAction: DebtPaymentPaceAcknowledgement["action"] | null;
  onUpdatePlan: () => void;
  onKeepPlan: () => void;
  onAcknowledgeOnetime: () => void;
}

function AbovePlanBlock({
  insight,
  balanceGrowing,
  disabled,
  pendingAction,
  onUpdatePlan,
  onKeepPlan,
  onAcknowledgeOnetime,
}: AbovePlanBlockProps) {
  const acceleratedMonths = insight.projections?.acceleratedMonths ?? 0;
  const interestSaved = Number(insight.projections?.interestSaved ?? "0");
  const showSavings = !balanceGrowing && (acceleratedMonths > 1 || interestSaved > 50);
  const suggestedPayment = insight.suggestedRecurringPayment ?? insight.actualPayment;

  return (
    <div className={noticeClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={balanceGrowing ? "neutral" : "success"}>Above plan</Badge>
            <span className="text-sm font-semibold text-[var(--text-strong)]">Payment pace changed</span>
          </div>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {balanceGrowing
              ? `You paid ${formatCurrency(insight.actualPayment)} against a ${formatCurrency(insight.plannedPayment)} plan for ${insight.actionablePaymentPeriod}, but the balance still rose — see above.`
              : `Recorded payments for ${insight.actionablePaymentPeriod} are ${formatCurrency(insight.actualPayment)} against a ${formatCurrency(insight.plannedPayment)} plan.`}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold text-[var(--text-strong)]">{insight.percentOfPlan.toFixed(0)}%</p>
          <p className="text-[var(--text-muted)]">of plan</p>
        </div>
      </div>

      {insight.projections ? (
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <p className="text-[var(--text-muted)]">Planned payoff</p>
            <p className="mt-1 font-semibold text-[var(--text-strong)]">
              {insight.projections.planned.estimatedPayoffDate ? formatIsoDate(insight.projections.planned.estimatedPayoffDate) : "Unavailable"}
            </p>
            <p className="mt-1 text-[var(--text-muted)]">{formatCurrency(insight.plannedPayment)}/month</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">{observedBasisLabel(insight.projections.observedBasis)}</p>
            <p className="mt-1 font-semibold text-[var(--text-strong)]">
              {insight.projections.observed.estimatedPayoffDate ? formatIsoDate(insight.projections.observed.estimatedPayoffDate) : "Unavailable"}
            </p>
            <p className="mt-1 text-[var(--text-muted)]">{formatCurrency(suggestedPayment)}/month</p>
          </div>
        </div>
      ) : null}

      {showSavings ? (
        <p className="text-sm text-[var(--text-muted)]">
          At this pace, the projection shows {acceleratedMonths > 1 ? `${acceleratedMonths} months earlier` : "a faster payoff"}
          {interestSaved > 50 ? ` and about ${formatCurrency(String(interestSaved.toFixed(2)))} less interest` : ""}.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onKeepPlan} disabled={disabled}>
          {pendingAction === "keep_plan" ? "Saving..." : "Keep current plan"}
        </Button>
        <Button type="button" variant="secondary" onClick={onUpdatePlan} disabled={disabled}>
          {pendingAction === "update_plan" ? "Updating..." : `Update plan to ${formatCurrency(suggestedPayment)}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onAcknowledgeOnetime} disabled={disabled}>
          {pendingAction === "acknowledge_onetime" ? "Saving..." : "This was one-time"}
        </Button>
      </div>
    </div>
  );
}

interface BelowPlanBlockProps {
  insight: NonNullable<Debt["paymentInsight"]>;
  disabled: boolean;
  pendingAction: DebtPaymentPaceAcknowledgement["action"] | null;
  onKeepPlan: () => void;
  onAcknowledgeOnetime: () => void;
}

function BelowPlanBlock({
  insight,
  disabled,
  pendingAction,
  onKeepPlan,
  onAcknowledgeOnetime,
}: BelowPlanBlockProps) {
  const delayedMonths = insight.projections?.acceleratedMonths ?? 0;
  const interestDelta = Number(insight.projections?.interestSaved ?? "0");
  const monthsLater = delayedMonths < 0 ? Math.abs(delayedMonths) : 0;
  const extraInterest = interestDelta < 0 ? Math.abs(interestDelta) : 0;

  return (
    <div className={noticeClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning">Below plan</Badge>
            <span className="text-sm font-semibold text-[var(--text-strong)]">Payment pace has slowed</span>
          </div>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Recorded payments for {insight.actionablePaymentPeriod} are {formatCurrency(insight.actualPayment)} against a {formatCurrency(insight.plannedPayment)} plan
            {insight.amountBelowPlan ? ` — ${formatCurrency(insight.amountBelowPlan)} short` : ""}.
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold text-[var(--text-strong)]">{insight.percentOfPlan.toFixed(0)}%</p>
          <p className="text-[var(--text-muted)]">of plan</p>
        </div>
      </div>

      {insight.projections ? (
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <p className="text-[var(--text-muted)]">Planned payoff</p>
            <p className="mt-1 font-semibold text-[var(--text-strong)]">
              {insight.projections.planned.estimatedPayoffDate ? formatIsoDate(insight.projections.planned.estimatedPayoffDate) : "Unavailable"}
            </p>
            <p className="mt-1 text-[var(--text-muted)]">{formatCurrency(insight.plannedPayment)}/month</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">{observedBasisLabel(insight.projections.observedBasis)}</p>
            <p className="mt-1 font-semibold text-[var(--text-strong)]">
              {insight.projections.observed.estimatedPayoffDate ? formatIsoDate(insight.projections.observed.estimatedPayoffDate) : "Unavailable"}
            </p>
            <p className="mt-1 text-[var(--text-muted)]">{formatCurrency(insight.actualPayment)}/month</p>
          </div>
        </div>
      ) : null}

      {monthsLater > 0 || extraInterest > 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          At this pace, the projection shows {monthsLater > 0 ? `about ${monthsLater} months later` : "a slower payoff"}
          {extraInterest > 0 ? ` and about ${formatCurrency(String(extraInterest.toFixed(2)))} more interest` : ""}.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onKeepPlan} disabled={disabled}>
          {pendingAction === "keep_plan" ? "Saving..." : "Keep current plan"}
        </Button>
        <Button type="button" variant="ghost" onClick={onAcknowledgeOnetime} disabled={disabled}>
          {pendingAction === "acknowledge_onetime" ? "Saving..." : "This was one-time"}
        </Button>
      </div>
    </div>
  );
}
