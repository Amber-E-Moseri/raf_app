-- Row-Level Security policies for all financial tables.
--
-- The application sets raf.workspace_id as a transaction-scoped session variable
-- before every DB operation (see postgresDb.js). These policies enforce that
-- every row read or written must belong to the current workspace.
--
-- The migration runner must bypass RLS using a superuser or the BYPASSRLS role.
-- Application roles (e.g. neondb_owner) should NOT have BYPASSRLS so that
-- policies are enforced at runtime.
--
-- All tables use household_id as the tenant key; workspace_id = household_id
-- in this codebase (the adapter maps them 1:1).

BEGIN;

-- Helper: read the current workspace id from the session config.
-- Returns NULL if not set (access will be denied by the USING clause).
create or replace function raf.current_workspace_id() returns uuid
  language sql stable security definer as $$
  select nullif(current_setting('raf.workspace_id', true), '')::uuid
$$;

-- ── households ──────────────────────────────────────────────────────────────
alter table public.households enable row level security;
drop policy if exists households_workspace_isolation on public.households;
create policy households_workspace_isolation
  on public.households
  using (id = raf.current_workspace_id());

-- ── allocation_categories ────────────────────────────────────────────────────
alter table public.allocation_categories enable row level security;
drop policy if exists allocation_categories_workspace_isolation on public.allocation_categories;
create policy allocation_categories_workspace_isolation
  on public.allocation_categories
  using (household_id = raf.current_workspace_id());

-- ── surplus_split_rules ──────────────────────────────────────────────────────
alter table public.surplus_split_rules enable row level security;
drop policy if exists surplus_split_rules_workspace_isolation on public.surplus_split_rules;
create policy surplus_split_rules_workspace_isolation
  on public.surplus_split_rules
  using (household_id = raf.current_workspace_id());

-- ── income_entries ────────────────────────────────────────────────────────────
alter table public.income_entries enable row level security;
drop policy if exists income_entries_workspace_isolation on public.income_entries;
create policy income_entries_workspace_isolation
  on public.income_entries
  using (household_id = raf.current_workspace_id());

-- ── income_allocations ────────────────────────────────────────────────────────
alter table public.income_allocations enable row level security;
drop policy if exists income_allocations_workspace_isolation on public.income_allocations;
create policy income_allocations_workspace_isolation
  on public.income_allocations
  using (household_id = raf.current_workspace_id());

-- ── debts ────────────────────────────────────────────────────────────────────
alter table public.debts enable row level security;
drop policy if exists debts_workspace_isolation on public.debts;
create policy debts_workspace_isolation
  on public.debts
  using (household_id = raf.current_workspace_id());

-- ── transactions ──────────────────────────────────────────────────────────────
alter table public.transactions enable row level security;
drop policy if exists transactions_workspace_isolation on public.transactions;
create policy transactions_workspace_isolation
  on public.transactions
  using (household_id = raf.current_workspace_id());

-- ── debt_payments ─────────────────────────────────────────────────────────────
alter table public.debt_payments enable row level security;
drop policy if exists debt_payments_workspace_isolation on public.debt_payments;
create policy debt_payments_workspace_isolation
  on public.debt_payments
  using (household_id = raf.current_workspace_id());

-- ── monthly_reviews ───────────────────────────────────────────────────────────
alter table public.monthly_reviews enable row level security;
drop policy if exists monthly_reviews_workspace_isolation on public.monthly_reviews;
create policy monthly_reviews_workspace_isolation
  on public.monthly_reviews
  using (household_id = raf.current_workspace_id());

-- ── import_batches ────────────────────────────────────────────────────────────
alter table public.import_batches enable row level security;
drop policy if exists import_batches_workspace_isolation on public.import_batches;
create policy import_batches_workspace_isolation
  on public.import_batches
  using (household_id = raf.current_workspace_id());

-- ── imported_transaction_rows ─────────────────────────────────────────────────
-- Rows are isolated via their parent import_batch household_id join.
-- Direct access via batch_id already ensures tenant scoping through the app layer.
-- Enable RLS here with a join-based policy for defence in depth.
alter table public.imported_transaction_rows enable row level security;
drop policy if exists imported_transaction_rows_workspace_isolation on public.imported_transaction_rows;
create policy imported_transaction_rows_workspace_isolation
  on public.imported_transaction_rows
  using (
    exists (
      select 1 from public.import_batches ib
      where ib.id = imported_transaction_rows.batch_id
        and ib.household_id = raf.current_workspace_id()
    )
  );

-- ── merchant_rules ────────────────────────────────────────────────────────────
alter table public.merchant_rules enable row level security;
drop policy if exists merchant_rules_workspace_isolation on public.merchant_rules;
create policy merchant_rules_workspace_isolation
  on public.merchant_rules
  using (household_id = raf.current_workspace_id());

COMMIT;
