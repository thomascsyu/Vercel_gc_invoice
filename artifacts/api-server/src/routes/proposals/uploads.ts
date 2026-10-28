import { randomUUID } from "crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { ObjectStorageService } from "../../lib/objectStorage";
import { BRANDING_STORAGE_URL_PREFIX } from "../../lib/brandingImageUrl";
import { rasterizeUploadedLogoToPng } from "../../lib/imageLogoUpload";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

function runCoverUpload(req: Request, res: Response, next: NextFunction) {
  logoUpload.single("file")(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed" });
      return;
    }
    next();
  });
}

router.post("/uploads/proposal-cover", runCoverUpload, async (req, res) => {
  const file = req.file;
  if (!file?.buffer?.length) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  try {
    const png = await rasterizeUploadedLogoToPng(file.buffer);
    if (!png) {
      res.status(400).json({ error: "Unsupported image format." });
      return;
    }
    const { publicPath } = await objectStorageService.uploadPublicAsset({
      folder: "branding/proposal-cover",
      filename: `${randomUUID()}.png`,
      contentType: "image/png",
      body: png,
    });
    res.status(201).json({ url: `${BRANDING_STORAGE_URL_PREFIX}${publicPath}` });
  } catch {
    res.status(400).json({ error: "Unsupported image format." });
  }
});

export default router;
