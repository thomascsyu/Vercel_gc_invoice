import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  apiGetProposalSetupTemplates,
  apiUpdateProposalSetupTemplates,
  type ProposalPaymentScheduleItem,
  type ProposalPhase,
  type ProposalSetupTemplate,
  type ProposalSetupTemplateId,
  type ProposalSetupTemplates,
} from "@/lib/proposals-api";
import { JOB_REFERENCE_TEMPLATES } from "@/lib/proposalJobReferenceTemplates";
import { TESTIMONIAL_TEMPLATES } from "@/lib/proposalTestimonialTemplates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getWizardAdvanceBlockers, paymentScheduleTotal } from "@/lib/proposalWizardValidation";

const TEMPLATE_TABS: { id: ProposalSetupTemplateId; title: string }[] = [
  { id: "iso9001", title: "ISO 9001" },
  { id: "iso14001-45001", title: "ISO 14001 & 45001" },
  { id: "iso27001", title: "ISO 27001" },
];

type ProposalSetupTemplatesPanelProps = {
  canEdit: boolean;
};

function renumberPhases(phases: ProposalPhase[]): ProposalPhase[] {
  return phases.map((row, i) => ({ ...row, phase: i + 1 }));
}

function cloneOneTemplate(template: ProposalSetupTemplate): ProposalSetupTemplate {
  return {
    ...template,
    isoStandards: [...template.isoStandards],
    scopePhases: template.scopePhases.map((p) => ({ ...p })),
    paymentSchedule: template.paymentSchedule.map((p) => ({ ...p })),
    jobReferenceTemplateIds: template.jobReferenceTemplateIds
      ? [...template.jobReferenceTemplateIds]
      : undefined,
    testimonialTemplateIds: template.testimonialTemplateIds
      ? [...template.testimonialTemplateIds]
      : undefined,
  };
}

function cloneTemplates(templates: ProposalSetupTemplates): ProposalSetupTemplates {
  return {
    iso9001: templates.iso9001 ? cloneOneTemplate(templates.iso9001) : undefined,
    "iso14001-45001": templates["iso14001-45001"]
      ? cloneOneTemplate(templates["iso14001-45001"])
      : undefined,
    iso27001: templates.iso27001 ? cloneOneTemplate(templates.iso27001) : undefined,
  };
}

