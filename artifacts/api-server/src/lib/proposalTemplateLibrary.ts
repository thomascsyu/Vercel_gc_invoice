/** ISO standard metadata and reusable proposal wording (presentation-style template). */

export type IsoStandardMeta = {
  code: string;
  version: string;
  systemName: string;
  abbreviation: string;
  benefits: string[];
};

export const ISO_STANDARD_LIBRARY: Record<string, IsoStandardMeta> = {
  "ISO 9001": {
    code: "ISO 9001",
    version: "2015",
    systemName: "Quality Management System",
    abbreviation: "QMS",
    benefits: [
      "Improved customer satisfaction and service quality",
      "Consistent processes and operational efficiency",
      "Better risk management and continual improvement",
      "Enhanced credibility with customers and stakeholders",
      "Foundation for integrated management systems",
    ],
  },
  "ISO 14001": {
    code: "ISO 14001",
    version: "2015",
    systemName: "Environmental Management System",
    abbreviation: "EMS",
    benefits: [
      "Environmental legislation compliance",
      "Increased credibility with environmentally conscious clients",
      "Environmental risk management",
      "Continual environmental improvement",
      "Resource efficiency and waste reduction",
    ],
  },
  "ISO 45001": {
    code: "ISO 45001",
    version: "2018",
    systemName: "Occupational Health and Safety Management System",
    abbreviation: "OHSMS",
    benefits: [
      "Safety legislation compliance",
      "Occupational health and safety risk management",
      "Injury and accident reduction",
      "Increased worker awareness and participation",
      "Integration with ISO 9001 and ISO 14001",
    ],
  },
  "ISO 27001": {
    code: "ISO 27001",
    version: "2022",
    systemName: "Information Security Management System",
    abbreviation: "ISMS",
    benefits: [
      "Protection of confidential information",
      "Risk-based approach to information security",
      "Regulatory and contractual compliance",
      "Customer and partner confidence",
      "Continual improvement of security controls",
    ],
  },
};

export const DEFAULT_SERVICE_LIST = [
  "ISO 9001:2015",
  "ISO 14001:2015",
  "ISO 45001:2018",
  "ISO 27001:2022",
  "ISO 10002:2014",
  "ISO 22000:2018",
  "ISO 20000:2018",
  "FSC",
  "CE Marking",
  "EcoVadis",
];

export const DEFAULT_COMPANY_PROFILE = `The Company

We provide professional ISO certification consulting services for different industries.

Since {{consultant.established_year}} establishment of Headquarter in {{consultant.headquarter_location}}, our Consultant Firm is {{consultant.certifications_display}}. We provide professional consulting services for different industries including: Government Departments, Theme Park, Airlines, Listed Companies, different service providers, logistics service, professional service, manufacturing, construction and trading.

Under our commitment "{{consultant.slogan}}", we are committed to provide practical, flexible, effective and swift one-stop solution, and enable client's management level more excellent.`;

export const TEAM_SECTION_INTRO =
  "Our consultant team supports clients throughout the certification process, from system setup to certification audit support.";

export const APPROACH_SECTION_INTRO =
  "Our consultancy service is structured into clear, sequential phases to ensure a straightforward and effective path to certification. Each phase has defined outcomes and outlines how we will work together.";

