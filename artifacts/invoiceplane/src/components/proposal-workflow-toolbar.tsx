import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  Briefcase,
  ClipboardCheck,
  ExternalLink,
  FileDown,
  Link2Off,
  RefreshCw,
  Send,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/api-base";
import { sharePreviewUrl } from "@/lib/proposal-shared";
import type { ProposalDocument } from "@/lib/modulesApi";

type ProposalWorkflowToolbarProps = {
  proposal: ProposalDocument;
  proposalId: string;
  clientEmail?: string;
  workflowPending: boolean;
  revoking: boolean;
  extractPending: boolean;
  onWorkflow: (action: string) => void;
  onReject: () => void;
  onCancel: () => void;
  onOpenEmail: (p: ProposalDocument, clientEmail?: string) => void;
  onRevokeLink: () => void;
  onRefreshLink?: () => void;
  refreshing?: boolean;
  onExtract: () => void;
  size?: "sm" | "default";
  primaryFirst?: boolean;
};

export function ProposalWorkflowToolbar({
  proposal,
  proposalId,
  clientEmail,
  workflowPending,
  revoking,
  extractPending,
  onWorkflow,
  onReject,
  onCancel,
  onOpenEmail,
  onRevokeLink,
  onRefreshLink,
  refreshing = false,
  onExtract,
  size = "sm",
  primaryFirst = false,
}: ProposalWorkflowToolbarProps) {
  const cancellable = ["draft", "pending_approval", "approved", "sent", "revision_requested", "no_response"].includes(
    proposal.status,
  );
  const pdfStaffUrl = apiUrl(`/proposals/${proposalId}/pdf`);
  const previewUrl = sharePreviewUrl(proposal);

  const buttons: ReactNode[] = [];

  if (proposal.status === "pending_approval") {
    buttons.push(
      <Button key="approve" size={size} onClick={() => onWorkflow("approve")} disabled={workflowPending}>
        <ThumbsUp className="h-3.5 w-3.5 mr-1" /> Approve
      </Button>,
      <Button key="reject" size={size} variant="outline" onClick={onReject} disabled={workflowPending}>
        <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
      </Button>,
    );
  }
  if (proposal.status === "draft") {
    buttons.push(
      <Button key="submit" size={size} onClick={() => onWorkflow("submit")} disabled={workflowPending}>
        <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Submit
      </Button>,
    );
  }
  if (proposal.status === "approved") {
    buttons.push(
      <Button key="send" size={size} onClick={() => onOpenEmail(proposal, clientEmail)} disabled={workflowPending}>
        <Send className="h-3.5 w-3.5 mr-1" /> Send to client
      </Button>,
    );
  }
  buttons.push(
    <Button key="pdf" size={size} variant="outline" asChild>
      <a href={pdfStaffUrl} target="_blank" rel="noopener noreferrer">
        <FileDown className="h-3.5 w-3.5 mr-1" /> PDF
      </a>
    </Button>,
  );
  if (cancellable) {
    buttons.push(
      <Button key="cancel" size={size} variant="outline" onClick={onCancel} disabled={workflowPending}>
        Cancel
      </Button>,
    );
  }

  const secondary = (
    <>
      {proposal.status === "approved" && (
        <Button size={size} variant="outline" onClick={() => onWorkflow("send")} disabled={workflowPending}>
          Mark sent (no email)
        </Button>
      )}
      {proposal.status === "sent" && (
        <>
          <Button size={size} variant="outline" onClick={() => onOpenEmail(proposal, clientEmail)} disabled={workflowPending}>
            <Send className="h-3.5 w-3.5 mr-1" /> Resend
          </Button>
          <Button size={size} variant="outline" onClick={() => onWorkflow("no_response")} disabled={workflowPending}>
            No response
          </Button>
        </>
      )}
      {(proposal.status === "revision_requested" || proposal.status === "sent" || proposal.status === "no_response") && (
        <Button size={size} variant="outline" onClick={() => onWorkflow("revision")} disabled={workflowPending}>
          New revision
        </Button>
      )}
      {proposal.status === "confirmed" && !proposal.jobOrderId && (
        <Button size={size} onClick={() => onWorkflow("job_order")} disabled={workflowPending}>
          <Briefcase className="h-3.5 w-3.5 mr-1" /> Job order
        </Button>
      )}
      {proposal.jobOrderId && (
        <>
          <Button size={size} variant="outline" asChild>
            <Link href="/job-orders">View job orders</Link>
          </Button>
          <Button size={size} variant="outline" onClick={onExtract} disabled={extractPending}>
            Extract for job order
          </Button>
        </>
      )}
      {previewUrl && (
        <Button size={size} variant="outline" asChild>
          <a href={previewUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5 mr-1" /> Client link
          </a>
        </Button>
      )}
      {proposal.shareToken && onRefreshLink && (
        <Button size={size} variant="outline" disabled={refreshing || revoking} onClick={onRefreshLink}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh link
        </Button>
      )}
      {proposal.shareToken && (
        <Button size={size} variant="outline" disabled={revoking || refreshing} onClick={onRevokeLink}>
          <Link2Off className="h-3.5 w-3.5 mr-1" /> Revoke link
        </Button>
      )}
    </>
  );

  if (primaryFirst) {
    return (
      <div className="flex flex-wrap gap-2">
        {buttons}
        {secondary}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {buttons}
      {secondary}
    </div>
  );
}
