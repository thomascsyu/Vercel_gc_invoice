import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { readBrandingAssetBackup } from "../lib/brandingAssetBackup";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets (e.g. company logos) from PUBLIC_OBJECT_SEARCH_PATHS.
 * Unauthenticated by design — this is the only public-facing storage route.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      // Not on disk/GCS — likely wiped by an ephemeral-disk redeploy. Fall
      // back to the durable Postgres copy (see brandingAssetBackup.ts) before
      // giving up, so the Document layouts preview and branding thumbnails
      // don't go blank for an image that uploaded fine before a restart.
      const backup = await readBrandingAssetBackup(filePath);
      if (backup) {
        res.setHeader("Content-Type", backup.contentType);
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.send(backup.data);
        return;
      }
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadPublicObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

export default router;
