import crypto from "node:crypto";

export type GmailOAuthSlot = 1 | 2 | 3;

type StatePayload = { userId: string; slot: GmailOAuthSlot; exp: number };

function stateSecret(): string {
  const s = process.env["GMAIL_OAUTH_STATE_SECRET"] ?? process.env["SESSION_SECRET"];
  if (!s) {
    throw new Error("Set SESSION_SECRET or GMAIL_OAUTH_STATE_SECRET for Gmail OAuth state signing");
  }
  return s;
}

export function signGmailOAuthState(userId: string, slot: GmailOAuthSlot): string {
  const payload: StatePayload = {
    userId,
    slot,
    exp: Date.now() + 15 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyGmailOAuthState(state: string): StatePayload | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch; reject those up front.
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const json = Buffer.from(body, "base64url").toString("utf8");
    const p = JSON.parse(json) as StatePayload;
    if (typeof p.userId !== "string" || (p.slot !== 1 && p.slot !== 2 && p.slot !== 3) || typeof p.exp !== "number") {
      return null;
    }
    if (p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}
