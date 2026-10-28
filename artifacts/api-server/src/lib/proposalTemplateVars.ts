import {
  clientsTable,
  companySettingsTable,
  consultantsTable,
  proposalDocumentsTable,
  type CompanyProposalProfile,
  type ProposalTemplateData,
} from "@workspace/db";
import {
  APPROACH_PHASE_TEMPLATES,
  DEFAULT_COMPANY_PROFILE,
  DEFAULT_SERVICE_LIST,
  DEFAULT_TERMS_TEMPLATE,
  OPTIONAL_MAINTENANCE_SECTIONS,
  SCOPE_REMARK,
  formatAuditType,
  formatManagementSystemDisplay,
  formatManagementSystemFull,
  formatManualName,
  formatPolicyName,
  formatProceduresName,
  formatProposalRevision,
  formatProposalTitle,
  formatStandardsDisplay,
  formatStandardsShort,
  formatSystemAbbreviations,
  formatSystemIssuesDisplay,
  interpolateTemplate,
  resolveIsoStandards,
} from "./proposalTemplateLibrary";

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatDateLong(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return `${String(d).padStart(2, "0")} ${MONTHS_LONG[m - 1]} ${y}`;
}

function companyAddress(settings: typeof companySettingsTable.$inferSelect | undefined): string {
  const lines = [
    settings?.addressLine1,
    settings?.addressLine2,
    settings?.addressLine3,
    settings?.addressLine4,
  ].filter(Boolean);
  if (lines.length) return lines.join(", ");
  return settings?.address?.trim() ?? "";
}

function totalStaffCount(
  proposal: typeof proposalDocumentsTable.$inferSelect,
): number | undefined {
  const locations = (proposal.certificationLocations ?? []) as { staffCount?: number }[];
  if (locations.length) {
    const total = locations.reduce((sum, loc) => sum + (loc.staffCount ?? 0), 0);
    return total > 0 ? total : undefined;
  }
  return proposal.clientStaffCount ?? undefined;
}

function scopeAddress(proposal: typeof proposalDocumentsTable.$inferSelect): string {
  const locations = (proposal.certificationLocations ?? []) as { address?: string }[];
  const lines = locations.map((l) => l.address?.trim()).filter(Boolean) as string[];
  if (lines.length) return lines.join("\n");
  return "";
}

export function buildTemplateVarMap(input: {
  proposal: typeof proposalDocumentsTable.$inferSelect;
  client: typeof clientsTable.$inferSelect | null;
  settings: typeof companySettingsTable.$inferSelect | undefined;
}): Record<string, string> {
  const { proposal, client, settings } = input;
  const profile = (settings?.proposalProfile ?? {}) as CompanyProposalProfile;
  const templateData = (proposal.templateData ?? {}) as ProposalTemplateData;
  const standards = resolveIsoStandards((proposal.isoStandards as string[]) ?? []);
  const cb = templateData.certificationBody ?? {};
  const terms = templateData.terms ?? {};
  const sales = templateData.salesContact ?? {};
  const revisionLabel = formatProposalRevision(proposal.proposalRevision);
  const cbShort = cb.shortName?.trim() || cb.name?.trim() || "";
  const auditType = templateData.auditType?.trim() || formatAuditType(standards);

  const vars: Record<string, string> = {
    "proposal.number": proposal.proposalNo,
    "proposal.revision": revisionLabel,
    "proposal.issue_date": formatDateLong(proposal.validFrom),
    "proposal.valid_until": formatDateLong(proposal.validUntil),
    "proposal.title": templateData.proposalTitle?.trim() || formatProposalTitle(standards),

    "consultant.company_name": settings?.companyName?.trim() || "Gabriel Consultant Limited",
    "consultant.short_name": profile.shortName?.trim() || "Gabriel",
    "consultant.address": companyAddress(settings),
    "consultant.phone": settings?.phone?.trim() ?? "",
    "consultant.email": settings?.email?.trim() ?? "",
    "consultant.website": profile.website?.trim() || "www.gabriel.hk",
    "consultant.slogan": profile.slogan?.trim() || "WHERE SATISFACTION GETS FOUND",
    "consultant.established_year": profile.establishedYear?.trim() || "2008",
    "consultant.headquarter_location": profile.headquarterLocation?.trim() || "Hong Kong",
    "consultant.certifications_display":
      profile.certificationsDisplay?.trim() || "an accredited ISO consultancy firm",

    "sales_contact.name": sales.name?.trim() ?? "",
    "sales_contact.title": sales.title?.trim() ?? "",
    "sales_contact.phone": sales.phone?.trim() ?? "",
    "sales_contact.email": sales.email?.trim() ?? "",

    "client.contact_name": client?.contactPerson?.trim() ?? "",
    "client.company_name": client?.name?.trim() ?? "—",
    "client.address": scopeAddress(proposal) || companyAddress(settings),
    "client.phone": client?.phone?.trim() ?? "",
    "client.email": client?.email?.trim() ?? "",

    "service.standards_display": formatStandardsDisplay(standards),
    "service.standards_short_display": formatStandardsShort(standards),
    "service.management_system_display": formatManagementSystemDisplay(standards),
    "service.management_system_full_display": formatManagementSystemFull(standards),
    "service.system_abbreviations_display": formatSystemAbbreviations(standards),
    "service.system_issues_display": formatSystemIssuesDisplay(standards),
    "service.policy_name": formatPolicyName(standards),
    "service.manual_name": formatManualName(standards),
    "service.procedures_name": formatProceduresName(standards),
    "service.audit_type": auditType,

    "certification_body.short_name": cbShort,
    "certification_body.name": cb.name?.trim() ?? "",
    "certification_body.description": cb.description?.trim() || proposal.certificationBodyIntro?.trim() || "",

    "scope.address": scopeAddress(proposal),
    "scope.staff_count": totalStaffCount(proposal) != null ? String(totalStaffCount(proposal)) : "",
    "scope.certification_scope": proposal.proposalScope?.trim() ?? "",
    "scope.scope_remark": SCOPE_REMARK,

    "terms.commencement_days": String(terms.commencementDays ?? 14),
    "terms.invoice_due_days": String(terms.invoiceDueDays ?? 14),
    "terms.claims_cap": terms.claimsCap?.trim() || "HK$ 1,000",

    "support.office_hours":
      templateData.optionalMaintenance?.supportHours?.trim() ||
      "Monday to Friday, 10:00 AM - 6:00 PM, excluding public holidays",
  };

  return vars;
}

