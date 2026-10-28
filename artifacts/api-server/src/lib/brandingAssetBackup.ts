import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Durable backup of an uploaded branding image, in Postgres, keyed by its
 * object-storage relative path. Local disk (the fallback when no GCS/volume
 * is configured) is wiped on every redeploy/restart; this survives that so a
 * logo that "worked before" doesn't quietly disappear from PDFs and previews.
 * Best-effort: a failure here must not fail the upload itself.
 *
 * `@workspace/db` is imported lazily (only when one of these functions is
 * actually called) rather than at module scope: `fetchImageBuffer.ts` pulls
 * this module in on every import, and unlike the rest of the DB-backed app,
 * it previously worked without a live database connection (pure object
 * storage) — a top-level import would make constructing the pg pool (and
 * thus requiring `DATABASE_URL`) a side effect of merely importing it.
 */
async function getBrandingAssetsTable() {
  const { brandingAssetsTable, db } = await import("@workspace/db");
  return { brandingAssetsTable, db };
}

export async function saveBrandingAssetBackup(
  relPath: string,
  contentType: string,
  data: Buffer,
): Promise<void> {
  try {
    const { brandingAssetsTable, db } = await getBrandingAssetsTable();
    const dataBase64 = data.toString("base64");
    await db
      .insert(brandingAssetsTable)
      .values({ relPath, contentType, dataBase64 })
      .onConflictDoUpdate({
        target: brandingAssetsTable.relPath,
        set: { contentType, dataBase64, updatedAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, relPath }, "Branding asset DB backup save failed (PDF/preview will still use object storage)");
  }
}

export async function readBrandingAssetBackup(
  relPath: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const { brandingAssetsTable, db } = await getBrandingAssetsTable();
    const [row] = await db
      .select()
      .from(brandingAssetsTable)
      .where(eq(brandingAssetsTable.relPath, relPath))
      .limit(1);
    if (!row) return null;
    return { data: Buffer.from(row.dataBase64, "base64"), contentType: row.contentType };
  } catch (err) {
    logger.warn({ err, relPath }, "Branding asset DB backup read failed");
    return null;
  }
}

/** Best-effort: removing a branding image should not fail if the backup row is already gone. */
export async function deleteBrandingAssetBackup(relPath: string): Promise<void> {
  try {
    const { brandingAssetsTable, db } = await getBrandingAssetsTable();
    await db.delete(brandingAssetsTable).where(eq(brandingAssetsTable.relPath, relPath));
  } catch (err) {
    logger.warn({ err, relPath }, "Branding asset DB backup delete failed");
  }
}
