import { db, usersTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { logger } from "./logger";

const DEFAULT_SUB = "local-app-user";

/**
 * Without a login system, all API data is scoped to a single workspace user.
 * Uses the oldest `invoiceplane_users` row, or creates one when the table is empty.
 */
export async function getCanonicalUserRow() {
  try {
    const rows = await db.select().from(usersTable).orderBy(asc(usersTable.createdAt));
    if (rows.length === 0) {
      const email = process.env["DEFAULT_APP_USER_EMAIL"]?.trim() || "app@local";
      const [row] = await db
        .insert(usersTable)
        .values({
          googleSub: DEFAULT_SUB,
          email,
          fullName: null,
          role: "admin",
        })
        .returning();
      return row;
    }
    return rows[0];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ error: msg }, "Database query failed in getCanonicalUserRow");

    // Check if the error is due to missing table
    if (msg.includes("invoiceplane_users") || msg.includes("does not exist") || msg.includes("relation")) {
      throw new Error(
        `Database table 'invoiceplane_users' is missing. ` +
        `Please run 'drizzle-kit push' to initialize the database schema. ` +
        `Original error: ${msg}`,
      );
    }
    throw e;
  }
}
