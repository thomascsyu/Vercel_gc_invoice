import sharp from "sharp";

/** Returns image width ÷ height, or null when dimensions cannot be read. */
export async function imageBufferAspectRatio(buf: Buffer | null | undefined): Promise<number | null> {
  if (!buf?.length) return null;
  try {
    const meta = await sharp(buf).metadata();
    const w = meta.width;
    const h = meta.height;
    if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
      return w / h;
    }
  } catch {
    /* ignore corrupt / unsupported */
  }
  return null;
}
