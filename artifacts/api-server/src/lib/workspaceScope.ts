import { db, usersTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import type { Request } from "express";
import { getCompanySettings, invalidateCompanySettingsCache } from "./companySettingsCache";
import { logger } from "./logger";
import type { AuthedRequest } from "./auth/requireAuth";

const CACHE_TTL_MS = 60_000;

let cachedDataUserId: string | undefined;
let cachedAt = 0;

function envWorkspaceDataUserId(): string | undefined {
  const raw = process.env["WORKSPACE_DATA_USER_ID"]?.trim();
  return raw || undefined;
}

async function fallbackWorkspaceDataUserId(): Promise<string> {
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
 * Google sub used to scope all shared business records.
 * Precedence: WORKSPACE_DATA_USER_ID env → company_settings.workspace_data_user_id → oldest admin → oldest user.
 */
export async function resolveWorkspaceDataUserId(): Promise<string> {
  const fromEnv = envWorkspaceDataUserId();
  if (fromEnv) return fromEnv;

  const now = Date.now();
  if (cachedDataUserId && now - cachedAt < CACHE_TTL_MS) {
    return cachedDataUserId;
  }

  const settings = await getCompanySettings();
  const fromSettings = settings?.workspaceDataUserId?.trim();
  if (fromSettings) {
    cachedDataUserId = fromSettings;
    cachedAt = now;
    return fromSettings;
  }

  const fallback = await fallbackWorkspaceDataUserId();
  cachedDataUserId = fallback;
  cachedAt = now;
  return fallback;
}

export function invalidateWorkspaceDataUserCache(): void {
  cachedDataUserId = undefined;
  cachedAt = 0;
}

export function invalidateWorkspaceScopeCaches(): void {
  invalidateCompanySettingsCache();
  invalidateWorkspaceDataUserCache();
}

export type WorkspaceScope = {
  actorUserId: string;
  dataUserId: string;
  role: "admin" | "user";
};

export async function getWorkspaceScope(req: Request): Promise<WorkspaceScope> {
  const areq = req as AuthedRequest;
  const dataUserId = areq.dataUserId ?? (await resolveWorkspaceDataUserId());
  return {
    actorUserId: areq.userId,
    dataUserId,
    role: areq.role,
  };
}

/** Attach `dataUserId` on an authenticated request (call after session/API key resolution). */
export async function attachWorkspaceDataUserId(areq: AuthedRequest): Promise<void> {
  areq.dataUserId = await resolveWorkspaceDataUserId();
}
