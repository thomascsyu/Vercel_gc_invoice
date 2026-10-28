import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { createCorsOptions } from "./lib/corsConfig";
import { logger } from "./lib/logger";
import { requireCsrfHeader } from "./lib/csrf";
import { apiRateLimiter } from "./lib/rateLimit";
import { isZodError } from "./lib/zodError";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Built InvoicePlane assets (Vite `outDir`: `artifacts/invoiceplane/dist/public`).
 * When set (or auto-detected next to the repo layout), the same process serves
 * the SPA and `/api`, which fixes static-only hosts that returned HTML for `/api/*`.
 */
function resolveInvoiceplaneStaticRoot(): string | null {
  const fromEnv = process.env["INVOICEPLANE_STATIC_ROOT"]?.trim();
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    if (existsSync(path.join(resolved, "index.html"))) return resolved;
    logger.warn(
      { INVOICEPLANE_STATIC_ROOT: fromEnv },
      "INVOICEPLANE_STATIC_ROOT set but index.html not found; skipping static serving",
    );
  }
  const candidates = [
    path.resolve(__dirname, "../../invoiceplane/dist/public"),
    path.resolve(process.cwd(), "../invoiceplane/dist/public"),
    path.resolve(process.cwd(), "artifacts/invoiceplane/dist/public"),
  ];
  for (const p of candidates) {
    if (existsSync(path.join(p, "index.html"))) return p;
  }
  return null;
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// `true` trusts an unlimited chain of X-Forwarded-For entries, which lets any
// client spoof its apparent IP outright (defeats IP-based rate limiting, and
// feeds req.secure used by the cookie/CSRF logic). Trust a fixed number of
// hops instead — 1 matches this app's documented single-reverse-proxy
// deployment (nginx, or nginx behind an Alibaba SLB). Override via
// TRUST_PROXY_HOPS when more than one proxy appends X-Forwarded-For.
const trustProxyHops = Number(process.env["TRUST_PROXY_HOPS"] ?? "1");
app.set("trust proxy", Number.isInteger(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1);

// Baseline security headers. CSP is disabled because the SPA loads Google
// Identity Services and inline Vite assets; CORP is relaxed to cross-origin so
// public assets/PDFs can still be embedded. The remaining defaults (HSTS,
// nosniff, frameguard SAMEORIGIN, referrer-policy, etc.) are safe to keep.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(cors(createCorsOptions()));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// API routes must be before static file serving
app.use("/api", apiRateLimiter, requireCsrfHeader, router);

const staticRoot = resolveInvoiceplaneStaticRoot();
if (staticRoot) {
  logger.info({ staticRoot }, "Serving InvoicePlane static assets from API process");
  // Static files - explicitly exclude /api from static serving
  app.use("/", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    express.static(staticRoot, {
      index: false,
      /**
       * Avoid stale SPA shells after deploy: HTML must not be cached by browsers or CDNs.
       * Hashed Vite chunks under `/assets/` are safe to cache immutably (filename changes each build).
       */
      setHeaders(res, filePath) {
        const base = path.basename(filePath);
        if (base === "index.html") {
          res.setHeader(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate",
          );
          return;
        }
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })(req, res, next);
  });
  // SPA fallback - only for non-API routes
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      // For API routes that weren't matched, return 404 JSON
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(404).send("Not found");
      return;
    }
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.sendFile(path.join(staticRoot, "index.html"), (err) => {
      if (err) next(err);
    });
  });
} else {
  logger.warn(
    "InvoicePlane build not found beside API (no index.html). Only /api is served — build the frontend in the Docker image or set INVOICEPLANE_STATIC_ROOT.",
  );
}

// Central error handler. Must be registered last and keep the 4-arg signature
// so Express treats it as an error handler. Avoids leaking stack traces to
// clients while still logging the full error server-side.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) {
    return;
  }
  if (isZodError(err)) {
    res.status(400).json({ error: "Validation failed" });
    return;
  }
  logger.error({ err, path: req.path }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

export default app;
