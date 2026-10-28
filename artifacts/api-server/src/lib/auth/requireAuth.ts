import type { Request, Response, NextFunction } from "express";
import { and, eq, gt } from "drizzle-orm";
import { apiKeysTable, db, usersTable } from "@workspace/db";
import { getSession } from "./session";
import { isGoogleOAuthConfigured } from "./google-oauth";
import { getCanonicalUserRow } from "../canonicalUser";
import { logger } from "../logger";
import { withConnectionRetry } from "../withConnectionRetry";
import {
  getApiKeyFromRequestHeader,
  hashApiKey,
  type ApiKeyPermission,
} from "./apiKey";

export type AuthedRequest = Request & {
  userId: string;
  role: "admin" | "user";
  authType?: "session" | "api_key";
  apiKeyPermission?: ApiKeyPermission;
};

export type ResolvedUser = { userId: string; role: "admin" | "user" };

export type ResolveAuthedUserResult =
  | ResolvedUser
  | { deactivated: true }
  | { dbUnavailable: true };

function authDbFallbackEnabled(): boolean {
  return process.env.AUTH_DB_FALLBACK === "1";
}

/**
 * Resolve the authenticated user for a request.
 *
 * 1. A valid signed session cookie always wins, but the session's `invoiceplane_users`
 *    row must exist and be active — a session for a user that was hard-deleted
 *    (or never persisted) is rejected, since callers rely on `userId` referencing
 *    a real row (it's now a DB foreign key target) (role changes also take effect
 *    from the DB rather than the JWT).
 * 2. When (and only when) Google OAuth is NOT configured, fall back to the
 *    single canonical workspace user. This keeps local/dev single-user mode
 *    working without a login provider.
 * 3. Otherwise the request is unauthenticated and the caller must reject it.
 *
 * When the DB is unreachable during the session lookup, the request fails closed
 * (503) unless `AUTH_DB_FALLBACK=1` is set (local/test only).
 */
export async function resolveAuthedUser(
  req: Request,
): Promise<ResolveAuthedUserResult | null> {
  const session = await getSession(req);
  if (session) {
    try {
      const [row] = await withConnectionRetry(() =>
        db
          .select({ isActive: usersTable.isActive, role: usersTable.role })
          .from(usersTable)
          .where(eq(usersTable.googleSub, session.sub))
          .limit(1),
      );
      if (!row) {
        logger.warn(
          { sub: session.sub },
          "Session references a user row that no longer exists",
        );
        return null;
      }
      if (!row.isActive) {
        return { deactivated: true };
      }
      const role =
        row.role === "admin" || row.role === "user" ? row.role : session.role;
      return { userId: session.sub, role };
    } catch (err) {
      if (authDbFallbackEnabled()) {
        logger.warn(
          { err, sub: session.sub },
          "Could not verify user isActive; using session claims",
        );
        return { userId: session.sub, role: session.role };
      }
      logger.error(
        { err, sub: session.sub },
        "Could not verify session against database",
      );
      return { dbUnavailable: true };
    }
  }

  if (!isGoogleOAuthConfigured()) {
    try {
      const row = await withConnectionRetry(() => getCanonicalUserRow());
      if (!row.isActive) {
        return { deactivated: true };
      }
      return { userId: row.googleSub, role: row.role as "admin" | "user" };
    } catch (err) {
      if (authDbFallbackEnabled()) {
        logger.warn(
          { err },
          "Could not load canonical user; treating request as unauthenticated",
        );
        return null;
      }
      logger.error({ err }, "Could not load canonical user from database");
      return { dbUnavailable: true };
    }
  }

  return null;
}

function isDeactivated(
  result: ResolveAuthedUserResult | null,
): result is { deactivated: true } {
  return Boolean(result && "deactivated" in result);
}

function isDbUnavailable(
  result: ResolveAuthedUserResult | null,
): result is { dbUnavailable: true } {
  return Boolean(result && "dbUnavailable" in result);
}

/** Express middleware: attaches `userId`/`role` or responds 401. */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const suppliedApiKey = getApiKeyFromRequestHeader(req.get("x-api-key"));
  if (suppliedApiKey) {
    withConnectionRetry(() =>
      db
        .select({
          id: apiKeysTable.id,
          userId: apiKeysTable.createdByUserId,
          permission: apiKeysTable.permission,
          role: usersTable.role,
          isActive: usersTable.isActive,
        })
        .from(apiKeysTable)
        .innerJoin(
          usersTable,
          eq(usersTable.googleSub, apiKeysTable.createdByUserId),
        )
        .where(
          and(
            eq(apiKeysTable.tokenHash, hashApiKey(suppliedApiKey)),
            eq(apiKeysTable.revoked, false),
            gt(apiKeysTable.expiresAt, new Date()),
          ),
        )
        .limit(1),
    )
      .then(async ([key]) => {
        if (!key || !key.isActive) {
          res
            .status(401)
            .json({ error: "Invalid, expired, or revoked API key" });
          return;
        }
        if (
          key.permission === "read" &&
          !["GET", "HEAD", "OPTIONS"].includes(req.method)
        ) {
          res.status(403).json({ error: "This API key has read-only access" });
          return;
        }
        const areq = req as AuthedRequest;
        areq.userId = key.userId;
        areq.role = key.role === "admin" ? "admin" : "user";
        areq.authType = "api_key";
        areq.apiKeyPermission =
          key.permission === "read" ? "read" : "read_write";
        await db
          .update(apiKeysTable)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeysTable.id, key.id));
        next();
      })
      .catch((e) => next(e));
    return;
  }
  resolveAuthedUser(req)
    .then((user) => {
      if (isDbUnavailable(user)) {
        res
          .status(503)
          .json({ error: "Authentication service temporarily unavailable" });
        return;
      }
      if (isDeactivated(user)) {
        res.status(401).json({ error: "Account deactivated" });
        return;
      }
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const areq = req as AuthedRequest;
      areq.userId = user.userId;
      areq.role = user.role;
      areq.authType = "session";
      next();
    })
    .catch((e) => next(e));
}
