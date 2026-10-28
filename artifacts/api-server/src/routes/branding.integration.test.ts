import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { Express } from "express";
import { createAccessToken } from "../lib/auth/jwt.js";
import { ACCESS_COOKIE } from "../lib/auth/cookies.js";
import { publicObjectRelPathFromStoredUrl } from "../lib/brandingImageUrl.js";

/** 1×1 PNG */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function listen(appInstance: Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = appInstance.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not bind test server"));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
    server.on("error", reject);
  });
}

function multipartBody(fields: { kind: string; file: Buffer; filename: string }): {
  body: Buffer;
  contentType: string;
} {
  const boundary = "----branding-test-boundary";
  const parts: Buffer[] = [];
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${fields.kind}\r\n`,
    ),
  );
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fields.filename}"\r\nContent-Type: image/png\r\n\r\n`,
    ),
  );
  parts.push(fields.file);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

describe("branding upload HTTP routes", () => {
  let server: Server;
  let baseUrl: string;
  let uploadRoot: string;
  let adminCookieHeader: string;
  let dbAvailable = false;
  const savedEnv: Record<string, string | undefined> = {};

  before(async () => {
    uploadRoot = await mkdtemp(path.join(tmpdir(), "branding-test-"));
    for (const key of [
      "DATABASE_URL",
      "JWT_SECRET",
      "LOCAL_PUBLIC_UPLOAD_DIR",
      "PUBLIC_OBJECT_SEARCH_PATHS",
      "PERSIST_LOCAL_UPLOADS",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_OAUTH_REDIRECT_URI",
      "AUTH_DB_FALLBACK",
    ]) {
      savedEnv[key] = process.env[key];
    }

    process.env.AUTH_DB_FALLBACK = "1";
    process.env.DATABASE_URL ??= "postgresql://127.0.0.1:5432/postgres";
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "integration-test-jwt-secret-that-is-at-least-32-chars";
    process.env.LOCAL_PUBLIC_UPLOAD_DIR = uploadRoot;
    delete process.env.PUBLIC_OBJECT_SEARCH_PATHS;
    delete process.env.PERSIST_LOCAL_UPLOADS;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://127.0.0.1/api/auth/google/callback";

    const token = await createAccessToken({
      sub: "branding-test-admin",
      email: "admin@test.local",
      role: "admin",
    });
    adminCookieHeader = `${ACCESS_COOKIE}=${token}`;

    const mod = await import("../app.js");
    ({ server, baseUrl } = await listen(mod.default));

    const probe = await fetch(`${baseUrl}/api/company-settings`, {
      headers: { Cookie: adminCookieHeader },
    });
    dbAvailable = probe.status === 200;
  });

  after(async () => {
    server.close();
    await rm(uploadRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { Cookie: adminCookieHeader, "X-Requested-With": "XMLHttpRequest", ...extra };
  }

  it("GET /api/uploads/branding/storage-status reports non-persistent local fallback", async () => {
    const res = await fetch(`${baseUrl}/api/uploads/branding/storage-status`, {
      headers: authHeaders(),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { persistent: boolean; backend: string };
    assert.equal(data.persistent, false);
    assert.equal(data.backend, "local-ephemeral");
  });

  it("GET /api/uploads/branding/storage-status reports persistent when PERSIST_LOCAL_UPLOADS=1", async () => {
    const prev = process.env.PERSIST_LOCAL_UPLOADS;
    process.env.PERSIST_LOCAL_UPLOADS = "1";
    try {
      const res = await fetch(`${baseUrl}/api/uploads/branding/storage-status`, {
        headers: authHeaders(),
      });
      assert.equal(res.status, 200);
      const data = (await res.json()) as { persistent: boolean; backend: string };
      assert.equal(data.persistent, true);
      assert.equal(data.backend, "local-volume");
    } finally {
      if (prev === undefined) delete process.env.PERSIST_LOCAL_UPLOADS;
      else process.env.PERSIST_LOCAL_UPLOADS = prev;
    }
  });

  it("POST /api/uploads/branding rejects invalid kind", async () => {
    const { body, contentType } = multipartBody({ kind: "invalid", file: TINY_PNG, filename: "x.png" });
    const res = await fetch(`${baseUrl}/api/uploads/branding`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": contentType }),
      body,
    });
    assert.equal(res.status, 400);
  });

  it("POST /api/uploads/branding rejects corrupt image", async () => {
    const { body, contentType } = multipartBody({
      kind: "company_logo",
      file: Buffer.from("not-an-image"),
      filename: "bad.png",
    });
    const res = await fetch(`${baseUrl}/api/uploads/branding`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": contentType }),
      body,
    });
    assert.equal(res.status, 400);
  });

  it("POST /api/uploads/branding stores PNG under branding/ folder", async () => {
    const { body, contentType } = multipartBody({
      kind: "header_logo",
      file: TINY_PNG,
      filename: "banner.png",
    });
    const res = await fetch(`${baseUrl}/api/uploads/branding`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": contentType }),
      body,
    });
    assert.equal(res.status, 201);
    const data = (await res.json()) as { url: string; kind: string };
    assert.equal(data.kind, "header_logo");
    assert.match(data.url, /^\/api\/storage\/public-objects\/branding\/header-logo\/[0-9a-f-]+\.png$/);
    const rel = publicObjectRelPathFromStoredUrl(data.url);
    assert.ok(rel);
    assert.equal(await fileExists(path.join(uploadRoot, rel)), true);
  });

  it("POST /api/uploads/branding accepts company_chop kind", async () => {
    const { body, contentType } = multipartBody({
      kind: "company_chop",
      file: TINY_PNG,
      filename: "chop.png",
    });
    const res = await fetch(`${baseUrl}/api/uploads/branding`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": contentType }),
      body,
    });
    assert.equal(res.status, 201);
    const data = (await res.json()) as { url: string; kind: string };
    assert.equal(data.kind, "company_chop");
    assert.match(data.url, /^\/api\/storage\/public-objects\/branding\/company-chop\/[0-9a-f-]+\.png$/);
    const rel = publicObjectRelPathFromStoredUrl(data.url);
    assert.ok(rel);
    assert.equal(await fileExists(path.join(uploadRoot, rel)), true);
  });

  it("POST /api/uploads/branding/abandon removes staged file", async () => {
    const { body, contentType } = multipartBody({
      kind: "company_chop",
      file: TINY_PNG,
      filename: "chop.png",
    });
    const uploadRes = await fetch(`${baseUrl}/api/uploads/branding`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": contentType }),
      body,
    });
    assert.equal(uploadRes.status, 201);
    const { url } = (await uploadRes.json()) as { url: string };
    const rel = publicObjectRelPathFromStoredUrl(url);
    assert.ok(rel);
    const abs = path.join(uploadRoot, rel);
    assert.equal(await fileExists(abs), true);

    const abandonRes = await fetch(`${baseUrl}/api/uploads/branding/abandon`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ url }),
    });
    assert.equal(abandonRes.status, 204);
    assert.equal(await fileExists(abs), false);
  });

  it("upload → PATCH settings → replace deletes prior file → remove clears settings", async (t) => {
    if (!dbAvailable) {
      t.skip("PostgreSQL with invoiceplane schema is not available");
      return;
    }

    async function upload(kind: "company_logo" | "header_logo" | "company_chop") {
      const { body, contentType } = multipartBody({ kind, file: TINY_PNG, filename: "logo.png" });
      const res = await fetch(`${baseUrl}/api/uploads/branding`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": contentType }),
        body,
      });
      assert.equal(res.status, 201);
      const data = (await res.json()) as { url: string };
      return data.url;
    }

    const firstUrl = await upload("company_logo");
    const firstRel = publicObjectRelPathFromStoredUrl(firstUrl);
    assert.ok(firstRel);
    const firstAbs = path.join(uploadRoot, firstRel);

    let patchRes = await fetch(`${baseUrl}/api/company-settings`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ logoUrl: firstUrl }),
    });
    assert.equal(patchRes.status, 200);
    let settings = (await patchRes.json()) as {
      logoUrl?: string;
      headerLogoUrl?: string;
      headerLogoScale?: number;
      chopUrl?: string;
      chopScale?: number;
    };
    assert.equal(settings.logoUrl, firstUrl);
    assert.equal(await fileExists(firstAbs), true);

    const secondUrl = await upload("company_logo");
    patchRes = await fetch(`${baseUrl}/api/company-settings`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ logoUrl: secondUrl }),
    });
    assert.equal(patchRes.status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await fileExists(firstAbs), false);

    const headerUrl = await upload("header_logo");
    patchRes = await fetch(`${baseUrl}/api/company-settings`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ headerLogoUrl: headerUrl, headerLogoScale: 1.5 }),
    });
    assert.equal(patchRes.status, 200);
    settings = (await patchRes.json()) as typeof settings;
    assert.equal(settings.headerLogoUrl, headerUrl);
    assert.equal(settings.headerLogoScale, 1.5);

    const chopUrl = await upload("company_chop");
    assert.match(chopUrl, /^\/api\/storage\/public-objects\/branding\/company-chop\/[0-9a-f-]+\.png$/);
    patchRes = await fetch(`${baseUrl}/api/company-settings`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ chopUrl, chopScale: 1.25 }),
    });
    assert.equal(patchRes.status, 200);
    settings = (await patchRes.json()) as typeof settings;
    assert.equal(settings.chopUrl, chopUrl);
    assert.equal(settings.chopScale, 1.25);

    patchRes = await fetch(`${baseUrl}/api/company-settings`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ logoUrl: null, headerLogoUrl: null, chopUrl: null }),
    });
    assert.equal(patchRes.status, 200);
    settings = (await patchRes.json()) as typeof settings;
    assert.equal(settings.logoUrl, undefined);
    assert.equal(settings.headerLogoUrl, undefined);
    assert.equal(settings.chopUrl, undefined);

    const chopRel = publicObjectRelPathFromStoredUrl(chopUrl);
    assert.ok(chopRel);
    assert.equal(await fileExists(path.join(uploadRoot, chopRel)), false);
  });
});
