import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type TokenPayload } from "./jwt";
import { getAuthCookies } from "./cookies";

export type AuthedRequest = Request & { user: TokenPayload };

export async function getSession(req: Request): Promise<TokenPayload | null> {
  const { access } = getAuthCookies(req);

  if (access) {
    const payload = await verifyAccessToken(access);
    if (payload) return payload;
  }

  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  getSession(req)
    .then((session) => {
      if (!session) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      (req as AuthedRequest).user = session;
      next();
    })
    .catch((e) => next(e));
}
