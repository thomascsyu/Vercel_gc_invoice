-- Speed up job order and client list/dashboard queries (previously unindexed beyond primary key)

CREATE INDEX IF NOT EXISTS "invoiceplane_job_orders_user_id_idx" ON "invoiceplane_job_orders" ("user_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_job_orders_user_created_idx" ON "invoiceplane_job_orders" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "invoiceplane_job_orders_user_client_idx" ON "invoiceplane_job_orders" ("user_id", "client_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_job_orders_source_idx" ON "invoiceplane_job_orders" ("source_type", "source_id");

CREATE INDEX IF NOT EXISTS "invoiceplane_clients_user_id_idx" ON "invoiceplane_clients" ("user_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_user_created_idx" ON "invoiceplane_clients" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_user_active_idx" ON "invoiceplane_clients" ("user_id", "is_active");
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_user_name_idx" ON "invoiceplane_clients" ("user_id", "name");
