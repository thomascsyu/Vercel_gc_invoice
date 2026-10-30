import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Run against a disposable database with the invoiceplane schema installed.
// Mutates the single company_settings row (restored afterwards).
describe(
  "workspace data owner resolution",
  { skip: !process.env.WORKSPACE_SCOPE_TEST_DATABASE_URL },
  () => {
    const run = randomUUID();
    const oldestAdmin = `ws-oldest-admin-${run}`;
    const laterAdmin = `ws-later-admin-${run}`;
    let database: typeof import("@workspace/db");
    let orm: typeof import("drizzle-orm");
    let scope: typeof import("./workspaceScope");
    let settingsId: string;
    let previousOwner: string | null = null;
    const prevEnv = process.env["WORKSPACE_DATA_USER_ID"];

    const resolveFresh = () => {
      scope.invalidateWorkspaceScopeCaches();
      return scope.resolveWorkspaceDataUserId();
    };

    before(async () => {
      process.env.DATABASE_URL = process.env.WORKSPACE_SCOPE_TEST_DATABASE_URL;
      delete process.env["WORKSPACE_DATA_USER_ID"];
      database = await import("@workspace/db");
      orm = await import("drizzle-orm");
      scope = await import("./workspaceScope");
      const { db, usersTable, companySettingsTable } = database;
      await db.insert(usersTable).values([
        { googleSub: oldestAdmin, email: `${oldestAdmin}@test.local`, role: "admin", createdAt: new Date("2000-01-01") },
        { googleSub: laterAdmin, email: `${laterAdmin}@test.local`, role: "admin", createdAt: new Date("2000-01-02") },
      ]);
      let [settings] = await db.select().from(companySettingsTable).limit(1);
      if (!settings) {
        [settings] = await db.insert(companySettingsTable).values({ companyName: "Test" }).returning();
      }
      settingsId = settings!.id;
      previousOwner = settings!.workspaceDataUserId ?? null;
      await db
        .update(companySettingsTable)
        .set({ workspaceDataUserId: null })
        .where(orm.eq(companySettingsTable.id, settingsId));
    });

    after(async () => {
      if (prevEnv === undefined) delete process.env["WORKSPACE_DATA_USER_ID"];
      else process.env["WORKSPACE_DATA_USER_ID"] = prevEnv;
      if (!database) return;
      const { db, usersTable, companySettingsTable } = database;
      await db
        .update(companySettingsTable)
        .set({ workspaceDataUserId: previousOwner })
        .where(orm.eq(companySettingsTable.id, settingsId));
      await db.delete(usersTable).where(orm.inArray(usersTable.googleSub, [oldestAdmin, laterAdmin]));
      scope.invalidateWorkspaceScopeCaches();
    });

    it("pins the oldest admin into company settings when nothing is configured", async () => {
      assert.equal(await resolveFresh(), oldestAdmin);
      const [settings] = await database.db
        .select()
        .from(database.companySettingsTable)
        .where(orm.eq(database.companySettingsTable.id, settingsId));
      assert.equal(settings!.workspaceDataUserId, oldestAdmin);
    });

    it("keeps the pinned owner after that admin is demoted", async () => {
      await database.db
        .update(database.usersTable)
        .set({ role: "user", isActive: false })
        .where(orm.eq(database.usersTable.googleSub, oldestAdmin));
      assert.equal(await resolveFresh(), oldestAdmin);
    });

    it("ignores WORKSPACE_DATA_USER_ID when it names no user", async () => {
      process.env["WORKSPACE_DATA_USER_ID"] = `missing-${run}`;
      try {
        assert.equal(await resolveFresh(), oldestAdmin);
      } finally {
        delete process.env["WORKSPACE_DATA_USER_ID"];
      }
    });

    it("prefers a valid WORKSPACE_DATA_USER_ID over company settings", async () => {
      process.env["WORKSPACE_DATA_USER_ID"] = `  ${laterAdmin}  `;
      try {
        assert.equal(await resolveFresh(), laterAdmin);
      } finally {
        delete process.env["WORKSPACE_DATA_USER_ID"];
      }
    });
  },
);
