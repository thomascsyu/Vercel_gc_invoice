/**
 * Staff proposal API — generated OpenAPI client (@workspace/api-client-react).
 * Legacy `api*` names match the old modulesApi surface for proposal UI files.
 */
import {
  approveProposal,
  billAllProposalMilestones,
  billProposalMilestone,
  cancelProposal,
  createJobOrderFromProposal,
  createProposal,
  createProposalRevision,
  deleteProposal,
  emailProposal,
  extractProposalForJobOrder,
  getProposal,
  getProposalSetupTemplates,
  getProposalsDashboard,
  listProposalActivity,
  listProposalQuestions,
  listProposals,
  markProposalNoResponse,
  migrateClientProposal,
  refreshProposalShareLink,
  rejectProposal,
  replyProposalQuestion,
  revokeProposalShareToken,
  sendProposal,
  submitProposal,
  updateProposal,
  updateProposalSetupTemplates,
  uploadProposalCover,
  type EmailSendBody,
  type ProposalDocument,
  type ProposalInput,
  type ProposalJobOrderBody,
  type ProposalPatch,
  type ProposalRejectBody,
  type ProposalSetupTemplatesPatch,
} from "@workspace/api-client-react";

export type ProposalSetupTemplateId = "iso9001" | "iso14001-45001" | "iso27001";

export type {
  ProposalDocument,
  ProposalActivity,
  ProposalQuestion,
  ProposalStatus,
  PaginatedProposals,
  ProposalsDashboard,
  ProposalsDashboardNeedsAttentionItem as ProposalsDashboardAttentionItem,
  ProposalsDashboardExpiringSoonItem as ProposalsDashboardExpiringItem,
  ProposalsDashboardRecentActivityItem as ProposalsDashboardActivityItem,
  ProposalPhase,
  ProposalPaymentScheduleItem,
  ProposalCertificationLocation,
  ProposalConsultantPortfolioItem,
  ProposalJobReference,
  ProposalTestimonial,
  ProposalTemplateData,
  ProposalMilestoneInvoice,
  ProposalSetupTemplates,
  ProposalSetupTemplate,
} from "@workspace/api-client-react";

export const apiGetProposalsDashboard = () => getProposalsDashboard();
export const apiGetProposalSetupTemplates = () => getProposalSetupTemplates();
export const apiUpdateProposalSetupTemplates = (body: ProposalSetupTemplatesPatch) =>
  updateProposalSetupTemplates(body);

export const apiListProposals = (params?: Parameters<typeof listProposals>[0]) =>
  listProposals(params);

export const apiGetProposal = (id: string) => getProposal(id);

export const apiCreateProposal = (body: ProposalInput) => createProposal(body);

export const apiUpdateProposal = (id: string, body: ProposalPatch) => updateProposal(id, body);

export const apiDeleteProposal = (id: string) => deleteProposal(id);
export const apiSubmitProposal = (id: string) => submitProposal(id);
export const apiApproveProposal = (id: string) => approveProposal(id);

export const apiRejectProposal = (id: string, reason?: string) =>
  rejectProposal(id, reason?.trim() ? { reason: reason.trim() } : ({} as ProposalRejectBody));

export const apiCancelProposal = (id: string, reason?: string) =>
  cancelProposal(id, reason?.trim() ? { reason: reason.trim() } : ({} as ProposalRejectBody));

export const apiSendProposal = (id: string) => sendProposal(id);
export const apiEmailProposal = (id: string, body?: EmailSendBody) => emailProposal(id, body ?? {});
export const apiRevokeProposalShareToken = (id: string) => revokeProposalShareToken(id);
export const apiRefreshProposalShareLink = (id: string) => refreshProposalShareLink(id);
export const apiProposalNoResponse = (id: string) => markProposalNoResponse(id);
export const apiProposalNewRevision = (id: string) => createProposalRevision(id);
export const apiProposalActivity = (id: string) => listProposalActivity(id);
export const apiProposalQuestions = (id: string) => listProposalQuestions(id);

export const apiReplyProposalQuestion = (id: string, questionId: string, reply: string) =>
  replyProposalQuestion(id, questionId, { reply });

export const apiCreateJobOrderFromProposal = (id: string, body?: ProposalJobOrderBody) =>
  createJobOrderFromProposal(id, body ?? {});

export const apiBillProposalMilestone = (id: string, index: number) =>
  billProposalMilestone(id, index);

export const apiBillAllProposalMilestones = (id: string) => billAllProposalMilestones(id);
export const apiExtractProposalForJobOrder = (id: string) => extractProposalForJobOrder(id);
export const apiMigrateClientProposal = (clientId: string) => migrateClientProposal(clientId);

export async function apiUploadProposalCover(file: File): Promise<{ url: string }> {
  return uploadProposalCover({ file });
}
