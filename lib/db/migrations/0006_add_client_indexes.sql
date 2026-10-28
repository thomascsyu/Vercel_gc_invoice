-- Performance indexes for client module pagination and search
-- These indexes significantly speed up the clients list query with filtering, sorting and pagination

-- Index for filtering by user_id (most restrictive filter)
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_user_id_idx" ON "invoiceplane_clients" ("user_id");

-- Composite index for user + active status filtering
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_user_active_idx" ON "invoiceplane_clients" ("user_id", "is_active");

-- Index for name searches with ILIKE pattern matching
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_name_idx" ON "invoiceplane_clients" USING btree ("name" text_pattern_ops);

-- Index for email searches
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_email_idx" ON "invoiceplane_clients" USING btree ("email" text_pattern_ops);

-- Composite index for sorting by name within a user's clients (common case)
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_user_name_idx" ON "invoiceplane_clients" ("user_id", "name");

-- Composite index for sorting by client_code
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_user_code_idx" ON "invoiceplane_clients" ("user_id", "client_code");

-- Composite index for sorting by created_at (default sort)
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_user_created_idx" ON "invoiceplane_clients" ("user_id", "created_at" DESC);

-- Full text search index for combined name/email search
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_search_idx" ON "invoiceplane_clients" USING gin (
  to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("email", ''))
);
