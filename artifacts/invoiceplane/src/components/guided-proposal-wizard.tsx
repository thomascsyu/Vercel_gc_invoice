import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Check, Plus, Trash2, X } from "lucide-react";
import type { Client } from "@workspace/api-client-react";
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
import { cn, formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { JobReferenceTemplatePicker } from "@/components/job-reference-template-picker";
import { TestimonialTemplatePicker } from "@/components/testimonial-template-picker";
import {
  clearProposalWizardDraft,
  readProposalWizardDraft,
  writeProposalWizardDraft,
  type ProposalWizardDraft,
} from "@/lib/proposalWizardDraft";
import { getWizardAdvanceBlockers, getWizardCreateBlockers, paymentScheduleTotal } from "@/lib/proposalWizardValidation";
import { describeApiFailure } from "@/lib/describeApiFailure";
import { resolveJobReferencesFromTemplateIds } from "@/lib/resolveJobReferencesFromTemplateIds";
import { resolveTestimonialsFromTemplateIds } from "@/lib/resolveTestimonialsFromTemplateIds";
import {
  apiCreateProposal,
  type ProposalCertificationLocation,
  type ProposalJobReference,
  type ProposalPaymentScheduleItem,
  type ProposalPhase,
  type ProposalSetupTemplateId,
  type ProposalSetupTemplates,
  type ProposalTestimonial,
} from "@/lib/modulesApi";
import { ISO_STANDARD_OPTIONS } from "@/lib/proposal-shared";

const WIZARD_STEPS = [
  { id: "client", label: "Client & fee" },
  { id: "scope", label: "Scope phases" },
  { id: "payment", label: "Payment" },
  { id: "references", label: "Job references" },
  { id: "testimonials", label: "Testimonials" },
  { id: "review", label: "Review" },
] as const;

const SETUP_TEMPLATE_OPTIONS: { id: ProposalSetupTemplateId; label: string }[] = [
  { id: "iso9001", label: "ISO 9001" },
  { id: "iso14001-45001", label: "ISO 14001 & ISO 45001" },
  { id: "iso27001", label: "ISO 27001" },
];

type GuidedProposalWizardProps = {
  clients: Client[];
  defaultPhases: ProposalPhase[];
  defaultPaymentSchedule: ProposalPaymentScheduleItem[];
  setupTemplates?: ProposalSetupTemplates;
  initialClientId?: string;
  onCreated: (id: string) => void;
};

function resolveInitialClientId(
  clients: Client[],
  initialClientId: string | undefined,
  draft: ProposalWizardDraft | null,
): string {
  if (draft?.clientId && clients.some((client) => client.id === draft.clientId)) {
    return draft.clientId;
  }
  if (initialClientId && clients.some((client) => client.id === initialClientId)) {
    return initialClientId;
  }
  return clients[0]?.id ?? "";
}

const DEFAULT_LOCATION: ProposalCertificationLocation = { address: "", staffCount: 0 };

function renumberPhases(phases: ProposalPhase[]): ProposalPhase[] {
  return phases.map((row, i) => ({ ...row, phase: i + 1 }));
}

export function GuidedProposalWizard({
  clients,
  defaultPhases,
  defaultPaymentSchedule,
  setupTemplates,
  initialClientId,
  onCreated,
}: GuidedProposalWizardProps) {
  const { toast } = useToast();
  const savedDraft = useMemo(() => readProposalWizardDraft(), []);
  const templatesBootstrapped = useRef(Boolean(savedDraft));
  const [restoredDraft, setRestoredDraft] = useState(Boolean(savedDraft));

  const [stepIndex, setStepIndex] = useState(() =>
    Math.min(Math.max(savedDraft?.stepIndex ?? 0, 0), WIZARD_STEPS.length - 1),
  );
  const [setupTemplateId, setSetupTemplateId] = useState<ProposalSetupTemplateId>(
    savedDraft?.setupTemplateId ?? "iso9001",
  );
  const [clientId, setClientId] = useState(() =>
    resolveInitialClientId(clients, initialClientId, savedDraft),
  );
  const [isoStandards, setIsoStandards] = useState(savedDraft?.isoStandards ?? "ISO 9001");
  const [totalAmount, setTotalAmount] = useState(savedDraft?.totalAmount ?? 0);
  const [currency, setCurrency] = useState(savedDraft?.currency ?? "HKD");
  const [proposalScope, setProposalScope] = useState(savedDraft?.proposalScope ?? "");
  const [certificationLocations, setCertificationLocations] = useState<ProposalCertificationLocation[]>(
    savedDraft?.certificationLocations ?? [{ ...DEFAULT_LOCATION }],
  );
  const [scopePhases, setScopePhases] = useState<ProposalPhase[]>(
    savedDraft?.scopePhases ?? defaultPhases,
  );
  const [paymentSchedule, setPaymentSchedule] = useState<ProposalPaymentScheduleItem[]>(
    savedDraft?.paymentSchedule ?? defaultPaymentSchedule,
  );
  const [jobReferences, setJobReferences] = useState<ProposalJobReference[]>(
    savedDraft?.jobReferences ?? [],
  );
  const [referencePageIndex, setReferencePageIndex] = useState(() => {
    const saved = savedDraft?.referencePageIndex ?? 0;
    const refCount = savedDraft?.jobReferences?.length ?? 0;
    if (saved === 0 || refCount === 0) return 0;
    return Math.min(saved, refCount);
  });
  const [testimonials, setTestimonials] = useState<ProposalTestimonial[]>(savedDraft?.testimonials ?? []);
  const [testimonialPageIndex, setTestimonialPageIndex] = useState(() => {
    const saved = savedDraft?.testimonialPageIndex ?? 0;
    const count = savedDraft?.testimonials?.length ?? 0;
    if (saved === 0 || count === 0) return 0;
    return Math.min(saved, count);
  });

  const applySetupTemplate = useCallback(
    (id: ProposalSetupTemplateId) => {
      const template = setupTemplates?.[id];
      if (!template) return;
      setIsoStandards(template.isoStandards.join(", "));
      setProposalScope(template.proposalScope ?? "");
      setScopePhases(template.scopePhases.map((phase, index) => ({ ...phase, phase: index + 1 })));
      setPaymentSchedule(template.paymentSchedule.map((row) => ({ ...row })));
      setJobReferences(resolveJobReferencesFromTemplateIds(template.jobReferenceTemplateIds));
      setTestimonials(resolveTestimonialsFromTemplateIds(template.testimonialTemplateIds));
      setReferencePageIndex(0);
      setTestimonialPageIndex(0);
    },
    [setupTemplates],
  );

  useEffect(() => {
    if (!setupTemplates || templatesBootstrapped.current) return;
    templatesBootstrapped.current = true;
    applySetupTemplate(setupTemplateId);
  }, [setupTemplates, setupTemplateId, applySetupTemplate]);

  useEffect(() => {
    if (!initialClientId || clientId) return;
    if (clients.some((client) => client.id === initialClientId)) {
      setClientId(initialClientId);
    }
  }, [clients, initialClientId, clientId]);

  useEffect(() => {
    writeProposalWizardDraft({
      stepIndex,
      setupTemplateId,
      clientId,
      isoStandards,
      totalAmount,
      currency,
      proposalScope,
      certificationLocations,
      scopePhases,
      paymentSchedule,
      jobReferences,
      referencePageIndex,
      testimonials,
      testimonialPageIndex,
    });
  }, [
    stepIndex,
    setupTemplateId,
    clientId,
    isoStandards,
    totalAmount,
    currency,
    proposalScope,
    certificationLocations,
    scopePhases,
    paymentSchedule,
    jobReferences,
    referencePageIndex,
    testimonials,
    testimonialPageIndex,
  ]);

  const step = WIZARD_STEPS[stepIndex];
  const selectedClient = clients.find((c) => c.id === clientId);

  const paymentTotal = useMemo(() => paymentScheduleTotal(paymentSchedule), [paymentSchedule]);

  const normalizedPhases = useMemo(
    () =>
      scopePhases.map((p, i) => ({
        ...p,
        phase: i + 1,
        title: p.title.trim() || `Phase ${i + 1}`,
        description: p.description?.trim() ?? "",
        deliverable: (p.deliverable ?? "").trim(),
        weeks: p.weeks > 0 ? Math.round(p.weeks) : 4,
        startMonth: p.startMonth >= 1 && p.startMonth <= 6 ? Math.round(p.startMonth) : 1,
        spanMonths: p.spanMonths >= 1 && p.spanMonths <= 6 ? Math.round(p.spanMonths) : 1,
      })),
    [scopePhases],
  );

  const createMut = useMutation({
    mutationFn: () =>
      apiCreateProposal({
        clientId,
        isoStandards: isoStandards.split(",").map((s) => s.trim()).filter(Boolean),
        totalAmount,
        currency,
        proposalScope: proposalScope.trim() || undefined,
        certificationLocations: certificationLocations
          .map((loc) => ({ address: loc.address.trim(), staffCount: loc.staffCount || 0 }))
          .filter((loc) => loc.address),
        scopePhases: normalizedPhases,
        paymentSchedule,
        termsConditions: setupTemplates?.[setupTemplateId]?.termsConditions?.trim() || undefined,
        jobReferences: jobReferences
          .map((ref) => ({
            clientName: ref.clientName.trim(),
            projectTitle: ref.projectTitle.trim(),
            description: ref.description?.trim() || undefined,
            photoUrl: ref.photoUrl,
          }))
          .filter((ref) => ref.clientName && ref.projectTitle),
        testimonials: testimonials
          .map((item) => ({
            quote: item.quote.trim(),
            authorName: item.authorName.trim(),
            authorTitle: item.authorTitle?.trim() || undefined,
            companyName: item.companyName?.trim() || undefined,
            photoUrl: item.photoUrl,
          }))
          .filter((item) => item.quote && item.authorName),
      }),
    onSuccess: (p) => {
      clearProposalWizardDraft();
      toast({ title: "Proposal created", description: "Your draft is ready to refine in the editor." });
      onCreated(p.id);
    },
    onError: (e: Error) =>
      toast({ title: "Create failed", description: describeApiFailure(e), variant: "destructive" }),
  });

  const advanceBlockers = useMemo(
    () =>
      getWizardAdvanceBlockers({
        stepId: step.id,
        clientId,
        totalAmount,
        certificationLocations,
        scopePhases,
        paymentSchedule,
        referencePageIndex,
        jobReferences,
        testimonialPageIndex,
        testimonials,
      }),
    [
      step.id,
      clientId,
      totalAmount,
      certificationLocations,
      scopePhases,
      paymentSchedule,
      referencePageIndex,
      jobReferences,
      testimonialPageIndex,
      testimonials,
    ],
  );

  const createBlockers = useMemo(
    () =>
      getWizardCreateBlockers({
        clientId,
        totalAmount,
        certificationLocations,
        scopePhases: normalizedPhases,
        paymentSchedule,
        referencePageIndex,
        jobReferences,
        testimonialPageIndex,
        testimonials,
        selectedClientExists: Boolean(selectedClient),
      }),
    [
      clientId,
      totalAmount,
      certificationLocations,
      normalizedPhases,
      paymentSchedule,
      referencePageIndex,
      jobReferences,
      testimonialPageIndex,
      testimonials,
      selectedClient,
    ],
  );

  const activeBlockers = step.id === "review" ? createBlockers : advanceBlockers;
  const canAdvance = activeBlockers.length === 0;

  const goToStep = (idx: number) => {
    setStepIndex(Math.min(Math.max(idx, 0), WIZARD_STEPS.length - 1));
    setReferencePageIndex(0);
    setTestimonialPageIndex(0);
  };

  const goNext = () => {
    if (step.id === "references") {
      if (referencePageIndex === 0) {
        if (jobReferences.length > 0) {
          setReferencePageIndex(1);
          return;
        }
      } else if (referencePageIndex < jobReferences.length) {
        setReferencePageIndex((page) => page + 1);
        return;
      }
    }
    if (step.id === "testimonials") {
      if (testimonialPageIndex === 0) {
        if (testimonials.length > 0) {
          setTestimonialPageIndex(1);
          return;
        }
      } else if (testimonialPageIndex < testimonials.length) {
        setTestimonialPageIndex((page) => page + 1);
        return;
      }
    }
    goToStep(Math.min(WIZARD_STEPS.length - 1, stepIndex + 1));
  };

  const goBack = () => {
    if (step.id === "testimonials" && testimonialPageIndex > 0) {
      setTestimonialPageIndex((page) => page - 1);
      return;
    }
    if (step.id === "testimonials" && testimonialPageIndex === 0 && stepIndex > 0) {
      const prevStep = WIZARD_STEPS[stepIndex - 1];
      if (prevStep.id === "references" && jobReferences.length > 0) {
        setStepIndex(stepIndex - 1);
        setTestimonialPageIndex(0);
        setReferencePageIndex(jobReferences.length);
        return;
      }
    }
    if (step.id === "references" && referencePageIndex > 0) {
      setReferencePageIndex((page) => page - 1);
      return;
    }
    goToStep(Math.max(0, stepIndex - 1));
  };

  const updateJobReference = (idx: number, patch: Partial<ProposalJobReference>) => {
    setJobReferences((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeJobReference = (idx: number) => {
    setJobReferences((rows) => {
      const next = rows.filter((_, i) => i !== idx);
      setReferencePageIndex((page) => {
        if (page === 0 || next.length === 0) return 0;
        if (page > next.length) return next.length;
        return page;
      });
      return next;
    });
  };

  const addBlankJobReference = () => {
    setJobReferences((rows) => [...rows, { clientName: "", projectTitle: "" }]);
  };

  const updateTestimonial = (idx: number, patch: Partial<ProposalTestimonial>) => {
    setTestimonials((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const removeTestimonial = (idx: number) => {
    setTestimonials((rows) => {
      const next = rows.filter((_, i) => i !== idx);
      setTestimonialPageIndex((page) => {
        if (page === 0 || next.length === 0) return 0;
        if (page > next.length) return next.length;
        return page;
      });
      return next;
    });
  };

  const addBlankTestimonial = () => {
    setTestimonials((rows) => [...rows, { quote: "", authorName: "" }]);
  };

  const updatePhase = (idx: number, patch: Partial<ProposalPhase>) => {
    setScopePhases((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const addPhase = () => {
    setScopePhases((rows) =>
      renumberPhases([
        ...rows,
        {
          phase: rows.length + 1,
          title: "",
          description: "",
          deliverable: "",
          weeks: 4,
          startMonth: 1,
          spanMonths: 1,
        },
      ]),
    );
  };

  const removePhase = (idx: number) => {
    setScopePhases((rows) => {
      if (rows.length <= 1) return rows;
      return renumberPhases(rows.filter((_, i) => i !== idx));
    });
  };

  const updatePayment = (idx: number, patch: Partial<ProposalPaymentScheduleItem>) => {
    setPaymentSchedule((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const addPaymentRow = () => {
    setPaymentSchedule((rows) => [...rows, { label: "", percentage: 0 }]);
  };

  const removePaymentRow = (idx: number) => {
    setPaymentSchedule((rows) => {
      if (rows.length <= 1) return rows;
      return rows.filter((_, i) => i !== idx);
    });
  };

  const updateLocation = (idx: number, patch: Partial<ProposalCertificationLocation>) => {
    setCertificationLocations((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };

  const addLocation = () => {
    setCertificationLocations((rows) => [...rows, { ...DEFAULT_LOCATION }]);
  };

  const removeLocation = (idx: number) => {
    setCertificationLocations((rows) => {
      if (rows.length <= 1) return rows;
      return rows.filter((_, i) => i !== idx);
    });
  };

  const handleTemplateChange = (value: ProposalSetupTemplateId) => {
    setSetupTemplateId(value);
    applySetupTemplate(value);
  };

  const discardRestoredDraft = () => {
    clearProposalWizardDraft();
    setRestoredDraft(false);
    templatesBootstrapped.current = false;
    setStepIndex(0);
    setSetupTemplateId("iso9001");
    setClientId(resolveInitialClientId(clients, initialClientId, null));
    setIsoStandards("ISO 9001");
    setTotalAmount(0);
    setCurrency("HKD");
    setProposalScope("");
    setCertificationLocations([{ ...DEFAULT_LOCATION }]);
    setScopePhases(defaultPhases);
    setPaymentSchedule(defaultPaymentSchedule);
    setJobReferences([]);
    setReferencePageIndex(0);
    setTestimonials([]);
    setTestimonialPageIndex(0);
    if (setupTemplates) {
      templatesBootstrapped.current = true;
      applySetupTemplate("iso9001");
    }
  };

  return (
    <div className="space-y-6">
      {restoredDraft && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>Restored your in-progress proposal draft.</span>
          <Button type="button" size="sm" variant="ghost" onClick={discardRestoredDraft}>
            <X className="h-3.5 w-3.5 mr-1" />
            Start fresh
          </Button>
        </div>
      )}

      <nav aria-label="Proposal setup progress" className="flex flex-wrap gap-2">
        {WIZARD_STEPS.map((s, idx) => {
          const done = idx < stepIndex;
          const active = idx === stepIndex;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => idx < stepIndex && goToStep(idx)}
              disabled={idx > stepIndex}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                active && "border-primary bg-primary/10 text-primary",
                done && "border-primary/40 text-foreground hover:bg-muted/50",
                !active && !done && "text-muted-foreground cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                  active ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {done ? <Check className="h-3 w-3" /> : idx + 1}
              </span>
              {s.label}
            </button>
          );
        })}
      </nav>

      {step.id === "client" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Start with the client and fee</h3>
            <p className="text-sm text-muted-foreground">
              Choose who this proposal is for and set the consultancy fee. You can refine wording later.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {setupTemplates && (
              <div className="space-y-2 md:col-span-2">
                <Label>Proposal template</Label>
                <Select value={setupTemplateId} onValueChange={handleTemplateChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SETUP_TEMPLATE_OPTIONS.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {setupTemplates[option.id]?.label ?? option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {setupTemplates[setupTemplateId]?.description && (
                  <p className="text-xs text-muted-foreground">
                    {setupTemplates[setupTemplateId].description}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2 md:col-span-2">
              <Label>Client</Label>
              {clients.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No clients yet.{" "}
                  <Link href="/clients" className="text-primary underline-offset-4 hover:underline">
                    Add a client
                  </Link>{" "}
                  before creating a proposal.
                </div>
              ) : (
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label>Consultancy fee</Label>
              <Input
                type="number"
                min={0}
                value={totalAmount || ""}
                onChange={(e) => setTotalAmount(Number(e.target.value) || 0)}
              />
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
            <div className="space-y-2 md:col-span-2">
              <Label>ISO standards</Label>
              <div className="flex flex-wrap gap-2">
                {ISO_STANDARD_OPTIONS.slice(0, 4).map((opt) => (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => {
                      const parts = isoStandards.split(",").map((s) => s.trim()).filter(Boolean);
                      if (parts.includes(opt.code)) {
                        setIsoStandards(parts.filter((c) => c !== opt.code).join(", "));
                      } else {
                        setIsoStandards([...parts, opt.code].join(", "));
                      }
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs",
                      isoStandards.includes(opt.code) ? "border-primary bg-primary/10 text-primary" : "border-border",
                    )}
                  >
                    {opt.code}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Proposed scope of certification</Label>
              <Textarea
                value={proposalScope}
                onChange={(e) => setProposalScope(e.target.value)}
                rows={3}
                placeholder="Describe the scope of certification (e.g. sales of machinery)"
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-medium text-sm">Address</h4>
                <p className="text-xs text-muted-foreground">
                  ISO certification may cover multiple locations. Add each site and the staff involved.
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={addLocation}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add location
              </Button>
            </div>
            {certificationLocations.map((loc, idx) => (
              <div key={idx} className="grid gap-3 md:grid-cols-[1fr_140px_auto] items-end">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {certificationLocations.length > 1 ? `Location ${idx + 1} address` : "Address"}
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
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removeLocation(idx)}
                  disabled={certificationLocations.length <= 1}
                  aria-label="Remove location"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {step.id === "scope" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold">Define phases</h3>
              <p className="text-sm text-muted-foreground">
                Add or remove phases as needed. Each phase needs a description and deliverable.
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addPhase}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add phase
            </Button>
          </div>
          <div className="space-y-4">
            {scopePhases.map((phase, idx) => (
              <div key={idx} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Phase {idx + 1}</p>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removePhase(idx)}
                    disabled={scopePhases.length <= 1}
                    aria-label="Remove phase"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Textarea
                    value={phase.description}
                    onChange={(e) => updatePhase(idx, { description: e.target.value })}
                    rows={2}
                    placeholder="What will be done in this phase"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Deliverable</Label>
                  <Textarea
                    value={phase.deliverable ?? ""}
                    onChange={(e) => updatePhase(idx, { deliverable: e.target.value })}
                    rows={2}
                    placeholder="What the client receives at the end of this phase"
                  />
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Timeline settings (Gantt)</summary>
                  <div className="mt-3 space-y-3">
                    <Input
                      value={phase.title}
                      onChange={(e) => updatePhase(idx, { title: e.target.value })}
                      placeholder="Phase title (optional)"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Weeks</Label>
                        <Input
                          type="number"
                          min={1}
                          value={phase.weeks}
                          onChange={(e) => updatePhase(idx, { weeks: Number(e.target.value) || 1 })}
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
                        />
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {step.id === "payment" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold">Payment schedule</h3>
              <p className="text-sm text-muted-foreground">
                Add or remove payment phases. Milestone percentages must total 100%.
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addPaymentRow}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add payment phase
            </Button>
          </div>
          <div className="space-y-3">
            {paymentSchedule.map((item, idx) => (
              <div key={idx} className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 space-y-1 min-w-[180px]">
                  <Label className="text-xs">Milestone</Label>
                  <Input
                    value={item.label}
                    onChange={(e) => updatePayment(idx, { label: e.target.value })}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-xs">%</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={item.percentage}
                    onChange={(e) => updatePayment(idx, { percentage: Number(e.target.value) || 0 })}
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => removePaymentRow(idx)}
                  disabled={paymentSchedule.length <= 1}
                  aria-label="Remove payment phase"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <p className={cn("text-sm", paymentTotal === 100 ? "text-muted-foreground" : "text-destructive")}>
            Total: {paymentTotal}% {paymentTotal !== 100 ? "(must equal 100%)" : ""}
          </p>
        </div>
      )}

      {step.id === "references" && referencePageIndex === 0 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Choose job references</h3>
            <p className="text-sm text-muted-foreground">
              Pick template references from past certification projects, or skip this step and add them later in the editor.
            </p>
          </div>
          <JobReferenceTemplatePicker
            jobReferences={jobReferences}
            onChange={setJobReferences}
            onAddBlank={addBlankJobReference}
          />
        </div>
      )}

      {step.id === "references" && referencePageIndex > 0 && (
        <div className="space-y-4">
          {(() => {
            const idx = referencePageIndex - 1;
            const ref = jobReferences[idx];
            if (!ref) return null;
            return (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold">Customise reference {idx + 1}</h3>
                    <p className="text-sm text-muted-foreground">
                      Page {referencePageIndex} of {jobReferences.length} — adjust wording before it appears in the proposal PDF.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeJobReference(idx)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive mr-1" />
                    Remove
                  </Button>
                </div>
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Company name</Label>
                      <Input
                        value={ref.clientName}
                        onChange={(e) => updateJobReference(idx, { clientName: e.target.value })}
                        placeholder="e.g. BEA, Omnichat"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Certification / project</Label>
                      <Input
                        value={ref.projectTitle}
                        onChange={(e) => updateJobReference(idx, { projectTitle: e.target.value })}
                        placeholder="e.g. ISO 9001:2015"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Description</Label>
                    <Textarea
                      value={ref.description ?? ""}
                      onChange={(e) => updateJobReference(idx, { description: e.target.value })}
                      rows={4}
                      placeholder="Brief description of the certification project"
                    />
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {step.id === "testimonials" && testimonialPageIndex === 0 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Choose testimonials</h3>
            <p className="text-sm text-muted-foreground">
              Pick client quotes from past engagements, or skip this step and add them later in the editor.
            </p>
          </div>
          <TestimonialTemplatePicker
            testimonials={testimonials}
            onChange={setTestimonials}
            onAddBlank={addBlankTestimonial}
          />
        </div>
      )}

      {step.id === "testimonials" && testimonialPageIndex > 0 && (
        <div className="space-y-4">
          {(() => {
            const idx = testimonialPageIndex - 1;
            const testimonial = testimonials[idx];
            if (!testimonial) return null;
            return (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold">Customise testimonial {idx + 1}</h3>
                    <p className="text-sm text-muted-foreground">
                      Page {testimonialPageIndex} of {testimonials.length} — adjust wording before it appears in the proposal PDF.
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeTestimonial(idx)}>
                    <Trash2 className="h-4 w-4 text-destructive mr-1" />
                    Remove
                  </Button>
                </div>
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Quote</Label>
                    <Textarea
                      value={testimonial.quote}
                      onChange={(e) => updateTestimonial(idx, { quote: e.target.value })}
                      rows={4}
                      placeholder="Testimonial quote"
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Author name</Label>
                      <Input
                        value={testimonial.authorName}
                        onChange={(e) => updateTestimonial(idx, { authorName: e.target.value })}
                        placeholder="e.g. Steve Chuang"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Author title</Label>
                      <Input
                        value={testimonial.authorTitle ?? ""}
                        onChange={(e) => updateTestimonial(idx, { authorTitle: e.target.value })}
                        placeholder="e.g. Chairman"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Company</Label>
                      <Input
                        value={testimonial.companyName ?? ""}
                        onChange={(e) => updateTestimonial(idx, { companyName: e.target.value })}
                        placeholder="e.g. BBPOS Ltd."
                      />
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {step.id === "review" && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Review and create draft</h3>
            <p className="text-sm text-muted-foreground">
              Confirm the essentials, then create a draft you can polish before submitting for approval.
            </p>
          </div>
          <div className="rounded-lg border divide-y text-sm">
            <ReviewRow label="Client" value={selectedClient?.name ?? "—"} />
            <ReviewRow label="Fee" value={formatCurrency(totalAmount, currency)} />
            {setupTemplates && (
              <ReviewRow
                label="Proposal template"
                value={setupTemplates[setupTemplateId]?.label ?? setupTemplateId}
              />
            )}
            <ReviewRow label="ISO standards" value={isoStandards} />
            {proposalScope.trim() && (
              <ReviewRow label="Proposed scope of certification" value={proposalScope.trim()} />
            )}
            <ReviewRow
              label="Certification locations"
              value={certificationLocations
                .filter((loc) => loc.address.trim())
                .map((loc) => `${loc.address.trim()} (${loc.staffCount} staff)`)
                .join(" · ") || "—"}
            />
            <div className="px-4 py-3 space-y-2">
              <span className="text-sm text-muted-foreground">Scope phases ({scopePhases.length})</span>
              <ul className="space-y-2 text-sm">
                {normalizedPhases.map((phase) => (
                  <li key={phase.phase} className="rounded-md border bg-muted/20 px-3 py-2">
                    <p className="font-medium">{phase.title}</p>
                    <p className="text-muted-foreground text-xs mt-1">{phase.description}</p>
                    {(phase.deliverable ?? "").trim() && (
                      <p className="text-xs mt-1">
                        <span className="text-muted-foreground">Deliverable:</span> {phase.deliverable}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <ReviewRow
              label="Payment milestones"
              value={paymentSchedule.map((p) => `${p.label} (${p.percentage}%)`).join(" · ")}
            />
            <ReviewRow
              label="Job references"
              value={
                jobReferences.length > 0
                  ? jobReferences.map((ref) => `${ref.clientName} — ${ref.projectTitle}`).join(" · ")
                  : "None (can add in editor)"
              }
            />
            <ReviewRow
              label="Testimonials"
              value={
                testimonials.length > 0
                  ? testimonials.map((item) => `${item.authorName} (${item.companyName ?? "—"})`).join(" · ")
                  : "None (can add in editor)"
              }
            />
          </div>
        </div>
      )}

      {!canAdvance && activeBlockers.length > 0 && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="status"
        >
          <p className="font-medium">Complete the following before continuing:</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {activeBlockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-between gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={goBack}
          disabled={
            (stepIndex === 0 && referencePageIndex === 0 && testimonialPageIndex === 0) ||
            createMut.isPending
          }
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        {step.id !== "review" ? (
          <Button type="button" onClick={goNext} disabled={!canAdvance}>
            {(step.id === "references" && referencePageIndex === 0 && jobReferences.length === 0) ||
            (step.id === "testimonials" && testimonialPageIndex === 0 && testimonials.length === 0)
              ? "Skip"
              : "Next"}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" onClick={() => createMut.mutate()} disabled={!canAdvance || createMut.isPending}>
            Create draft proposal
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium sm:max-w-[65%] sm:text-right">{value}</span>
    </div>
  );
}
