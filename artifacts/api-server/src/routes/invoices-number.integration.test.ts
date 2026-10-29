import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";

// Run against a disposable database with the invoiceplane schema installed.
describe(
  "invoice number creation and uniqueness",
  { skip: !process.env.INVOICE_NUMBER_TEST_DATABASE_URL },
  () => {
    const userId = `invoice-number-test-${randomUUID()}`;
    let server: Server;
    let baseUrl: string;
    let clientId: string;
    let database: typeof import("@workspace/db");
    let eq: typeof import("drizzle-orm").eq;
    const payload = () => ({
      clientId,
      invoiceDate: "2026-09-20",
      dueDate: "2026-10-20",
      currency: "HKD",
      status: "draft",
      items: [{ name: "Consulting", quantity: 1, price: 100, taxRate: 0 }],
    });
    async function request(path: string, body?: unknown, method = "POST") {
      const response = await fetch(
        `${baseUrl}${path}`,
        body === undefined
          ? undefined
          : {
              method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
      );
      return { status: response.status, body: (await response.json()) as { id?: string; invoiceNumber?: string; error?: string; total?: number; available?: boolean } };
    }
    before(async () => {
      process.env.DATABASE_URL = process.env.INVOICE_NUMBER_TEST_DATABASE_URL;
      database = await import("@workspace/db");
      ({ eq } = await import("drizzle-orm"));
      await database.db
        .insert(database.usersTable)
        .values({ googleSub: userId, email: `${userId}@test.local` });
      const [client] = await database.db
        .insert(database.clientsTable)
        .values({
          userId,
          clientCode: "TEST001",
          name: "Invoice number test client",
        })
        .returning();
      clientId = client.id;
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        Object.assign(req, { userId, dataUserId: userId });
        next();
      });
      app.use((await import("./invoiceplane/invoices")).default);
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      assert(address && typeof address !== "string");
      baseUrl = `http://127.0.0.1:${address.port}`;
    });
    after(async () => {
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      if (database) {
        await database.db
          .delete(database.auditLogTable)
          .where(eq(database.auditLogTable.userId, userId));
        await database.db
          .delete(database.invoicesTable)
          .where(eq(database.invoicesTable.userId, userId));
        await database.db
          .delete(database.clientsTable)
          .where(eq(database.clientsTable.userId, userId));
        await database.db
          .delete(database.usersTable)
          .where(eq(database.usersTable.googleSub, userId));
        await database.pool.end();
      }
    });
    it("previews an available number without creating an invoice, then saves that exact number", async () => {
      const first = await request("/invoices/next-number");
      assert.equal(first.status, 200);
      assert.match(first.body.invoiceNumber!, /^\d+$/);
      const second = await request("/invoices/next-number");
      assert.equal(second.body.invoiceNumber, first.body.invoiceNumber);
      const saved = await request("/invoices", {
        ...payload(),
        invoiceNumber: first.body.invoiceNumber,
      });
      assert.equal(saved.status, 201);
      assert.equal(saved.body.invoiceNumber, first.body.invoiceNumber);
    });
    it("accepts a trimmed custom number and rejects duplicates without inserting", async () => {
      const saved = await request("/invoices", {
        ...payload(),
        invoiceNumber: " CUSTOM-001 ",
      });
      assert.equal(saved.status, 201);
      assert.equal(saved.body.invoiceNumber, "CUSTOM-001");
      const before = (await request("/invoices")).body.total;
      const duplicate = await request("/invoices", {
        ...payload(),
        invoiceNumber: "CUSTOM-001",
      });
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.body.error, "Duplicate invoice number");
      assert.equal((await request("/invoices")).body.total, before);
      assert.equal(
        (
          await request(
            "/invoices/number-availability?invoiceNumber=CUSTOM-001",
          )
        ).body.available,
        false,
      );
      assert.equal(
        (await request("/invoices/number-availability?invoiceNumber=UNUSED"))
          .body.available,
        true,
      );
    });
    it("rejects a duplicate when updating an existing invoice", async () => {
      const saved = await request("/invoices", {
        ...payload(),
        invoiceNumber: "CUSTOM-002",
      });
      assert.equal(saved.status, 201);
      const duplicate = await request(
        `/invoices/${saved.body.id}`,
        { ...payload(), invoiceNumber: "CUSTOM-001" },
        "PATCH",
      );
      assert.equal(duplicate.status, 409);
      assert.equal(duplicate.body.error, "Duplicate invoice number");
      const unchanged = await request(
        `/invoices/${saved.body.id}`,
        { ...payload(), invoiceNumber: "CUSTOM-002" },
        "PATCH",
      );
      assert.equal(unchanged.status, 200);
    });
    it("allows only one concurrent save and returns the exact warning for the other", async () => {
      const results = await Promise.all(
        [1, 2].map(() =>
          request("/invoices", { ...payload(), invoiceNumber: "RACE-001" }),
        ),
      );
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal(
        results.find((r) => r.status === 409)!.body.error,
        "Duplicate invoice number",
      );
    });
    it("the database rejects duplicates even when bypassing request validation", async () => {
      const [existing] = await database.db
        .select()
        .from(database.invoicesTable)
        .where(eq(database.invoicesTable.userId, userId))
        .limit(1);
      const { id: _id, ...copy } = existing;
      await assert.rejects(
        database.db.insert(database.invoicesTable).values(copy),
        (error: any) => {
          assert.equal(error.cause?.code, "23505");
          return true;
        },
      );
    });
    it("skips occupied automatically generated numbers and still supports clients omitting the number", async () => {
      const preview = (await request("/invoices/next-number")).body
        .invoiceNumber as string;
      const occupied = (BigInt(preview) + 1n).toString();
      assert.equal(
        (await request("/invoices", { ...payload(), invoiceNumber: occupied }))
          .status,
        201,
      );
      const next = (await request("/invoices/next-number")).body.invoiceNumber;
      assert.notEqual(next, occupied);
      const saved = await request("/invoices", payload());
      assert.equal(saved.status, 201);
      assert.equal(saved.body.invoiceNumber, next);
    });
    it("rejects explicitly blank invoice numbers", async () => {
      assert.equal(
        (await request("/invoices", { ...payload(), invoiceNumber: "  " }))
          .status,
        400,
      );
    });
  },
);
