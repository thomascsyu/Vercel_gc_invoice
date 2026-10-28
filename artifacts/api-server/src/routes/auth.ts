import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { google } from "googleapis";
import { z } from "zod";
import crypto from "node:crypto";
import { db, usersTable } from "@workspace/db";
import { count, eq, and, sql } from "drizzle-orm";
import { createAccessToken, createRefreshToken, verifyRefreshToken } from "../lib/auth/jwt";
import { setAuthCookies, clearAuthCookies, getAuthCookies } from "../lib/auth/cookies";
import { requireAuth, type AuthedRequest } from "../lib/auth/session";
import {
  getGoogleOAuthConfig,
  isGoogleOAuthConfigured,
  GOOGLE_OAUTH_REDIRECT_PATH,
} from "../lib/auth/google-oauth";
import { authRateLimiter } from "../lib/rateLimit";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use("/auth", authRateLimiter);

function resolveFrontendBase(req: Request): string {
  return (
    process.env["PUBLIC_APP_URL"]?.replace(/\/+$/, "") ||
    `${req.protocol}://${req.get("host") ?? "localhost"}`.replace(/\/+$/, "")
  );
}

/**
 * Same-origin relative redirect paths only. Rejects protocol-relative URLs
 * (e.g. //evil.com), backslashes, null bytes, and non-printable characters.
 */
function isSafeRelativeRedirect(path: string): boolean {
  if (path === "") return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//") || path.includes("\\") || path.includes("\0")) return false;
  return /^\/[\x20-\x7E]*$/.test(path);
}

const OAUTH_STATE_COOKIE = "ip_oauth_state";

function isSecureRequest(req: Request): boolean {
  if (process.env["FORCE_SECURE_COOKIES"]) return true;
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function setOAuthStateCookie(req: Request, res: Response, nonce: string): void {
  res.cookie(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: isSecureRequest(req),
    // Lax is required so the cookie is sent on the top-level GET navigation
    // back from Google to the callback URL (a cross-site redirect).
    sameSite: "lax",
    maxAge: 1000 * 60 * 10, // 10 minutes
    path: "/api/auth",
  });
}

function clearOAuthStateCookie(req: Request, res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: "lax",
    path: "/api/auth",
  });
}

// Google OAuth - Start
router.get("/auth/google", (req: Request, res: Response) => {
  if (!isGoogleOAuthConfigured()) {
    const frontendBase = resolveFrontendBase(req);
    const next = typeof req.query["next"] === "string" ? req.query["next"] : "";
    const nextQs = isSafeRelativeRedirect(next) ? `&next=${encodeURIComponent(next)}` : "";
    return res.redirect(302, `${frontendBase}/login?error=config${nextQs}`);
  }

  const config = getGoogleOAuthConfig()!;
  const oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);

  const next = typeof req.query["next"] === "string" ? req.query["next"] : "/";
  const nonce = crypto.randomBytes(32).toString("base64url");
  const state = Buffer.from(JSON.stringify({ next, nonce })).toString("base64url");

  // Bind the state to an HttpOnly cookie so the callback can verify the flow
  // was initiated by this browser (CSRF protection for the login redirect).
  setOAuthStateCookie(req, res, nonce);

  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["openid", "email", "profile"],
    include_granted_scopes: true,
    state,
  });

  res.redirect(302, authorizeUrl);
});

// Google OAuth - Callback
const GoogleCallbackQuery = z.object({
  code: z.string(),
  state: z.string(),
});

const GoogleErrorQuery = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

