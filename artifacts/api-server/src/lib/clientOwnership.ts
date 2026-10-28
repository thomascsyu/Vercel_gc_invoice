import { clientsTable, db } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import type { DataMode } from "./dataMode";
import { currentDataMode } from "./dataMode";

/**
 * Returns true when `clientId` belongs to `userId` in the given data mode
 * and hasn't been soft-deleted — a deleted client can't be assigned to a
 * new (or edited) invoice/quotation, even though its historical documents
 * keep displaying its name.
 */
export async function isClientOwnedByUser(
  userId: string,
  clientId: string,
  dataMode?: DataMode,
): Promise<boolean> {
  const mode = dataMode ?? (await currentDataMode());
  const [row] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(
      and(
        eq(clientsTable.id, clientId),
        eq(clientsTable.userId, userId),
        eq(clientsTable.dataMode, mode),
        isNull(clientsTable.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Resolves client ownership; use in handlers to return 400/404 before writes. */
export async function assertClientOwnedByUser(
  userId: string,
  clientId: string,
  dataMode?: DataMode,
): Promise<{ ok: true } | { ok: false; status: 400; error: string }> {
  if (!(await isClientOwnedByUser(userId, clientId, dataMode))) {
    return { ok: false, status: 400, error: "Client not found or does not belong to your account." };
  }
  return { ok: true };
}
