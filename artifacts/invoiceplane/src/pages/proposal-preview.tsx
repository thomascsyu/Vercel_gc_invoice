import { useParams, useSearch } from "wouter";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api-base";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  apiProposalPublicConfirm,
  apiProposalPublicDownload,
  apiProposalPublicInfo,
  apiProposalPublicQuestion,
  apiProposalPublicRevise,
} from "@/lib/modulesApi";

function buildPdfUrl(id: string, token: string): string {
  return apiUrl(`/proposals/${id}/pdf/public?token=${encodeURIComponent(token)}`);
}

export default function ProposalPreview() {
  const params = useParams<{ id: string }>();
  const search = useSearch();
  const { toast } = useToast();
  const id = params.id;
  const token = useMemo(() => new URLSearchParams(search).get("token") ?? "", [search]);

  const [question, setQuestion] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [reviseComment, setReviseComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const pdfUrl = useMemo(() => (id && token ? buildPdfUrl(id, token) : ""), [id, token]);

  const { data: info, refetch } = useQuery({
    queryKey: ["proposal-public", id, token],
    queryFn: () => apiProposalPublicInfo(id!, token),
    enabled: Boolean(id && token),
  });

  if (!id || !token) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Invalid or missing share link. Please request a new link from the sender.
      </div>
    );
  }

  const handleDownload = async () => {
    try {
      setSubmitting(true);
      const blob = await apiProposalPublicDownload(id, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Proposal_${info?.proposalNo ?? id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started" });
    } catch (e) {
      toast({ title: "Download failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuestion = async () => {
    if (!question.trim()) return;
    try {
      setSubmitting(true);
      await apiProposalPublicQuestion(id, {
        token,
        questionText: question.trim(),
        clientName: clientName.trim() || undefined,
        clientEmail: clientEmail.trim() || undefined,
      });
      setQuestion("");
      toast({ title: "Question sent", description: "We will respond shortly." });
    } catch (e) {
      toast({ title: "Failed to send question", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (!signatureName.trim()) {
      toast({ title: "Please enter your name to sign", variant: "destructive" });
      return;
    }
    try {
      setSubmitting(true);
      await apiProposalPublicConfirm(id, token, signatureName.trim());
      toast({ title: "Proposal confirmed", description: "Thank you for confirming." });
      refetch();
    } catch (e) {
      toast({ title: "Confirmation failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevise = async () => {
    if (!reviseComment.trim()) return;
    try {
      setSubmitting(true);
      await apiProposalPublicRevise(id, token, reviseComment.trim());
      setReviseComment("");
      toast({ title: "Revision requested", description: "The consultant will follow up." });
      refetch();
    } catch (e) {
      toast({ title: "Request failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-white border-b shadow-sm">
        <div>
          <p className="text-sm font-semibold text-gray-800">
            Proposal {info?.proposalNo ?? ""}
            {info?.proposalRevision != null ? ` · Rev. ${info.proposalRevision}` : ""}
          </p>
          {info?.clientName && <p className="text-xs text-muted-foreground">{info.clientName}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={handleDownload} disabled={submitting}>
          Download PDF
        </Button>
      </div>

      <iframe src={pdfUrl} className="flex-1 w-full min-h-[60vh] border-0 bg-white" title="Proposal PDF" />

      <div className="border-t bg-white p-4 space-y-4 max-w-3xl mx-auto w-full">
        <div className="space-y-2">
          <Label htmlFor="question">Have a question?</Label>
          <Input
            id="clientName"
            placeholder="Your name (optional)"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
          <Input
            id="clientEmail"
            type="email"
            placeholder="Your email (optional)"
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
          />
          <Textarea
            id="question"
            placeholder="Type your question here…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
          />
          <Button onClick={handleQuestion} disabled={submitting || !question.trim()}>
            Submit question
          </Button>
        </div>

        {info?.canConfirm && (
          <div className="space-y-2 pt-2 border-t">
            <Label htmlFor="signature">Confirm proposal</Label>
            <Input
              id="signature"
              placeholder="Your full name (signature)"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
            />
            <Button onClick={handleConfirm} disabled={submitting}>
              Confirm & sign
            </Button>
          </div>
        )}

        {info?.canRevise && (
          <div className="space-y-2 pt-2 border-t">
            <Label htmlFor="revise">Request revision</Label>
            <Textarea
              id="revise"
              placeholder="Describe the changes you need…"
              value={reviseComment}
              onChange={(e) => setReviseComment(e.target.value)}
              rows={3}
            />
            <Button variant="outline" onClick={handleRevise} disabled={submitting || !reviseComment.trim()}>
              Request revision
            </Button>
          </div>
        )}

        {info?.status === "confirmed" && (
          <p className="text-sm text-green-700 font-medium pt-2">This proposal has been confirmed. Thank you.</p>
        )}
        {info?.status === "revision_requested" && (
          <p className="text-sm text-amber-700 font-medium pt-2">A revision has been requested. The consultant will follow up.</p>
        )}
      </div>
    </div>
  );
}
