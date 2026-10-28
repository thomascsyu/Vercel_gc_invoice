import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { useListClients } from "@workspace/api-client-react";
import {
  apiApproveProposal,
  apiCancelProposal,
  apiCreateProposal,
  apiEmailProposal,
  apiGetProposal,
  apiGetProposalSetupTemplates,
  apiGetSettings,
  apiRefreshProposalShareLink,
  apiRejectProposal,
  apiRevokeProposalShareToken,
  apiSendProposal,
  apiSubmitProposal,
  apiUpdateProposal,
  type ProposalCertificationLocation,
  type ProposalDocument,
  type ProposalPaymentScheduleItem,
  type ProposalPhase,
  type ProposalSetupTemplateId,
  type ProposalSetupTemplates,
} from "@/lib/modulesApi";
import {
  DEFAULT_PAYMENT_SCHEDULE,
  DEFAULT_PHASES,
  sharePreviewUrl,
  validityDays,
} from "@/lib/proposal-shared";
import { paymentScheduleTotal } from "@/lib/proposalWizardValidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProposalGanttPreview } from "@/components/proposal-gantt-preview";
import { ProposalIsoGrid } from "@/components/proposal-iso-grid";
import { ProposalWorkflowToolbar } from "@/components/proposal-workflow-toolbar";
import { EmailDialog } from "@/components/email-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-base";
import { cn, formatCurrency } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  FileDown,
  MessageCircleQuestion,
  PenLine,
  Plus,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

function resolveSetupTemplateId(standards: string[]): ProposalSetupTemplateId | null {
  const set = new Set(standards);
  if (set.has("ISO 14001") && set.has("ISO 45001")) return "iso14001-45001";
  if (set.has("ISO 27001")) return "iso27001";
  if (set.has("ISO 9001")) return "iso9001";
  return null;
}

function applySetupTemplate(
  templates: ProposalSetupTemplates,
  id: ProposalSetupTemplateId,
  setters: {
    setProposalScope: (v: string) => void;
    setScopePhases: (v: ProposalPhase[]) => void;
    setPaymentSchedule: (v: ProposalPaymentScheduleItem[]) => void;
    setFirmIntro: (v: string) => void;
    setTermsConditions: (v: string) => void;
  },
) {
  const template = templates[id];
  if (!template) return;
  setters.setProposalScope(template.proposalScope ?? "");
  setters.setScopePhases(template.scopePhases.map((phase, index) => ({ ...phase, phase: index + 1 })));
  setters.setPaymentSchedule(template.paymentSchedule.map((row) => ({ ...row })));
  if (template.termsConditions) setters.setTermsConditions(template.termsConditions);
}

const BUILDER_STEPS = [
  { id: "client", label: "Client & validity" },
  { id: "scope", label: "Scope & ISO" },
  { id: "fee", label: "Fee & payments" },
  { id: "evidence", label: "Evidence" },
  { id: "send", label: "Send & portal" },
] as const;

type BuilderStepId = (typeof BUILDER_STEPS)[number]["id"];

const DEFAULT_PHASES_TYPED: ProposalPhase[] = DEFAULT_PHASES.map((p) => ({ ...p }));