export const APPROACH_PHASE_TEMPLATES = [
  {
    title: "System Review & Foundation",
    objective:
      "To understand your current operations and identify the specific actions needed for compliance.",
    activities:
      "We meet with representatives from your key departments to review existing documents, operational processes, and how {{service.system_issues_display}} are handled. This collaborative review determines your current level of alignment with {{service.standards_display}} requirements.",
    keyOutcome: "A clear, agreed-upon list of necessary actions and priorities to build your system upon.",
    clientInvolvement:
      "Providing department representatives for meetings and sharing current process documentation.",
  },
  {
    title: "System Documentation",
    objective:
      "To develop a complete and compliant set of {{service.management_system_full_display}} documents tailored to your organization.",
    activities:
      "We draft the core English-language documentation required by the standard, including the {{service.policy_name}}, {{service.manual_name}}, {{service.procedures_name}}, and Forms. We then guide your team in creating practical, department-specific Work Instructions. We also conduct a foundational {{service.standards_display}} awareness training session for your staff.",
    keyOutcome:
      "A fully documented, easy-to-use {{service.system_abbreviations_display}} that meets the standard and reflects your operations, together with {{service.standards_display}} training.",
    clientInvolvement:
      "Providing input to ensure documents match your processes, involvement in developing Work Instructions with our guidance, and having staff attend the training.",
  },
  {
    title: "System Implementation & Internal Check",
    objective:
      "To actively support the launch of your {{service.system_abbreviations_display}} in daily operations and prepare for the official audit.",
    activities:
      "We provide hands-on support through on-site or virtual advisory visits to help troubleshoot issues and review early records. You will have access to remote support for daily questions. We assist in planning and conducting your first Internal Audit and help prepare the documentation for the Management Review meeting.",
    keyOutcome:
      "A live, functioning {{service.system_abbreviations_display}}, completion of your mandatory internal audit, and a ready management team.",
    clientInvolvement:
      "Applying the {{service.system_abbreviations_display}} in daily work, participating in the internal audit, providing information for management review, and using our support channels for guidance.",
  },
  {
    title: "Certification Audit Support",
    objective: "To provide expert guidance during the final certification audit for a successful outcome.",
    activities:
      "A consultant from our team will attend the certification audit with you. We will provide on-the-spot advice and help formulate effective responses and corrective action plans if the auditor identifies any non-conformities.",
    keyOutcome:
      "Expert support during the critical audit to facilitate a smooth process and address any findings.",
    clientInvolvement:
      "Ensuring your team and records are prepared and available, and implementing any agreed-upon corrective actions after the audit.",
  },
] as const;

export const OPTIONAL_MAINTENANCE_SECTIONS = [
  "Professional Guidance on {{service.standards_short_display}} — Deliver expert advice to enhance the effectiveness of {{service.system_abbreviations_display}}. Provide project management support for smooth service delivery, available through phone and email during {{support.office_hours}}.",
  "{{service.standards_short_display}} Awareness Training — Facilitate training sessions for the ISO Committee to refresh their knowledge of {{service.standards_display}}, ensuring they are well-prepared for audits.",
  "Compliance-Based Evaluation — Conduct a compliance assessment against {{service.standards_display}}, identifying areas for improvement. Collaborate on an action plan based on the evaluation results.",
  "{{service.standards_short_display}} Internal Audit — Perform internal audits of {{service.system_abbreviations_display}} in line with {{service.standards_display}} requirements.",
  "Support for Management Review Meetings — Assist with the annual Management Review Meeting to ensure effective discussions and planning.",
  "Surveillance Audit Preparation and Support — Provide guidance for the {{service.standards_display}} Surveillance Audit. Assist in the audit process, offering advisory support and developing corrective action plans based on findings.",
];

export const DEFAULT_TERMS_TEMPLATE = `Terms & Conditions

Validity of Proposal
Valid until {{proposal.valid_until}}.

Commencement of Project
Within {{terms.commencement_days}} days after the receipt of the first payment.

Payment of Consultancy Fees
Payments shall be followed by the agreed payment schedule. For continuous delay in payment, {{consultant.short_name}} reserves the right to terminate the project on behalf of THE CLIENT.

Termination
Should THE CLIENT be dissatisfied with any of the services provided by {{consultant.short_name}}, it is agreed that THE CLIENT may reserve the right to terminate this proposal at any particular phase, subject to full payment being made to {{consultant.short_name}} for those services completed by {{consultant.short_name}} up to the phase where such notification to {{consultant.short_name}} is received in writing.

Certification Fee
The consultancy fee mentioned above excludes all fees charged by Certification Body.

Certification Guarantee
In case THE CLIENT fails in the {{service.standards_short_display}} certification audit due to system setup, {{consultant.short_name}} will continue to work with THE CLIENT at no additional charge.

Confidentiality of Information
{{consultant.short_name}} shall regard and preserve as confidential all documents produced during consultancy services and shall not disclose to third parties without written consent by THE CLIENT.

Claims for Loss and Damage
{{consultant.short_name}} shall indemnify and keep THE CLIENT indemnified for any loss and damages arising from any claims against THE CLIENT by third party in relation to the aforementioned with a maximum amount of {{terms.claims_cap}}.

Payment Terms
{{terms.invoice_due_days}} days after the date of the invoice.`;

