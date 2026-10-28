import { useState } from "react";
import {
  useGetClientCertifications,
  useCreateClientCertification,
  useUpdateClientCertification,
  useDeleteClientCertification,
  useCreateClientCertificationAudit,
  useUpdateClientCertificationAudit,
  useDeleteClientCertificationAudit,
  getGetClientCertificationsQueryKey,
  getListClientsQueryKey,
  type Client,
  type AuditVisitStatus,
  type ClientCertificationWithAudits,
  type ClientCertificationAudit,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ClipboardList, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/utils";
import { formatAuditVisitStatus } from "@/lib/clientCertificationDisplay";
import { useToast } from "@/hooks/use-toast";
import { describeApiFailure } from "@/lib/describeApiFailure";

const STATUS_NONE = "__none__";

function statusSelectValue(status?: AuditVisitStatus): string {
  return status ?? STATUS_NONE;
}

function statusFromSelect(value: string): AuditVisitStatus | undefined {
  if (value === STATUS_NONE) return undefined;
  return value as AuditVisitStatus;
}

type ClientAuditHistoryDialogProps = {
  client: Client;
  onClose: () => void;
};

export function ClientAuditHistoryDialog({ client, onClose }: ClientAuditHistoryDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const clientId = client.id;

  const { data, isLoading, isError, error, refetch } = useGetClientCertifications(clientId, {
    query: { queryKey: getGetClientCertificationsQueryKey(clientId) },
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetClientCertificationsQueryKey(clientId) }),
      queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }),
    ]);
  };

  const onMutationError = (err: unknown) => {
    toast({
      title: "Could not save",
      description: describeApiFailure(err),
      variant: "destructive",
    });
  };

  const createCert = useCreateClientCertification({
    mutation: {
      onSuccess: async () => {
        await invalidate();
        setNewCertBody("");
        setNewCertStandard("");
      },
      onError: onMutationError,
    },
  });

  const updateCert = useUpdateClientCertification({ mutation: { onSuccess: invalidate, onError: onMutationError } });
  const deleteCert = useDeleteClientCertification({ mutation: { onSuccess: invalidate, onError: onMutationError } });
  const createAudit = useCreateClientCertificationAudit({ mutation: { onSuccess: invalidate, onError: onMutationError } });
  const updateAudit = useUpdateClientCertificationAudit({ mutation: { onSuccess: invalidate, onError: onMutationError } });
  const deleteAudit = useDeleteClientCertificationAudit({ mutation: { onSuccess: invalidate, onError: onMutationError } });

  const [newCertBody, setNewCertBody] = useState("");
  const [newCertStandard, setNewCertStandard] = useState("");
  const [editingCertId, setEditingCertId] = useState<string | null>(null);
  const [editCertBody, setEditCertBody] = useState("");
  const [editCertStandard, setEditCertStandard] = useState("");

  const certifications = data?.certifications ?? [];

  const startEditCert = (cert: ClientCertificationWithAudits) => {
    setEditingCertId(cert.id);
    setEditCertBody(cert.certificationBody);
    setEditCertStandard(cert.standard);
  };

  const saveEditCert = (certId: string) => {
    updateCert.mutate({
      id: clientId,
      certId,
      data: { certificationBody: editCertBody.trim(), standard: editCertStandard.trim() },
    });
    setEditingCertId(null);
  };

  const addCertification = () => {
    const certificationBody = newCertBody.trim();
    const standard = newCertStandard.trim();
    if (!certificationBody || !standard) {
      toast({ title: "CB and standard are required", variant: "destructive" });
      return;
    }
    createCert.mutate({ id: clientId, data: { certificationBody, standard } });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-muted-foreground" />
            Audit history &mdash; {client.name}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded" />
            ))}
          </div>
        ) : isError ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{describeApiFailure(error)}</p>
            <Button variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : (
          <div className="space-y-8">
            {certifications.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4">
                No certifications recorded for this client. Add a certification body and standard below, then add audit dates.
              </p>
            ) : (
              certifications.map((cert) => (
                <CertificationSection
                  key={cert.id}
                  cert={cert}
                  clientId={clientId}
                  editingCertId={editingCertId}
                  editCertBody={editCertBody}
                  editCertStandard={editCertStandard}
                  onStartEdit={() => startEditCert(cert)}
                  onCancelEdit={() => setEditingCertId(null)}
                  onSaveEdit={() => saveEditCert(cert.id)}
                  onEditBodyChange={setEditCertBody}
                  onEditStandardChange={setEditCertStandard}
                  onDeleteCert={() => {
                    if (window.confirm("Delete this certification and all audit history?")) {
                      deleteCert.mutate({ id: clientId, certId: cert.id });
                    }
                  }}
                  createAudit={createAudit}
                  updateAudit={updateAudit}
                  deleteAudit={deleteAudit}
                  pending={createAudit.isPending || updateAudit.isPending || deleteAudit.isPending}
                />
              ))
            )}

            <Separator />

            <section className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Add certification
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="new-cb">Certification body (CB)</Label>
                  <Input
                    id="new-cb"
                    value={newCertBody}
                    onChange={(e) => setNewCertBody(e.target.value)}
                    placeholder="e.g. SGS, BSI"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-standard">Standard</Label>
                  <Input
                    id="new-standard"
                    value={newCertStandard}
                    onChange={(e) => setNewCertStandard(e.target.value)}
                    placeholder="e.g. ISO 9001:2015, FSC, SOC 2"
                  />
                </div>
              </div>
              <Button onClick={addCertification} disabled={createCert.isPending}>
                <Plus className="h-4 w-4 mr-2" /> Add certification
              </Button>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CertificationSection({
  cert,
  clientId,
  editingCertId,
  editCertBody,
  editCertStandard,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditBodyChange,
  onEditStandardChange,
  onDeleteCert,
  createAudit,
  updateAudit,
  deleteAudit,
  pending,
}: {
  cert: ClientCertificationWithAudits;
  clientId: string;
  editingCertId: string | null;
  editCertBody: string;
  editCertStandard: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditBodyChange: (v: string) => void;
  onEditStandardChange: (v: string) => void;
  onDeleteCert: () => void;
  createAudit: ReturnType<typeof useCreateClientCertificationAudit>;
  updateAudit: ReturnType<typeof useUpdateClientCertificationAudit>;
  deleteAudit: ReturnType<typeof useDeleteClientCertificationAudit>;
  pending: boolean;
}) {
  const isEditing = editingCertId === cert.id;
  const [newAuditDate, setNewAuditDate] = useState("");
  const [newAuditStatus, setNewAuditStatus] = useState(STATUS_NONE);
  const [newAuditNotes, setNewAuditNotes] = useState("");
  const [editingAuditId, setEditingAuditId] = useState<string | null>(null);
  const [editAuditDate, setEditAuditDate] = useState("");
  const [editAuditStatus, setEditAuditStatus] = useState(STATUS_NONE);
  const [editAuditNotes, setEditAuditNotes] = useState("");

  const startEditAudit = (audit: ClientCertificationAudit) => {
    setEditingAuditId(audit.id);
    setEditAuditDate(audit.auditDate.slice(0, 10));
    setEditAuditStatus(statusSelectValue(audit.status));
    setEditAuditNotes(audit.notes ?? "");
  };

  const addAudit = () => {
    if (!newAuditDate) return;
    createAudit.mutate({
      id: clientId,
      certId: cert.id,
      data: {
        auditDate: newAuditDate,
        status: statusFromSelect(newAuditStatus),
        notes: newAuditNotes.trim() || undefined,
      },
    });
    setNewAuditDate("");
    setNewAuditStatus(STATUS_NONE);
    setNewAuditNotes("");
  };

  const saveAudit = (auditId: string) => {
    updateAudit.mutate({
      id: clientId,
      certId: cert.id,
      auditId,
      data: {
        auditDate: editAuditDate,
        status: statusFromSelect(editAuditStatus),
        notes: editAuditNotes.trim() || undefined,
      },
    });
    setEditingAuditId(null);
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {isEditing ? (
          <div className="grid flex-1 gap-2 sm:grid-cols-2">
            <Input value={editCertBody} onChange={(e) => onEditBodyChange(e.target.value)} aria-label="Certification body" />
            <Input value={editCertStandard} onChange={(e) => onEditStandardChange(e.target.value)} aria-label="Standard" />
          </div>
        ) : (
          <div>
            <p className="font-medium">{cert.certificationBody}</p>
            <p className="text-sm text-muted-foreground">{cert.standard}</p>
          </div>
        )}
        <div className="flex gap-1 shrink-0">
          {isEditing ? (
            <>
              <Button size="icon" variant="ghost" onClick={onSaveEdit} aria-label="Save certification">
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onCancelEdit} aria-label="Cancel edit">
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button size="icon" variant="ghost" onClick={onStartEdit} aria-label="Edit certification">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onDeleteCert} aria-label="Delete certification">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left font-medium px-3 py-2">Audit date</th>
              <th className="text-left font-medium px-3 py-2 w-28">Status</th>
              <th className="text-left font-medium px-3 py-2">Notes</th>
              <th className="w-20 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {cert.audits.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-muted-foreground text-center">
                  No audit dates yet.
                </td>
              </tr>
            ) : (
              cert.audits.map((audit) =>
                editingAuditId === audit.id ? (
                  <tr key={audit.id} className="border-b">
                    <td className="px-3 py-2">
                      <Input type="date" value={editAuditDate} onChange={(e) => setEditAuditDate(e.target.value)} />
                    </td>
                    <td className="px-3 py-2">
                      <AuditStatusSelect value={editAuditStatus} onChange={setEditAuditStatus} />
                    </td>
                    <td className="px-3 py-2">
                      <Input value={editAuditNotes} onChange={(e) => setEditAuditNotes(e.target.value)} placeholder="Optional" />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button size="icon" variant="ghost" onClick={() => saveAudit(audit.id)} disabled={pending}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditingAuditId(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ) : (
                  <tr key={audit.id} className="border-b last:border-0">
                    <td className="px-3 py-2">{formatDate(audit.auditDate)}</td>
                    <td className="px-3 py-2">
                      {formatAuditVisitStatus(audit.status) ? (
                        <Badge variant="secondary">{formatAuditVisitStatus(audit.status)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{audit.notes?.trim() || "—"}</td>
                    <td className="px-2 py-2 text-right">
                      <Button size="icon" variant="ghost" onClick={() => startEditAudit(audit)} aria-label="Edit audit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (window.confirm("Delete this audit record?")) {
                            deleteAudit.mutate({ id: clientId, certId: cert.id, auditId: audit.id });
                          }
                        }}
                        aria-label="Delete audit"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-2 pt-1">
        <div className="space-y-1">
          <Label className="text-xs">New audit date</Label>
          <Input type="date" value={newAuditDate} onChange={(e) => setNewAuditDate(e.target.value)} className="w-[11rem]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <AuditStatusSelect value={newAuditStatus} onChange={setNewAuditStatus} className="w-[8rem]" />
        </div>
        <div className="space-y-1 flex-1 min-w-[8rem]">
          <Label className="text-xs">Notes</Label>
          <Input value={newAuditNotes} onChange={(e) => setNewAuditNotes(e.target.value)} placeholder="Optional" />
        </div>
        <Button onClick={addAudit} disabled={!newAuditDate || pending} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add audit
        </Button>
      </div>
    </section>
  );
}

function AuditStatusSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Blank" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={STATUS_NONE}>Blank</SelectItem>
        <SelectItem value="sv">SV</SelectItem>
        <SelectItem value="rn">RN</SelectItem>
        <SelectItem value="sv_rn">SV &amp; RN</SelectItem>
      </SelectContent>
    </Select>
  );
}