export function renderCompanyProfile(vars: Record<string, string>, customIntro?: string | null): string {
  if (customIntro?.trim()) return customIntro.trim();
  return interpolateTemplate(DEFAULT_COMPANY_PROFILE, vars);
}

export function renderTerms(vars: Record<string, string>, customTerms?: string | null): string {
  if (customTerms?.trim()) return customTerms.trim();
  return interpolateTemplate(DEFAULT_TERMS_TEMPLATE, vars);
}

export function renderIntroduction(vars: Record<string, string>): string {
  const lines = [
    `To assist ${vars["client.company_name"]} (THE CLIENT) to set up ${vars["service.standards_display"]} ${vars["service.management_system_display"]} and assist ${vars["service.audit_type"]}${vars["certification_body.short_name"] ? ` by ${vars["certification_body.short_name"]}` : ""}.`,
    "",
    vars["scope.address"] ? `Address:\n${vars["scope.address"]}` : "",
    vars["scope.staff_count"] ? `Staff:\n${vars["scope.staff_count"]}` : "",
    vars["scope.certification_scope"] ? `Scope:\n${vars["scope.certification_scope"]}` : "",
    "",
    `Proposed scope of Certification`,
    "",
    `Remark: ${vars["scope.scope_remark"]}`,
  ];
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

export function renderApproachPhase(
  index: number,
  vars: Record<string, string>,
  custom?: { title?: string; description?: string; deliverable?: string },
): { title: string; blocks: { label: string; text: string }[] } {
  const template = APPROACH_PHASE_TEMPLATES[index] ?? APPROACH_PHASE_TEMPLATES[0];
  const title = custom?.title?.trim() || template.title;
  const activities = custom?.description?.trim() || interpolateTemplate(template.activities, vars);
  const keyOutcome = custom?.deliverable?.trim() || interpolateTemplate(template.keyOutcome, vars);
  return {
    title,
    blocks: [
      { label: "Objective", text: interpolateTemplate(template.objective, vars) },
      { label: "Our Activities", text: activities },
      { label: "Key Outcome", text: keyOutcome },
      { label: "Your Involvement", text: interpolateTemplate(template.clientInvolvement, vars) },
    ],
  };
}

export function renderOptionalMaintenance(vars: Record<string, string>): string[] {
  return OPTIONAL_MAINTENANCE_SECTIONS.map((s, i) =>
    `${i + 1}. ${interpolateTemplate(s, vars)}`,
  );
}

export function defaultServiceList(profile?: CompanyProposalProfile): string {
  const list = profile?.serviceList?.length ? profile.serviceList : DEFAULT_SERVICE_LIST;
  return list.join(", ");
}

export type ProposalTemplateContext = ReturnType<typeof buildProposalTemplateContext>;

export function buildProposalTemplateContext(input: {
  proposal: typeof proposalDocumentsTable.$inferSelect;
  client: typeof clientsTable.$inferSelect | null;
  settings: typeof companySettingsTable.$inferSelect | undefined;
  consultants: (typeof consultantsTable.$inferSelect)[];
}) {
  const vars = buildTemplateVarMap(input);
  const templateData = (input.proposal.templateData ?? {}) as ProposalTemplateData;
  const standards = resolveIsoStandards((input.proposal.isoStandards as string[]) ?? []);
  const profile = (input.settings?.proposalProfile ?? {}) as CompanyProposalProfile;
  const cb = templateData.certificationBody ?? {};

  return {
    vars,
    standards,
    profile,
    templateData,
    showCertificationBody: Boolean(cb.enabled && (cb.name?.trim() || cb.description?.trim() || input.proposal.certificationBodyIntro?.trim())),
    showOptionalMaintenance: Boolean(templateData.optionalMaintenance?.enabled),
    showCertificationFees: Boolean(
      cb.enabled && (templateData.feeRows ?? []).some((r) => (r.certificationFee ?? 0) > 0),
    ),
    companyProfile: renderCompanyProfile(vars, input.proposal.firmIntro),
    introduction: renderIntroduction(vars),
    terms: renderTerms(vars, input.proposal.termsConditions),
    optionalMaintenance: renderOptionalMaintenance(vars),
    serviceList: defaultServiceList(profile),
  };
}
