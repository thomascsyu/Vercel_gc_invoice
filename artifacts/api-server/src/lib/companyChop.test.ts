import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { companyChopStoredUrl } from "./companyChop.js";

describe("companyChopStoredUrl", () => {
  it("prefers chopUrl when set", () => {
    assert.equal(
      companyChopStoredUrl({
        chopUrl: "/api/storage/public-objects/branding/company-chop/a.png",
        signatureImageUrl: "/api/storage/public-objects/branding/company-chop/old.png",
      }),
      "/api/storage/public-objects/branding/company-chop/a.png",
    );
  });

  it("returns null when both cleared after branding remove", () => {
    assert.equal(companyChopStoredUrl({ chopUrl: null, signatureImageUrl: null }), null);
  });

  it("ignores whitespace-only chopUrl and falls back to legacy signature", () => {
    assert.equal(
      companyChopStoredUrl({
        chopUrl: "   ",
        signatureImageUrl: "/api/storage/public-objects/branding/company-chop/legacy.png",
      }),
      "/api/storage/public-objects/branding/company-chop/legacy.png",
    );
  });

  it("falls back to legacy signature when chopUrl is null", () => {
    assert.equal(
      companyChopStoredUrl({
        chopUrl: null,
        signatureImageUrl: "/api/storage/public-objects/branding/company-chop/legacy.png",
      }),
      "/api/storage/public-objects/branding/company-chop/legacy.png",
    );
  });
});