export const SCOPE_REMARK =
  "The scope of certification will be finalised by Certification Body during the onsite audit.";

export const OUR_CLIENTS_TAGLINE = `Our Clients

Always serve with honesty, integrity and transparency.
Always be accessible and responsive.
Always meet the deadlines!`;

/** Match user-entered ISO strings (e.g. "ISO 9001", "ISO 9001:2015") to library keys. */
export function normalizeIsoCode(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  for (const key of Object.keys(ISO_STANDARD_LIBRARY)) {
    if (t.startsWith(key.toUpperCase())) return key;
  }
  return null;
}

export function resolveIsoStandards(codes: string[]): IsoStandardMeta[] {
  const out: IsoStandardMeta[] = [];
  const seen = new Set<string>();
  for (const raw of codes) {
    const key = normalizeIsoCode(raw);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(ISO_STANDARD_LIBRARY[key]);
    }
  }
  return out;
}

function joinNatural(items: string[], conj = "&"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} ${conj} ${items.at(-1)}`;
}

export function formatStandardsDisplay(standards: IsoStandardMeta[]): string {
  return joinNatural(standards.map((s) => `${s.code}:${s.version}`));
}

export function formatStandardsShort(standards: IsoStandardMeta[]): string {
  return joinNatural(standards.map((s) => s.code));
}

export function formatManagementSystemDisplay(standards: IsoStandardMeta[]): string {
  if (standards.length > 1) return "Integrated Management Systems";
  return standards[0]?.systemName ?? "Management System";
}

export function formatManagementSystemFull(standards: IsoStandardMeta[]): string {
  if (standards.length === 0) return "Management System";
  if (standards.length === 1) return standards[0].systemName;
  return joinNatural(standards.map((s) => s.systemName));
}

export function formatSystemAbbreviations(standards: IsoStandardMeta[]): string {
  if (standards.length === 0) return "MS";
  return joinNatural(standards.map((s) => s.abbreviation));
}

export function formatSystemIssuesDisplay(standards: IsoStandardMeta[]): string {
  const issues: string[] = [];
  if (standards.some((s) => s.code === "ISO 9001")) issues.push("quality");
  if (standards.some((s) => s.code === "ISO 14001")) issues.push("environmental");
  if (standards.some((s) => s.code === "ISO 45001")) issues.push("safety");
  if (issues.length === 0) return "operational";
  return joinNatural(issues, "and");
}

export function formatPolicyName(standards: IsoStandardMeta[]): string {
  const parts: string[] = [];
  if (standards.some((s) => s.code === "ISO 9001")) parts.push("Quality Policy");
  if (standards.some((s) => s.code === "ISO 14001")) parts.push("Environmental Policy");
  if (standards.some((s) => s.code === "ISO 45001")) parts.push("OH&S Policy");
  return parts.length ? joinNatural(parts) : "Policy";
}

export function formatManualName(standards: IsoStandardMeta[]): string {
  if (standards.length > 1) return "Integrated Management System Manual";
  if (standards[0]?.code === "ISO 9001") return "Quality Manual";
  if (standards[0]?.code === "ISO 14001") return "Environmental Manual";
  if (standards[0]?.code === "ISO 45001") return "OH&S Manual";
  return "Management System Manual";
}

export function formatProceduresName(standards: IsoStandardMeta[]): string {
  return standards.length > 1 ? "Procedures and Work Instructions" : "Procedures";
}

export function formatProposalRevision(revision: number): string {
  return `R${revision}`;
}

export function formatProposalTitle(standards: IsoStandardMeta[]): string {
  if (standards.length === 0) return "ISO Consultancy Service";
  return `${formatStandardsShort(standards)} Consultancy Service`;
}

export function formatAuditType(standards: IsoStandardMeta[]): string {
  if (standards.length > 1) return "IMS Certification Audit";
  return "Certification Audit";
}

export function interpolateTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => vars[key.trim()] ?? "");
}
