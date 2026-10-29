import { db, usersTable } from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { requireAdmin } from "../../lib/auth/requireAdmin";
import { getCompanySettings } from "../../lib/companySettingsCache";
import { proposalsEnabled } from "../../lib/featureFlags";
import { resolveWorkspaceDataUserId } from "../../lib/workspaceScope";
import { isForeignKeyViolation } from "../../lib/pgErrors";

const router: IRouter = Router();

// ---------- /me ----------
router.get("/me", async (req, res) => {
  const areq = req as AuthedRequest;
  const [row, settings, dataUserId] = await Promise.all([
    db
      .select()
      .from(usersTable)
      .where(eq(usersTable.googleSub, areq.userId))
      .limit(1)
      .then((rows) => rows[0]),
    getCompanySettings(),
    resolveWorkspaceDataUserId(),
  ]);
  const testModeEnabled = settings?.testModeEnabled ?? false;
  const capabilities = { proposals: proposalsEnabled() };
  if (!row) {
    res.json({
      userId: areq.userId,
      role: areq.role,
      testModeEnabled,
      dataUserId,
      capabilities,
    });
    return;
  }
  res.json({
    userId: row.googleSub,
    role: row.role,
    email: row.email,
    fullName: row.fullName ?? undefined,
    testModeEnabled,
    dataUserId,
    capabilities,
  });
});

// ---------- Users (admin) ----------
const UserCreateSchema = z.object({
  email: z.string().email(),
  fullName: z.string().optional(),
  role: z.enum(["user", "admin"]).default("user"),
  googleSub: z.string().optional(),
});
const UserPatchSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().nullable().optional(),
  role: z.enum(["user", "admin"]).optional(),
  isActive: z.boolean().optional(),
});

function userDto(row: typeof usersTable.$inferSelect) {
  return {
    id: row.id,
    googleSub: row.googleSub,
    email: row.email,
    fullName: row.fullName ?? undefined,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/users", requireAdmin, async (_req, res) => {
  // Excludes tombstone rows migration 0035 creates for user_ids that had no
  // matching user (so the new user_id foreign keys have a valid target) --
  // those aren't real accounts and should never show up for admins.
  const rows = await db
    .select()
    .from(usersTable)
    .where(sql`${usersTable.email} NOT LIKE 'deleted-user+%@invalid.local'`)
    .orderBy(asc(usersTable.createdAt));
  res.json(rows.map(userDto));
});

router.post("/users", requireAdmin, async (req, res) => {
  const body = UserCreateSchema.parse(req.body);
  const [existingByEmail] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, body.email));
  if (existingByEmail) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }
  const googleSub = body.googleSub ?? `pending:${body.email.toLowerCase()}`;
  const [row] = await db
    .insert(usersTable)
    .values({
      googleSub,
      email: body.email,
      fullName: body.fullName ?? null,
      role: body.role,
    })
    .returning();
  res.status(201).json(userDto(row));
});

router.patch("/users/:id", requireAdmin, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = UserPatchSchema.parse(req.body);
  const [row] = await db
    .update(usersTable)
    .set({
      ...body,
      // Bumping the version invalidates any live refresh token immediately,
      // instead of waiting up to 7 days for it to expire naturally.
      ...(body.isActive === false ? { refreshTokenVersion: sql`${usersTable.refreshTokenVersion} + 1` } : {}),
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(userDto(row));
});

router.delete("/users/:id", requireAdmin, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const areq = req as AuthedRequest;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(204).send();
    return;
  }
  if (target.googleSub === areq.userId) {
    res.status(400).json({ error: "You cannot remove your own account" });
    return;
  }
  try {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      res.status(409).json({ error: "This user still owns records (invoices, clients, …). Deactivate the account instead of deleting it." });
      return;
    }
    throw err;
  }
  res.status(204).send();
});

export default router;
