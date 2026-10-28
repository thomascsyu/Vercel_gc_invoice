import type { ProposalPaymentScheduleItem, ProposalPhase } from "@workspace/db";

/** Four-phase consultancy approach aligned with the presentation-style ISO proposal template. */
export const DEFAULT_SCOPE_PHASES: ProposalPhase[] = [
  {
    phase: 1,
    title: "System Review & Foundation",
    description:
      "We meet with representatives from your key departments to review existing documents, operational processes, and how quality, environmental and safety issues are handled. This collaborative review determines your current level of alignment with ISO requirements.",
    deliverable: "A clear, agreed-upon list of necessary actions and priorities to build your system upon.",
    weeks: 6,
    startMonth: 1,
    spanMonths: 2,
  },
  {
    phase: 2,
    title: "System Documentation",
    description:
      "We draft the core English-language documentation required by the standard, including policies, manuals, procedures, and forms. We guide your team in creating practical Work Instructions and conduct a foundational ISO awareness training session for your staff.",
    deliverable:
      "A fully documented, easy-to-use management system that meets the standard and reflects your operations, together with ISO training.",
    weeks: 4,
    startMonth: 2,
    spanMonths: 1,
  },
  {
    phase: 3,
    title: "System Implementation & Internal Check",
    description:
      "We provide hands-on support through on-site or virtual advisory visits, remote support for daily questions, and assistance planning and conducting your first Internal Audit and Management Review meeting.",
    deliverable:
      "A live, functioning management system, completion of your mandatory internal audit, and a ready management team.",
    weeks: 12,
    startMonth: 2,
    spanMonths: 4,
  },
  {
    phase: 4,
    title: "Certification Audit Support",
    description:
      "A consultant from our team will attend the certification audit with you, provide on-the-spot advice, and help formulate effective responses and corrective action plans if the auditor identifies any non-conformities.",
    deliverable:
      "Expert support during the critical audit to facilitate a smooth process and address any findings.",
    weeks: 2,
    startMonth: 5,
    spanMonths: 1,
  },
];

export const DEFAULT_PAYMENT_SCHEDULE: ProposalPaymentScheduleItem[] = [
  { label: "After confirmation of this proposal", percentage: 70 },
  { label: "After passing Certification Audit", percentage: 30 },
];

/** Short fallback when no template-driven terms are available. */
export const DEFAULT_TERMS =
  "This proposal is valid for the period stated on the cover page. Fees are exclusive of any certification body charges unless otherwise stated. Payment terms follow the schedule outlined in this document.";
