BEGIN;

CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  filename text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsing', 'review', 'approved', 'failed')),
  row_count int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_batches_household_id ON public.import_batches (household_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_created_at ON public.import_batches (created_at);

CREATE TABLE IF NOT EXISTS public.imported_transaction_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  raw_date text,
  raw_description text,
  raw_merchant text,
  raw_amount text,
  raw_direction text,
  parsed_date date,
  parsed_description text,
  parsed_merchant text,
  parsed_amount numeric(12,2),
  parsed_direction text CHECK (parsed_direction IN ('debit', 'credit')),
  suggested_category_id uuid REFERENCES public.allocation_categories(id),
  suggested_debt_id uuid REFERENCES public.debts(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'duplicate', 'skipped')),
  duplicate_of_id uuid REFERENCES public.transactions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imported_transaction_rows_batch_status
  ON public.imported_transaction_rows (batch_id, status);
CREATE INDEX IF NOT EXISTS idx_imported_transaction_rows_household_id
  ON public.imported_transaction_rows (household_id);

CREATE TABLE IF NOT EXISTS public.merchant_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  match_type text NOT NULL CHECK (match_type IN ('exact', 'contains', 'starts_with', 'regex')),
  match_value text NOT NULL,
  category_id uuid REFERENCES public.allocation_categories(id),
  priority int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_rules_household_id ON public.merchant_rules (household_id);

ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.import_batches(id);

CREATE INDEX IF NOT EXISTS idx_transactions_import_batch_id ON public.transactions (import_batch_id);

CREATE TRIGGER trg_import_batches_set_updated_at
BEFORE UPDATE ON public.import_batches
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_merchant_rules_set_updated_at
BEFORE UPDATE ON public.merchant_rules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
