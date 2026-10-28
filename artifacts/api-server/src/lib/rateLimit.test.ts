import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Server } from "node:http";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  createPublicRateLimitGate,
  isPublicRateLimitedPath,
  shouldSkipSharedApiRateLimit,
} from "./rateLimitPaths.ts";

const here = dirname(fileURLToPath(import.meta.url));

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
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

/**
 * Exercises the exact mounting pattern used in app.ts/rateLimit.ts (a limiter
 * mounted via `router.use(limiter)`, standardHeaders on, JSON error body) —
 * with a throwaway low limit so the test doesn't need hundreds of requests.
 * Confirms our usage of express-rate-limit actually blocks at the configured
 * threshold and returns the expected shape, without touching the real
 * production limits in rateLimit.ts.
 */
test("a mounted rate limiter rejects requests past its limit with 429 and the configured message", async () => {
  const app = express();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
  });
  app.use(limiter);
  app.get("/ping", (_req, res) => res.json({ ok: true }));

  const { server, baseUrl } = await listen(app);
  try {
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/ping`);
      results.push(res.status);
      if (res.status === 429) {
        const body = (await res.json()) as { error?: string };
        assert.match(body.error ?? "", /too many requests/i);
      }
    }
    assert.deepEqual(results, [200, 200, 200, 429, 429]);
  } finally {
    server.close();
  }
});

test("isPublicRateLimitedPath matches only unauthenticated endpoints", () => {
  assert.equal(isPublicRateLimitedPath("/clients/import/template"), true);
  assert.equal(isPublicRateLimitedPath("/invoices/abc/pdf/public"), true);
  assert.equal(isPublicRateLimitedPath("/quotations/abc/pdf/public"), true);
  assert.equal(isPublicRateLimitedPath("/proposals/abc/public"), true);
  assert.equal(isPublicRateLimitedPath("/proposals/abc/pdf/public"), true);
  assert.equal(isPublicRateLimitedPath("/proposals/abc/public/confirm"), true);

  assert.equal(isPublicRateLimitedPath("/clients"), false);
  assert.equal(isPublicRateLimitedPath("/clients/options"), false);
  assert.equal(isPublicRateLimitedPath("/clients/import"), false);
  assert.equal(isPublicRateLimitedPath("/clients/import/jobs/job-1"), false);
  assert.equal(isPublicRateLimitedPath("/invoices"), false);
  assert.equal(isPublicRateLimitedPath("/invoices/abc/pdf"), false);
  assert.equal(isPublicRateLimitedPath("/proposals"), false);
  assert.equal(isPublicRateLimitedPath("/proposals/abc"), false);
  assert.equal(isPublicRateLimitedPath("/proposals/abc/pdf"), false);
});

test("shouldSkipSharedApiRateLimit leaves the Clients list on the shared budget", () => {
  assert.equal(shouldSkipSharedApiRateLimit("/clients"), false);
  assert.equal(shouldSkipSharedApiRateLimit("/clients/import"), false);
  assert.equal(shouldSkipSharedApiRateLimit("/clients/import/jobs"), false);
  assert.equal(shouldSkipSharedApiRateLimit("/clients/import/jobs/job-1/extra"), false);

  assert.equal(shouldSkipSharedApiRateLimit("/clients/import/jobs/job-1"), true);
  assert.equal(shouldSkipSharedApiRateLimit("/pdf-document-layouts"), true);
  assert.equal(shouldSkipSharedApiRateLimit("/pdf-document-layouts/preview"), true);
});

/**
 * Reproduces invoiceplane/index.ts: the public router is mounted with
 * `router.use` ahead of `GET /clients`. The gate must not count that list
 * request. A bare limiter on the public router would 429 it.
 */
test("the public rate-limit gate does not throttle GET /clients mounted behind it", async () => {
  const app = express();
  const api = Router();
  const publicRouter = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 2,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
  });
  publicRouter.use(createPublicRateLimitGate(limiter));
  publicRouter.get("/clients/import/template", (_req, res) => res.json({ template: true }));
  publicRouter.get("/invoices/:id/pdf/public", (_req, res) => res.json({ pdf: true }));
  api.use(publicRouter);
  api.get("/clients", (_req, res) => res.json({ ok: true }));
  api.get("/clients/import/jobs/:jobId", (_req, res) => res.json({ status: "running" }));
  app.use("/api", api);

  const { server, baseUrl } = await listen(app);
  try {
    const clientStatuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      clientStatuses.push((await fetch(`${baseUrl}/api/clients`)).status);
    }
    assert.deepEqual(clientStatuses, [200, 200, 200, 200, 200]);

    const jobStatuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      jobStatuses.push((await fetch(`${baseUrl}/api/clients/import/jobs/job-1`)).status);
    }
    assert.deepEqual(jobStatuses, [200, 200, 200, 200, 200]);

    const templateStatuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${baseUrl}/api/clients/import/template`);
      templateStatuses.push(res.status);
      if (res.status === 429) {
        const body = (await res.json()) as { error?: string };
        assert.match(body.error ?? "", /too many requests/i);
      }
    }
    assert.deepEqual(templateStatuses, [200, 200, 429, 429]);

    const pdfStatuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      pdfStatuses.push((await fetch(`${baseUrl}/api/invoices/inv-1/pdf/public`)).status);
    }
    assert.deepEqual(pdfStatuses, [429, 429, 429]);
  } finally {
    server.close();
  }
});

