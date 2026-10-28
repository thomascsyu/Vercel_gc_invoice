import sharp from "sharp";

const MAX_EDGE_PX = 4096;

/**
 * Rasterize any decodable raster (incl. TIFF/TIF/heic/avif/etc.) into PNG bytes
 * for storage and PDF embedding (PdfKit reliably supports JPEG/PNG).
 */
export async function rasterizeUploadedLogoToPng(raw: Buffer): Promise<Buffer | null> {
  try {
    const out = await sharp(raw, { failOn: "none" })
      .rotate()
      .resize({
        width: MAX_EDGE_PX,
        height: MAX_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Validate and normalize branding uploads into PNG bytes.
 * Re-encodes even PNG/JPEG so corrupt or mislabeled files are rejected before storage.
 */
export async function prepareBrandingImageForStorage(raw: Buffer): Promise<Buffer | null> {
  return rasterizeUploadedLogoToPng(raw);
}
