import type { ProposalActivity, ProposalDocument, ProposalPhase, ProposalStatus } from "@/lib/modulesApi";

export const DEFAULT_PHASES: ProposalPhase[] = [
  {
    phase: 1,
    title: "Review the existing system",
    description:
      "Conduct a comprehensive review of the client's existing management system, processes, and documentation against the target ISO standard requirements.",
    weeks: 6,
    startMonth: 1,
    spanMonths: 2,
  },
  {
    phase: 2,
    title: "Documentation",
    description:
      "Develop and refine required documentation including policies, procedures, work instructions, and records to meet certification requirements.",
    weeks: 4,
    startMonth: 3,
    spanMonths: 1,
  },
  {
    phase: 3,
    title: "Implementation",
    description:
      "Support implementation of the management system across the organisation, including internal audit preparation and staff awareness.",
    weeks: 12,
    startMonth: 4,
    spanMonths: 2,
  },
  {
    phase: 4,
    title: "Certification Audit",
    description:
      "Accompany and support the client through the certification audit with the certification body.",
    weeks: 2,
    startMonth: 6,
    spanMonths: 1,
  },
];

export const DEFAULT_PAYMENT_SCHEDULE = [
  { label: "Confirmation of proposal", percentage: 25 },
  { label: "Submission of document", percentage: 25 },
  { label: "Completion of Internal Audit", percentage: 25 },
  { label: "After passing Certification Audit", percentage: 25 },
];

export const MAX_PROPOSAL_CONSULTANTS = 3;

export const PROPOSAL_STATUSES: ProposalStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "confirmed",
  "revision_requested",
  "no_response",
  "rejected",
  "expired",
  "superseded",
  "cancelled",
];

export const ISO_STANDARD_OPTIONS = [
  { code: "ISO 9001", label: "ISO 9001", description: "Quality management systems" },
  { code: "ISO 14001", label: "ISO 14001", description: "Environmental management" },
  { code: "ISO 45001", label: "ISO 45001", description: "Occupational health & safety" },
  { code: "ISO 27001", label: "ISO 27001", description: "Information security management" },
  { code: "ISO 22000", label: "ISO 22000", description: "Food safety management" },
  { code: "ISO 50001", label: "ISO 50001", description: "Energy management" },
] as const;

export function statusBadge(status: ProposalStatus | string) {
  const map: Record<string, string> = {
    draft: "bg-slate-500/10 text-slate-700 border-slate-200",
    pending_approval: "bg-amber-500/10 text-amber-700 border-amber-200",
    approved: "bg-blue-500/10 text-blue-700 border-blue-200",
    sent: "bg-indigo-500/10 text-indigo-700 border-indigo-200",
    confirmed: "bg-green-500/10 text-green-700 border-green-200",
    revision_requested: "bg-orange-500/10 text-orange-700 border-orange-200",
    no_response: "bg-gray-500/10 text-gray-700 border-gray-200",
    rejected: "bg-red-500/10 text-red-700 border-red-200",
    expired: "bg-orange-500/10 text-orange-700 border-orange-200",
    superseded: "bg-muted text-muted-foreground",
    cancelled: "bg-red-500/10 text-red-700 border-red-200",
  };
  return map[status] ?? "bg-muted";
}

export function formatLabel(s: string) {
  return s.replace(/_/g, " ");
}

export function eventLabel(type: string, data?: Record<string, unknown>) {
  switch (type) {
    case "link_opened": return "Link opened";
    case "pdf_viewed": return "PDF viewed";
    case "pdf_downloaded": return "PDF downloaded";
    case "question_raised": return `Question: ${String(data?.questionText ?? "").slice(0, 80)}`;
    case "confirmed": return `Confirmed by ${String(data?.signatureName ?? "client")}`;
    case "revision_requested": return `Revision requested: ${String(data?.comment ?? "").slice(0, 80)}`;
    case "sent": return "Sent to client";
    case "approved": return "Approved";
    case "submitted": return "Submitted for approval";
    case "no_response": return "Marked no response";
    case "rejected": return `Rejected${data?.reason ? `: ${String(data.reason).slice(0, 80)}` : ""}`;
    case "cancelled": return `Cancelled${data?.reason ? `: ${String(data.reason).slice(0, 80)}` : ""}`;
    case "milestone_invoiced": return `Milestone invoiced: ${String(data?.invoiceNumber ?? data?.invoiceId ?? "").slice(0, 80)}`;
    default: return type;
  }
}

export function sharePreviewUrl(p: Pick<ProposalDocument, "id" | "shareToken">): string | null {
  if (!p.shareToken) return null;
  const base = import.meta.env.BASE_URL ?? "/";
  const path = `${base}proposals/${p.id}/preview?token=${encodeURIComponent(p.shareToken)}`.replace(/\/+/g, "/");
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export function validityDays(validFrom?: string, validUntil?: string): number | null {
  if (!validFrom || !validUntil) return null;
  const start = new Date(validFrom);
  const end = new Date(validUntil);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}
