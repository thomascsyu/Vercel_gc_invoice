import type {
  ProposalCertificationLocation,
  ProposalJobReference,
  ProposalPaymentScheduleItem,
  ProposalPhase,
  ProposalSetupTemplateId,
  ProposalTestimonial,
} from "@/lib/modulesApi";

const STORAGE_KEY = "invoiceplane-proposal-wizard-draft";

export type ProposalWizardDraft = {
  stepIndex: number;
  setupTemplateId: ProposalSetupTemplateId;
  clientId: string;
  isoStandards: string;
  totalAmount: number;
  currency: string;
  proposalScope: string;
  certificationLocations: ProposalCertificationLocation[];
  scopePhases: ProposalPhase[];
  paymentSchedule: ProposalPaymentScheduleItem[];
  jobReferences: ProposalJobReference[];
  referencePageIndex: number;
  testimonials: ProposalTestimonial[];
  testimonialPageIndex: number;
  savedAt: string;
};

export function readProposalWizardDraft(): ProposalWizardDraft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProposalWizardDraft;
  } catch {
    return null;
  }
}

export function writeProposalWizardDraft(draft: Omit<ProposalWizardDraft, "savedAt">): void {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() } satisfies ProposalWizardDraft),
    );
  } catch {
    // Ignore quota / private mode errors.
  }
}

export function clearProposalWizardDraft(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
