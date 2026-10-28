import * as jose from "jose";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 15; // 15 minutes
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// 32 chars is a floor, not a target: it's the minimum needed so a short,
// human-chosen secret can't be brute-forced offline against a captured
// HS256 token (the payload includes `role`, so a forged token is a full
// admin-impersonation bypass of OAuth). Operators should use a long random
// value, not exactly 32 characters.
export const MIN_JWT_SECRET_LENGTH = 32;

function jwtSecret(): Uint8Array | null {
  const s = process.env["JWT_SECRET"];
  if (!s || s.length < MIN_JWT_SECRET_LENGTH) return null;
  return new TextEncoder().encode(s);
}

export function getJwtSecret(): Uint8Array {
  const secret = jwtSecret();
  if (!secret) {
    throw new Error(`JWT_SECRET must be set and at least ${MIN_JWT_SECRET_LENGTH} characters long`);
  }
  return secret;
}

export type TokenPayload = {
  sub: string;
  email: string;
  role: "admin" | "user";
  fullName?: string;
  typ: "access" | "refresh";
  /** Refresh tokens only: the user's `refreshTokenVersion` at issuance, used to detect reuse of an already-rotated token. */
  ver?: number;
};

export async function createAccessToken(payload: Omit<TokenPayload, "typ" | "ver">): Promise<string> {
  const secret = getJwtSecret();
  return new jose.SignJWT({ ...payload, typ: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function createRefreshToken(payload: Omit<TokenPayload, "typ" | "ver">, ver: number): Promise<string> {
  const secret = getJwtSecret();
  return new jose.SignJWT({ ...payload, typ: "refresh", ver })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const secret = getJwtSecret();
    const { payload } = await jose.jwtVerify(token, secret);
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

/** Only accepts access tokens (rejects refresh tokens used as access). */
export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
  const payload = await verifyToken(token);
  if (!payload || payload.typ !== "access") return null;
  return payload;
}

export async function verifyRefreshToken(token: string): Promise<TokenPayload | null> {
  const payload = await verifyToken(token);
  if (!payload || payload.typ !== "refresh") return null;
  return payload;
}
