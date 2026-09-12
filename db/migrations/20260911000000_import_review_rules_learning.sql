BEGIN;

-- Extend import_review_rules with merchant-key and learning-strength columns.
-- normalized_merchant: stable merchant identity stripped of store numbers and codes,
--   enabling cross-variation matching (e.g. "WHOLE FOODS #1042" ~ "WHOLE FOODS MARKET").
-- confirmation_count: incremented each time a user reconfirms the same merchant→category pairing.
-- correction_count: incremented each time a user changes a previously learned category.
--   correction_count > 0 marks the rule as ambiguous (suggestion only, never auto-assign).

ALTER TABLE raf.import_review_rules
  ADD COLUMN IF NOT EXISTS normalized_merchant text,
  ADD COLUMN IF NOT EXISTS confirmation_count int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS correction_count int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_import_review_rules_merchant
  ON raf.import_review_rules (workspace_id, normalized_merchant)
  WHERE normalized_merchant IS NOT NULL;

COMMIT;
