import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  apiApproveProposal,
  apiBillAllProposalMilestones,
  apiBillProposalMilestone,
  apiCancelProposal,
  apiCreateJobOrderFromProposal,
  apiDeleteProposal,
  apiEmailProposal,
  apiExtractProposalForJobOrder,
  apiGetProposal,
  apiGetSettings,
  apiListConsultants,
  apiGetProposalSetupTemplates,
  apiListProposals,
  apiProposalActivity,
  apiProposalNewRevision,
  apiProposalNoResponse,
  apiProposalQuestions,
  apiRejectProposal,
  apiReplyProposalQuestion,
  apiRefreshProposalShareLink,
  apiRevokeProposalShareToken,
  apiSendProposal,
  apiSubmitProposal,
  apiUpdateProposal,
  apiUploadProposalCover,
  type ProposalActivity,
  type ProposalConsultantPortfolioItem,
  type ProposalDocument,
  type ProposalJobReference,
  type ProposalMilestoneInvoice,
  type ProposalCertificationLocation,
  type ProposalPaymentScheduleItem,
  type ProposalPhase,
  type ProposalQuestion,
  type ProposalStatus,
  type ProposalTemplateData,
  type ProposalTestimonial,
} from "@/lib/modulesApi";
import { useListClients, type Client } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Pencil,
  Trash2,
  Send,
  ClipboardCheck,
  XCircle,
  ExternalLink,
  Search,
  RefreshCw,
  LayoutDashboard,
  LayoutTemplate,
  List,
  CheckCircle2,
  RotateCcw,
  ExternalLink as ExternalLinkIcon,
} from "lucide-react";
import { JobReferenceTemplatePicker } from "@/components/job-reference-template-picker";
import { TestimonialTemplatePicker } from "@/components/testimonial-template-picker";
import { ProposalSetupTemplatesPanel } from "@/components/proposal-setup-templates-panel";
import { ProposalsDashboardPanel } from "@/components/proposals-dashboard-panel";
import { GuidedProposalWizard } from "@/components/guided-proposal-wizard";
import { ProposalDetailPanel } from "@/components/proposal-detail-panel";
import { ProposalGanttPreview } from "@/components/proposal-gantt-preview";
import { ProposalIsoGrid } from "@/components/proposal-iso-grid";
import { ProposalWorkflowToolbar } from "@/components/proposal-workflow-toolbar";
import {
  DEFAULT_PHASES,
  DEFAULT_PAYMENT_SCHEDULE,
  MAX_PROPOSAL_CONSULTANTS,
  PROPOSAL_STATUSES,
  eventLabel,
  formatLabel,
  sharePreviewUrl,
  statusBadge,
  validityDays,
} from "@/lib/proposal-shared";
import { useToast } from "@/hooks/use-toast";
import { PaginationControls } from "@/components/pagination-controls";
import { useDebounce } from "@/hooks/use-debounce";
import { ListQueryState } from "@/components/list-query-state";
import { EmailDialog } from "@/components/email-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { apiUrl, publicMediaSrcUrl } from "@/lib/api-base";
import { cn, formatCurrency } from "@/lib/utils";
import { useAuthSession } from "@/context/auth-session";

function StatusBadge({ status }: { status: ProposalStatus }) {
  const icon =
    status === "confirmed" ? (
      <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden />
    ) : status === "sent" ? (
      <Send className="h-3 w-3 mr-1" aria-hidden />
    ) : status === "revision_requested" ? (
      <RotateCcw className="h-3 w-3 mr-1" aria-hidden />
    ) : null;
  return (
    <Badge variant="outline" className={cn("capitalize inline-flex items-center", statusBadge(status))}>
      {icon}
      {formatLabel(status)}
    </Badge>
  );
}

