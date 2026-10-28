import type { Request, Response, NextFunction } from "express";
import type { AuthedRequest } from "./requireAuth";

/** Express middleware: requires `role === "admin"` after `requireAuth`. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if ((req as AuthedRequest).role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
