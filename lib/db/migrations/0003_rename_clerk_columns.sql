-- Remove Clerk-specific column names in favor of generic identifiers.
-- Idempotent: safe to re-run; columns may have already been renamed.

-- invoiceplane_users.clerk_user_id -> google_sub
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_users'
       AND column_name = 'clerk_user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_users'
       AND column_name = 'google_sub'
  ) THEN
    ALTER TABLE "invoiceplane_users" RENAME COLUMN "clerk_user_id" TO "google_sub";
  END IF;
END $$;

-- Matching unique constraint name, if it was derived from the old column.
-- Drizzle auto-named uniques are usually `<table>_<column>_unique`; rename
-- defensively with IF EXISTS semantics.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'invoiceplane_users_clerk_user_id_unique'
  ) THEN
    ALTER TABLE "invoiceplane_users"
      RENAME CONSTRAINT "invoiceplane_users_clerk_user_id_unique"
      TO "invoiceplane_users_google_sub_unique";
  END IF;
END $$;

-- invoiceplane_api_keys.created_by_clerk_id -> created_by_user_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_api_keys'
       AND column_name = 'created_by_clerk_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_api_keys'
       AND column_name = 'created_by_user_id'
  ) THEN
    ALTER TABLE "invoiceplane_api_keys"
      RENAME COLUMN "created_by_clerk_id" TO "created_by_user_id";
  END IF;
END $$;
