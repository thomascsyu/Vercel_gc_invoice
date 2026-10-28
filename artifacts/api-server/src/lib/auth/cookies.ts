import type { Response, Request } from "express";

export const ACCESS_COOKIE = "ip_access_token";
export const REFRESH_COOKIE = "ip_refresh_token";

const isSecure = (req: Request) => {
  if (process.env["FORCE_SECURE_COOKIES"]) return true;
  return req.secure || req.headers["x-forwarded-proto"] === "https";
};

const sameSite = (req: Request): "none" | "lax" | undefined => {
  if (process.env["FORCE_SAMESITE_NONE"]) return "none";
  return isSecure(req) ? "none" : "lax";
};

export function setAuthCookies(
  res: Response,
  req: Request,
  accessToken: string,
  refreshToken: string,
): void {
  const secure = isSecure(req);
  const samesite = sameSite(req);

  res.cookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure,
    sameSite: samesite,
    maxAge: 1000 * 60 * 15, // 15 minutes
    path: "/",
  });

  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: samesite,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
}

export function clearAuthCookies(res: Response, req: Request): void {
  const secure = isSecure(req);
  const samesite = sameSite(req);

  res.clearCookie(ACCESS_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: samesite,
    path: "/",
  });

  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: samesite,
    path: "/",
  });
}

export function getAuthCookies(req: Request): { access?: string; refresh?: string } {
  return {
    access: req.cookies?.[ACCESS_COOKIE],
    refresh: req.cookies?.[REFRESH_COOKIE],
  };
}
