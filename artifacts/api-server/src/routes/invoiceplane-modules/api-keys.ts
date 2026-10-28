import { Router, type IRouter } from "express";
import { requireAdmin } from "../../lib/auth/requireAdmin";
import { apiKeysTable, db } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AuthedRequest } from "../../lib/auth/requireAuth";
import { generateApiKey, hashApiKey } from "../../lib/auth/apiKey";

const router: IRouter = Router();

const CreateApiKeyBody = z.object({
  label: z.string().trim().min(1).max(100),
  permission: z.enum(["read", "read_write"]).default("read_write"),
  expiryDays: z.coerce.number().int().min(1).max(3650).default(90),
});

router.get("/api-keys", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      id: apiKeysTable.id,
      label: apiKeysTable.label,
      last4: apiKeysTable.last4,
      permission: apiKeysTable.permission,
      revoked: apiKeysTable.revoked,
      expiresAt: apiKeysTable.expiresAt,
      lastUsedAt: apiKeysTable.lastUsedAt,
      createdAt: apiKeysTable.createdAt,
    })
    .from(apiKeysTable)
    .orderBy(desc(apiKeysTable.createdAt));
  res.json(rows);
});

router.post("/api-keys", requireAdmin, async (req, res) => {
  const parsed = CreateApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({
        error: "Invalid API key settings",
        issues: parsed.error.issues.map((i) => i.message),
      });
    return;
  }
  const token = generateApiKey();
  const expiresAt = new Date(Date.now() + parsed.data.expiryDays * 86_400_000);
  const [row] = await db
    .insert(apiKeysTable)
    .values({
      label: parsed.data.label,
      permission: parsed.data.permission,
      tokenHash: hashApiKey(token),
      last4: token.slice(-4),
      createdByUserId: (req as AuthedRequest).userId,
      expiresAt,
    })
    .returning();
  res.status(201).json({ ...row, token, tokenHash: undefined });
});

router.post("/api-keys/:id/revoke", requireAdmin, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "Invalid API key id" });
    return;
  }
  const [row] = await db
    .update(apiKeysTable)
    .set({ revoked: true })
    .where(eq(apiKeysTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "API key not found" });
    return;
  }
  res.json(row);
});

export default router;
