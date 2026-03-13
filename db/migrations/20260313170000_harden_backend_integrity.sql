BEGIN;

ALTER TABLE public.households
ADD CONSTRAINT households_savings_floor_nonnegative_chk
CHECK (savings_floor >= 0),
ADD CONSTRAINT households_monthly_essentials_nonnegative_chk
CHECK (monthly_essentials_baseline >= 0);

ALTER TABLE public.debts
ADD CONSTRAINT debts_apr_nonnegative_chk
CHECK (apr >= 0),
ADD CONSTRAINT debts_minimum_payment_nonnegative_chk
CHECK (minimum_payment >= 0),
ADD CONSTRAINT debts_monthly_payment_nonnegative_chk
CHECK (monthly_payment >= 0);

ALTER TABLE public.import_batches
ADD CONSTRAINT import_batches_id_household_unique UNIQUE (id, household_id);

ALTER TABLE public.merchant_rules
ADD CONSTRAINT merchant_rules_id_household_unique UNIQUE (id, household_id);

ALTER TABLE public.transactions
DROP CONSTRAINT IF EXISTS transactions_import_batch_id_fkey;

ALTER TABLE public.transactions
ADD CONSTRAINT transactions_import_batch_fk
FOREIGN KEY (import_batch_id, household_id)
REFERENCES public.import_batches(id, household_id);

ALTER TABLE public.imported_transaction_rows
DROP CONSTRAINT IF EXISTS imported_transaction_rows_batch_id_fkey,
DROP CONSTRAINT IF EXISTS imported_transaction_rows_suggested_category_id_fkey,
DROP CONSTRAINT IF EXISTS imported_transaction_rows_suggested_debt_id_fkey,
DROP CONSTRAINT IF EXISTS imported_transaction_rows_duplicate_of_id_fkey,
DROP CONSTRAINT IF EXISTS imported_transaction_rows_suggested_by_rule_id_fkey;

ALTER TABLE public.imported_transaction_rows
ADD CONSTRAINT imported_transaction_rows_batch_fk
FOREIGN KEY (batch_id, household_id)
REFERENCES public.import_batches(id, household_id)
ON DELETE CASCADE,
ADD CONSTRAINT imported_transaction_rows_suggested_category_fk
FOREIGN KEY (suggested_category_id, household_id)
REFERENCES public.allocation_categories(id, household_id),
ADD CONSTRAINT imported_transaction_rows_suggested_debt_fk
FOREIGN KEY (suggested_debt_id, household_id)
REFERENCES public.debts(id, household_id),
ADD CONSTRAINT imported_transaction_rows_duplicate_of_fk
FOREIGN KEY (duplicate_of_id, household_id)
REFERENCES public.transactions(id, household_id),
ADD CONSTRAINT imported_transaction_rows_suggested_by_rule_fk
FOREIGN KEY (suggested_by_rule_id, household_id)
REFERENCES public.merchant_rules(id, household_id);

ALTER TABLE public.merchant_rules
DROP CONSTRAINT IF EXISTS merchant_rules_category_id_fkey;

ALTER TABLE public.merchant_rules
ADD CONSTRAINT merchant_rules_category_fk
FOREIGN KEY (category_id, household_id)
REFERENCES public.allocation_categories(id, household_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_payments_transaction_id_unique
ON public.debt_payments (transaction_id)
WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_household_dedup_lookup
ON public.transactions (household_id, transaction_date, amount, merchant);

CREATE INDEX IF NOT EXISTS idx_income_allocations_income_entry_id
ON public.income_allocations (income_entry_id);

CREATE INDEX IF NOT EXISTS idx_merchant_rules_household_priority_created_at
ON public.merchant_rules (household_id, priority DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_income_allocation_total()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_income_entry_id uuid;
  income_amount numeric(12,2);
  allocated_total numeric(12,2);
BEGIN
  target_income_entry_id := COALESCE(NEW.income_entry_id, OLD.income_entry_id, NEW.id, OLD.id);

  SELECT amount
    INTO income_amount
  FROM public.income_entries
  WHERE id = target_income_entry_id;

  IF income_amount IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0.00)
    INTO allocated_total
  FROM public.income_allocations
  WHERE income_entry_id = target_income_entry_id;

  IF allocated_total <> income_amount THEN
    RAISE EXCEPTION 'Income allocation total must equal deposit amount for income_entry % (expected %, found %)',
      target_income_entry_id, income_amount, allocated_total;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_income_entries_allocation_total
AFTER INSERT OR UPDATE ON public.income_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_income_allocation_total();

CREATE CONSTRAINT TRIGGER trg_income_allocations_total
AFTER INSERT OR UPDATE OR DELETE ON public.income_allocations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_income_allocation_total();

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocation_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surplus_split_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imported_transaction_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY households_owner_policy ON public.households
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY allocation_categories_household_policy ON public.allocation_categories
USING (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = allocation_categories.household_id
    AND households.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = allocation_categories.household_id
    AND households.owner_user_id = auth.uid()
));

CREATE POLICY surplus_split_rules_household_policy ON public.surplus_split_rules
USING (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = surplus_split_rules.household_id
    AND households.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = surplus_split_rules.household_id
    AND households.owner_user_id = auth.uid()
));

CREATE POLICY income_entries_household_policy ON public.income_entries
USING (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = income_entries.household_id
    AND households.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = income_entries.household_id
    AND households.owner_user_id = auth.uid()
));

CREATE POLICY income_allocations_household_policy ON public.income_allocations
USING (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = income_allocations.household_id
    AND households.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = income_allocations.household_id
    AND households.owner_user_id = auth.uid()
));

CREATE POLICY transactions_household_policy ON public.transactions
USING (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = transactions.household_id
    AND households.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = transactions.household_id
    AND households.owner_user_id = auth.uid()
));

CREATE POLICY debts_household_policy ON public.debts
USING (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = debts.household_id
    AND households.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = debts.household_id
    AND households.owner_user_id = auth.uid()
));

CREATE POLICY debt_payments_household_policy ON public.debt_payments
USING (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = debt_payments.household_id
    AND households.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = debt_payments.household_id
    AND households.owner_user_id = auth.uid()
));

CREATE POLICY import_batches_household_policy ON public.import_batches
USING (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = import_batches.household_id
    AND households.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = import_batches.household_id
    AND households.owner_user_id = auth.uid()
));

CREATE POLICY imported_transaction_rows_household_policy ON public.imported_transaction_rows
USING (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = imported_transaction_rows.household_id
    AND households.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = imported_transaction_rows.household_id
    AND households.owner_user_id = auth.uid()
));

CREATE POLICY merchant_rules_household_policy ON public.merchant_rules
USING (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = merchant_rules.household_id
    AND households.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = merchant_rules.household_id
    AND households.owner_user_id = auth.uid()
));

CREATE POLICY monthly_reviews_household_policy ON public.monthly_reviews
USING (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = monthly_reviews.household_id
    AND households.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.households
  WHERE households.id = monthly_reviews.household_id
    AND households.owner_user_id = auth.uid()
));

COMMIT;
