BEGIN;

CREATE TABLE IF NOT EXISTS public.monthly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  review_month date NOT NULL,
  net_surplus numeric(12,2) NOT NULL,
  split_applied jsonb NOT NULL,
  distributions jsonb NOT NULL,
  alert_status text NOT NULL CHECK (alert_status IN ('ok', 'elevated', 'risky')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, review_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_reviews_household_id ON public.monthly_reviews (household_id);
CREATE INDEX IF NOT EXISTS idx_monthly_reviews_review_month ON public.monthly_reviews (review_month);

CREATE TRIGGER trg_monthly_reviews_set_updated_at
BEFORE UPDATE ON public.monthly_reviews
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
