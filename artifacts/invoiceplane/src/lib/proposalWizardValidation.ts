import type { ProposalPaymentScheduleItem, ProposalPhase } from "@/lib/proposals-api";

/** Rounded to 2dp so e.g. 33.33 + 33.33 + 33.34 reliably reads (and compares) as exactly 100. */
export function paymentScheduleTotal(schedule: ProposalPaymentScheduleItem[]): number {
  const raw = schedule.reduce((sum, row) => sum + (row.percentage || 0), 0);
  return Math.round(raw * 100) / 100;
}

export function getWizardAdvanceBlockers(input: {
  stepId: string;
  clientId: string;
  totalAmount: number;
  certificationLocations: { address: string }[];
  scopePhases: ProposalPhase[];
  paymentSchedule: ProposalPaymentScheduleItem[];
  referencePageIndex: number;
  jobReferences: { clientName: string; projectTitle: string }[];
  testimonialPageIndex: number;
  testimonials: { quote: string; authorName: string }[];
}): string[] {
  const blockers: string[] = [];

  if (input.stepId === "client") {
    if (!input.clientId) blockers.push("Select a client");
    if (input.totalAmount <= 0) blockers.push("Enter a consultancy fee greater than 0");
    if (!input.certificationLocations.some((loc) => loc.address.trim())) {
      blockers.push("Add at least one certification site address");
    }
  }

  if (input.stepId === "scope") {
    input.scopePhases.forEach((phase, index) => {
      if (!phase.description.trim()) {
        blockers.push(`Phase ${index + 1}: add a description`);
      }
      if (!(phase.deliverable ?? "").trim()) {
        blockers.push(`Phase ${index + 1}: add a deliverable`);
      }
    });
  }

  if (input.stepId === "payment") {
    input.paymentSchedule.forEach((row, index) => {
      if (!row.label.trim()) blockers.push(`Payment milestone ${index + 1}: add a label`);
    });
    const total = paymentScheduleTotal(input.paymentSchedule);
    if (input.paymentSchedule.length === 0) {
      blockers.push("Add at least one payment milestone");
    } else if (total !== 100) {
      blockers.push(`Payment milestones must total 100% (currently ${total}%)`);
    }
  }

  if (input.stepId === "references" && input.referencePageIndex > 0) {
    const ref = input.jobReferences[input.referencePageIndex - 1];
    if (!ref?.clientName.trim()) blockers.push("Enter the reference company name");
    if (!ref?.projectTitle.trim()) blockers.push("Enter the certification / project title");
  }

  if (input.stepId === "testimonials" && input.testimonialPageIndex > 0) {
    const testimonial = input.testimonials[input.testimonialPageIndex - 1];
    if (!testimonial?.quote.trim()) blockers.push("Enter the testimonial quote");
    if (!testimonial?.authorName.trim()) blockers.push("Enter the author name");
  }

  return blockers;
}

/** Validates all required wizard fields before creating a draft on the review step. */
export function getWizardCreateBlockers(
  input: Omit<Parameters<typeof getWizardAdvanceBlockers>[0], "stepId"> & {
    selectedClientExists: boolean;
  },
): string[] {
  const blockers = (["client", "scope", "payment"] as const).flatMap((stepId) =>
    getWizardAdvanceBlockers({ ...input, stepId }),
  );
  if (!input.selectedClientExists) {
    blockers.unshift("Selected client is no longer available — choose another client");
  }
  return blockers;
}
