# RAF Product Constitution & Engineering Guardrails

RAF is not intended to become a generic expense tracker or conventional budgeting application.

## Core Product Philosophy

RAF is a financial stewardship and resource-allocation system.

Its central question is not:

> "Where did my money go?"

It is:

> "Given the resources available to me, how should I steward them wisely?"

RAF should help users make intentional decisions before, during, and after money is spent.

The fundamental lifecycle is:

Income -> Allocate -> Spend -> Review Surplus/Deficit -> Adjust

Historical reporting matters, but it exists to improve future allocation decisions.

## Financial Ideology

Preserve these principles throughout the system:

1. Every dollar should have intentional direction.
2. Obligations should be understood before discretionary spending.
3. Users should live within their actual means rather than budgeting against imagined income.
4. Multiple income streams should be treated as resources arriving at different times, not merely collapsed into one monthly number.
5. Giving is an intentional allocation category. RAF currently supports the user's principle of 10% giving; architecture should make allocation principles configurable without diminishing their importance.
6. Savings should have purpose and appropriate minimum/floor targets.
7. Debt should be deliberately reduced rather than treated merely as another recurring expense.
8. Surplus is a resource requiring a decision, not automatically "money available to spend."
9. Deficits should trigger adjustment and prioritization rather than simply displaying a negative number.
10. Spending should be intentional but RAF should not become punitive, moralizing, or guilt-driven.
11. The system may recommend; the user ultimately decides.
12. User overrides are legitimate decisions and should be preserved and explainable.
13. Financial health should represent stewardship and sustainability, not simply wealth or income.
14. RAF should help users build margin, resilience and progress over time.
15. Increasing income should not automatically imply increasing lifestyle spending.

## Product Personality

RAF should feel:

- calm
- thoughtful
- intentional
- intelligent
- encouraging
- practical
- transparent
- non-judgmental

Avoid:

- shame-based financial messaging
- gamification that encourages obsession
- generic "spend less" recommendations
- pretending AI knows the user's priorities better than the user
- optimizing solely for net worth
- excessive alerts
- financial-advisor impersonation
- opaque financial scores

## RAF's Differentiator

RAF is not primarily:

- an expense tracker
- a bank dashboard
- a transaction categorizer
- an AI chatbot
- a debt calculator

Those may exist as supporting capabilities.

RAF's core product is an allocation and financial decision engine.

The system should increasingly connect:

Income
-> obligations
-> giving
-> savings floors
-> goals
-> debt strategy
-> flexible spending
-> surplus
-> future trajectory

into one coherent financial plan.

## Engineering Principle

Financial truth must remain deterministic.

AI must never become the source of truth for balances, allocation calculations, debt calculations, forecasts or financial records.

Use deterministic domain logic for financial calculations.

AI/Remi may:

- explain calculations
- surface patterns
- answer questions using calculated RAF data
- help users explore scenarios
- propose actions

but the RAF engine performs the calculation and validates changes.

## Change Rule

For every implementation phase:

1. Audit the current implementation first.
2. Identify existing functionality that can be reused.
3. Do not rewrite working functionality unnecessarily.
4. Preserve existing behavior unless the phase explicitly changes it.
5. Prefer migrations over destructive schema changes.
6. Maintain backwards compatibility where reasonable.
7. Add tests around financial calculations before refactoring them.
8. Treat tenant isolation and financial-data security as hard requirements.
9. Keep RAF a modular monolith.
10. Do not introduce microservices unless there is an evidenced need.

Before implementing any phase, report:

- current state
- gaps
- proposed architecture
- files/schema affected
- migration risks
- tests required
