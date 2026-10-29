import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod/v4";
import { type AuthedRequest } from "../../lib/auth/requireAuth";
import { requireAdmin } from "../../lib/auth/requireAdmin";
import {
  BACKUP_VERSION,
  BackupPayloadSchema,
  exportUserBackup,
  restoreUserBackup,
} from "../../lib/backupRestore";
import { invalidateCompanySettingsCache } from "../../lib/companySettingsCache";

const router: IRouter = Router();

const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function handleBackupUpload(req: Request, res: Response, next: NextFunction) {
  backupUpload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "Backup file too large (max 100 MB)" });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    if (err) {
      const message = err instanceof Error && err.message.trim() ? err.message : "Upload failed";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
}

router.get("/backup/export", requireAdmin, async (req, res) => {
  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const includeCompany = req.query.includeCompany === "true";
  const dataModeParam = req.query.dataMode;
  const dataMode = dataModeParam === "live" || dataModeParam === "test" ? dataModeParam : undefined;
  const payload = await exportUserBackup({ userId, includeCompany, dataMode });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="gc-inv-backup-${stamp}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

router.post("/backup/restore", requireAdmin, handleBackupUpload, async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No backup file uploaded" });
    return;
  }

  const body = z
    .object({
      restoreCompany: z
        .union([z.literal("true"), z.literal("false")])
        .optional()
        .transform((v) => v === "true"),
      confirm: z
        .union([z.literal("true"), z.literal("false")])
        .optional()
        .transform((v) => v === "true"),
      restoreDataMode: z.union([z.literal("live"), z.literal("test")]).optional(),
    })
    .parse(req.body);

  if (!body.confirm) {
    res.status(400).json({
      error: "Restore requires confirm=true. This replaces all of your business data with the backup.",
    });
    return;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(req.file.buffer.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Backup file is not valid JSON" });
    return;
  }

  const parsed = BackupPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid backup format", issues: parsed.error.issues.map((i) => i.message) });
    return;
  }

  if (parsed.data.version !== BACKUP_VERSION) {
    res.status(400).json({ error: `Unsupported backup version: ${parsed.data.version}` });
    return;
  }

  const userId = (req as unknown as AuthedRequest).dataUserId!;
  const restoreCompany = body.restoreCompany ?? parsed.data.includeCompany;

  try {
    const result = await restoreUserBackup({
      userId,
      payload: parsed.data,
      restoreCompany,
      dataMode: body.restoreDataMode,
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restore failed";
    res.status(500).json({ error: message });
  }
});

export default router;