test("a bare public limiter mounted ahead of /clients would 429 the Clients list", async () => {
  const app = express();
  const api = Router();
  const publicRouter = Router();
  publicRouter.use(
    rateLimit({
      windowMs: 60_000,
      limit: 2,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests. Please try again later." },
    }),
  );
  publicRouter.get("/clients/import/template", (_req, res) => res.type("text/plain").send("template"));
  api.use(publicRouter);
  api.get("/clients", (_req, res) => res.json({ ok: true }));
  app.use("/api", api);

  const { server, baseUrl } = await listen(app);
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await fetch(`${baseUrl}/api/clients`)).status);
    }
    assert.deepEqual(statuses, [200, 200, 429, 429]);
  } finally {
    server.close();
  }
});

test("client import job polling is skipped by the shared API limiter and limited on its own", async () => {
  const app = express();
  const shared = rateLimit({
    windowMs: 60_000,
    limit: 2,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
    skip: (req) => shouldSkipSharedApiRateLimit(req.path),
  });
  const jobLimiter = rateLimit({
    windowMs: 60_000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
  });
  app.use("/api", shared);
  app.get("/api/clients", (_req, res) => res.json({ ok: true }));
  app.get("/api/clients/import/jobs/:jobId", jobLimiter, (_req, res) => res.json({ status: "running" }));

  const { server, baseUrl } = await listen(app);
  try {
    const jobStatuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      jobStatuses.push((await fetch(`${baseUrl}/api/clients/import/jobs/job-1`)).status);
    }
    assert.deepEqual(jobStatuses, [200, 200, 200, 429, 429]);

    const listStatuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      listStatuses.push((await fetch(`${baseUrl}/api/clients`)).status);
    }
    assert.deepEqual(listStatuses, [200, 200, 429]);
  } finally {
    server.close();
  }
});

test("public routers mount the gate rather than the limiter itself", () => {
  for (const relativePath of [
    "../routes/invoiceplane/public.ts",
    "../routes/proposals/public.ts",
  ]) {
    const source = readFileSync(pathResolve(here, relativePath), "utf8");
    assert.match(source, /publicRateLimitGate/);
    assert.doesNotMatch(source, /router\.use\(publicRateLimiter\)/);
  }
  const clients = readFileSync(pathResolve(here, "../routes/invoiceplane/clients.ts"), "utf8");
  assert.match(clients, /\/clients\/import\/jobs\/:jobId", clientImportJobRateLimiter/);
});
