import assert from "node:assert/strict";
import test from "node:test";
import { isForeignKeyViolation, isTransientConnectionError, isUniqueViolation } from "./pgErrors";

test("isUniqueViolation detects a top-level pg error", () => {
  const err = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
  });
  assert.equal(isUniqueViolation(err), true);
});

test("isUniqueViolation detects a pg error wrapped by Drizzle in cause", () => {
  const pgError = Object.assign(new Error("duplicate key"), { code: "23505" });
  const wrapped = new Error("Failed query: insert into ...", { cause: pgError });
  assert.equal(isUniqueViolation(wrapped), true);
});

test("isUniqueViolation ignores other errors", () => {
  assert.equal(isUniqueViolation(new Error("connection refused")), false);
  assert.equal(isUniqueViolation(Object.assign(new Error("nope"), { code: "23503" })), false);
  assert.equal(isUniqueViolation(null), false);
  assert.equal(isUniqueViolation("23505"), false);
});

test("isForeignKeyViolation detects a top-level pg error", () => {
  const err = Object.assign(new Error("violates foreign key constraint"), {
    code: "23503",
  });
  assert.equal(isForeignKeyViolation(err), true);
});

test("isForeignKeyViolation detects a pg error wrapped by Drizzle in cause", () => {
  const pgError = Object.assign(new Error("violates foreign key constraint"), { code: "23503" });
  const wrapped = new Error("Failed query: delete from ...", { cause: pgError });
  assert.equal(isForeignKeyViolation(wrapped), true);
});

test("isForeignKeyViolation ignores other errors", () => {
  assert.equal(isForeignKeyViolation(new Error("connection refused")), false);
  assert.equal(isForeignKeyViolation(Object.assign(new Error("nope"), { code: "23505" })), false);
  assert.equal(isForeignKeyViolation(null), false);
  assert.equal(isForeignKeyViolation("23503"), false);
});

test("isTransientConnectionError detects SQLSTATE 57P01", () => {
  const err = Object.assign(new Error("terminating connection due to administrator command"), {
    code: "57P01",
  });
  assert.equal(isTransientConnectionError(err), true);
});

test("isTransientConnectionError detects admin shutdown message without code", () => {
  const err = new Error("terminating connection due to administrator command");
  assert.equal(isTransientConnectionError(err), true);
});

test("isTransientConnectionError detects wrapped pg connection errors", () => {
  const pgError = Object.assign(new Error("connection terminated"), { code: "57P01" });
  const wrapped = new Error("Failed query: select ...", { cause: pgError });
  assert.equal(isTransientConnectionError(wrapped), true);
});

test("isTransientConnectionError ignores unique violations", () => {
  assert.equal(
    isTransientConnectionError(Object.assign(new Error("duplicate key"), { code: "23505" })),
    false,
  );
});
