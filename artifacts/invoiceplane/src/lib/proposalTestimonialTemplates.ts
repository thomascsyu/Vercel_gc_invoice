import type { ProposalTestimonial } from "@/lib/modulesApi";

export type TestimonialTemplate = {
  id: string;
  label: string;
  industry: string;
  quote: string;
  authorName: string;
  authorTitle: string;
  companyName: string;
};

export const TESTIMONIAL_TEMPLATES: TestimonialTemplate[] = [
  {
    id: "fhki-chairman",
    label: "FHKI — Chairman",
    industry: "Industry association",
    quote:
      "Gabriel Consulting guided our organisation through ISO 9001 certification with clarity and professionalism. Their consultants understood our governance structure and helped us embed quality practices that our members could see in action.",
    authorName: "Steve Chuang",
    authorTitle: "Chairman",
    companyName: "Federation of Hong Kong Industries",
  },
  {
    id: "bbpos-ceo",
    label: "BBPOS — CEO",
    industry: "Fintech / payments",
    quote:
      "The ISO 27001 engagement was structured and practical. Gabriel's team translated Annex A controls into workflows our engineering and operations teams could adopt without slowing product delivery.",
    authorName: "Ronald Wong",
    authorTitle: "Chief Executive Officer",
    companyName: "BBPOS Ltd.",
  },
  {
    id: "logistics-director",
    label: "Harbour Logistics — Operations Director",
    industry: "Logistics",
    quote:
      "ISO 45001 certification required genuine worker participation, not just paperwork. Gabriel facilitated hazard workshops on the warehouse floor and helped us close audit findings ahead of schedule.",
    authorName: "Karen Lam",
    authorTitle: "Director of Operations",
    companyName: "Harbour Logistics Ltd.",
  },
  {
    id: "manufacturing-gm",
    label: "Precision Manufacturing — General Manager",
    industry: "Manufacturing",
    quote:
      "Our ISO 14001 project improved waste segregation and chemical storage compliance across two factory sites. The consultants were responsive during surveillance audits and kept documentation audit-ready.",
    authorName: "David Cheung",
    authorTitle: "General Manager",
    companyName: "Precision Manufacturing Co.",
  },
  {
    id: "education-principal",
    label: "Bright Future Academy — Principal",
    industry: "Education",
    quote:
      "ISO 21001 helped us align curriculum planning, learner support, and parent communication under one management framework. Gabriel made the standard accessible for teaching staff who were new to formal QMS concepts.",
    authorName: "Dr. Emily Ho",
    authorTitle: "Principal",
    companyName: "Bright Future Academy",
  },
  {
    id: "construction-md",
    label: "Summit Construction — Managing Director",
    industry: "Construction",
    quote:
      "Project-based ISO 9001 was challenging for a main contractor with multiple sites. Gabriel designed a pragmatic document hierarchy and trained our site agents on inspection records that auditors accepted first time.",
    authorName: "Michael Tsang",
    authorTitle: "Managing Director",
    companyName: "Summit Construction Ltd.",
  },
  {
    id: "fnb-operations",
    label: "Golden Dragon — Group Operations Manager",
    industry: "Food & beverage",
    quote:
      "Food safety certification across our central kitchen and outlets needed consistent HACCP controls. Gabriel's team standardised our supplier approval and traceability records without disrupting daily service.",
    authorName: "Angela Fung",
    authorTitle: "Group Operations Manager",
    companyName: "Golden Dragon Restaurant Group",
  },
  {
    id: "medtech-qa",
    label: "MediCare Devices — QA Director",
    industry: "Medical devices",
    quote:
      "ISO 13485 implementation for our Class II devices required tight design-control evidence. Gabriel supported our validation documentation and prepared the team confidently for the certification audit.",
    authorName: "James Yip",
    authorTitle: "Director of Quality Assurance",
    companyName: "MediCare Devices HK",
  },
];

export function templateToTestimonial(template: TestimonialTemplate): ProposalTestimonial {
  return {
    quote: template.quote,
    authorName: template.authorName,
    authorTitle: template.authorTitle,
    companyName: template.companyName,
  };
}

export function testimonialMatchesTemplate(
  testimonial: ProposalTestimonial,
  template: TestimonialTemplate,
): boolean {
  return (
    testimonial.authorName.trim() === template.authorName &&
    testimonial.companyName?.trim() === template.companyName
  );
}
