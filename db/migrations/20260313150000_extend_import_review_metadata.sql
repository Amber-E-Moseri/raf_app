BEGIN;

ALTER TABLE public.imported_transaction_rows
ADD COLUMN IF NOT EXISTS raw_data jsonb,
ADD COLUMN IF NOT EXISTS suggested_by_rule_id uuid REFERENCES public.merchant_rules(id),
ADD COLUMN IF NOT EXISTS suggestion_reason text,
ADD COLUMN IF NOT EXISTS duplicate_reason text;

ALTER TABLE public.imported_transaction_rows
DROP CONSTRAINT IF EXISTS imported_transaction_rows_status_check;

ALTER TABLE public.imported_transaction_rows
ADD CONSTRAINT imported_transaction_rows_status_check
CHECK (status IN ('pending', 'approved', 'duplicate', 'skipped', 'rejected'));

COMMIT;