function TemplateEditor({
  templateId,
  template,
  onChange,
  canEdit,
}: {
  templateId: ProposalSetupTemplateId;
  template: ProposalSetupTemplate;
  onChange: (next: ProposalSetupTemplate) => void;
  canEdit: boolean;
}) {
  const paymentTotal = useMemo(
    () => paymentScheduleTotal(template.paymentSchedule),
    [template.paymentSchedule],
  );

  const patch = (partial: Partial<ProposalSetupTemplate>) => onChange({ ...template, ...partial });

  const updatePhase = (idx: number, phasePatch: Partial<ProposalPhase>) => {
    const scopePhases = template.scopePhases.map((row, i) => (i === idx ? { ...row, ...phasePatch } : row));
    patch({ scopePhases });
  };

  const updatePayment = (idx: number, rowPatch: Partial<ProposalPaymentScheduleItem>) => {
    const paymentSchedule = template.paymentSchedule.map((row, i) =>
      i === idx ? { ...row, ...rowPatch } : row,
    );
    patch({ paymentSchedule });
  };

  const toggleJobRefTemplate = (refId: string, checked: boolean) => {
    const current = template.jobReferenceTemplateIds ?? [];
    const next = checked ? [...current, refId] : current.filter((id) => id !== refId);
    patch({ jobReferenceTemplateIds: next });
  };

  const toggleTestimonialTemplate = (refId: string, checked: boolean) => {
    const current = template.testimonialTemplateIds ?? [];
    const next = checked ? [...current, refId] : current.filter((id) => id !== refId);
    patch({ testimonialTemplateIds: next });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label>Template label</Label>
          <Input
            value={template.label}
            onChange={(e) => patch({ label: e.target.value })}
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Description</Label>
          <Textarea
            value={template.description ?? ""}
            onChange={(e) => patch({ description: e.target.value })}
            disabled={!canEdit}
            rows={2}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>ISO standards (comma-separated)</Label>
          <Input
            value={template.isoStandards.join(", ")}
            onChange={(e) =>
              patch({
                isoStandards: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Default scope of certification</Label>
          <Textarea
            value={template.proposalScope ?? ""}
            onChange={(e) => patch({ proposalScope: e.target.value })}
            disabled={!canEdit}
            rows={3}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-medium text-sm">Scope phases</h4>
          {canEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                patch({
                  scopePhases: renumberPhases([
                    ...template.scopePhases,
                    {
                      phase: template.scopePhases.length + 1,
                      title: "",
                      description: "",
                      deliverable: "",
                      weeks: 4,
                      startMonth: 1,
                      spanMonths: 1,
                    },
                  ]),
                })
              }
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add phase
            </Button>
          )}
        </div>
        {template.scopePhases.map((phase, idx) => (
          <div key={`${templateId}-phase-${idx}`} className="space-y-2 border-b pb-3 last:border-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">Phase {idx + 1}</p>
              {canEdit && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={template.scopePhases.length <= 1}
                  onClick={() =>
                    patch({
                      scopePhases: renumberPhases(template.scopePhases.filter((_, i) => i !== idx)),
                    })
                  }
                  aria-label="Remove phase"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <Input
              value={phase.title}
              onChange={(e) => updatePhase(idx, { title: e.target.value })}
              disabled={!canEdit}
              placeholder="Phase title"
            />
            <Textarea
              value={phase.description}
              onChange={(e) => updatePhase(idx, { description: e.target.value })}
              disabled={!canEdit}
              rows={2}
              placeholder="Description"
            />
            <Textarea
              value={phase.deliverable ?? ""}
              onChange={(e) => updatePhase(idx, { deliverable: e.target.value })}
              disabled={!canEdit}
              rows={2}
              placeholder="Deliverable"
            />
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-medium text-sm">Payment schedule</h4>
          {canEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                patch({
                  paymentSchedule: [...template.paymentSchedule, { label: "", percentage: 0 }],
                })
              }
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add milestone
            </Button>
          )}
        </div>
        {template.paymentSchedule.map((item, idx) => (
          <div key={`${templateId}-pay-${idx}`} className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 space-y-1 min-w-[180px]">
              <Label className="text-xs">Milestone</Label>
              <Input
                value={item.label}
                onChange={(e) => updatePayment(idx, { label: e.target.value })}
                disabled={!canEdit}
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
                disabled={!canEdit}
              />
            </div>
            {canEdit && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={template.paymentSchedule.length <= 1}
                onClick={() =>
                  patch({
                    paymentSchedule: template.paymentSchedule.filter((_, i) => i !== idx),
                  })
                }
                aria-label="Remove milestone"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        <p className={cn("text-sm", paymentTotal === 100 ? "text-muted-foreground" : "text-destructive")}>
          Total: {paymentTotal}% {paymentTotal !== 100 ? "(must equal 100%)" : ""}
        </p>
      </div>

      <div className="space-y-2">
        <Label>Terms & conditions</Label>
        <Textarea
          value={template.termsConditions ?? ""}
          onChange={(e) => patch({ termsConditions: e.target.value })}
          disabled={!canEdit}
          rows={4}
        />
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="font-medium text-sm">Suggested job references</h4>
        <p className="text-xs text-muted-foreground">
          Pre-select job reference templates applied when staff choose this setup template in the wizard.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {JOB_REFERENCE_TEMPLATES.map((refTemplate) => {
            const checked = (template.jobReferenceTemplateIds ?? []).includes(refTemplate.id);
            return (
              <label
                key={refTemplate.id}
                className={cn(
                  "flex cursor-pointer gap-2 rounded-md border p-3 text-sm",
                  checked && "border-primary bg-primary/5",
                  !canEdit && "cursor-default opacity-80",
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={!canEdit}
                  onCheckedChange={(value) => toggleJobRefTemplate(refTemplate.id, value === true)}
                  className="mt-0.5"
                />
                <span>{refTemplate.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="font-medium text-sm">Suggested testimonials</h4>
        <p className="text-xs text-muted-foreground">
          Pre-select client quotes applied when staff choose this setup template in the wizard.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {TESTIMONIAL_TEMPLATES.map((testimonialTemplate) => {
            const checked = (template.testimonialTemplateIds ?? []).includes(testimonialTemplate.id);
            return (
              <label
                key={testimonialTemplate.id}
                className={cn(
                  "flex cursor-pointer gap-2 rounded-md border p-3 text-sm",
                  checked && "border-primary bg-primary/5",
                  !canEdit && "cursor-default opacity-80",
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={!canEdit}
                  onCheckedChange={(value) =>
                    toggleTestimonialTemplate(testimonialTemplate.id, value === true)
                  }
                  className="mt-0.5"
                />
                <span>{testimonialTemplate.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ProposalSetupTemplatesPanel({ canEdit }: ProposalSetupTemplatesPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["proposal-setup-templates"],
    queryFn: apiGetProposalSetupTemplates,
  });

  const [draft, setDraft] = useState<ProposalSetupTemplates | null>(null);
  const [activeTab, setActiveTab] = useState<ProposalSetupTemplateId>("iso9001");

  useEffect(() => {
    if (data) setDraft(cloneTemplates(data));
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("No template draft");
      const tabDraft = draft[activeTab];
      if (!tabDraft) throw new Error("Active template is missing");
      return apiUpdateProposalSetupTemplates({ [activeTab]: tabDraft });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposal-setup-templates"] });
      toast({ title: "Template saved", description: `${draft?.[activeTab]?.label ?? "Template"} updated.` });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const activeTemplate = draft?.[activeTab];
  const templateBlockers = useMemo(() => {
    if (!activeTemplate) return ["Template is unavailable"];
    const blockers = [
      ...getWizardAdvanceBlockers({
        stepId: "scope",
        clientId: "x",
        totalAmount: 1,
        certificationLocations: [{ address: "x" }],
        scopePhases: activeTemplate.scopePhases,
        paymentSchedule: activeTemplate.paymentSchedule,
        referencePageIndex: 0,
        jobReferences: [],
        testimonialPageIndex: 0,
        testimonials: [],
      }),
      ...getWizardAdvanceBlockers({
        stepId: "payment",
        clientId: "x",
        totalAmount: 1,
        certificationLocations: [{ address: "x" }],
        scopePhases: activeTemplate.scopePhases,
        paymentSchedule: activeTemplate.paymentSchedule,
        referencePageIndex: 0,
        jobReferences: [],
        testimonialPageIndex: 0,
        testimonials: [],
      }),
    ];
    if (!activeTemplate.label.trim()) blockers.unshift("Template label is required");
    return blockers;
  }, [activeTemplate]);
  const canSave = canEdit && templateBlockers.length === 0;

  if (isLoading || !draft) {
    return <p className="text-sm text-muted-foreground">Loading proposal templates…</p>;
  }

  if (isError) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">Failed to load proposal templates.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Proposal templates</CardTitle>
        <CardDescription>
          Configure default scope, payment, and job references for ISO 9001, ISO 14001 &amp; ISO 45001, and ISO 27001
          proposals. Staff can apply these when creating a new proposal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canEdit && (
          <p className="text-sm text-muted-foreground rounded-md border bg-muted/30 px-3 py-2">
            View only — contact an administrator to edit proposal templates.
          </p>
        )}

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ProposalSetupTemplateId)}>
          <TabsList className="flex flex-wrap h-auto gap-1">
            {TEMPLATE_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.title}
              </TabsTrigger>
            ))}
          </TabsList>

          {TEMPLATE_TABS.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="mt-4">
              {draft[tab.id] ? (
                <TemplateEditor
                  templateId={tab.id}
                  template={draft[tab.id]!}
                  canEdit={canEdit}
                  onChange={(next) =>
                    setDraft((current) => (current ? { ...current, [tab.id]: next } : current))
                  }
                />
              ) : (
                <p className="text-sm text-muted-foreground">This template is not configured yet.</p>
              )}
            </TabsContent>
          ))}
        </Tabs>

        {canEdit && (
          <div className="space-y-2 pt-2">
            {!canSave && templateBlockers.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <p className="font-medium">Fix these issues before saving:</p>
                <ul className="mt-1 list-disc pl-5 space-y-0.5">
                  {templateBlockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="button" onClick={() => saveMut.mutate()} disabled={!canSave || saveMut.isPending}>
                <Save className="h-4 w-4 mr-1" />
                Save {TEMPLATE_TABS.find((t) => t.id === activeTab)?.title} template
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
