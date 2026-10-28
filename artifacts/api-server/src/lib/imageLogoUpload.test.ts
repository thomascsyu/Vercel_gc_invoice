import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prepareBrandingImageForStorage, rasterizeUploadedLogoToPng } from "./imageLogoUpload.js";

/** 1×1 PNG */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("prepareBrandingImageForStorage", () => {
  it("accepts a valid PNG and returns re-encoded PNG bytes", async () => {
    const out = await prepareBrandingImageForStorage(TINY_PNG);
    assert.ok(out);
    assert.ok(out.length > 0);
    assert.equal(out[0], 0x89);
    assert.equal(out.toString("ascii", 1, 4), "PNG");
  });

  it("rejects non-image data", async () => {
    const out = await prepareBrandingImageForStorage(Buffer.from("not-an-image"));
    assert.equal(out, null);
  });

  it("rejects corrupt PNG header", async () => {
    const corrupt = Buffer.from(TINY_PNG);
    corrupt[10] = 0xff;
    const out = await prepareBrandingImageForStorage(corrupt);
    assert.equal(out, null);
  });

  it("rasterizeUploadedLogoToPng matches prepareBrandingImageForStorage for valid input", async () => {
    const a = await rasterizeUploadedLogoToPng(TINY_PNG);
    const b = await prepareBrandingImageForStorage(TINY_PNG);
    assert.deepEqual(a, b);
  });
});
