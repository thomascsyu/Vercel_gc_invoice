import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PAYMENT_SCHEDULE } from "./proposalDefaults";
import { DEFAULT_PROPOSAL_SETUP_TEMPLATES } from "./proposalSetupTemplates";
import { streamProposalPdfToBuffer } from "./proposalPdfDraw";

function countPdfPages(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

const template = DEFAULT_PROPOSAL_SETUP_TEMPLATES.iso9001;

const previewProposal = {
  id: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000002",
  clientId: "00000000-0000-0000-0000-000000000003",
  proposalNo: "P-202606-006",
  proposalRevision: 0,
  status: "draft" as const,
  validFrom: "2026-06-12",
  validUntil: "2026-12-09",
  coverPhotoUrl: null,
  firmIntro: null,
  certificationBodyIntro: null,
  clientStaffCount: null,
  isoStandards: ["ISO 14001:2015", "ISO 45001:2018", "ISO 27001:2022"],
  proposalScope: template.proposalScope,
  certificationLocations: [],
  templateData: {},
  scopePhases: template.scopePhases,
  pmToolsIntro: null,
  trainingPlatformIntro: null,
  termsConditions: template.termsConditions,
  consultantPortfolio: [],
  jobReferences: [],
  testimonials: [
    {
      quote: "Sample testimonial for layout preview.",
      authorName: "Jane Doe",
      authorTitle: "Director",
      companyName: "Sample Client Ltd.",
    },
  ],
  currency: "HKD",
  totalAmount: "787878",
  paymentSchedule: DEFAULT_PAYMENT_SCHEDULE,
  milestoneInvoices: [],
  shareToken: null,
  shareTokenExpiresAt: null,
  jobOrderId: null,
  revisionRequestComment: null,
  clientConfirmedAt: null,
  clientSignatureName: null,
  submittedAt: null,
  approvedAt: null,
  sentAt: null,
  supersededById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const previewClient = {
  id: "00000000-0000-0000-0000-000000000003",
  userId: "00000000-0000-0000-0000-000000000002",
  name: "HXP REGISTRATION CO., LIMITED",
  contactPerson: null,
  addressLine1: null,
  addressLine2: null,
  addressLine3: null,
  addressLine4: null,
  address: null,
  email: null,
  phone: null,
  country: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

const previewSettings = {
  id: "1",
  companyName: "Gabriel Consultant Limited",
  addressLine1: null,
  addressLine2: null,
  addressLine3: null,
  addressLine4: null,
  address: null,
  phone: null,
  email: null,
  logoUrl: null,
  chopUrl: null,
  signatureImageUrl: null,
  companyLogoScale: null,
  proposalProfile: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

test("proposal PDF renders without stack overflow", async () => {
  const { buffer, filename } = await streamProposalPdfToBuffer(
    previewProposal as unknown as Parameters<typeof streamProposalPdfToBuffer>[0],
    previewClient as unknown as Parameters<typeof streamProposalPdfToBuffer>[1],
    previewSettings as unknown as Parameters<typeof streamProposalPdfToBuffer>[2],
    [],
  );
  assert.ok(buffer.length > 1000, "expected non-trivial PDF output");
  assert.match(filename, /^Proposal_P-202606-006_R0\.pdf$/);
  const pages = countPdfPages(buffer);
  assert.ok(pages >= 2 && pages <= 20, `expected reasonable page count, got ${pages}`);
});
