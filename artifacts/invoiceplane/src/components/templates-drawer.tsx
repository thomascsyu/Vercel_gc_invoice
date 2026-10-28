import { useState, useRef, useEffect } from "react";
import type { QuotationTemplate, InvoiceLineItem } from "@workspace/api-client-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Trash2,
  Check,
  ChevronDown,
  ChevronRight,
  FileSignature,
  LayoutTemplate,
  Copy,
  Pencil,
  X,
  ArrowUp,
  ArrowDown,
  Pin,
  PinOff,
} from "lucide-react";
import {
  lineItemHasContent,
  lineItemPreviewLabel,
  quotationDescriptionDisplay,
  quotationItemToStored,
} from "@/lib/lineItemText";

// Template line items: description + optional details (no price in UI)
const emptyTemplateItem = (): { name: string; description: string; details: string } => ({
  name: "",
  description: "",
  details: "",
});

function templateItemHasContent(it: { name: string; description: string; details: string }) {
  return lineItemHasContent({
    name: it.name,
    description: it.description,
    details: it.details,
    quantity: 1,
    price: 0,
  });
}

function templateItemToApi(it: { name: string; description: string; details: string }): InvoiceLineItem {
  const stored = quotationItemToStored(
    quotationDescriptionDisplay(it),
    it.details ?? "",
  );
  return {
    ...stored,
    quantity: 1,
    price: 0,
    taxRate: 0,
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: QuotationTemplate[];
  onCreateTemplate: (name: string, items: InvoiceLineItem[]) => void;
  onUpdateTemplate: (id: string, name: string, items: InvoiceLineItem[]) => void;
  onRenameTemplate: (id: string, newName: string) => void;
  onDeleteTemplate: (id: string) => void;
  onApplyTemplate: (tpl: QuotationTemplate) => void;
  onDuplicateTemplate: (tpl: QuotationTemplate) => void;
  onReorderTemplates: (ids: string[]) => void;
  isCreating?: boolean;
  isUpdating?: boolean;
};

export function TemplatesDrawer({
  open,
  onOpenChange,
  templates,
  onCreateTemplate,
  onUpdateTemplate,
  onRenameTemplate,
  onDeleteTemplate,
  onApplyTemplate,
  onDuplicateTemplate,
  onReorderTemplates,
  isCreating,
  isUpdating,
}: Props) {
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newItems, setNewItems] = useState<{ name: string; description: string; details: string }[]>([emptyTemplateItem()]);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editItems, setEditItems] = useState<{ name: string; description: string; details: string }[]>([emptyTemplateItem()]);

  const [localOrder, setLocalOrder] = useState<string[]>(() => templates.map((t) => t.id));

  useEffect(() => {
    const incomingIds = templates.map((t) => t.id);
    setLocalOrder((prev) => {
      const prevSet = new Set(prev);
      const incomingSet = new Set(incomingIds);
      const removed = prev.filter((id) => !incomingSet.has(id));
      const added = incomingIds.filter((id) => !prevSet.has(id));
      if (removed.length === 0 && added.length === 0) return prev;
      const next = prev.filter((id) => incomingSet.has(id));
      return [...next, ...added];
    });
  }, [templates]);

  const orderedTemplates = localOrder
    .map((id) => templates.find((t) => t.id === id))
    .filter((t): t is QuotationTemplate => t !== undefined);

  const moveTemplate = (id: string, dir: -1 | 1) => {
    setLocalOrder((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      onReorderTemplates(next);
      return next;
    });
  };

  const pinTemplate = (id: string) => {
    setLocalOrder((prev) => {
      if (prev[0] === id) return prev;
      const next = [id, ...prev.filter((x) => x !== id)];
      onReorderTemplates(next);
      return next;
    });
  };

  const unpinTemplate = (id: string) => {
    setLocalOrder((prev) => {
      const next = [...prev.filter((x) => x !== id), id];
      onReorderTemplates(next);
      return next;
    });
  };

  const isPinned = (id: string) => localOrder[0] === id && localOrder.length > 1;

  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      onRenameTemplate(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const updateNewItem = (idx: number, patch: Partial<{ name: string; description: string; details: string }>) =>
    setNewItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const removeNewItem = (idx: number) =>
    setNewItems((prev) => prev.filter((_, i) => i !== idx));

  const moveNewItem = (idx: number, dir: -1 | 1) =>
    setNewItems((prev) => {
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });

  const handleCreate = () => {
    if (!newName.trim()) return;
    const validItems = newItems.filter(templateItemHasContent);
    if (!validItems.length) return;
    onCreateTemplate(newName.trim(), validItems.map(templateItemToApi));
    setCreatingNew(false);
    setNewName("");
    setNewItems([emptyTemplateItem()]);
  };

  const cancelCreate = () => {
    setCreatingNew(false);
    setNewName("");
    setNewItems([emptyTemplateItem()]);
  };

  const startEditing = (tpl: QuotationTemplate) => {
    setEditingId(tpl.id);
    setEditName(tpl.name);
    // Template line items: description + optional details
    setEditItems(tpl.items.length ? tpl.items.map((it) => ({
      name: it.name,
      description: it.description ?? "",
      details: it.details ?? "",
    })) : [emptyTemplateItem()]);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(tpl.id);
      return next;
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const updateEditItem = (idx: number, patch: Partial<{ name: string; description: string; details: string }>) =>
    setEditItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const removeEditItem = (idx: number) =>
    setEditItems((prev) => prev.filter((_, i) => i !== idx));

  const moveEditItem = (idx: number, dir: -1 | 1) =>
    setEditItems((prev) => {
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });

  const handleSaveEdit = () => {
    if (!editingId || !editName.trim()) return;
    const validItems = editItems.filter(templateItemHasContent);
    if (!validItems.length) return;
    onUpdateTemplate(editingId, editName.trim(), validItems.map(templateItemToApi));
    setEditingId(null);
  };


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between pr-6">
            <SheetTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-5 w-5" />
              Quotation Templates
            </SheetTitle>
            {!creatingNew && (
              <Button size="sm" onClick={() => setCreatingNew(true)}>
                <Plus className="h-4 w-4 mr-1" /> New Template
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {creatingNew && (
            <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
              <div className="text-sm font-semibold">Create New Template</div>

              <div className="space-y-1.5">
                <Label className="text-xs">Template Name *</Label>
                <Input
                  placeholder="e.g. Standard Consulting Package"
                  value={newName}
                  autoFocus
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") cancelCreate();
                  }}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Line Items *</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setNewItems((prev) => [...prev, emptyTemplateItem()])}
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add line
                  </Button>
                </div>
                {newItems.map((it, idx) => (
                  <div key={idx} className="flex flex-col gap-2 border rounded p-2 bg-card">
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col gap-0.5 shrink-0 pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 p-0"
                          onClick={() => moveNewItem(idx, -1)}
                          disabled={idx === 0}
                          title="Move up"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 p-0"
                          onClick={() => moveNewItem(idx, 1)}
                          disabled={idx === newItems.length - 1}
                          title="Move down"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex-1 space-y-2 min-w-0">
                        <Textarea
                          placeholder="Description — use Enter for more lines (optional)"
                          rows={2}
                          className="text-sm resize-y min-h-0"
                          value={quotationDescriptionDisplay(it)}
                          onChange={(e) =>
                            updateNewItem(idx, quotationItemToStored(e.target.value, it.details))
                          }
                        />
                        <Textarea
                          placeholder="Details / fine print (optional)"
                          rows={4}
                          className="text-sm resize-y min-h-0"
                          value={it.details}
                          onChange={(e) =>
                            updateNewItem(idx, quotationItemToStored(quotationDescriptionDisplay(it), e.target.value))
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => removeNewItem(idx)}
                        disabled={newItems.length === 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end text-sm pt-1">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={cancelCreate}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCreate}
                    disabled={
                      !newName.trim() ||
                      !newItems.some(templateItemHasContent) ||
                      isCreating
                    }
                  >
                    {isCreating ? "Saving…" : "Save Template"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!templates.length && !creatingNew ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3 text-muted-foreground">
              <LayoutTemplate className="h-10 w-10 opacity-30" />
              <p className="text-sm">No templates yet.</p>
              <p className="text-xs">Create a template to quickly pre-fill new quotations.</p>
              <Button size="sm" onClick={() => setCreatingNew(true)}>
                <Plus className="h-4 w-4 mr-1" /> Create First Template
              </Button>
            </div>
          ) : (
            orderedTemplates.map((tpl, tplIdx) => {
              const expanded = expandedIds.has(tpl.id);
              const isEditing = editingId === tpl.id;

              const displayItemCount = isEditing
                ? editItems.filter(templateItemHasContent).length || editItems.length
                : tpl.items.length;

              return (
                <div key={tpl.id} className="border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 p-3 bg-card">
                    <button
                      type="button"
                      className="flex-1 flex items-center gap-2 text-left min-w-0"
                      onClick={() => !isEditing && toggleExpand(tpl.id)}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      {renamingId === tpl.id ? (
                        <div
                          className="flex flex-1 gap-1 min-w-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Input
                            ref={renameRef}
                            className="h-7 text-sm flex-1"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                              if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
                            }}
                            onBlur={commitRename}
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 p-0 shrink-0"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => { e.stopPropagation(); commitRename(); }}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {isEditing ? editName || tpl.name : tpl.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {displayItemCount} item{displayItemCount !== 1 ? "s" : ""}
                          </div>
                        </div>
                      )}
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      {!isEditing && (
                        <>
                          <div className="flex flex-col gap-0.5 mr-0.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                              title="Move up"
                              onClick={(e) => { e.stopPropagation(); moveTemplate(tpl.id, -1); }}
                              disabled={tplIdx === 0}
                            >
                              <ArrowUp className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                              title="Move down"
                              onClick={(e) => { e.stopPropagation(); moveTemplate(tpl.id, 1); }}
                              disabled={tplIdx === orderedTemplates.length - 1}
                            >
                              <ArrowDown className="h-3 w-3" />
                            </Button>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className={`h-7 w-7 p-0 ${isPinned(tpl.id) ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                            title={isPinned(tpl.id) ? "Unpin from top" : "Pin to top"}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isPinned(tpl.id)) unpinTemplate(tpl.id);
                              else pinTemplate(tpl.id);
                            }}
                          >
                            {isPinned(tpl.id) ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            title="Edit template"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditing(tpl);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            title="Open New Quotation pre-filled with this template"
                            onClick={() => {
                              onApplyTemplate(tpl);
                              onOpenChange(false);
                            }}
                          >
                            <FileSignature className="h-3.5 w-3.5" />
                            Apply
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            title="Duplicate template"
                            onClick={() => onDuplicateTemplate(tpl)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Duplicate
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            title="Delete template"
                            onClick={() => onDeleteTemplate(tpl.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {expanded && !isEditing && (
                    <div className="border-t bg-muted/20 px-4 py-3 space-y-2">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        Line Items Preview
                      </div>
                      <div className="space-y-1.5">
                        {tpl.items.map((it, i) => (
                          <div key={i} className="flex flex-col gap-0.5 text-sm">
                            <div className="font-medium truncate">{lineItemPreviewLabel(it)}</div>
                            {it.details && (
                              <div className="text-xs text-muted-foreground truncate">{it.details}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isEditing && (
                    <div className="border-t bg-muted/20 px-4 py-4 space-y-4">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Edit Template
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Template Name *</Label>
                        <Input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Line Items *</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setEditItems((prev) => [...prev, emptyTemplateItem()])}
                          >
                            <Plus className="h-3 w-3 mr-1" /> Add line
                          </Button>
                        </div>
                        {editItems.map((it, idx) => (
                          <div key={idx} className="flex flex-col gap-2 border rounded p-2 bg-card">
                            <div className="flex items-start gap-2">
                              <div className="flex flex-col gap-0.5 shrink-0 pt-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 p-0"
                                  onClick={() => moveEditItem(idx, -1)}
                                  disabled={idx === 0}
                                  title="Move up"
                                >
                                  <ArrowUp className="h-3 w-3" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 p-0"
                                  onClick={() => moveEditItem(idx, 1)}
                                  disabled={idx === editItems.length - 1}
                                  title="Move down"
                                >
                                  <ArrowDown className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="flex-1 space-y-2 min-w-0">
                                <Textarea
                                  placeholder="Description — use Enter for more lines (optional)"
                                  rows={2}
                                  className="text-sm resize-y min-h-0"
                                  value={quotationDescriptionDisplay(it)}
                                  onChange={(e) =>
                                    updateEditItem(idx, quotationItemToStored(e.target.value, it.details))
                                  }
                                />
                                <Textarea
                                  placeholder="Details / fine print (optional)"
                                  rows={4}
                                  className="text-sm resize-y min-h-0"
                                  value={it.details}
                                  onChange={(e) =>
                                    updateEditItem(idx, quotationItemToStored(quotationDescriptionDisplay(it), e.target.value))
                                  }
                                />
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => removeEditItem(idx)}
                                disabled={editItems.length === 1}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-end text-sm pt-1">
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={cancelEdit}>
                            <X className="h-3.5 w-3.5 mr-1" /> Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={
                              !editName.trim() ||
                              !editItems.some(templateItemHasContent) ||
                              isUpdating
                            }
                          >
                            {isUpdating ? "Saving…" : "Save Changes"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