export default function ProposalBuilderPage() {
  const params = useParams<{ id?: string }>();
  const isNew = !params.id || params.id === "new";
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [proposalId, setProposalId] = useState<string | null>(isNew ? null : params.id ?? null);
  const [stepIndex, setStepIndex] = useState(0);
  const [clientId, setClientId] = useState("");
  const [validFrom, setValidFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return d.toISOString().slice(0, 10);
  });
  const [isoStandards, setIsoStandards] = useState<string[]>(["ISO 9001"]);
  const [proposalScope, setProposalScope] = useState("");
  const [scopePhases, setScopePhases] = useState<ProposalPhase[]>(DEFAULT_PHASES_TYPED);
  const [totalAmount, setTotalAmount] = useState(0);
  const [currency, setCurrency] = useState("HKD");
  const [clientStaffCount, setClientStaffCount] = useState<number | undefined>();
  const [paymentSchedule, setPaymentSchedule] = useState<ProposalPaymentScheduleItem[]>(DEFAULT_PAYMENT_SCHEDULE);
  const [firmIntro, setFirmIntro] = useState("");
  const [termsConditions, setTermsConditions] = useState("");
  const [certificationLocations, setCertificationLocations] = useState<ProposalCertificationLocation[]>([
    { address: "", staffCount: 0 },
  ]);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data: clientsPage } = useListClients({ page: 1, pageSize: 500 });
  const clients = clientsPage?.data ?? [];

  const { data: proposal, isLoading } = useQuery({
    queryKey: ["proposal", proposalId],
    queryFn: () => apiGetProposal(proposalId!),
    enabled: Boolean(proposalId),
  });

  const { data: setupTemplates } = useQuery({
    queryKey: ["proposal-setup-templates"],
    queryFn: apiGetProposalSetupTemplates,
  });

  const { data: settings } = useQuery({
    queryKey: ["/company-settings"],
    queryFn: apiGetSettings,
  });

  useEffect(() => {
    if (!proposal) return;
    setClientId(proposal.clientId);
    setValidFrom(proposal.validFrom ?? validFrom);
    setValidUntil(proposal.validUntil ?? validUntil);
    setIsoStandards(proposal.isoStandards ?? []);
    setProposalScope(proposal.proposalScope ?? "");
    setScopePhases(proposal.scopePhases ?? DEFAULT_PHASES_TYPED);
    setTotalAmount(proposal.totalAmount);
    setCurrency(proposal.currency);
    setClientStaffCount(proposal.clientStaffCount);
    setPaymentSchedule(proposal.paymentSchedule ?? DEFAULT_PAYMENT_SCHEDULE);
    setFirmIntro(proposal.firmIntro ?? "");
    setTermsConditions(proposal.termsConditions ?? "");
    setCertificationLocations(
      proposal.certificationLocations?.length
        ? proposal.certificationLocations
        : [{ address: "", staffCount: 0 }],
    );
  }, [proposal]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        clientId,
        validFrom,
        validUntil,
        isoStandards,
        proposalScope: proposalScope.trim() || undefined,
        scopePhases,
        totalAmount,
        currency,
        clientStaffCount,
        paymentSchedule,
        firmIntro: firmIntro.trim() || undefined,
        termsConditions: termsConditions.trim() || undefined,
        certificationLocations: certificationLocations.filter((loc) => loc.address.trim()),
        templateData: proposal?.templateData,
      };
      if (proposalId) return apiUpdateProposal(proposalId, body);
      const created = await apiCreateProposal(body);
      setProposalId(created.id);
      window.history.replaceState(null, "", `/proposals/${created.id}/build`);
      setLocation(`/proposals/${created.id}/build`);
      return created;
    },
    onSuccess: () => {
      if (proposalId) qc.invalidateQueries({ queryKey: ["proposal", proposalId] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["proposals-dashboard"] });
      toast({ title: "Saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const workflowMut = useMutation({
    mutationFn: async ({ action, reason }: { action: string; reason?: string }) => {
      if (!proposalId) throw new Error("Save the proposal first");
      switch (action) {
        case "submit": return apiSubmitProposal(proposalId);
        case "approve": return apiApproveProposal(proposalId);
        case "reject": return apiRejectProposal(proposalId, reason);
        case "cancel": return apiCancelProposal(proposalId, reason);
        case "send": return apiSendProposal(proposalId);
        default: throw new Error("Unknown action");
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["proposal", proposalId] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      const titles: Record<string, string> = {
        submit: "Submitted for approval",
        approve: "Approved",
        reject: "Rejected",
        cancel: "Proposal cancelled",
        send: "Sent to client",
      };
      toast({ title: titles[vars.action] ?? "Updated" });
      if (vars.action === "reject") {
        setRejectDialogOpen(false);
        setRejectReason("");
      }
      if (vars.action === "cancel") {
        setCancelDialogOpen(false);
        setCancelReason("");
      }
    },
    onError: (e: Error) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const emailMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof apiEmailProposal>[1] }) =>
      apiEmailProposal(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposal", proposalId] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
    },
  });

  const handleIsoChange = (standards: string[]) => {
    setIsoStandards(standards);
    if (!setupTemplates) return;
    const templateId = resolveSetupTemplateId(standards);
    if (templateId) {
      applySetupTemplate(setupTemplates, templateId, {
        setProposalScope,
        setScopePhases,
        setPaymentSchedule,
        setFirmIntro,
        setTermsConditions,
      });
    }
  };

  const updateLocation = (idx: number, patch: Partial<ProposalCertificationLocation>) => {
    setCertificationLocations((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const addLocationRow = () => {
    setCertificationLocations((rows) => [...rows, { address: "", staffCount: 0 }]);
  };

  const removeLocationRow = (idx: number) => {
    setCertificationLocations((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== idx)));
  };

  const openEmailDialog = (_p?: ProposalDocument, _clientEmail?: string) => {
    if (!proposal) return;
    setEmailDialogOpen(true);
  };

  const step = BUILDER_STEPS[stepIndex];
  const dayCount = validityDays(validFrom, validUntil);
  const paymentTotal = paymentScheduleTotal(paymentSchedule);
  const selectedClient = clients.find((c) => c.id === clientId);
  const pdfUrl = proposalId ? apiUrl(`/proposals/${proposalId}/pdf`) : null;
  const portalUrl = proposal?.shareToken ? sharePreviewUrl(proposal as ProposalDocument) : null;

  const canAdvance = useMemo(() => {
    if (step.id === "client") return Boolean(clientId) && Boolean(validFrom) && Boolean(validUntil);
    if (step.id === "scope") return isoStandards.length > 0 && scopePhases.every((p) => p.title.trim());
    if (step.id === "fee") return totalAmount > 0 && paymentTotal === 100;
    return true;
  }, [step.id, clientId, validFrom, validUntil, isoStandards, scopePhases, totalAmount, paymentTotal]);

  const persist = useCallback(async () => {
    await saveMut.mutateAsync();
  }, [saveMut]);

  const updatePhase = (idx: number, patch: Partial<ProposalPhase>) => {
    setScopePhases((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const updatePayment = (idx: number, patch: Partial<ProposalPaymentScheduleItem>) => {
    setPaymentSchedule((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  if (!isNew && isLoading) {
    return <p className="p-6 text-muted-foreground">Loading proposal…</p>;
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-4rem)]">
      <div className="flex-1 min-w-0 flex flex-col border-r">
        <header className="shrink-0 border-b px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button type="button" variant="ghost" size="sm" asChild>
              <Link href="/proposals">
                <ArrowLeft className="h-4 w-4 mr-1" /> Proposals
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">
                {proposal?.proposalNo ?? "New proposal"}
              </h1>
              <p className="text-xs text-muted-foreground">
                {selectedClient?.name ?? "Select a client"} · Step {stepIndex + 1} of {BUILDER_STEPS.length}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void persist()} disabled={saveMut.isPending}>
              Save
            </Button>
            {pdfUrl && (
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                  <FileDown className="h-3.5 w-3.5 mr-1" /> PDF
                </a>
              </Button>
            )}
            {proposal?.status === "draft" && proposalId && (
              <Button type="button" size="sm" onClick={() => workflowMut.mutate({ action: "submit" })} disabled={workflowMut.isPending}>
                Submit for approval
              </Button>
            )}
          </div>
        </header>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <nav className="hidden md:flex w-48 shrink-0 flex-col border-r p-4 gap-1" aria-label="Builder steps">
            {BUILDER_STEPS.map((s, idx) => {
              const done = idx < stepIndex;
              const active = idx === stepIndex;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={idx > stepIndex && !proposalId}
                  onClick={() => idx <= stepIndex && setStepIndex(idx)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                    active && "bg-primary/10 text-primary font-medium",
                    done && "text-foreground hover:bg-muted/50",
                    !active && !done && "text-muted-foreground",
                  )}
                >
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs", active ? "bg-primary text-primary-foreground" : "bg-muted")}>
                    {done ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                  </span>
                  <span>{s.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            {step.id === "client" && (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Client details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>Client</Label>
                      <Select value={clientId} onValueChange={setClientId}>
                        <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                        <SelectContent>
                          {clients.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedClient && (
                      <dl className="grid grid-cols-2 gap-2 text-sm">
                        <div><dt className="text-muted-foreground">Contact</dt><dd>{selectedClient.contactPerson ?? "—"}</dd></div>
                        <div><dt className="text-muted-foreground">Email</dt><dd className="truncate">{selectedClient.email ?? "—"}</dd></div>
                      </dl>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Validity</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Valid from</Label>
                      <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Valid until</Label>
                      <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                      {dayCount != null ? <p className="text-xs text-muted-foreground">Valid for {dayCount} days</p> : null}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {step.id === "scope" && (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">ISO standards</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ProposalIsoGrid selected={isoStandards} onChange={handleIsoChange} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Proposal scope</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea value={proposalScope} onChange={(e) => setProposalScope(e.target.value)} rows={3} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Project scope & phases</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {scopePhases.map((phase, idx) => (
                      <div key={phase.phase} className="grid gap-2 sm:grid-cols-[1fr_72px_80px_80px] items-start border-b pb-4 last:border-0">
                        <div>
                          <Input value={phase.title} onChange={(e) => updatePhase(idx, { title: e.target.value })} className="font-medium" />
                          <Textarea value={phase.description} onChange={(e) => updatePhase(idx, { description: e.target.value })} rows={2} className="mt-2" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Weeks</Label>
                          <Input type="number" min={1} value={phase.weeks} onChange={(e) => updatePhase(idx, { weeks: Number(e.target.value) || 1 })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Start</Label>
                          <Input type="number" min={1} max={6} value={phase.startMonth} onChange={(e) => updatePhase(idx, { startMonth: Number(e.target.value) || 1 })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Span</Label>
                          <Input type="number" min={1} max={6} value={phase.spanMonths} onChange={(e) => updatePhase(idx, { spanMonths: Number(e.target.value) || 1 })} />
                        </div>
                      </div>
                    ))}
                    <ProposalGanttPreview phases={scopePhases} />
                  </CardContent>
                </Card>
              </>
            )}

            {step.id === "fee" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Fee & payment schedule</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Fee</Label>
                      <Input type="number" min={0} value={totalAmount || ""} onChange={(e) => setTotalAmount(Number(e.target.value) || 0)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Currency</Label>
                      <Select value={currency} onValueChange={setCurrency}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["HKD", "USD", "CNY", "MOP"].map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Staff count</Label>
                      <Input type="number" min={0} value={clientStaffCount ?? ""} onChange={(e) => setClientStaffCount(Number(e.target.value) || undefined)} />
                    </div>
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="text-left px-3 py-2">Milestone</th>
                          <th className="text-right px-3 py-2 w-20">%</th>
                          <th className="text-right px-3 py-2 w-32">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paymentSchedule.map((item, idx) => (
                          <tr key={idx} className="border-b">
                            <td className="px-3 py-2">
                              <Input value={item.label} onChange={(e) => updatePayment(idx, { label: e.target.value })} className="h-8" />
                            </td>
                            <td className="px-3 py-2">
                              <Input type="number" value={item.percentage} onChange={(e) => updatePayment(idx, { percentage: Number(e.target.value) || 0 })} className="h-8 text-right" />
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {formatCurrency((totalAmount * item.percentage) / 100, currency)}
                            </td>
                          </tr>
                        ))}
                        <tr className="font-medium bg-muted/20">
                          <td className="px-3 py-2">Total</td>
                          <td className="px-3 py-2 text-right">{paymentTotal}%</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(totalAmount, currency)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {paymentTotal !== 100 && <p className="text-sm text-destructive">Percentages must total 100%.</p>}
                </CardContent>
              </Card>
            )}

            {step.id === "evidence" && (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Certification locations</CardTitle>
                    <CardDescription>ISO certification may cover multiple sites.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {certificationLocations.map((loc, idx) => (
                      <div key={idx} className="grid gap-2 md:grid-cols-[1fr_140px_auto] items-end">
                        <div className="space-y-1">
                          <Label className="text-xs">
                            {certificationLocations.length > 1 ? `Location ${idx + 1}` : "Address"}
                          </Label>
                          <Input
                            value={loc.address}
                            onChange={(e) => updateLocation(idx, { address: e.target.value })}
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
                          />
                        </div>
                        {certificationLocations.length > 1 && (
                          <Button type="button" size="icon" variant="ghost" onClick={() => removeLocationRow(idx)} aria-label="Remove location">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="outline" onClick={addLocationRow}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add location
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Firm background & terms</CardTitle>
                    <CardDescription>Portfolio blocks and advanced template options can be refined in the list detail panel after saving.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Firm background</Label>
                      <Textarea value={firmIntro} onChange={(e) => setFirmIntro(e.target.value)} rows={4} />
                    </div>
                    <div className="space-y-2">
                      <Label>Terms & conditions</Label>
                      <Textarea value={termsConditions} onChange={(e) => setTermsConditions(e.target.value)} rows={4} />
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {step.id === "send" && proposal && proposalId && (
              <div className="space-y-4">
                <ProposalWorkflowToolbar
                  proposal={proposal}
                  proposalId={proposalId}
                  clientEmail={selectedClient?.email}
                  workflowPending={workflowMut.isPending}
                  revoking={revoking}
                  refreshing={refreshing}
                  extractPending={false}
                  onWorkflow={(action) => workflowMut.mutate({ action })}
                  onReject={() => setRejectDialogOpen(true)}
                  onCancel={() => setCancelDialogOpen(true)}
                  onOpenEmail={openEmailDialog}
                  onRefreshLink={async () => {
                    setRefreshing(true);
                    try {
                      await apiRefreshProposalShareLink(proposalId);
                      qc.invalidateQueries({ queryKey: ["proposal", proposalId] });
                      toast({ title: "Share link refreshed" });
                    } finally {
                      setRefreshing(false);
                    }
                  }}
                  onRevokeLink={async () => {
                    setRevoking(true);
                    try {
                      await apiRevokeProposalShareToken(proposalId);
                      qc.invalidateQueries({ queryKey: ["proposal", proposalId] });
                      toast({ title: "Share link revoked" });
                    } finally {
                      setRevoking(false);
                    }
                  }}
                  onExtract={() => {}}
                />
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Client portal actions</CardTitle>
                    <CardDescription>What your client will see after you send the proposal.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg border p-3 text-center text-sm">
                      <ThumbsUp className="h-5 w-5 mx-auto mb-2 text-green-600" />
                      Confirm proposal
                    </div>
                    <div className="rounded-lg border p-3 text-center text-sm">
                      <PenLine className="h-5 w-5 mx-auto mb-2 text-orange-600" />
                      Request revision
                    </div>
                    <div className="rounded-lg border p-3 text-center text-sm">
                      <MessageCircleQuestion className="h-5 w-5 mx-auto mb-2 text-primary" />
                      Ask a question
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {step.id === "send" && !proposalId && (
              <p className="text-sm text-muted-foreground">Save the proposal first to preview send options.</p>
            )}

            <div className="flex justify-between pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={stepIndex === 0}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Back
              </Button>
              {stepIndex < BUILDER_STEPS.length - 1 ? (
                <Button
                  type="button"
                  onClick={async () => {
                    if (!canAdvance) return;
                    await persist();
                    setStepIndex((i) => i + 1);
                  }}
                  disabled={!canAdvance || saveMut.isPending}
                >
                  Next: {BUILDER_STEPS[stepIndex + 1]?.label}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button type="button" asChild>
                  <Link href={proposalId ? `/proposals?open=${proposalId}` : "/proposals"}>Finish</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <aside className="hidden lg:flex w-[min(38vw,420px)] shrink-0 flex-col bg-muted/20 border-l">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-sm">Live PDF preview</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Updates after you save</p>
        </div>
        <div className="flex-1 p-4 min-h-0">
          {pdfUrl ? (
            <iframe title="Proposal PDF preview" src={pdfUrl} className="w-full h-full min-h-[480px] rounded-lg border bg-white" />
          ) : (
            <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground text-center p-6">
              Save step 1 to generate a PDF preview
            </div>
          )}
        </div>
        <div className="p-4 border-t space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Client portal</span>
            {portalUrl ? <Badge variant="outline" className="text-green-700 border-green-200 bg-green-500/10">Ready to share</Badge> : null}
          </div>
          {portalUrl ? (
            <Button type="button" variant="outline" size="sm" className="w-full" asChild>
              <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open portal preview
              </a>
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Portal link appears after the proposal is sent.</p>
          )}
        </div>
      </aside>

      <EmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        title={`Send Proposal ${proposal?.proposalNo ?? ""}`}
        description="Email the proposal PDF and client portal link to the client."
        defaultEmail={selectedClient?.email ?? ""}
        showRecipientOverride
        senderEmail1={settings?.gmailAccount1?.senderEmail}
        senderEmail2={settings?.gmailAccount2?.senderEmail}
        onSend={async (params) => {
          if (!proposalId) return;
          try {
            await emailMut.mutateAsync({
              id: proposalId,
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
          } catch (err) {
            toast({
              title: "Failed to send email",
              description: err instanceof Error ? err.message : "Unknown error",
              variant: "destructive",
            });
          }
        }}
      />

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject proposal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Optional reason for rejection"
              rows={3}
            />
            <Button
              variant="destructive"
              onClick={() => workflowMut.mutate({ action: "reject", reason: rejectReason })}
              disabled={workflowMut.isPending}
            >
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel proposal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Optional reason for cancellation"
              rows={3}
            />
            <Button
              variant="destructive"
              onClick={() => workflowMut.mutate({ action: "cancel", reason: cancelReason })}
              disabled={workflowMut.isPending}
            >
              Cancel proposal
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
