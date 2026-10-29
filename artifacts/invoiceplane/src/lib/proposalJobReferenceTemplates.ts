import type { ProposalJobReference } from "@/lib/proposals-api";

export type JobReferenceTemplate = {
  id: string;
  label: string;
  industry: string;
  clientName: string;
  projectTitle: string;
  description: string;
};

export const JOB_REFERENCE_TEMPLATES: JobReferenceTemplate[] = [
  {
    id: "bea-iso9001",
    label: "BEA — ISO 9001",
    industry: "Banking & finance",
    clientName: "BEA",
    projectTitle: "ISO 9001:2015",
    description:
      "Quality management system certification for retail banking operations, covering branch service delivery, complaint handling, and process governance across Hong Kong.",
  },
  {
    id: "omnichat-iso27001",
    label: "Omnichat — ISO 27001",
    industry: "Technology / SaaS",
    clientName: "Omnichat",
    projectTitle: "ISO/IEC 27001:2022",
    description:
      "Information security management system for a customer engagement platform, including risk assessment, access control, and secure software development practices.",
  },
  {
    id: "manufacturing-iso14001",
    label: "Precision Manufacturing — ISO 14001",
    industry: "Manufacturing",
    clientName: "Precision Manufacturing Co.",
    projectTitle: "ISO 14001:2015",
    description:
      "Environmental management system implementation for a precision parts factory, covering waste reduction, chemical handling, and regulatory compliance.",
  },
  {
    id: "logistics-iso45001",
    label: "Harbour Logistics — ISO 45001",
    industry: "Logistics",
    clientName: "Harbour Logistics Ltd.",
    projectTitle: "ISO 45001:2018",
    description:
      "Occupational health and safety management system for warehouse and distribution operations, including hazard identification and contractor safety coordination.",
  },
  {
    id: "fnb-iso22000",
    label: "Golden Dragon Restaurant Group — ISO 22000",
    industry: "Food & beverage",
    clientName: "Golden Dragon Restaurant Group",
    projectTitle: "ISO 22000:2018",
    description:
      "Food safety management system across central kitchen and multi-outlet operations, including HACCP plans, supplier control, and traceability.",
  },
  {
    id: "healthcare-iso13485",
    label: "MediCare Devices — ISO 13485",
    industry: "Medical devices",
    clientName: "MediCare Devices HK",
    projectTitle: "ISO 13485:2016",
    description:
      "Medical device quality management system covering design controls, production validation, and post-market surveillance for Class II devices.",
  },
  {
    id: "construction-iso9001",
    label: "Summit Construction — ISO 9001",
    industry: "Construction",
    clientName: "Summit Construction Ltd.",
    projectTitle: "ISO 9001:2015",
    description:
      "Project-based quality management for main-contractor operations, including subcontractor control, site inspection records, and client handover documentation.",
  },
  {
    id: "education-iso21001",
    label: "Bright Future Academy — ISO 21001",
    industry: "Education",
    clientName: "Bright Future Academy",
    projectTitle: "ISO 21001:2018",
    description:
      "Educational organisation management system for a private school, aligning curriculum delivery, learner support, and stakeholder feedback processes.",
  },
];

export function templateToJobReference(template: JobReferenceTemplate): ProposalJobReference {
  return {
    clientName: template.clientName,
    projectTitle: template.projectTitle,
    description: template.description,
  };
}

export function jobReferenceMatchesTemplate(
  ref: ProposalJobReference,
  template: JobReferenceTemplate,
): boolean {
  return (
    ref.clientName.trim() === template.clientName &&
    ref.projectTitle.trim() === template.projectTitle
  );
}
