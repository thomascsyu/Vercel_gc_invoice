import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { assertProductionSecurityConfig } from "./productionGuards.js";

const envSnapshot: Record<string, string | undefined> = {};

function saveEnv(keys: string[]) {
  for (const k of keys) {
    envSnapshot[k] = process.env[k];
  }
}

function restoreEnv(keys: string[]) {
  for (const k of keys) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
}

describe("assertProductionSecurityConfig", () => {
  const keys = [
    "NODE_ENV",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "PUBLIC_APP_URL",
    "CORS_ALLOWED_ORIGINS",
    "CORS_RESTRICT",
    "JWT_SECRET",
  ];

  beforeEach(() => saveEnv(keys));
  afterEach(() => restoreEnv(keys));

  it("does not throw outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    assert.doesNotThrow(() => assertProductionSecurityConfig());
  });

  it("throws in production without Google OAuth", () => {
    process.env.NODE_ENV = "production";
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    process.env.PUBLIC_APP_URL = "https://app.example.com";
    process.env.JWT_SECRET = "production-jwt-secret-that-is-at-least-32-chars";
    assert.throws(
      () => assertProductionSecurityConfig(),
      /Google OAuth/i,
    );
  });

  it("throws in production with permissive CORS", () => {
    process.env.NODE_ENV = "production";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://app.example.com/api/auth/google/callback";
    process.env.JWT_SECRET = "production-jwt-secret-that-is-at-least-32-chars";
    delete process.env.PUBLIC_APP_URL;
    delete process.env.CORS_ALLOWED_ORIGINS;
    process.env.CORS_RESTRICT = "false";
    assert.throws(
      () => assertProductionSecurityConfig(),
      /strict CORS/i,
    );
  });
});
