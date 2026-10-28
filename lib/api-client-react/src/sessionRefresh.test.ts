import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchWithSessionRetry } from "./sessionRefresh.ts";

describe("fetchWithSessionRetry", { concurrency: false }, () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the original response when status is not 401", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : String(input));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const res = await fetchWithSessionRetry("/api/pdf-document-layouts/preview", { method: "POST" });
    assert.equal(res.status, 200);
    assert.deepEqual(calls, ["/api/pdf-document-layouts/preview"]);
  });

  it("refreshes once then retries the original request after 401", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      calls.push(url);
      if (url.includes("/auth/refresh")) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (calls.filter((c) => c.includes("/preview")).length === 1) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
      return new Response("pdf", { status: 200 });
    }) as typeof fetch;

    const res = await fetchWithSessionRetry("https://app.example/api/pdf-document-layouts/preview", {
      method: "POST",
    });
    assert.equal(res.status, 200);
    assert.equal(calls[0], "https://app.example/api/pdf-document-layouts/preview");
    assert.equal(calls[1], "https://app.example/api/auth/refresh");
    assert.equal(calls[2], "https://app.example/api/pdf-document-layouts/preview");
  });

  it("does not retry when refresh fails", async () => {
    let previewCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/auth/refresh")) {
        return new Response(JSON.stringify({ error: "Invalid refresh token" }), { status: 401 });
      }
      previewCalls += 1;
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }) as typeof fetch;

    const res = await fetchWithSessionRetry("/api/pdf-document-layouts/preview");
    assert.equal(res.status, 401);
    assert.equal(previewCalls, 1);
  });
});
