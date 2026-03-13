BEGIN;

ALTER TABLE public.merchant_rules
ADD COLUMN IF NOT EXISTS merchant_pattern text,
ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

UPDATE public.merchant_rules
SET merchant_pattern = COALESCE(merchant_pattern, match_value)
WHERE merchant_pattern IS NULL;

COMMIT;
