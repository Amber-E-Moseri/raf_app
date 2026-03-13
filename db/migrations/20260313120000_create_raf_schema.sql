BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE,
  name text,
  timezone text NOT NULL DEFAULT 'America/Toronto',
  active_month date NOT NULL,
  period_start_day int NOT NULL DEFAULT 1 CHECK (period_start_day BETWEEN 1 AND 28),
  savings_floor numeric(12,2) NOT NULL DEFAULT 0,
  monthly_essentials_baseline numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_households_created_at ON public.households (created_at);

CREATE TABLE IF NOT EXISTS public.allocation_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  slug text NOT NULL,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  allocation_percent numeric(6,4) NOT NULL CHECK (allocation_percent >= 0 AND allocation_percent <= 1),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, slug),
  UNIQUE (id, household_id)
);

CREATE INDEX IF NOT EXISTS idx_allocation_categories_household_id ON public.allocation_categories (household_id);
CREATE INDEX IF NOT EXISTS idx_allocation_categories_created_at ON public.allocation_categories (created_at);

CREATE TABLE IF NOT EXISTS public.surplus_split_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  slug text NOT NULL,
  label text NOT NULL,
  split_percent numeric(6,4) NOT NULL CHECK (split_percent >= 0 AND split_percent <= 1),
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, slug),
  UNIQUE (id, household_id)
);

CREATE INDEX IF NOT EXISTS idx_surplus_split_rules_household_id ON public.surplus_split_rules (household_id);
CREATE INDEX IF NOT EXISTS idx_surplus_split_rules_created_at ON public.surplus_split_rules (created_at);

CREATE TABLE IF NOT EXISTS public.income_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  received_date date NOT NULL,
  notes text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, household_id)
);

CREATE INDEX IF NOT EXISTS idx_income_entries_household_id ON public.income_entries (household_id);
CREATE INDEX IF NOT EXISTS idx_income_entries_created_at ON public.income_entries (created_at);
CREATE INDEX IF NOT EXISTS idx_income_entries_household_received_date ON public.income_entries (household_id, received_date);

CREATE TABLE IF NOT EXISTS public.debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name text NOT NULL,
  starting_balance numeric(12,2) NOT NULL CHECK (starting_balance > 0),
  apr numeric(5,2) NOT NULL DEFAULT 0,
  minimum_payment numeric(12,2) NOT NULL DEFAULT 0,
  monthly_payment numeric(12,2) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, household_id)
);

CREATE INDEX IF NOT EXISTS idx_debts_household_id ON public.debts (household_id);
CREATE INDEX IF NOT EXISTS idx_debts_created_at ON public.debts (created_at);
CREATE INDEX IF NOT EXISTS idx_debts_household_is_active ON public.debts (household_id, is_active);

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  description text NOT NULL,
  merchant text,
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  category_id uuid,
  linked_debt_id uuid,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, household_id),
  CONSTRAINT transactions_amount_direction_chk CHECK (
    amount > 0 OR (amount < 0 AND direction = 'credit')
  ),
  CONSTRAINT transactions_category_fk
    FOREIGN KEY (category_id, household_id)
    REFERENCES public.allocation_categories(id, household_id),
  CONSTRAINT transactions_linked_debt_fk
    FOREIGN KEY (linked_debt_id, household_id)
    REFERENCES public.debts(id, household_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_household_id ON public.transactions (household_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_household_transaction_date ON public.transactions (household_id, transaction_date);

CREATE TABLE IF NOT EXISTS public.income_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  income_entry_id uuid NOT NULL,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  allocation_category_id uuid NOT NULL,
  allocated_amount numeric(12,2) NOT NULL CHECK (allocated_amount >= 0),
  allocation_percent numeric(6,4) NOT NULL CHECK (allocation_percent >= 0 AND allocation_percent <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT income_allocations_income_entry_fk
    FOREIGN KEY (income_entry_id, household_id)
    REFERENCES public.income_entries(id, household_id)
    ON DELETE CASCADE,
  CONSTRAINT income_allocations_category_fk
    FOREIGN KEY (allocation_category_id, household_id)
    REFERENCES public.allocation_categories(id, household_id)
);

CREATE INDEX IF NOT EXISTS idx_income_allocations_household_id ON public.income_allocations (household_id);
CREATE INDEX IF NOT EXISTS idx_income_allocations_created_at ON public.income_allocations (created_at);

CREATE TABLE IF NOT EXISTS public.debt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL,
  transaction_id uuid,
  payment_date date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT debt_payments_debt_fk
    FOREIGN KEY (debt_id, household_id)
    REFERENCES public.debts(id, household_id),
  CONSTRAINT debt_payments_transaction_fk
    FOREIGN KEY (transaction_id)
    REFERENCES public.transactions(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_debt_payments_household_id ON public.debt_payments (household_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_created_at ON public.debt_payments (created_at);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt_id ON public.debt_payments (debt_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_household_payment_date ON public.debt_payments (household_id, payment_date);

CREATE OR REPLACE FUNCTION public.enforce_active_allocation_percent_sum()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_household uuid;
  active_count int;
  pct_sum numeric(10,4);
BEGIN
  target_household := COALESCE(NEW.household_id, OLD.household_id);

  SELECT COUNT(*), COALESCE(SUM(allocation_percent), 0)
    INTO active_count, pct_sum
  FROM public.allocation_categories
  WHERE household_id = target_household
    AND is_active = true;

  IF active_count > 0 AND ABS(pct_sum - 1.0000) > 0.0001 THEN
    RAISE EXCEPTION 'Active allocation percentages must sum to 1.0000 ± 0.0001 for household % (found %)',
      target_household, pct_sum;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_active_surplus_split_percent_sum()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_household uuid;
  active_count int;
  pct_sum numeric(10,4);
BEGIN
  target_household := COALESCE(NEW.household_id, OLD.household_id);

  SELECT COUNT(*), COALESCE(SUM(split_percent), 0)
    INTO active_count, pct_sum
  FROM public.surplus_split_rules
  WHERE household_id = target_household
    AND is_active = true;

  IF active_count > 0 AND ABS(pct_sum - 1.0000) > 0.0001 THEN
    RAISE EXCEPTION 'Active surplus split percentages must sum to 1.0000 ± 0.0001 for household % (found %)',
      target_household, pct_sum;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_allocation_categories_percent_sum
AFTER INSERT OR UPDATE OR DELETE ON public.allocation_categories
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_allocation_percent_sum();

CREATE CONSTRAINT TRIGGER trg_surplus_split_rules_percent_sum
AFTER INSERT OR UPDATE OR DELETE ON public.surplus_split_rules
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_active_surplus_split_percent_sum();

CREATE OR REPLACE FUNCTION public.prevent_debt_delete_with_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.debt_payments WHERE debt_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete debt % with payments; set is_active = false instead.', OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_prevent_debt_delete_with_payments
BEFORE DELETE ON public.debts
FOR EACH ROW EXECUTE FUNCTION public.prevent_debt_delete_with_payments();

CREATE TRIGGER trg_households_set_updated_at
BEFORE UPDATE ON public.households
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_allocation_categories_set_updated_at
BEFORE UPDATE ON public.allocation_categories
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_surplus_split_rules_set_updated_at
BEFORE UPDATE ON public.surplus_split_rules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_income_entries_set_updated_at
BEFORE UPDATE ON public.income_entries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_transactions_set_updated_at
BEFORE UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_debts_set_updated_at
BEFORE UPDATE ON public.debts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
