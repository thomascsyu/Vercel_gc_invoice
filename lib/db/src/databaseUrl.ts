function trimEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function encodeUserinfo(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Build a URL from `POSTGRES_HOST`, `POSTGRES_USER` / `POSTGRES_USERNAME`,
 * `POSTGRES_PASSWORD`, and `POSTGRES_DATABASE` / `POSTGRES_DB`. Returns
 * undefined when required parts are missing.
 */
export function buildDatabaseUrlFromPostgresParts(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const host = env.POSTGRES_HOST?.trim();
  const port = env.POSTGRES_PORT?.trim() || "5432";
  const username = env.POSTGRES_USERNAME?.trim() || env.POSTGRES_USER?.trim();
  const password = env.POSTGRES_PASSWORD?.trim();
  const database = env.POSTGRES_DATABASE?.trim() || env.POSTGRES_DB?.trim();

  if (!host || !username || password === undefined || !database) {
    return undefined;
  }

  return `postgresql://${encodeUserinfo(username)}:${encodeUserinfo(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

/**
 * PostgreSQL URL from env.
 *
 * On the Ubuntu VM, set `DATABASE_URL` to local Postgres or the ApsaraDB RDS
 * endpoint. Injected `POSTGRES_CONNECTION_STRING` / `POSTGRES_URI` / `POSTGRES_*`
 * parts still win when present, so a stale `DATABASE_URL` cannot override a
 * platform-provided connection string.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url =
    trimEnv(env, "POSTGRES_CONNECTION_STRING") ||
    trimEnv(env, "POSTGRES_URI") ||
    buildDatabaseUrlFromPostgresParts(env) ||
    trimEnv(env, "DATABASE_URL");

  if (!url) {
    throw new Error(
      "DATABASE_URL must be set (or provide POSTGRES_CONNECTION_STRING / POSTGRES_URI / POSTGRES_HOST, user, password, and database). Did you forget to provision a database?",
    );
  }
  return url;
}
