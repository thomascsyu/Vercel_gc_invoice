import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDatabaseUrlFromPostgresParts,
  resolveDatabaseUrl,
} from "@workspace/db/database-url";

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void,
): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("resolveDatabaseUrl prefers POSTGRES_CONNECTION_STRING over stale DATABASE_URL", () => {
  withEnv(
    {
      DATABASE_URL: "postgresql://root:old@10.43.187.64:5432/zeabur",
      POSTGRES_CONNECTION_STRING:
        "postgresql://root:secret@postgresql.zeabur.internal:5432/zeabur",
      POSTGRES_URI: undefined,
      POSTGRES_HOST: undefined,
      POSTGRES_PORT: undefined,
      POSTGRES_USERNAME: undefined,
      POSTGRES_PASSWORD: undefined,
      POSTGRES_DATABASE: undefined,
    },
    () => {
      assert.equal(
        resolveDatabaseUrl(),
        "postgresql://root:secret@postgresql.zeabur.internal:5432/zeabur",
      );
    },
  );
});

test("resolveDatabaseUrl falls back to DATABASE_URL for local dev", () => {
  withEnv(
    {
      DATABASE_URL: "postgresql://dev:dev@127.0.0.1:5432/invoiceplane",
      POSTGRES_CONNECTION_STRING: undefined,
      POSTGRES_URI: undefined,
      POSTGRES_HOST: undefined,
      POSTGRES_PORT: undefined,
      POSTGRES_USERNAME: undefined,
      POSTGRES_PASSWORD: undefined,
      POSTGRES_DATABASE: undefined,
    },
    () => {
      assert.equal(
        resolveDatabaseUrl(),
        "postgresql://dev:dev@127.0.0.1:5432/invoiceplane",
      );
    },
  );
});

test("buildDatabaseUrlFromPostgresParts composes POSTGRES_* host parts", () => {
  const url = buildDatabaseUrlFromPostgresParts({
    POSTGRES_HOST: "postgresql.zeabur.internal",
    POSTGRES_PORT: "5432",
    POSTGRES_USERNAME: "root",
    POSTGRES_PASSWORD: "p@ss:word",
    POSTGRES_DATABASE: "zeabur",
  });
  assert.equal(
    url,
    "postgresql://root:p%40ss%3Aword@postgresql.zeabur.internal:5432/zeabur",
  );
});

test("resolveDatabaseUrl builds from POSTGRES_* when connection string vars are absent", () => {
  withEnv(
    {
      DATABASE_URL: "postgresql://root:old@10.43.187.64:5432/zeabur",
      POSTGRES_CONNECTION_STRING: undefined,
      POSTGRES_URI: undefined,
      POSTGRES_HOST: "postgresql.zeabur.internal",
      POSTGRES_PORT: "5432",
      POSTGRES_USERNAME: "root",
      POSTGRES_PASSWORD: "fresh",
      POSTGRES_DATABASE: "zeabur",
    },
    () => {
      assert.equal(
        resolveDatabaseUrl(),
        "postgresql://root:fresh@postgresql.zeabur.internal:5432/zeabur",
      );
    },
  );
});

test("resolveDatabaseUrl throws when no database env is configured", () => {
  withEnv(
    {
      DATABASE_URL: undefined,
      POSTGRES_CONNECTION_STRING: undefined,
      POSTGRES_URI: undefined,
      POSTGRES_HOST: undefined,
      POSTGRES_PORT: undefined,
      POSTGRES_USERNAME: undefined,
      POSTGRES_PASSWORD: undefined,
      POSTGRES_DATABASE: undefined,
    },
    () => {
      assert.throws(() => resolveDatabaseUrl(), /DATABASE_URL must be set/);
    },
  );
});
