import type { GmailAccount } from "@workspace/db";
import { canUseServiceAccount } from "./gmailApi";

export interface ResolvedGmailSender {
  senderEmail: string;
  refreshToken?: string;
  serviceAccountCredentials?: {
    clientEmail: string;
    privateKey: string;
  };
  /** The authentication method that will be used */
  authMethod: "oauth" | "serviceAccount";
}

/**
 * Use `account` as the From identity. Inherits OAuth refresh token from `tokenSource`
 * when the account has a sender email but no refresh token (second From address).
 * Also supports Service Account (Domain-wide Delegation) authentication.
 */
export function resolveGmailForSend(
  account: GmailAccount | null | undefined,
  tokenSource: GmailAccount | null | undefined,
): ResolvedGmailSender | null {
  const email = account?.senderEmail?.trim();
  if (!email) return null;

  // Check for Service Account credentials on the account itself
  if (account?.serviceAccountCredentials?.clientEmail && account?.serviceAccountCredentials?.privateKey) {
    return {
      senderEmail: email,
      serviceAccountCredentials: account.serviceAccountCredentials,
      authMethod: "serviceAccount",
    };
  }

  // Check if global Service Account is configured via env vars
  if (canUseServiceAccount(account)) {
    return {
      senderEmail: email,
      authMethod: "serviceAccount",
    };
  }

  // Fall back to OAuth refresh token
  const refresh =
    (account?.refreshToken && String(account.refreshToken).trim()) ||
    (tokenSource?.refreshToken && String(tokenSource.refreshToken).trim()) ||
    "";
  if (!refresh) return null;

  return { senderEmail: email, refreshToken: refresh, authMethod: "oauth" };
}
