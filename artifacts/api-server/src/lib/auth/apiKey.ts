import { createHash, randomBytes } from "node:crypto";

export type ApiKeyPermission = "read" | "read_write";

export function generateApiKey(): string {
  return `gci_${randomBytes(32).toString("base64url")}`;
}

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function getApiKeyFromRequestHeader(
  value: string | undefined,
): string | null {
  const token = value?.trim();
  return token || null;
}
