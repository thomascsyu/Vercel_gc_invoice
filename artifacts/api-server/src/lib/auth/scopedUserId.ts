import type { Request } from "express";
import type { AuthedRequest } from "./requireAuth";

/** Workspace-scoped Google sub for business data (set by requireAuth). */
export function scopedDataUserId(req: Request): string {
  const id = (req as AuthedRequest).dataUserId;
  if (!id) {
    throw new Error("Missing dataUserId — requireAuth must run before this handler");
  }
  return id;
}
