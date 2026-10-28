import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectStorageService, type PublicObjectSource } from "./objectStorage.js";
import { fetchImageBuffer, invalidateImageBufferCache } from "./fetchImageBuffer.js";
import { BRANDING_STORAGE_URL_PREFIX } from "./brandingImageUrl.js";

const BYTES = Buffer.from("fake-logo-bytes");

function logoUrl(id: string): string {
  return `${BRANDING_STORAGE_URL_PREFIX}branding/company-logo/${id}.png`;
}

function fakeSource(): PublicObjectSource {
  return { kind: "local", absolutePath: "/dev/null", contentType: "image/png" };
}

function stubStorage(overrides: {
  search: ObjectStorageService["searchPublicObject"];
  download?: ObjectStorageService["downloadPublicObject"];
}): () => void {
  const origSearch = ObjectStorageService.prototype.searchPublicObject;
  const origDownload = ObjectStorageService.prototype.downloadPublicObject;
  ObjectStorageService.prototype.searchPublicObject = overrides.search;
  ObjectStorageService.prototype.downloadPublicObject =
    overrides.download ?? (async () => new Response(BYTES));
  return () => {
    ObjectStorageService.prototype.searchPublicObject = origSearch;
    ObjectStorageService.prototype.downloadPublicObject = origDownload;
  };
}

test("retries once after a transient fetch error before giving up", async () => {
  invalidateImageBufferCache();
  let calls = 0;
  const restore = stubStorage({
    search: async () => {
      calls++;
      if (calls === 1) throw new Error("network blip");
      return fakeSource();
    },
  });
  try {
    const buf = await fetchImageBuffer(logoUrl("retry"));
    assert.ok(buf, "logo should still render after one transient failure");
    assert.equal(buf!.toString(), BYTES.toString());
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});

test("falls back to last-known-good bytes when a later fetch fails after a prior success", async () => {
  invalidateImageBufferCache();
  let fail = false;
  const restore = stubStorage({
    search: async () => {
      if (fail) throw new Error("storage down");
      return fakeSource();
    },
  });
  try {
    const first = await fetchImageBuffer(logoUrl("last-good"));
    assert.ok(first, "first fetch should succeed and populate the last-known-good cache");

    invalidateImageBufferCache();
    fail = true;
    const second = await fetchImageBuffer(logoUrl("last-good"));
    assert.ok(second, "logo should not disappear when object storage hiccups again");
    assert.equal(second!.toString(), BYTES.toString());
  } finally {
    restore();
  }
});

test("does not retry and returns null when the object is confirmed absent", async () => {
  invalidateImageBufferCache();
  let calls = 0;
  const restore = stubStorage({
    search: async () => {
      calls++;
      return null;
    },
  });
  try {
    const buf = await fetchImageBuffer(logoUrl("absent"));
    assert.equal(buf, null);
    assert.equal(calls, 1, "a confirmed-absent object should not be retried");
  } finally {
    restore();
  }
});

test("does not retry a timed-out fetch", async () => {
  invalidateImageBufferCache();
  let calls = 0;
  const restore = stubStorage({
    search: async () => {
      calls++;
      throw new Error("Branding image fetch timed out");
    },
  });
  try {
    const buf = await fetchImageBuffer(logoUrl("timeout"));
    assert.equal(buf, null);
    assert.equal(calls, 1, "an 8s hang should not be retried for another 8s");
  } finally {
    restore();
  }
});

test("hot-caches last-known-good bytes so the next PDF does not wait out another fetch", async () => {
  invalidateImageBufferCache();
  let calls = 0;
  let fail = false;
  const restore = stubStorage({
    search: async () => {
      calls++;
      if (fail) throw new Error("storage down");
      return fakeSource();
    },
  });
  try {
    const url = logoUrl("stale-hot");
    await fetchImageBuffer(url);
    assert.equal(calls, 1);

    invalidateImageBufferCache();
    fail = true;
    const second = await fetchImageBuffer(url);
    assert.ok(second);
    assert.equal(calls, 2, "fallback path should attempt storage once");

    const third = await fetchImageBuffer(url);
    assert.ok(third);
    assert.equal(calls, 2, "stale hit should not search storage again");
  } finally {
    restore();
  }
});
