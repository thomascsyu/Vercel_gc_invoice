import type { AuditVisitStatus } from "@workspace/api-client-react";

export function formatAuditVisitStatus(status?: AuditVisitStatus | null): string {
  if (!status) return "";
  if (status === "sv") return "SV";
  if (status === "rn") return "RN";
  return "SV & RN";
}
