-- Fix broken trigger on raf.income_entries.
--
-- The shared enforce_income_allocation_total() function uses NEW.income_entry_id,
-- which is a valid column on raf.income_allocations but does NOT exist on
-- raf.income_entries (whose primary key is just "id").  When the deferred
-- constraint trigger fires at commit for an income_entries INSERT it throws:
--   ERROR: record "new" has no field "income_entry_id"
--
-- Fix: introduce a dedicated function for the income_entries side of the check
-- that resolves the target entry id via NEW.id / OLD.id (the PK).

CREATE OR REPLACE FUNCTION raf.enforce_income_entry_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_income_entry_id uuid;
  income_amount          numeric(12,2);
  allocated_total        numeric(12,2);
BEGIN
  -- income_entries.id is the pk — use it directly (no income_entry_id column here)
  target_income_entry_id := COALESCE(NEW.id, OLD.id);

  SELECT amount INTO income_amount
  FROM raf.income_entries
  WHERE id = target_income_entry_id;

  IF income_amount IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0.00) INTO allocated_total
  FROM raf.income_allocations
  WHERE income_entry_id = target_income_entry_id;

  IF allocated_total <> income_amount THEN
    RAISE EXCEPTION
      'Income allocation total must equal deposit amount for income_entry % (expected %, found %)',
      target_income_entry_id, income_amount, allocated_total;
  END IF;

  RETURN NULL;
END;
$$;

-- Re-wire the trigger on income_entries to use the corrected function.
DROP TRIGGER IF EXISTS trg_income_entries_allocation_total ON raf.income_entries;

CREATE CONSTRAINT TRIGGER trg_income_entries_allocation_total
AFTER INSERT OR UPDATE ON raf.income_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION raf.enforce_income_entry_allocation_total();

-- Also tighten the income_allocations trigger: only look at income_entry_id /
-- its DELETE-side OLD.income_entry_id — the fallback NEW.id / OLD.id were
-- only needed because the same function was erroneously shared with the
-- income_entries table.
CREATE OR REPLACE FUNCTION raf.enforce_income_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_income_entry_id uuid;
  income_amount          numeric(12,2);
  allocated_total        numeric(12,2);
BEGIN
  target_income_entry_id := COALESCE(NEW.income_entry_id, OLD.income_entry_id);

  SELECT amount INTO income_amount
  FROM raf.income_entries
  WHERE id = target_income_entry_id;

  IF income_amount IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0.00) INTO allocated_total
  FROM raf.income_allocations
  WHERE income_entry_id = target_income_entry_id;

  IF allocated_total <> income_amount THEN
    RAISE EXCEPTION
      'Income allocation total must equal deposit amount for income_entry % (expected %, found %)',
      target_income_entry_id, income_amount, allocated_total;
  END IF;

  RETURN NULL;
END;
$$;
