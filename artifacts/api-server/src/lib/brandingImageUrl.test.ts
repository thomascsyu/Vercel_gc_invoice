import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BRANDING_STORAGE_URL_PREFIX,
  isManagedBrandingStoragePath,
  publicObjectRelPathFromStoredUrl,
} from "./brandingImageUrl.js";

describe("brandingImageUrl", () => {
  it("parses stored public object URLs", () => {
    const url = `${BRANDING_STORAGE_URL_PREFIX}branding/company-logo/abc.png`;
    assert.equal(publicObjectRelPathFromStoredUrl(url), "branding/company-logo/abc.png");
    const chop = `${BRANDING_STORAGE_URL_PREFIX}branding/company-chop/seal.png`;
    assert.equal(publicObjectRelPathFromStoredUrl(chop), "branding/company-chop/seal.png");
  });

  it("parses absolute URLs with embedded public-objects route", () => {
    const rel = "branding/header-logo/banner.png";
    assert.equal(
      publicObjectRelPathFromStoredUrl(`https://app.example.com${BRANDING_STORAGE_URL_PREFIX}${rel}`),
      rel,
    );
  });

  it("rejects external and traversal URLs", () => {
    assert.equal(publicObjectRelPathFromStoredUrl("https://evil.example/logo.png"), null);
    assert.equal(
      publicObjectRelPathFromStoredUrl(`${BRANDING_STORAGE_URL_PREFIX}branding/../secrets`),
      null,
    );
  });

  it("isManagedBrandingStoragePath allows branding and legacy logos folders", () => {
    assert.equal(isManagedBrandingStoragePath("branding/header-logo/x.png"), true);
    assert.equal(isManagedBrandingStoragePath("logos/old.png"), true);
    assert.equal(isManagedBrandingStoragePath("other/x.png"), false);
  });
});
