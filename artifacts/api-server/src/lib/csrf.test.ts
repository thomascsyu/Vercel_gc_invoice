import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { requireCsrfHeader } from "./csrf";

function fakeReq(method: string, header?: string): Request {
  return {
    method,
    get(name: string) {
      return name.toLowerCase() === "x-requested-with" ? header : undefined;
    },
  } as unknown as Request;
}

function fakeRes(): Response & { statusCode?: number; body?: unknown } {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as Response["status"];
  res.json = ((payload: unknown) => {
    res.body = payload;
    return res;
  }) as Response["json"];
  return res;
}

test("requireCsrfHeader allows GET without the header", () => {
  const req = fakeReq("GET");
  const res = fakeRes();
  let nextCalled = false;
  requireCsrfHeader(req, res, () => (nextCalled = true));
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, undefined);
});

test("requireCsrfHeader allows HEAD and OPTIONS without the header", () => {
  for (const method of ["HEAD", "OPTIONS"]) {
    const res = fakeRes();
    let nextCalled = false;
    requireCsrfHeader(fakeReq(method), res, () => (nextCalled = true));
    assert.equal(nextCalled, true, `expected ${method} to pass through`);
  }
});

test("requireCsrfHeader rejects POST without the header", () => {
  const req = fakeReq("POST");
  const res = fakeRes();
  let nextCalled = false;
  requireCsrfHeader(req, res, () => (nextCalled = true));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("requireCsrfHeader rejects a mutating request with the wrong header value", () => {
  const req = fakeReq("PATCH", "SomethingElse");
  const res = fakeRes();
  let nextCalled = false;
  requireCsrfHeader(req, res, () => (nextCalled = true));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("requireCsrfHeader allows POST/PUT/PATCH/DELETE with the correct header", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = fakeRes();
    let nextCalled = false;
    requireCsrfHeader(fakeReq(method, "XMLHttpRequest"), res, () => (nextCalled = true));
    assert.equal(nextCalled, true, `expected ${method} with header to pass through`);
    assert.equal(res.statusCode, undefined);
  }
});
