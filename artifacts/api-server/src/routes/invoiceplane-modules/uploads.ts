import crypto from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod/v4";
import { requireAdmin } from "../../lib/auth/requireAdmin";
import {
  isManagedBrandingStoragePath,
  publicObjectRelPathFromStoredUrl,
} from "../../lib/brandingImageUrl";
import { prepareBrandingImageForStorage } from "../../lib/imageLogoUpload";
import { deleteBrandingAssetBackup, saveBrandingAssetBackup } from "../../lib/brandingAssetBackup";
import { objectStorageService } from "./helpers";

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

const router: IRouter = Router();

// ---------- Logo upload (admin) — registered before DB seed middleware ----------

/** User-facing message for logo upload storage failures (admin-only route). */
function publicLogoUploadErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("PUBLIC_OBJECT_SEARCH_PATHS")) {
    return msg;
  }
  if (msg.includes("Invalid path: must contain at least a bucket name")) {
    return (
      "Object storage path is invalid. Set PUBLIC_OBJECT_SEARCH_PATHS to paths like " +
      "`/my-bucket/public` (bucket name as first segment after the leading slash)."
    );
  }
  if (/PERMISSION_DENIED|access denied|AccessDenied|403|credentials|authentication|invalid_grant/i.test(msg)) {
    return "Storage access denied. Check Google Cloud credentials and bucket permissions for this server.";
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|getaddrinfo/i.test(msg)) {
    return "Could not reach object storage. Check network connectivity and Google Cloud Storage availability.";
  }
  return (
    "Could not save the image to storage. " +
    "Confirm PUBLIC_OBJECT_SEARCH_PATHS and GCS credentials are set on the server."
  );
}

type BrandingUploadKind = "company_logo" | "header_logo" | "company_chop";

const BRANDING_UPLOAD_FOLDERS: Record<BrandingUploadKind, string> = {
  company_logo: "branding/company-logo",
  header_logo: "branding/header-logo",
  company_chop: "branding/company-chop",
};

function runBrandingFileUpload(req: Request, res: Response, next: NextFunction) {
  logoUpload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "File too large (max 12 MB)" });
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

async function completeBrandingImageUpload(req: Request, res: Response, kind: BrandingUploadKind) {
  const file = req.file;
  if (!file?.buffer?.length) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const preparedBody = await prepareBrandingImageForStorage(file.buffer);
  if (!preparedBody) {
    res.status(400).json({
      error:
        "Unsupported or corrupt image. Try PNG or JPEG, or another common raster format (TIFF/HEIC are converted automatically).",
    });
    return;
  }
  const filename = `${crypto.randomUUID()}.png`;
  const folder = BRANDING_UPLOAD_FOLDERS[kind];
  try {
    const { publicPath } = await objectStorageService.uploadPublicAsset({
      folder,
      filename,
      contentType: "image/png",
      body: preparedBody,
    });
    // Best-effort durable copy so this survives an ephemeral-disk redeploy
    // even when GCS/a volume isn't configured (see brandingAssetBackup.ts).
    await saveBrandingAssetBackup(publicPath, "image/png", preparedBody);
    const url = `/api/storage/public-objects/${publicPath}`;
    res.status(201).json({ url, kind });
  } catch (err) {
    req.log.error({ err }, "Branding image upload failed");
    res.status(500).json({ error: publicLogoUploadErrorMessage(err) });
  }
}

/** @deprecated Prefer POST /uploads/branding with multipart field `kind`. */
router.post(
  "/uploads/logo",
  requireAdmin,
  runBrandingFileUpload,
  async (req: Request, res: Response) => {
    await completeBrandingImageUpload(req, res, "company_logo");
  },
);

router.post("/uploads/branding", requireAdmin, runBrandingFileUpload, async (req: Request, res: Response) => {
  const raw = typeof (req.body as { kind?: string })?.kind === "string" ? (req.body as { kind: string }).kind.trim() : "";
  if (raw !== "company_logo" && raw !== "header_logo" && raw !== "company_chop") {
    res.status(400).json({
      error: "Missing or invalid kind. Use company_logo, header_logo, or company_chop.",
    });
    return;
  }
  await completeBrandingImageUpload(req, res, raw as BrandingUploadKind);
});

/**
 * Whether branding uploads survive a container recreate (GCS or a host
 * directory such as `/data`). Ephemeral container disk does not, so admins
 * should see a warning before they re-upload the same logo after every deploy.
 */
router.get("/uploads/branding/storage-status", requireAdmin, (_req, res) => {
  res.json(objectStorageService.getUploadStorageStatus());
});

/** Remove a staged upload when saving settings failed after storage (admin). */
router.post("/uploads/branding/abandon", requireAdmin, async (req, res) => {
  const { url } = z.object({ url: z.string().min(1) }).parse(req.body ?? {});
  const rel = publicObjectRelPathFromStoredUrl(url);
  if (!rel || !isManagedBrandingStoragePath(rel)) {
    res.status(400).json({ error: "Invalid branding asset URL" });
    return;
  }
  try {
    await objectStorageService.deletePublicAsset(rel);
    await deleteBrandingAssetBackup(rel);
    res.status(204).end();
  } catch (err) {
    req.log?.error?.({ err }, "Abandon branding upload failed");
    res.status(500).json({ error: "Could not remove staged upload" });
  }
});

/** DELETE branding file from object storage by stored app URL (same rules as abandon). */
router.delete("/uploads/branding", requireAdmin, async (req, res) => {
  const urlParam = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!urlParam) {
    res.status(400).json({ error: "Missing url query parameter" });
    return;
  }
  const rel = publicObjectRelPathFromStoredUrl(urlParam);
  if (!rel || !isManagedBrandingStoragePath(rel)) {
    res.status(400).json({ error: "Invalid branding asset URL" });
    return;
  }
  try {
    await objectStorageService.deletePublicAsset(rel);
    await deleteBrandingAssetBackup(rel);
    res.status(204).end();
  } catch (err) {
    req.log?.error?.({ err }, "Delete branding asset failed");
    res.status(500).json({ error: "Could not delete branding asset" });
  }
});

export default router;
