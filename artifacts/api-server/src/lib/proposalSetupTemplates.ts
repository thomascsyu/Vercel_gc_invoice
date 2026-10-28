import type {
  ProposalPaymentScheduleItem,
  ProposalPhase,
  ProposalSetupTemplate,
  ProposalSetupTemplateId,
  ProposalSetupTemplates,
} from "@workspace/db";
import { DEFAULT_PAYMENT_SCHEDULE, DEFAULT_TERMS } from "./proposalDefaults";

const SHARED_PAYMENT: ProposalPaymentScheduleItem[] = DEFAULT_PAYMENT_SCHEDULE;

const ISO9001_PHASES: ProposalPhase[] = [
  {
    phase: 1,
    title: "Gap analysis & planning",
    description:
      "Review existing quality processes, documentation, and organisational context against ISO 9001:2015 requirements. Identify gaps and define the certification roadmap.",
    deliverable: "Gap analysis report and implementation plan",
    weeks: 6,
    startMonth: 1,
    spanMonths: 2,
  },
  {
    phase: 2,
    title: "QMS documentation",
    description:
      "Develop and refine the quality manual, procedures, work instructions, forms, and records required for ISO 9001 certification.",
    deliverable: "Approved QMS documentation set",
    weeks: 4,
    startMonth: 3,
    spanMonths: 1,
  },
  {
    phase: 3,
    title: "Implementation & internal audit",
    description:
      "Support rollout of the QMS, staff awareness, process monitoring, and preparation for internal audit.",
    deliverable: "Internal audit report and corrective action records",
    weeks: 12,
    startMonth: 4,
    spanMonths: 2,
  },
  {
    phase: 4,
    title: "Certification audit support",
    description:
      "Accompany the client through Stage 1 and Stage 2 certification audits with the certification body.",
    deliverable: "Certification audit support and closure of audit findings",
    weeks: 2,
    startMonth: 6,
    spanMonths: 1,
  },
];

const ISO14001_45001_PHASES: ProposalPhase[] = [
  {
    phase: 1,
    title: "Environmental & safety review",
    description:
      "Assess environmental aspects, legal compliance, hazards, and OH&S risks against ISO 14001:2015 and ISO 45001:2018 requirements.",
    deliverable: "Aspects/impacts register, hazard identification, and legal compliance review",
    weeks: 6,
    startMonth: 1,
    spanMonths: 2,
  },
  {
    phase: 2,
    title: "Integrated EMS & OHS documentation",
    description:
      "Develop integrated policies, procedures, emergency plans, and operational controls covering environment and occupational health & safety.",
    deliverable: "Integrated EMS/OHS documentation package",
    weeks: 5,
    startMonth: 3,
    spanMonths: 1,
  },
  {
    phase: 3,
    title: "Implementation & worker participation",
    description:
      "Roll out controls, contractor coordination, monitoring programmes, incident reporting, and worker consultation mechanisms.",
    deliverable: "Implementation records, monitoring logs, and training attendance",
    weeks: 14,
    startMonth: 4,
    spanMonths: 2,
  },
  {
    phase: 4,
    title: "Internal audit & certification",
    description:
      "Conduct integrated internal audits and support dual certification audits for ISO 14001 and ISO 45001.",
    deliverable: "Internal audit reports and certification audit accompaniment",
    weeks: 3,
    startMonth: 6,
    spanMonths: 1,
  },
];

const ISO27001_PHASES: ProposalPhase[] = [
  {
    phase: 1,
    title: "ISMS scoping & risk assessment",
    description:
      "Define the information security management system scope, asset inventory, and risk assessment methodology aligned with ISO/IEC 27001:2022.",
    deliverable: "ISMS scope statement and risk assessment report",
    weeks: 5,
    startMonth: 1,
    spanMonths: 2,
  },
  {
    phase: 2,
    title: "Statement of Applicability & policies",
    description:
      "Select Annex A controls, prepare the Statement of Applicability, and develop information security policies and procedures.",
    deliverable: "Statement of Applicability and ISMS policy set",
    weeks: 5,
    startMonth: 3,
    spanMonths: 1,
  },
  {
    phase: 3,
    title: "Control implementation",
    description:
      "Implement technical and organisational controls, access management, incident response, supplier security, and security awareness training.",
    deliverable: "Implemented controls evidence and awareness training records",
    weeks: 12,
    startMonth: 4,
    spanMonths: 2,
  },
  {
    phase: 4,
    title: "Internal audit & certification",
    description:
      "Perform ISMS internal audit and support the certification audit with the certification body.",
    deliverable: "Internal audit report and certification audit support",
    weeks: 2,
    startMonth: 6,
    spanMonths: 1,
  },
];

