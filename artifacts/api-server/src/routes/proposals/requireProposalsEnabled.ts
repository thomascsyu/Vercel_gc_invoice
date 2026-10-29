import type { NextFunction, Request, Response } from "express";
import { proposalsEnabled } from "../../lib/featureFlags";

export function requireProposalsEnabled(req: Request, res: Response, next: NextFunction): void {
  if (!proposalsEnabled()) {
    res.status(404).json({ error: "Not found", code: "PROPOSALS_DISABLED" });
    return;
  }
  next();
}
