import { companySettingsTable, db, type GmailAccount } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAuth, type AuthedRequest } from "../../lib/auth/requireAuth";
import { invalidateCompanySettingsCache } from "../../lib/companySettingsCache";
import {
  exchangeCodeForTokens,
  getGmailAddressFromRefreshToken,
  isGmailOAuthConfigured,
  sendViaGmailApi,
  gmailOAuthAuthorizeUrl,
} from "../../lib/gmailApi";
import { resolveGmailForSend } from "../../lib/gmailSettings";
import { signGmailOAuthState, verifyGmailOAuthState } from "../../lib/gmailOAuthState";
import { ensureCompanySettings } from "./helpers";
import { logger } from "../../lib/logger";

const router: IRouter = Router();

// ---------- Gmail OAuth (admin) — must run before global requireAuth so /callback works without a logged-in browser session ----------
router.get("/gmail/oauth/start", requireAuth, async (req, res, next) => {
  try {
    const areq = req as AuthedRequest;
    if (areq.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    if (!isGmailOAuthConfigured()) {
      res.status(503).json({ error: "Gmail OAuth is not configured on the server" });
      return;
    }
    const slot = z.coerce.number().int().min(1).max(3).parse(req.query["slot"]);
    const state = signGmailOAuthState(areq.userId, slot as 1 | 2 | 3);
    const url = gmailOAuthAuthorizeUrl(state);
    res.json({ url });
  } catch (e) {
    next(e);
  }
});

router.get("/gmail/oauth/callback", async (req, res) => {
  const frontendBase =
    process.env["PUBLIC_APP_URL"]?.replace(/\/$/, "") ||
    `${req.protocol}://${req.get("host") ?? "localhost"}`.replace(/\/$/, "");
  const adminUrl = `${frontendBase}/admin?tab=email-gmail&gmail=`;
  try {
    const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
    const stateRaw = typeof req.query["state"] === "string" ? req.query["state"] : "";
    const err = typeof req.query["error"] === "string" ? req.query["error"] : "";
    if (err) {
      res.redirect(302, `${adminUrl}error&reason=${encodeURIComponent(err)}`);
      return;
    }
    if (!code || !stateRaw) {
      res.redirect(302, `${adminUrl}error&reason=${encodeURIComponent("missing_code_or_state")}`);
      return;
    }
    const payload = verifyGmailOAuthState(stateRaw);
    if (!payload) {
      res.redirect(302, `${adminUrl}error&reason=${encodeURIComponent("invalid_state")}`);
      return;
    }
    const tokens = await exchangeCodeForTokens(code);
    const refresh = tokens.refresh_token;
    if (!refresh) {
      res.redirect(302, `${adminUrl}error&reason=${encodeURIComponent("no_refresh_token_retry")}`);
      return;
    }
    const senderEmail = (await getGmailAddressFromRefreshToken(refresh)) ?? "";
    if (!senderEmail) {
      res.redirect(302, `${adminUrl}error&reason=${encodeURIComponent("profile_email")}`);
      return;
    }
    const current = await ensureCompanySettings();
    const existing =
      payload.slot === 1
        ? (current.gmailAccount1 as GmailAccount | null)
        : payload.slot === 2
          ? (current.gmailAccount2 as GmailAccount | null)
          : (current.gmailAccount3 as GmailAccount | null);
    const acc: GmailAccount = {
      senderEmail,
      refreshToken: refresh,
      oauthScopes: tokens.scope ?? undefined,
      signature: existing?.signature,
      senderName: existing?.senderName,
    };
    if (payload.slot === 1) {
      await db
        .update(companySettingsTable)
        .set({ gmailAccount1: acc, updatedAt: new Date() })
        .where(eq(companySettingsTable.id, current.id));
    } else if (payload.slot === 2) {
      await db
        .update(companySettingsTable)
        .set({ gmailAccount2: acc, updatedAt: new Date() })
        .where(eq(companySettingsTable.id, current.id));
    } else {
      await db
        .update(companySettingsTable)
        .set({ gmailAccount3: acc, updatedAt: new Date() })
        .where(eq(companySettingsTable.id, current.id));
    }
    invalidateCompanySettingsCache();
    res.redirect(302, `${adminUrl}ok&slot=${payload.slot}`);
  } catch (e) {
    logger.error({ err: e }, "Gmail OAuth callback failed");
    res.redirect(302, `${adminUrl}error&reason=oauth_failed`);
  }
});

export default router;