export default function ProposalsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterClientId, setFilterClientId] = useState(() => {
    const params = new URLSearchParams(searchString);
    return params.get("clientId") ?? "";
  });
  const debouncedSearch = useDebounce(search, 250);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailProposalId, setEmailProposalId] = useState<string | null>(null);
  const [emailProposalNo, setEmailProposalNo] = useState("");
  const [emailDefaultTo, setEmailDefaultTo] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [pageView, setPageView] = useState<"dashboard" | "list" | "templates">(() => {
    const v = new URLSearchParams(searchString).get("view");
    if (v === "list") return "list";
    if (v === "templates") return "templates";
    return "dashboard";
  });
  const [panelRevoking, setPanelRevoking] = useState(false);
  const [panelRefreshing, setPanelRefreshing] = useState(false);
  const [createWizardOpen, setCreateWizardOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const openId = params.get("open");
    if (openId) {
      setEditingId(openId);
      setEditorOpen(true);
    } else {
      setEditorOpen(false);
      setEditingId(null);
    }
    setFilterClientId(params.get("clientId") ?? "");
    const view = params.get("view");
    if (view === "list") setPageView("list");
    else if (view === "templates") setPageView("templates");
    else setPageView("dashboard");
    if (params.get("create") === "1") setCreateWizardOpen(true);
    setPage(1);
  }, [searchString]);

  const { data: me } = useAuthSession();
  const isAdmin = me?.role === "admin";

  const { data: panelProposal } = useQuery({
    queryKey: ["proposal", editingId],
    queryFn: () => apiGetProposal(editingId!),
    enabled: Boolean(editingId),
  });

  const { data: settings } = useQuery({
    queryKey: ["/company-settings"],
    queryFn: apiGetSettings,
  });

  const { data: setupTemplates } = useQuery({
    queryKey: ["proposal-setup-templates"],
    queryFn: apiGetProposalSetupTemplates,
  });

  const emailProposalMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof apiEmailProposal>[1] }) =>
      apiEmailProposal(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["proposals-dashboard"] });
      if (editingId) qc.invalidateQueries({ queryKey: ["proposal", editingId] });
    },
  });

  const { data: clientsPage } = useListClients({ page: 1, pageSize: 500 });
  const clients = clientsPage?.data ?? [];

  const { data: listPage, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["proposals", page, pageSize, debouncedSearch, filterStatus, filterClientId],
    queryFn: () =>
      apiListProposals({
        page,
        pageSize,
        q: debouncedSearch || undefined,
        status: filterStatus || undefined,
        clientId: filterClientId || undefined,
      }),
  });

  const deleteMut = useMutation({
    mutationFn: apiDeleteProposal,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["proposals-dashboard"] });
      toast({ title: "Proposal deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const handleEditorOpenChange = (open: boolean) => {
    setEditorOpen(open);
    if (!open) {
      setEditingId(null);
    }
  };

  const openCreate = () => {
    setCreateWizardOpen(true);
  };

  const openEdit = (id: string) => {
    setEditingId(id);
    setEditorOpen(true);
    const params = new URLSearchParams(searchString);
    params.set("open", id);
    params.delete("create");
    setLocation(`/proposals?${params.toString()}`);
  };

  const closePanel = () => {
    setEditorOpen(false);
    setEditingId(null);
    const params = new URLSearchParams(searchString);
    params.delete("open");
    const qs = params.toString();
    setLocation(qs ? `/proposals?${qs}` : "/proposals");
  };

  const setView = (view: "dashboard" | "list" | "templates") => {
    setPageView(view);
    const params = new URLSearchParams(searchString);
    if (view === "dashboard") params.set("view", "pipeline");
    else if (view === "list") params.set("view", "list");
    else params.set("view", "templates");
    const qs = params.toString();
    setLocation(qs ? `/proposals?${qs}` : "/proposals");
  };

  const workflow = useMutation({
    mutationFn: async ({ action, id, reason }: { action: string; id: string; reason?: string }) => {
      switch (action) {
        case "submit": return apiSubmitProposal(id);
        case "approve": return apiApproveProposal(id);
        case "reject": return apiRejectProposal(id, reason);
        case "cancel": return apiCancelProposal(id, reason);
        case "send": return apiSendProposal(id);
        case "no_response": return apiProposalNoResponse(id);
        case "revision": return apiProposalNewRevision(id);
        case "job_order": return apiCreateJobOrderFromProposal(id);
        default: throw new Error("Unknown action");
      }
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["proposals-dashboard"] });
      if (editingId) qc.invalidateQueries({ queryKey: ["proposal", editingId] });
      const titles: Record<string, string> = {
        submit: "Submitted for approval",
        approve: "Approved",
        reject: "Rejected",
        cancel: "Proposal cancelled",
        send: "Sent to client",
        no_response: "Marked no response",
        revision: "New revision created",
        job_order: "Job order created",
      };
      toast({ title: titles[vars.action] ?? "Updated" });
      if (vars.action === "revision" && data && "proposalNo" in data) {
        setEditingId(data.id);
        qc.invalidateQueries({ queryKey: ["proposal", data.id] });
      }
      if (vars.action === "job_order" && data && "milestoneInvoice" in data && data.milestoneInvoice) {
        toast({
          title: "First milestone invoiced",
          description: `Draft invoice ${data.milestoneInvoice.invoiceNumber} created automatically.`,
        });
      }
      if (vars.action === "reject") {
        setRejectDialogOpen(false);
        setRejectReason("");
      }
      if (vars.action === "cancel") {
        setCancelDialogOpen(false);
        setCancelReason("");
      }
      refetch();
    },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const proposals = listPage?.data ?? [];

  const openEmailDialog = (p: ProposalDocument, clientEmail?: string) => {
    setEmailProposalId(p.id);
    setEmailProposalNo(p.proposalNo);
    setEmailDefaultTo(clientEmail ?? "");
    setEmailDialogOpen(true);
  };

  const handleSendEmail = async (params: {
    to: string;
    slot: 1 | 2;
    cc?: string;
    bcc?: string;
    contactPersonOverride?: string;
  }) => {
    if (!emailProposalId) return;
    try {
      await emailProposalMut.mutateAsync({
        id: emailProposalId,
        data: {
          to: params.to,
          slot: params.slot,
          cc: params.cc,
          bcc: params.bcc,
          contactPersonOverride: params.contactPersonOverride?.trim() || undefined,
        },
      });
      toast({ title: "Proposal sent", description: `Email sent to ${params.to}` });
      setEmailDialogOpen(false);
      setEmailProposalId(null);
    } catch (err) {
      toast({
        title: "Failed to send email",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleSkipSend = () => {
    if (!emailProposalId) return;
    workflow.mutate({ action: "send", id: emailProposalId });
    setEmailDialogOpen(false);
    setEmailProposalId(null);
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proposals</h1>
          <p className="text-sm text-muted-foreground">Generate and send professional proposals for ISO consulting services</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={pageView} onValueChange={(v) => setView(v as "dashboard" | "list" | "templates")}>
            <TabsList>
              <TabsTrigger value="dashboard" className="gap-1.5">
                <LayoutDashboard className="h-4 w-4" />
                Pipeline
              </TabsTrigger>
              <TabsTrigger value="list" className="gap-1.5">
                <List className="h-4 w-4" />
                List
              </TabsTrigger>
              <TabsTrigger value="templates" className="gap-1.5">
                <LayoutTemplate className="h-4 w-4" />
                Templates
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> New proposal
          </Button>
        </div>
      </div>

      {pageView === "templates" ? (
        <ProposalSetupTemplatesPanel canEdit={isAdmin} />
      ) : null}

      {pageView === "dashboard" ? (
        <ProposalsDashboardPanel
          onFilterStatus={(status) => {
            setFilterStatus(status);
            setPage(1);
          }}
          onOpenProposal={openEdit}
          onViewList={() => setView("list")}
        />
      ) : null}

      {pageView === "list" ? (
      <div className={cn("transition-[padding] duration-300", editorOpen && editingId && "lg:pr-[min(44vw,580px)]")}>
      <div className="flex flex-wrap gap-2 max-w-3xl">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search proposals…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={filterStatus || "all"} onValueChange={(v) => { setFilterStatus(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {PROPOSAL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{formatLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filterClientId || "all"}
          onValueChange={(v) => {
            setFilterClientId(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => refetch()} aria-label="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <ListQueryState isLoading={isLoading} isError={isError} error={error} isEmpty={!proposals.length} emptyMessage="No proposals yet">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proposal No.</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Rev.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.map((p) => (
                  <TableRow
                    key={p.id}
                    className={cn(
                      "cursor-pointer",
                      editingId === p.id && "bg-primary/5 hover:bg-primary/10",
                    )}
                    onClick={() => openEdit(p.id)}
                  >
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(p.id);
                        }}
                      >
                        {p.proposalNo}
                      </button>
                    </TableCell>
                    <TableCell>{p.clientName ?? "—"}</TableCell>
                    <TableCell>{p.proposalRevision}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">{formatCurrency(p.totalAmount, p.currency)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p.id)} aria-label="Edit proposal">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setLocation(`/proposals/${p.id}/build`)}
                        aria-label="Open in builder"
                      >
                        <ExternalLinkIcon className="h-4 w-4" />
                      </Button>
                      {p.status === "draft" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => workflow.mutate({ action: "submit", id: p.id })}
                          aria-label="Submit for approval"
                        >
                          <ClipboardCheck className="h-4 w-4" />
                        </Button>
                      )}
                      {p.shareToken && (
                        <Button variant="ghost" size="sm" asChild>
                          <a href={sharePreviewUrl(p)!} target="_blank" rel="noopener noreferrer" aria-label="Client portal link">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      {p.status !== "confirmed" && (
                        <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate(p.id)} aria-label="Delete proposal">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListQueryState>
        </CardContent>
      </Card>

      {listPage && (
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={listPage.total}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      )}
      </div>
      ) : null}

      <ProposalDetailPanel
        open={editorOpen && Boolean(editingId)}
        title={panelProposal?.proposalNo ?? "Proposal"}
        subtitle={panelProposal?.clientName}
        onClose={closePanel}
        headerActions={
          panelProposal && editingId ? (
            <ProposalWorkflowToolbar
              proposal={panelProposal}
              proposalId={editingId}
              clientEmail={clients.find((c) => c.id === panelProposal.clientId)?.email}
              workflowPending={workflow.isPending}
              revoking={panelRevoking}
              extractPending={false}
              primaryFirst
              onWorkflow={(action) => workflow.mutate({ action, id: editingId })}
              onReject={() => setRejectDialogOpen(true)}
              onCancel={() => setCancelDialogOpen(true)}
              onOpenEmail={openEmailDialog}
              onRefreshLink={async () => {
                setPanelRefreshing(true);
                try {
                  await apiRefreshProposalShareLink(editingId);
                  qc.invalidateQueries({ queryKey: ["proposal", editingId] });
                  toast({ title: "Share link refreshed" });
                } finally {
                  setPanelRefreshing(false);
                }
              }}
              refreshing={panelRefreshing}
              onRevokeLink={async () => {
                setPanelRevoking(true);
                try {
                  await apiRevokeProposalShareToken(editingId);
                  qc.invalidateQueries({ queryKey: ["proposal", editingId] });
                  toast({ title: "Share link revoked" });
                } finally {
                  setPanelRevoking(false);
                }
              }}
              onExtract={() => {}}
            />
          ) : null
        }
      >
        {editingId ? (
          <ProposalEditor
            id={editingId}
            clients={clients}
            hideToolbar
            onWorkflow={(action, reason) => workflow.mutate({ action, id: editingId, reason })}
            onReject={() => setRejectDialogOpen(true)}
            onCancel={() => setCancelDialogOpen(true)}
            workflowPending={workflow.isPending}
            onOpenEmail={openEmailDialog}
            onRevokeLink={async (pid) => {
              await apiRevokeProposalShareToken(pid);
              qc.invalidateQueries({ queryKey: ["proposal", pid] });
              toast({ title: "Share link revoked" });
            }}
            onOpenBuilder={() => setLocation(`/proposals/${editingId}/build`)}
          />
        ) : null}
      </ProposalDetailPanel>

      <Dialog open={createWizardOpen} onOpenChange={setCreateWizardOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New proposal</DialogTitle>
          </DialogHeader>
          <GuidedProposalWizard
            clients={clients}
            defaultPhases={DEFAULT_PHASES}
            defaultPaymentSchedule={DEFAULT_PAYMENT_SCHEDULE}
            setupTemplates={setupTemplates}
            initialClientId={filterClientId || undefined}
            onCreated={(id) => {
              setCreateWizardOpen(false);
              qc.invalidateQueries({ queryKey: ["proposals"] });
              qc.invalidateQueries({ queryKey: ["proposals-dashboard"] });
              openEdit(id);
            }}
          />
        </DialogContent>
      </Dialog>

      <EmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        title={`Send Proposal ${emailProposalNo}`}
        description="Email the proposal PDF and client portal link to the client."
        defaultEmail={emailDefaultTo}
        showRecipientOverride
        senderEmail1={settings?.gmailAccount1?.senderEmail}
        senderEmail2={settings?.gmailAccount2?.senderEmail}
        onSend={handleSendEmail}
        isSending={emailProposalMut.isPending}
        showSkip
        onSkip={handleSkipSend}
      />

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject proposal</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Why is this proposal being rejected?"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!editingId || workflow.isPending}
              onClick={() => editingId && workflow.mutate({ action: "reject", id: editingId, reason: rejectReason.trim() || undefined })}
            >
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel proposal</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Reason (optional)</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Why is this proposal being cancelled?"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>Keep</Button>
            <Button
              variant="destructive"
              disabled={!editingId || workflow.isPending}
              onClick={() => editingId && workflow.mutate({ action: "cancel", id: editingId, reason: cancelReason.trim() || undefined })}
            >
              Cancel proposal
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProposalEditor({
  id,
  clients,
  hideToolbar,
  onWorkflow,
  onReject,
  onCancel,
  workflowPending,
  onOpenEmail,
  onRevokeLink,
  onOpenBuilder,
}: {
  id: string;
  clients: Client[];
  hideToolbar?: boolean;
  onWorkflow: (action: string, reason?: string) => void;
  onReject: () => void;
  onCancel: () => void;
  workflowPending: boolean;
  onOpenEmail: (p: ProposalDocument, clientEmail?: string) => void;
  onRevokeLink: (id: string) => Promise<void>;
  onOpenBuilder?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: proposal, isLoading } = useQuery({
    queryKey: ["proposal", id],
    queryFn: () => apiGetProposal(id),
  });
  const { data: activity = [] } = useQuery({
    queryKey: ["proposal-activity", id],
    queryFn: () => apiProposalActivity(id),
    enabled: Boolean(id),
  });
  const { data: questions = [] } = useQuery({
    queryKey: ["proposal-questions", id],
    queryFn: () => apiProposalQuestions(id),
    enabled: Boolean(id),
  });
  const { data: consultants = [] } = useQuery({
    queryKey: ["consultants"],
    queryFn: apiListConsultants,
  });

  const [form, setForm] = useState<Partial<ProposalDocument>>({});
  const [isoStandards, setIsoStandards] = useState<string[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [revoking, setRevoking] = useState(false);
  const [jobRefTemplateOpen, setJobRefTemplateOpen] = useState(false);
  const [templateDraftRefs, setTemplateDraftRefs] = useState<ProposalJobReference[]>([]);
  const [testimonialTemplateOpen, setTestimonialTemplateOpen] = useState(false);
  const [templateDraftTestimonials, setTemplateDraftTestimonials] = useState<ProposalTestimonial[]>([]);

  useEffect(() => {
    if (proposal) {
      setForm(proposal);
      setIsoStandards(proposal.isoStandards ?? []);
    }
  }, [proposal]);

  const saveMut = useMutation({
    mutationFn: () =>
      apiUpdateProposal(id, {
        ...form,
        isoStandards,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposal", id] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const billMilestoneMut = useMutation({
    mutationFn: (index: number) => apiBillProposalMilestone(id, index),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["proposal", id] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast({
        title: "Milestone invoice created",
        description: `${data.invoice.invoiceNumber} — ${data.invoice.label}`,
      });
      setForm(data.proposal);
    },
    onError: (e: Error) => toast({ title: "Billing failed", description: e.message, variant: "destructive" }),
  });

  const billAllMut = useMutation({
    mutationFn: () => apiBillAllProposalMilestones(id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["proposal", id] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      setForm(data.proposal);
      const createdMsg = `${data.created.length} draft invoice(s) created`;
      toast({
        title: data.created.length ? "Milestone invoices created" : "Milestone billing failed",
        description: data.errors.length ? `${createdMsg}. Failed: ${data.errors.join("; ")}` : createdMsg,
        variant: data.errors.length && !data.created.length ? "destructive" : undefined,
      });
    },
    onError: (e: Error) => toast({ title: "Billing failed", description: e.message, variant: "destructive" }),
  });

  const extractMut = useMutation({
    mutationFn: () => apiExtractProposalForJobOrder(id),
    onSuccess: (data) => {
      toast({
        title: "Extraction complete",
        description: `Suggested line item: ${data.lineItem.name}. Open the linked job order to apply.`,
      });
    },
    onError: (e: Error) => toast({ title: "Extraction failed", description: e.message, variant: "destructive" }),
  });

  const replyMut = useMutation({
    mutationFn: ({ qid, reply }: { qid: string; reply: string }) => apiReplyProposalQuestion(id, qid, reply),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposal-questions", id] });
      toast({ title: "Reply sent" });
    },
    onError: (e: Error) => toast({ title: "Failed to send reply", description: e.message, variant: "destructive" }),
  });

  const coverMut = useMutation({
    mutationFn: (file: File) => apiUploadProposalCover(file),
    onSuccess: (r) => {
      setForm((f) => ({ ...f, coverPhotoUrl: r.url }));
      toast({ title: "Cover photo uploaded" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const patch = useCallback((p: Partial<ProposalDocument>) => setForm((f) => ({ ...f, ...p })), []);

  const patchTemplate = useCallback(
    (p: Partial<ProposalTemplateData>) =>
      setForm((f) => ({ ...f, templateData: { ...(f.templateData ?? {}), ...p } })),
    [],
  );

  const selectedClient = clients.find((c) => c.id === (form.clientId ?? proposal?.clientId));
  const clientEmail = selectedClient?.email;

  const toggleConsultant = (cid: string) => {
    setForm((f) => {
      const cur = [...(f.consultantIds ?? [])];
      if (cur.includes(cid)) {
        const nextIds = cur.filter((x) => x !== cid);
        const nextPortfolio = (f.consultantPortfolio ?? []).filter((p) => p.consultantId !== cid);
        return { ...f, consultantIds: nextIds, consultantPortfolio: nextPortfolio };
      }
      if (cur.length >= MAX_PROPOSAL_CONSULTANTS) return f;
      return { ...f, consultantIds: [...cur, cid] };
    });
  };

  const portfolioForConsultant = (consultantId: string): ProposalConsultantPortfolioItem => {
    return (form.consultantPortfolio ?? []).find((p) => p.consultantId === consultantId) ?? { consultantId };
  };

  const updateConsultantPortfolio = (consultantId: string, patch: Partial<ProposalConsultantPortfolioItem>) => {
    setForm((f) => {
      const items = [...(f.consultantPortfolio ?? [])];
      const idx = items.findIndex((p) => p.consultantId === consultantId);
      const next = { ...portfolioForConsultant(consultantId), ...patch, consultantId };
      if (idx >= 0) items[idx] = next;
      else items.push(next);
      return { ...f, consultantPortfolio: items };
    });
  };

  const updateJobReference = (idx: number, patch: Partial<ProposalJobReference>) => {
    setForm((f) => {
      const items = [...(f.jobReferences ?? [])];
      items[idx] = { ...items[idx], ...patch };
      return { ...f, jobReferences: items };
    });
  };

  const addJobReference = () => {
    setForm((f) => ({
      ...f,
      jobReferences: [...(f.jobReferences ?? []), { clientName: "", projectTitle: "" }],
    }));
  };

  const openJobRefTemplates = () => {
    setTemplateDraftRefs([]);
    setJobRefTemplateOpen(true);
  };

  const applyJobRefTemplates = () => {
    setForm((f) => {
      const existing = f.jobReferences ?? [];
      const merged = [...existing];
      for (const ref of templateDraftRefs) {
        const duplicate = existing.some(
          (row) =>
            row.clientName.trim() === ref.clientName.trim() &&
            row.projectTitle.trim() === ref.projectTitle.trim(),
        );
        if (!duplicate) merged.push(ref);
      }
      return { ...f, jobReferences: merged };
    });
    setJobRefTemplateOpen(false);
    setTemplateDraftRefs([]);
  };

  const removeJobReference = (idx: number) => {
    setForm((f) => ({
      ...f,
      jobReferences: (f.jobReferences ?? []).filter((_, i) => i !== idx),
    }));
  };

  const updateTestimonial = (idx: number, patch: Partial<ProposalTestimonial>) => {
    setForm((f) => {
      const items = [...(f.testimonials ?? [])];
      items[idx] = { ...items[idx], ...patch };
      return { ...f, testimonials: items };
    });
  };

  const addTestimonial = () => {
    setForm((f) => ({
      ...f,
      testimonials: [...(f.testimonials ?? []), { quote: "", authorName: "" }],
    }));
  };

  const openTestimonialTemplates = () => {
    setTemplateDraftTestimonials([]);
    setTestimonialTemplateOpen(true);
  };

  const applyTestimonialTemplates = () => {
    setForm((f) => {
      const existing = f.testimonials ?? [];
      const merged = [...existing];
      for (const item of templateDraftTestimonials) {
        const duplicate = existing.some(
          (row) =>
            row.authorName.trim() === item.authorName.trim() &&
            (row.companyName ?? "").trim() === (item.companyName ?? "").trim(),
        );
        if (!duplicate) merged.push(item);
      }
      return { ...f, testimonials: merged };
    });
    setTestimonialTemplateOpen(false);
    setTemplateDraftTestimonials([]);
  };

  const removeTestimonial = (idx: number) => {
    setForm((f) => ({
      ...f,
      testimonials: (f.testimonials ?? []).filter((_, i) => i !== idx),
    }));
  };

  const consultantPhotoMut = useMutation({
    mutationFn: ({ file, consultantId }: { file: File; consultantId: string }) =>
      apiUploadProposalCover(file).then((r) => ({ consultantId, url: r.url })),
    onSuccess: ({ consultantId, url }) => {
      setForm((f) => {
        const items = [...(f.consultantPortfolio ?? [])];
        const idx = items.findIndex((p) => p.consultantId === consultantId);
        const next = { ...(idx >= 0 ? items[idx] : { consultantId }), consultantId, photoUrl: url };
        if (idx >= 0) items[idx] = next;
        else items.push(next);
        return { ...f, consultantPortfolio: items };
      });
      toast({ title: "Consultant photo uploaded" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const jobRefPhotoMut = useMutation({
    mutationFn: ({ file, idx }: { file: File; idx: number }) =>
      apiUploadProposalCover(file).then((r) => ({ idx, url: r.url })),
    onSuccess: ({ idx, url }) => {
      updateJobReference(idx, { photoUrl: url });
      toast({ title: "Reference photo uploaded" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const testimonialPhotoMut = useMutation({
    mutationFn: ({ file, idx }: { file: File; idx: number }) =>
      apiUploadProposalCover(file).then((r) => ({ idx, url: r.url })),
    onSuccess: ({ idx, url }) => {
      updateTestimonial(idx, { photoUrl: url });
      toast({ title: "Testimonial photo uploaded" });
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const updatePhase = (idx: number, phasePatch: Partial<ProposalPhase>) => {
    setForm((f) => {
      const phases = [...(f.scopePhases ?? DEFAULT_PHASES)];
      phases[idx] = { ...phases[idx], ...phasePatch };
      return { ...f, scopePhases: phases };
    });
  };

  const addPhaseRow = () => {
    setForm((f) => {
      const phases = [...(f.scopePhases ?? DEFAULT_PHASES)];
      phases.push({
        phase: phases.length + 1,
        title: "",
        description: "",
        deliverable: "",
        weeks: 4,
        startMonth: 1,
        spanMonths: 1,
      });
      return { ...f, scopePhases: phases.map((p, i) => ({ ...p, phase: i + 1 })) };
    });
  };

  const removePhaseRow = (idx: number) => {
    setForm((f) => {
      const phases = [...(f.scopePhases ?? DEFAULT_PHASES)];
      if (phases.length <= 1) return f;
      phases.splice(idx, 1);
      return { ...f, scopePhases: phases.map((p, i) => ({ ...p, phase: i + 1 })) };
    });
  };

  const updateLocation = (idx: number, locPatch: Partial<ProposalCertificationLocation>) => {
    setForm((f) => {
      const locations = [...(f.certificationLocations ?? [{ address: "", staffCount: 0 }])];
      locations[idx] = { ...locations[idx], ...locPatch };
      return { ...f, certificationLocations: locations };
    });
  };

  const addLocationRow = () => {
    setForm((f) => ({
      ...f,
      certificationLocations: [...(f.certificationLocations ?? []), { address: "", staffCount: 0 }],
    }));
  };

  const removeLocationRow = (idx: number) => {
    setForm((f) => {
      const locations = [...(f.certificationLocations ?? [])];
      if (locations.length <= 1) return f;
      locations.splice(idx, 1);
      return { ...f, certificationLocations: locations };
    });
  };

  const updatePayment = (idx: number, itemPatch: Partial<ProposalPaymentScheduleItem>) => {
    setForm((f) => {
      const items = [...(f.paymentSchedule ?? DEFAULT_PAYMENT_SCHEDULE)];
      items[idx] = { ...items[idx], ...itemPatch };
      return { ...f, paymentSchedule: items };
    });
  };

  const addPaymentRow = () => {
    setForm((f) => ({
      ...f,
      paymentSchedule: [...(f.paymentSchedule ?? []), { label: "", percentage: 0 }],
    }));
  };

  const removePaymentRow = (idx: number) => {
    setForm((f) => {
      const items = [...(f.paymentSchedule ?? [])];
      if (items.length <= 1) return f;
      items.splice(idx, 1);
      return { ...f, paymentSchedule: items };
    });
  };

  const milestoneInvoices = (form.milestoneInvoices ?? proposal?.milestoneInvoices ?? []) as ProposalMilestoneInvoice[];
  const billedMap = useMemo(
    () => new Map(milestoneInvoices.map((m) => [m.scheduleIndex, m])),
    [milestoneInvoices],
  );

  if (isLoading || !proposal) return <p className="text-muted-foreground p-4">Loading…</p>;

  const editable = proposal.status === "draft" || proposal.status === "revision_requested";
  const validityDayCount = validityDays(form.validFrom ?? proposal.validFrom, form.validUntil ?? proposal.validUntil);
  const feeAmount = Number(form.totalAmount ?? proposal.totalAmount ?? 0);
  const feeCurrency = form.currency ?? proposal.currency ?? "HKD";

  return (
    <>
    <Tabs defaultValue="content" className="w-full">
      <TabsList>
        <TabsTrigger value="content">Content</TabsTrigger>
        <TabsTrigger value="activity">Activity ({activity.length})</TabsTrigger>
        <TabsTrigger value="questions">Questions ({questions.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="content" className="space-y-4 mt-4">
        {!hideToolbar && (
          <ProposalWorkflowToolbar
            proposal={proposal}
            proposalId={id}
            clientEmail={clientEmail}
            workflowPending={workflowPending}
            revoking={revoking}
            extractPending={extractMut.isPending}
            onWorkflow={onWorkflow}
            onReject={onReject}
            onCancel={onCancel}
            onOpenEmail={onOpenEmail}
            onRevokeLink={async () => {
              setRevoking(true);
              try {
                await onRevokeLink(id);
              } finally {
                setRevoking(false);
              }
            }}
            onExtract={() => extractMut.mutate()}
          />
        )}

        {onOpenBuilder && (
          <Button type="button" variant="outline" size="sm" onClick={onOpenBuilder}>
            <ExternalLinkIcon className="h-3.5 w-3.5 mr-1" /> Open in builder
          </Button>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Client</Label>
            <Select value={form.clientId} onValueChange={(v) => patch({ clientId: v })} disabled={!editable}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Proposal no.</Label>
            <Input value={form.proposalNo ?? ""} disabled />
          </div>
          <div className="space-y-2">
            <Label>Valid from</Label>
            <Input type="date" value={form.validFrom ?? ""} onChange={(e) => patch({ validFrom: e.target.value })} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label>Valid until</Label>
            <Input type="date" value={form.validUntil ?? ""} onChange={(e) => patch({ validUntil: e.target.value })} disabled={!editable} />
            {validityDayCount != null ? (
              <p className="text-xs text-muted-foreground">Valid for {validityDayCount} days</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>Fee ({form.currency})</Label>
            <Input type="number" value={form.totalAmount ?? 0} onChange={(e) => patch({ totalAmount: Number(e.target.value) })} disabled={!editable} />
          </div>
          <div className="space-y-2">
            <Label>Staff count</Label>
            <Input type="number" value={form.clientStaffCount ?? ""} onChange={(e) => patch({ clientStaffCount: Number(e.target.value) || undefined })} disabled={!editable} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Cover photo</Label>
          {form.coverPhotoUrl && (
            <img src={publicMediaSrcUrl(form.coverPhotoUrl)} alt="Cover" className="h-32 object-cover rounded border" />
          )}
          {editable && (
            <Input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) coverMut.mutate(f); }} />
          )}
        </div>

        <div className="space-y-2 border rounded-lg p-4">
          <Label>ISO standards</Label>
          <ProposalIsoGrid selected={isoStandards} onChange={setIsoStandards} disabled={!editable} />
        </div>

        <div className="space-y-2">
          <Label>Proposed scope of certification</Label>
          <Textarea value={form.proposalScope ?? ""} onChange={(e) => patch({ proposalScope: e.target.value })} disabled={!editable} rows={3} />
        </div>

        <div className="space-y-3 border rounded-lg p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-medium text-sm">Address</h3>
              <p className="text-xs text-muted-foreground">ISO certification may cover multiple locations.</p>
            </div>
            {editable && (
              <Button type="button" size="sm" variant="outline" onClick={addLocationRow}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add location
              </Button>
            )}
          </div>
          {(form.certificationLocations?.length ? form.certificationLocations : [{ address: "", staffCount: 0 }]).map((loc, idx) => (
            <div key={idx} className="grid gap-2 md:grid-cols-[1fr_140px_auto] items-end">
              <div className="space-y-1">
                <Label className="text-xs">
                  {(form.certificationLocations?.length ?? 1) > 1 ? `Location ${idx + 1} address` : "Address"}
                </Label>
                <Input
                  value={loc.address}
                  onChange={(e) => updateLocation(idx, { address: e.target.value })}
                  disabled={!editable}
                  placeholder="Full address of certification site"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Staff involved</Label>
                <Input
                  type="number"
                  min={0}
                  value={loc.staffCount || ""}
                  onChange={(e) => updateLocation(idx, { staffCount: Number(e.target.value) || 0 })}
                  disabled={!editable}
                />
              </div>
              {editable && (form.certificationLocations?.length ?? 1) > 1 && (
                <Button type="button" size="icon" variant="ghost" onClick={() => removeLocationRow(idx)} aria-label="Remove location">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label>Firm background</Label>
          <Textarea value={form.firmIntro ?? ""} onChange={(e) => patch({ firmIntro: e.target.value })} disabled={!editable} rows={3} />
        </div>

        <div className="space-y-2">
          <Label>Certification body intro</Label>
          <Textarea value={form.certificationBodyIntro ?? ""} onChange={(e) => patch({ certificationBodyIntro: e.target.value })} disabled={!editable} rows={2} />
        </div>

        <div className="space-y-3 border rounded-lg p-4">
          <div>
            <h3 className="font-medium text-sm">Proposal template options</h3>
            <p className="text-xs text-muted-foreground">Presentation-style PDF fields (sales contact, certification body, fees, terms).</p>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Proposal title (optional override)</Label>
              <Input
                value={form.templateData?.proposalTitle ?? ""}
                onChange={(e) => patchTemplate({ proposalTitle: e.target.value })}
                disabled={!editable}
                placeholder="Auto-generated from ISO standards"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Audit type</Label>
              <Input
                value={form.templateData?.auditType ?? ""}
                onChange={(e) => patchTemplate({ auditType: e.target.value })}
                disabled={!editable}
                placeholder="e.g. IMS Certification Audit"
              />
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <Input
              value={form.templateData?.salesContact?.name ?? ""}
              onChange={(e) => patchTemplate({ salesContact: { ...form.templateData?.salesContact, name: e.target.value } })}
              disabled={!editable}
              placeholder="Sales contact name"
            />
            <Input
              value={form.templateData?.salesContact?.title ?? ""}
              onChange={(e) => patchTemplate({ salesContact: { ...form.templateData?.salesContact, title: e.target.value } })}
              disabled={!editable}
              placeholder="Sales contact title"
            />
            <Input
              value={form.templateData?.salesContact?.phone ?? ""}
              onChange={(e) => patchTemplate({ salesContact: { ...form.templateData?.salesContact, phone: e.target.value } })}
              disabled={!editable}
              placeholder="Sales contact phone"
            />
            <Input
              value={form.templateData?.salesContact?.email ?? ""}
              onChange={(e) => patchTemplate({ salesContact: { ...form.templateData?.salesContact, email: e.target.value } })}
              disabled={!editable}
              placeholder="Sales contact email"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.templateData?.certificationBody?.enabled ?? false}
              disabled={!editable}
              onCheckedChange={(v) =>
                patchTemplate({
                  certificationBody: { ...form.templateData?.certificationBody, enabled: v === true },
                })
              }
            />
            Include certification body section
          </label>
          {(form.templateData?.certificationBody?.enabled) && (
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                value={form.templateData?.certificationBody?.name ?? ""}
                onChange={(e) => patchTemplate({ certificationBody: { ...form.templateData?.certificationBody, name: e.target.value } })}
                disabled={!editable}
                placeholder="Certification body name"
              />
              <Input
                value={form.templateData?.certificationBody?.shortName ?? ""}
                onChange={(e) => patchTemplate({ certificationBody: { ...form.templateData?.certificationBody, shortName: e.target.value } })}
                disabled={!editable}
                placeholder="Short name (e.g. DW)"
              />
              <Textarea
                className="md:col-span-2"
                value={form.templateData?.certificationBody?.description ?? ""}
                onChange={(e) => patchTemplate({ certificationBody: { ...form.templateData?.certificationBody, description: e.target.value } })}
                disabled={!editable}
                rows={2}
                placeholder="Certification body description"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.templateData?.optionalMaintenance?.enabled ?? false}
              disabled={!editable}
              onCheckedChange={(v) =>
                patchTemplate({
                  optionalMaintenance: { ...form.templateData?.optionalMaintenance, enabled: v === true },
                })
              }
            />
            Include optional maintenance service section
          </label>
          {(form.templateData?.optionalMaintenance?.enabled) && (
            <Input
              value={form.templateData?.optionalMaintenance?.supportHours ?? ""}
              onChange={(e) => patchTemplate({ optionalMaintenance: { ...form.templateData?.optionalMaintenance, supportHours: e.target.value } })}
              disabled={!editable}
              placeholder="Support hours (e.g. Monday–Friday 10:00–18:00)"
            />
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Multi-year fee table (optional)</Label>
              {editable && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    patchTemplate({
                      feeRows: [...(form.templateData?.feeRows ?? []), { year: "", consultancyFee: 0, certificationFee: 0 }],
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add year
                </Button>
              )}
            </div>
            {(form.templateData?.feeRows ?? []).map((row, idx) => (
              <div key={idx} className="grid gap-2 md:grid-cols-4 items-end">
                <Input
                  value={row.year}
                  onChange={(e) => {
                    const rows = [...(form.templateData?.feeRows ?? [])];
                    rows[idx] = { ...rows[idx], year: e.target.value };
                    patchTemplate({ feeRows: rows });
                  }}
                  disabled={!editable}
                  placeholder="1st Year"
                />
                <Input
                  type="number"
                  value={row.consultancyFee ?? ""}
                  onChange={(e) => {
                    const rows = [...(form.templateData?.feeRows ?? [])];
                    rows[idx] = { ...rows[idx], consultancyFee: Number(e.target.value) || 0 };
                    patchTemplate({ feeRows: rows });
                  }}
                  disabled={!editable}
                  placeholder="Consultancy fee"
                />
                <Input
                  type="number"
                  value={row.certificationFee ?? ""}
                  onChange={(e) => {
                    const rows = [...(form.templateData?.feeRows ?? [])];
                    rows[idx] = { ...rows[idx], certificationFee: Number(e.target.value) || 0 };
                    patchTemplate({ feeRows: rows });
                  }}
                  disabled={!editable}
                  placeholder="Certification fee"
                />
                {editable && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => patchTemplate({ feeRows: (form.templateData?.feeRows ?? []).filter((_, i) => i !== idx) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Commencement (days)</Label>
              <Input
                type="number"
                value={form.templateData?.terms?.commencementDays ?? 14}
                onChange={(e) => patchTemplate({ terms: { ...form.templateData?.terms, commencementDays: Number(e.target.value) || 14 } })}
                disabled={!editable}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Invoice due (days)</Label>
              <Input
                type="number"
                value={form.templateData?.terms?.invoiceDueDays ?? 14}
                onChange={(e) => patchTemplate({ terms: { ...form.templateData?.terms, invoiceDueDays: Number(e.target.value) || 14 } })}
                disabled={!editable}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Claims cap</Label>
              <Input
                value={form.templateData?.terms?.claimsCap ?? "HK$ 1,000"}
                onChange={(e) => patchTemplate({ terms: { ...form.templateData?.terms, claimsCap: e.target.value } })}
                disabled={!editable}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 border rounded-lg p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-sm">Scope phases</h3>
            {editable && (
              <Button type="button" size="sm" variant="outline" onClick={addPhaseRow}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add phase
              </Button>
            )}
          </div>
          {(form.scopePhases ?? DEFAULT_PHASES).map((phase, idx) => (
            <div key={phase.phase} className="space-y-2 border-b pb-3 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">Phase {phase.phase}</p>
                {editable && (form.scopePhases ?? DEFAULT_PHASES).length > 1 && (
                  <Button type="button" size="icon" variant="ghost" onClick={() => removePhaseRow(idx)} aria-label="Remove phase">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <Input
                value={phase.title}
                onChange={(e) => updatePhase(idx, { title: e.target.value })}
                disabled={!editable}
                placeholder="Phase title"
              />
              <Textarea
                value={phase.description}
                onChange={(e) => updatePhase(idx, { description: e.target.value })}
                disabled={!editable}
                rows={2}
                placeholder="Phase description"
              />
              <Textarea
                value={phase.deliverable ?? ""}
                onChange={(e) => updatePhase(idx, { deliverable: e.target.value })}
                disabled={!editable}
                rows={2}
                placeholder="Deliverable"
              />
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Weeks</Label>
                  <Input
                    type="number"
                    min={1}
                    value={phase.weeks}
                    onChange={(e) => updatePhase(idx, { weeks: Number(e.target.value) || 1 })}
                    disabled={!editable}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Start month</Label>
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    value={phase.startMonth}
                    onChange={(e) => updatePhase(idx, { startMonth: Number(e.target.value) || 1 })}
                    disabled={!editable}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Span (months)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    value={phase.spanMonths}
                    onChange={(e) => updatePhase(idx, { spanMonths: Number(e.target.value) || 1 })}
                    disabled={!editable}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <ProposalGanttPreview phases={form.scopePhases ?? DEFAULT_PHASES} />

        <div className="space-y-3 border rounded-lg p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium text-sm">Payment schedule</h3>
            <div className="flex flex-wrap gap-2">
              {proposal.status === "confirmed" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={billAllMut.isPending || billMilestoneMut.isPending}
                  onClick={() => billAllMut.mutate()}
                >
                  Bill all unbilled
                </Button>
              )}
              {editable && (
                <Button type="button" size="sm" variant="outline" onClick={addPaymentRow}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add milestone
                </Button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left font-medium px-3 py-2">Milestone</th>
                  <th className="text-right font-medium px-3 py-2 w-20">%</th>
                  <th className="text-right font-medium px-3 py-2 w-32">Amount ({feeCurrency})</th>
                  <th className="px-2 py-2 w-28" />
                </tr>
              </thead>
              <tbody>
                {(form.paymentSchedule ?? DEFAULT_PAYMENT_SCHEDULE).map((item, idx) => {
                  const billed = billedMap.get(idx);
                  const amount = (feeAmount * (item.percentage || 0)) / 100;
                  return (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <Input
                          value={item.label}
                          onChange={(e) => updatePayment(idx, { label: e.target.value })}
                          disabled={!editable}
                          className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={item.percentage}
                          onChange={(e) => updatePayment(idx, { percentage: Number(e.target.value) || 0 })}
                          disabled={!editable}
                          className="h-8 text-right tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {formatCurrency(amount, feeCurrency)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {billed ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/invoices?open=${billed.invoiceId}`}>{billed.invoiceNumber ?? "Invoice"}</Link>
                          </Button>
                        ) : proposal.status === "confirmed" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={billMilestoneMut.isPending}
                            onClick={() => billMilestoneMut.mutate(idx)}
                          >
                            Bill
                          </Button>
                        ) : editable && (form.paymentSchedule ?? []).length > 1 ? (
                          <Button type="button" size="icon" variant="ghost" onClick={() => removePaymentRow(idx)} aria-label="Remove milestone">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-muted/20 font-medium">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {(form.paymentSchedule ?? DEFAULT_PAYMENT_SCHEDULE).reduce((s, i) => s + (i.percentage || 0), 0)}%
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(feeAmount, feeCurrency)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">All fees are in {feeCurrency} and exclude any applicable taxes.</p>
        </div>

        <div className="space-y-2">
          <Label>Project management tools</Label>
          <Textarea value={form.pmToolsIntro ?? ""} onChange={(e) => patch({ pmToolsIntro: e.target.value })} disabled={!editable} rows={2} />
        </div>

        <div className="space-y-2">
          <Label>Training platform</Label>
          <Textarea value={form.trainingPlatformIntro ?? ""} onChange={(e) => patch({ trainingPlatformIntro: e.target.value })} disabled={!editable} rows={2} />
        </div>

        <div className="space-y-2 border rounded-lg p-4">
          <div className="flex items-baseline justify-between gap-2">
            <Label className="mb-0">Assigned consultants</Label>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {(form.consultantIds ?? []).length}/{MAX_PROPOSAL_CONSULTANTS} selected
            </span>
          </div>
          {consultants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No consultants yet. Add them under Consultants.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 max-h-36 overflow-y-auto pr-1">
              {consultants
                .filter((c) => c.isActive || (form.consultantIds ?? []).includes(c.id))
                .map((c) => {
                  const checked = (form.consultantIds ?? []).includes(c.id);
                  const maxReached = (form.consultantIds ?? []).length >= MAX_PROPOSAL_CONSULTANTS;
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-md border p-2 cursor-pointer text-center text-xs",
                        checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                        !checked && maxReached && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!editable || (!checked && maxReached)}
                        onCheckedChange={() => toggleConsultant(c.id)}
                        className="sr-only"
                      />
                      <span className="font-mono">{c.shortCode}</span>
                      <span className="truncate">{c.name}</span>
                    </label>
                  );
                })}
            </div>
          )}
        </div>

        {(form.consultantIds ?? []).length > 0 && (
          <div className="space-y-3 border rounded-lg p-4">
            <h3 className="font-medium text-sm">Consultant portfolio</h3>
            {(form.consultantIds ?? []).map((cid) => {
              const consultant = consultants.find((c) => c.id === cid);
              const portfolio = portfolioForConsultant(cid);
              return (
                <div key={cid} className="space-y-2 border-b pb-3 last:border-0 last:pb-0">
                  <p className="text-xs font-medium text-muted-foreground">{consultant?.name ?? cid}</p>
                  {portfolio.photoUrl && (
                    <img src={publicMediaSrcUrl(portfolio.photoUrl)} alt={consultant?.name ?? "Consultant"} className="h-20 w-20 object-cover rounded border" />
                  )}
                  {editable && (
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) consultantPhotoMut.mutate({ file: f, consultantId: cid });
                      }}
                    />
                  )}
                  <Textarea
                    value={portfolio.bio ?? ""}
                    onChange={(e) => updateConsultantPortfolio(cid, { bio: e.target.value })}
                    disabled={!editable}
                    rows={2}
                    placeholder="Short bio for the proposal PDF"
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-3 border rounded-lg p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-medium text-sm">Job references</h3>
              <p className="text-xs text-muted-foreground">Past certification projects with company name and ceremony photo.</p>
            </div>
            {editable && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={openJobRefTemplates}>
                  <LayoutTemplate className="h-3.5 w-3.5 mr-1" /> Add from template
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={addJobReference}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add blank
                </Button>
              </div>
            )}
          </div>
          {(form.jobReferences ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No job references yet.</p>
          )}
          {(form.jobReferences ?? []).map((ref, idx) => (
            <div key={idx} className="space-y-2 border-b pb-3 last:border-0 last:pb-0">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Company name</Label>
                  <Input
                    value={ref.clientName}
                    onChange={(e) => updateJobReference(idx, { clientName: e.target.value })}
                    disabled={!editable}
                    placeholder="e.g. BEA, Omnichat"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Certification / project</Label>
                  <Input
                    value={ref.projectTitle}
                    onChange={(e) => updateJobReference(idx, { projectTitle: e.target.value })}
                    disabled={!editable}
                    placeholder="e.g. ISO 9001:2015"
                  />
                </div>
              </div>
              <Textarea
                value={ref.description ?? ""}
                onChange={(e) => updateJobReference(idx, { description: e.target.value })}
                disabled={!editable}
                rows={2}
                placeholder="Brief description (optional)"
              />
              <div className="space-y-1">
                <Label className="text-xs">Reference photo</Label>
                {ref.photoUrl && (
                  <img
                    src={publicMediaSrcUrl(ref.photoUrl)}
                    alt={ref.clientName || "Job reference"}
                    className="h-24 w-full max-w-xs object-cover rounded border"
                  />
                )}
                {editable && (
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) jobRefPhotoMut.mutate({ file: f, idx });
                    }}
                  />
                )}
              </div>
              {editable && (
                <Button type="button" size="sm" variant="ghost" onClick={() => removeJobReference(idx)}>
                  <Trash2 className="h-4 w-4 text-destructive mr-1" /> Remove
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-3 border rounded-lg p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-medium text-sm">Testimonials</h3>
              <p className="text-xs text-muted-foreground">Client quotes with headshot or company logo.</p>
            </div>
            {editable && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={openTestimonialTemplates}>
                  <LayoutTemplate className="h-3.5 w-3.5 mr-1" /> Add from template
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={addTestimonial}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add blank
                </Button>
              </div>
            )}
          </div>
          {(form.testimonials ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No testimonials yet.</p>
          )}
          {(form.testimonials ?? []).map((t, idx) => (
            <div key={idx} className="space-y-2 border-b pb-3 last:border-0 last:pb-0">
              <Textarea
                value={t.quote}
                onChange={(e) => updateTestimonial(idx, { quote: e.target.value })}
                disabled={!editable}
                rows={3}
                placeholder="Testimonial quote"
              />
              <div className="grid gap-2 md:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Author name</Label>
                  <Input
                    value={t.authorName}
                    onChange={(e) => updateTestimonial(idx, { authorName: e.target.value })}
                    disabled={!editable}
                    placeholder="e.g. Steve Chuang"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Author title</Label>
                  <Input
                    value={t.authorTitle ?? ""}
                    onChange={(e) => updateTestimonial(idx, { authorTitle: e.target.value })}
                    disabled={!editable}
                    placeholder="e.g. Chairman, FHKI"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Company name</Label>
                  <Input
                    value={t.companyName ?? ""}
                    onChange={(e) => updateTestimonial(idx, { companyName: e.target.value })}
                    disabled={!editable}
                    placeholder="e.g. BBPOS Ltd."
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Headshot or company logo</Label>
                {t.photoUrl && (
                  <img
                    src={publicMediaSrcUrl(t.photoUrl)}
                    alt={t.authorName || "Testimonial"}
                    className="h-16 w-16 object-cover rounded-full border"
                  />
                )}
                {editable && (
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) testimonialPhotoMut.mutate({ file: f, idx });
                    }}
                  />
                )}
              </div>
              {editable && (
                <Button type="button" size="sm" variant="ghost" onClick={() => removeTestimonial(idx)}>
                  <Trash2 className="h-4 w-4 text-destructive mr-1" /> Remove
                </Button>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label>Terms & conditions</Label>
          <Textarea value={form.termsConditions ?? ""} onChange={(e) => patch({ termsConditions: e.target.value })} disabled={!editable} rows={3} />
        </div>

        {editable && (
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            Save changes
          </Button>
        )}

        {proposal.revisionRequestComment && (
          <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded border">
            Client revision request: {proposal.revisionRequestComment}
          </p>
        )}

      </TabsContent>

      <TabsContent value="activity" className="mt-4">
        <ActivityTimeline items={activity} />
      </TabsContent>

      <TabsContent value="questions" className="mt-4 space-y-4">
        {questions.length === 0 && <p className="text-muted-foreground text-sm">No questions yet.</p>}
        {questions.map((q) => (
          <QuestionCard
            key={q.id}
            q={q}
            reply={replyDrafts[q.id] ?? ""}
            onReplyChange={(v) => setReplyDrafts((d) => ({ ...d, [q.id]: v }))}
            onSend={() => replyMut.mutate({ qid: q.id, reply: replyDrafts[q.id] ?? "" })}
            sending={replyMut.isPending}
          />
        ))}
      </TabsContent>
    </Tabs>

    <Dialog open={jobRefTemplateOpen} onOpenChange={setJobRefTemplateOpen}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add job references from templates</DialogTitle>
        </DialogHeader>
        <JobReferenceTemplatePicker
          jobReferences={templateDraftRefs}
          onChange={setTemplateDraftRefs}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setJobRefTemplateOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={applyJobRefTemplates}
            disabled={templateDraftRefs.length === 0}
          >
            Add {templateDraftRefs.length} reference{templateDraftRefs.length === 1 ? "" : "s"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={testimonialTemplateOpen} onOpenChange={setTestimonialTemplateOpen}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add testimonials from templates</DialogTitle>
        </DialogHeader>
        <TestimonialTemplatePicker
          testimonials={templateDraftTestimonials}
          onChange={setTemplateDraftTestimonials}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setTestimonialTemplateOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={applyTestimonialTemplates}
            disabled={templateDraftTestimonials.length === 0}
          >
            Add {templateDraftTestimonials.length} testimonial
            {templateDraftTestimonials.length === 1 ? "" : "s"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}

function ActivityTimeline({ items }: { items: ProposalActivity[] }) {
  if (!items.length) return <p className="text-muted-foreground text-sm">No activity recorded yet.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {items.map((a) => (
        <li key={a.id} className="flex gap-2 border-l-2 pl-3 py-1 border-primary/30">
          <span className="text-muted-foreground whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</span>
          <span>{eventLabel(a.eventType, a.eventData)}</span>
          <Badge variant="outline" className="text-xs ml-auto">{a.actorType}</Badge>
        </li>
      ))}
    </ul>
  );
}

function QuestionCard({
  q,
  reply,
  onReplyChange,
  onSend,
  sending,
}: {
  q: ProposalQuestion;
  reply: string;
  onReplyChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
}) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <p className="font-medium">{q.questionText}</p>
      <p className="text-xs text-muted-foreground">{q.clientName ? `${q.clientName} · ` : ""}{new Date(q.createdAt).toLocaleString()}</p>
      {q.staffReply ? (
        <p className="text-sm bg-muted p-2 rounded">Reply: {q.staffReply}</p>
      ) : (
        <div className="flex gap-2">
          <Textarea value={reply} onChange={(e) => onReplyChange(e.target.value)} placeholder="Your reply…" rows={2} className="flex-1" />
          <Button size="sm" onClick={onSend} disabled={sending || !reply.trim()}>Reply</Button>
        </div>
      )}
    </div>
  );
}