router.get("/auth/google/callback", async (req: Request, res: Response) => {
  const frontendBase = resolveFrontendBase(req);

  try {
    // Check for error from Google
    const errorParse = GoogleErrorQuery.safeParse(req.query);
    if (errorParse.success) {
      return res.redirect(302, `${frontendBase}/login?error=oauth&message=${encodeURIComponent(errorParse.data.error)}`);
    }

    const { code, state } = GoogleCallbackQuery.parse(req.query);

    // Decode state
    let next = "/";
    let stateNonce: string | undefined;
    try {
      const stateObj = JSON.parse(Buffer.from(state, "base64url").toString());
      if (typeof stateObj.next === "string") {
        next = stateObj.next;
      }
      if (typeof stateObj.nonce === "string") {
        stateNonce = stateObj.nonce;
      }
    } catch {
      // ignore invalid state
    }

    // CSRF protection: the state nonce must match the cookie set when the flow
    // started, and must be present. Clear the one-time cookie either way.
    const cookieNonce = req.cookies?.[OAUTH_STATE_COOKIE];
    clearOAuthStateCookie(req, res);
    const nonceOk =
      typeof cookieNonce === "string" &&
      typeof stateNonce === "string" &&
      cookieNonce.length > 0 &&
      cookieNonce.length === stateNonce.length &&
      crypto.timingSafeEqual(Buffer.from(cookieNonce), Buffer.from(stateNonce));
    if (!nonceOk) {
      return res.redirect(302, `${frontendBase}/login?error=state`);
    }

    if (!isGoogleOAuthConfigured()) {
      return res.redirect(302, `${frontendBase}/login?error=config`);
    }

    const config = getGoogleOAuthConfig()!;
    const oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      return res.redirect(302, `${frontendBase}/login?error=token`);
    }

    // Get user info from Google
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    if (!userInfo.email) {
      return res.redirect(302, `${frontendBase}/login?error=email`);
    }

    const googleSub = userInfo.id!;
    const email = userInfo.email;
    const fullName = userInfo.name ?? null;

    // Check for hosted domain restriction
    const hostedDomain = process.env["GOOGLE_OAUTH_HOSTED_DOMAIN"];
    if (hostedDomain) {
      const emailDomain = email.split("@")[1];
      if (emailDomain !== hostedDomain) {
        return res.redirect(302, `${frontendBase}/login?error=domain`);
      }
    }

    // Check invite-only mode
    const inviteOnly = ["true", "1", "yes"].includes(process.env["GOOGLE_SIGN_IN_INVITE_ONLY"] ?? "");

    // Find or create user (indexed lookups — avoid full-table select that breaks if schema lags)
    const emailLower = email.toLowerCase();
    const [bySub] = await db.select().from(usersTable).where(eq(usersTable.googleSub, googleSub)).limit(1);
    let user = bySub;
    if (!user) {
      const [byEmail] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
      user = byEmail;
    }

    if (user?.googleSub.startsWith("pending:") && user.googleSub !== googleSub) {
      const [upgraded] = await db
        .update(usersTable)
        .set({ googleSub, fullName: fullName ?? user.fullName, updatedAt: new Date() })
        .where(eq(usersTable.id, user.id))
        .returning();
      user = upgraded ?? user;
    }

    if (!user) {
      if (inviteOnly) {
        const [pendingUser] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.googleSub, `pending:${emailLower}`))
          .limit(1);
        if (!pendingUser) {
          return res.redirect(302, `${frontendBase}/login?error=invite_required`);
        }
        const [updated] = await db
          .update(usersTable)
          .set({ googleSub, fullName, updatedAt: new Date() })
          .where(eq(usersTable.id, pendingUser.id))
          .returning();
        user = updated;
      } else {
        const [{ n: userCount }] = await db.select({ n: count() }).from(usersTable);
        const role = Number(userCount) === 0 ? "admin" : "user";
        const [created] = await db
          .insert(usersTable)
          .values({
            googleSub,
            email,
            fullName,
            role,
          })
          .returning();
        user = created;
      }
    }

    if (!user.isActive) {
      return res.redirect(302, `${frontendBase}/login?error=inactive`);
    }

    // Create tokens
    const tokenPayload = {
      sub: user.googleSub,
      email: user.email,
      role: user.role as "admin" | "user",
      fullName: user.fullName ?? undefined,
    };

    const accessToken = await createAccessToken(tokenPayload);
    const refreshToken = await createRefreshToken(tokenPayload, user.refreshTokenVersion);

    setAuthCookies(res, req, accessToken, refreshToken);

    // Redirect to the next page
    res.redirect(302, `${frontendBase}${isSafeRelativeRedirect(next) ? next : "/"}`);
  } catch (e) {
    logger.error({ err: e }, "Google OAuth error");
    res.redirect(302, `${frontendBase}/login?error=oauth`);
  }
});

// Clear session cookies and invalidate the refresh token server-side.
router.post("/auth/logout", async (req: Request, res: Response) => {
  try {
    const { refresh } = getAuthCookies(req);
    if (refresh) {
      const payload = await verifyRefreshToken(refresh);
      if (payload) {
        await db
          .update(usersTable)
          .set({ refreshTokenVersion: sql`${usersTable.refreshTokenVersion} + 1` })
          .where(eq(usersTable.googleSub, payload.sub));
      }
    }
  } catch (error) {
    // Signing out locally must still succeed when token verification or the database is
    // temporarily unavailable. The cookie is cleared below; server-side revocation remains
    // best-effort and the short-lived access token will expire independently.
    logger.warn({ err: error }, "Could not revoke refresh token during logout");
  }
  clearAuthCookies(res, req);
  res.status(204).send();
});

// Refresh token — rotates the refresh token on every use and rejects reuse
// of an already-rotated one (its embedded version will no longer match the
// user's current version in the database).
router.post("/auth/refresh", async (req: Request, res: Response) => {
  const { refresh } = getAuthCookies(req);
  if (!refresh) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const payload = await verifyRefreshToken(refresh);
  if (!payload) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.googleSub, payload.sub)).limit(1);
  if (!user || !user.isActive || payload.ver !== user.refreshTokenVersion) {
    clearAuthCookies(res, req);
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const [updated] = await db
    .update(usersTable)
    .set({ refreshTokenVersion: sql`${usersTable.refreshTokenVersion} + 1` })
    .where(
      and(
        eq(usersTable.id, user.id),
        eq(usersTable.isActive, true),
        eq(usersTable.refreshTokenVersion, payload.ver),
      ),
    )
    .returning({ refreshTokenVersion: usersTable.refreshTokenVersion });
  if (!updated) {
    clearAuthCookies(res, req);
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const tokenPayload = {
    sub: user.googleSub,
    email: user.email,
    role: user.role as "admin" | "user",
    fullName: user.fullName ?? undefined,
  };
  const newAccessToken = await createAccessToken(tokenPayload);
  const newRefreshToken = await createRefreshToken(tokenPayload, updated.refreshTokenVersion);
  setAuthCookies(res, req, newAccessToken, newRefreshToken);

  return res.json({ success: true });
});

// Get current user
router.get("/auth/me", requireAuth, (req: Request, res: Response) => {
  const user = (req as AuthedRequest).user;
  res.json({
    userId: user.sub,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
  });
});

export default router;
