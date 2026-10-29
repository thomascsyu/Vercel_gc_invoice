import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDatabaseUrl } from "./databaseUrl";

const { Pool } = pg;

const databaseUrl = resolveDatabaseUrl();

// Each Vercel Function instance gets its own pool, and many instances can run
// at once, so keep per-instance pools small and release idle clients quickly.
// Point DATABASE_URL at a pooled endpoint (PgBouncer / Neon / Supabase pooler).
const isServerless = Boolean(process.env.VERCEL);

/**
 * Shared pg pool for Drizzle. Tuned for managed Postgres (ApsaraDB RDS and
 * similar) where restarts and idle-connection cleanup emit SQLSTATE 57P01
 * ("terminating connection due to administrator command") on stale clients.
 */
export const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.PG_POOL_MAX ?? (isServerless ? 5 : 20)),
  idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_TIMEOUT_MS ?? (isServerless ? 5_000 : 30_000)),
  connectionTimeoutMillis: Number(process.env.PG_POOL_CONNECT_TIMEOUT_MS ?? 5_000),
  // Detect dead TCP peers before checkout; helps after DB pod restarts.
  keepAlive: process.env.PG_POOL_KEEPALIVE !== "false",
  keepAliveInitialDelayMillis: Number(process.env.PG_POOL_KEEPALIVE_DELAY_MS ?? 10_000),
  // Recycle connections before the server/pooler force-kills long-lived ones.
  maxLifetimeSeconds: Number(process.env.PG_POOL_MAX_LIFETIME_SECONDS ?? 1_800),
});

// Without this handler, idle-client 57P01 errors become uncaught exceptions and
// can crash the Node process after a Postgres restart or admin terminate.
pool.on("error", (err) => {
  console.error("[pg-pool] idle client discarded after connection error:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
