import { companySettingsTable, db, usersTable } from "@workspace/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getCompanySettings, invalidateCompanySettingsCache } from "./companySettingsCache";
import { logger } from "./logger";
import type { AuthedRequest } from "./auth/requireAuth";

const CACHE_TTL_MS = 60_000;

let cachedDataUserId: string | undefined;
let cachedAt = 0;
let warnedInvalidEnvSub: string | undefined;

function envWorkspaceDataUserId(): string | undefined {
  const raw = process.env["WORKSPACE_DATA_USER_ID"]?.trim();
  return raw || undefined;
}

async function userExists(googleSub: string): Promise<boolean> {
  const [row] = await db
    .select({ googleSub: usersTable.googleSub })
    .from(usersTable)
    .where(eq(usersTable.googleSub, googleSub))
    .limit(1);
  return Boolean(row);
}

async function oldestAdminOrUser(): Promise<string> {
  const [admin] = await db
    .select({ googleSub: usersTable.googleSub })
    .from(usersTable)
    .where(and(eq(usersTable.isActive, true), eq(usersTable.role, "admin")))
    .orderBy(asc(usersTable.createdAt))
    .limit(1);
  if (admin) return admin.googleSub;

  const [anyUser] = await db
    .select({ googleSub: usersTable.googleSub })
    .from(usersTable)
    .orderBy(asc(usersTable.createdAt))
    .limit(1);
  if (anyUser) return anyUser.googleSub;

  throw new Error(
    "Cannot resolve workspace data user: no invoiceplane_users row and WORKSPACE_DATA_USER_ID is unset.",
  );
}

/**
 * Picks the oldest admin once and pins it in company settings so the owner never
 * drifts when roles or activation change later. Only fills a NULL column, so
 * concurrent instances converge on whichever value was written first.
 */
async function pinFallbackWorkspaceDataUserId(): Promise<string> {
  const candidate = await oldestAdminOrUser();
  const [pinned] = await db
    .update(companySettingsTable)
    .set({ workspaceDataUserId: candidate })
    .where(isNull(companySettingsTable.workspaceDataUserId))
    .returning({ workspaceDataUserId: companySettingsTable.workspaceDataUserId });
  invalidateCompanySettingsCache();
  if (pinned?.workspaceDataUserId) {
    logger.warn(
      { workspaceDataUserId: pinned.workspaceDataUserId },
      "workspace_data_user_id was unset; pinned the oldest admin as the workspace data owner",
    );
    return pinned.workspaceDataUserId;
  }
  const settings = await getCompanySettings({ fresh: true });
  const existing = settings?.workspaceDataUserId?.trim();
  if (existing) return existing;
  // No company settings row yet — use the candidate without pinning; the next
  // resolution after settings are created will pin it.
  return candidate;
}

/**
 * Google sub used to scope all shared business records.
 * Precedence: WORKSPACE_DATA_USER_ID env (if it names a real user) →
 * company_settings.workspace_data_user_id → oldest admin (pinned into company settings).
 */
export async function resolveWorkspaceDataUserId(): Promise<string> {
  const now = Date.now();
  if (cachedDataUserId && now - cachedAt < CACHE_TTL_MS) {
    return cachedDataUserId;
  }

  let resolved: string | undefined;

  const fromEnv = envWorkspaceDataUserId();
  if (fromEnv) {
    if (await userExists(fromEnv)) {
      resolved = fromEnv;
    } else if (warnedInvalidEnvSub !== fromEnv) {
      warnedInvalidEnvSub = fromEnv;
      logger.error(
        { workspaceDataUserId: fromEnv },
        "WORKSPACE_DATA_USER_ID does not match any invoiceplane_users.google_sub; ignoring it",
      );
    }
  }

  if (!resolved) {
    const settings = await getCompanySettings();
    resolved = settings?.workspaceDataUserId?.trim() || (await pinFallbackWorkspaceDataUserId());
  }

  cachedDataUserId = resolved;
  cachedAt = now;
  return resolved;
}

export function invalidateWorkspaceDataUserCache(): void {
  cachedDataUserId = undefined;
  cachedAt = 0;
}

export function invalidateWorkspaceScopeCaches(): void {
  invalidateCompanySettingsCache();
  invalidateWorkspaceDataUserCache();
}

/** Attach `dataUserId` on an authenticated request (call after session/API key resolution). */
export async function attachWorkspaceDataUserId(areq: AuthedRequest): Promise<void> {
  areq.dataUserId = await resolveWorkspaceDataUserId();
}