export const PROPOSAL_SETUP_TEMPLATE_IDS: ProposalSetupTemplateId[] = [
  "iso9001",
  "iso14001-45001",
  "iso27001",
];

export const DEFAULT_PROPOSAL_SETUP_TEMPLATES: ProposalSetupTemplates = {
  iso9001: {
    label: "ISO 9001",
    description: "Quality management system (ISO 9001:2015) consulting proposal defaults.",
    isoStandards: ["ISO 9001:2015"],
    proposalScope:
      "Design, documentation, implementation, and certification support for an ISO 9001:2015 quality management system.",
    scopePhases: ISO9001_PHASES,
    paymentSchedule: SHARED_PAYMENT,
    termsConditions: DEFAULT_TERMS,
    jobReferenceTemplateIds: ["bea-iso9001", "manufacturing-iso14001", "summit-construction-iso9001"],
    testimonialTemplateIds: ["fhki-chairman", "manufacturing-gm", "construction-md"],
  },
  "iso14001-45001": {
    label: "ISO 14001 & ISO 45001",
    description:
      "Integrated environmental and occupational health & safety management system proposal defaults.",
    isoStandards: ["ISO 14001:2015", "ISO 45001:2018"],
    proposalScope:
      "Integrated ISO 14001 environmental management and ISO 45001 occupational health & safety certification support.",
    scopePhases: ISO14001_45001_PHASES,
    paymentSchedule: SHARED_PAYMENT,
    termsConditions: DEFAULT_TERMS,
    jobReferenceTemplateIds: ["manufacturing-iso14001", "logistics-iso45001"],
    testimonialTemplateIds: ["logistics-director", "manufacturing-gm"],
  },
  iso27001: {
    label: "ISO 27001",
    description: "Information security management system (ISO/IEC 27001:2022) consulting proposal defaults.",
    isoStandards: ["ISO/IEC 27001:2022"],
    proposalScope:
      "Establish and certify an ISO/IEC 27001:2022 information security management system covering people, processes, and technology.",
    scopePhases: ISO27001_PHASES,
    paymentSchedule: SHARED_PAYMENT,
    termsConditions: DEFAULT_TERMS,
    jobReferenceTemplateIds: ["omnichat-iso27001"],
    testimonialTemplateIds: ["bbpos-ceo"],
  },
};

function deepCloneTemplate(template: ProposalSetupTemplate): ProposalSetupTemplate {
  return {
    ...template,
    isoStandards: [...template.isoStandards],
    scopePhases: template.scopePhases.map((p) => ({ ...p })),
    paymentSchedule: template.paymentSchedule.map((p) => ({ ...p })),
    jobReferenceTemplateIds: template.jobReferenceTemplateIds
      ? [...template.jobReferenceTemplateIds]
      : undefined,
    testimonialTemplateIds: template.testimonialTemplateIds
      ? [...template.testimonialTemplateIds]
      : undefined,
  };
}

function mergeTemplate(
  id: ProposalSetupTemplateId,
  stored: Partial<ProposalSetupTemplate> | undefined,
): ProposalSetupTemplate {
  const base = deepCloneTemplate(DEFAULT_PROPOSAL_SETUP_TEMPLATES[id]);
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    isoStandards: stored.isoStandards?.length ? [...stored.isoStandards] : base.isoStandards,
    scopePhases: stored.scopePhases?.length
      ? stored.scopePhases.map((p, i) => ({ ...base.scopePhases[i], ...p, phase: i + 1 }))
      : base.scopePhases,
    paymentSchedule: stored.paymentSchedule?.length
      ? stored.paymentSchedule.map((p) => ({ ...p }))
      : base.paymentSchedule,
    jobReferenceTemplateIds:
      stored.jobReferenceTemplateIds !== undefined
        ? [...stored.jobReferenceTemplateIds]
        : base.jobReferenceTemplateIds,
    testimonialTemplateIds:
      stored.testimonialTemplateIds !== undefined
        ? [...stored.testimonialTemplateIds]
        : base.testimonialTemplateIds,
  };
}

export function mergeProposalSetupTemplates(
  stored: Partial<ProposalSetupTemplates> | null | undefined,
): ProposalSetupTemplates {
  return {
    iso9001: mergeTemplate("iso9001", stored?.iso9001),
    "iso14001-45001": mergeTemplate("iso14001-45001", stored?.["iso14001-45001"]),
    iso27001: mergeTemplate("iso27001", stored?.iso27001),
  };
}
