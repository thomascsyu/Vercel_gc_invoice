import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  apiCreateRecurring,
  apiDeleteRecurring,
  apiListRecurring,
  apiRunDueRecurring,
  apiUpdateRecurring,
  type Recurring,
} from "@/lib/modulesApi";
import { useListClients, type Client } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Zap, Pencil, Check, ChevronsUpDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ListQueryState } from "@/components/list-query-state";

const CURRENCIES = ["HKD", "USD", "CNY", "MOP"] as const;
const FREQS = ["weekly", "monthly", "quarterly", "yearly"] as const;

const emptyLineItem = () => ({
  name: "Service fee",
  description: "",
  details: "",
  quantity: 1,
  price: 0,
});

export default function RecurringInvoicesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const {
    data = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({ queryKey: ["/recurring-invoices"], queryFn: apiListRecurring });
  const { data: clientsPage } = useListClients({ pageSize: 500 });
  const clients: Client[] = clientsPage?.data ?? [];
  const [clientOpen, setClientOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [form, setForm] = useState<Partial<Recurring>>({
    clientId: "",
    label: "",
    frequency: "monthly",
    currency: "HKD",
    nextRunDate: new Date().toISOString().slice(0, 10),
    items: [emptyLineItem()],
    enabled: true,
  });
  const resetForm = () =>
    setForm({
      clientId: "",
      label: "",
      frequency: "monthly",
      currency: "HKD",
      nextRunDate: new Date().toISOString().slice(0, 10),
      items: [emptyLineItem()],
      enabled: true,
    });

  const createMut = useMutation({
    mutationFn: () => apiCreateRecurring(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/recurring-invoices"] });
      setOpen(false);
      resetForm();
      toast({ title: "Schedule created" });
    },
    onError: (e: Error) => toast({ title: "Failed to create schedule", description: e.message, variant: "destructive" }),
  });
  const updateMut = useMutation({
    mutationFn: () => apiUpdateRecurring(editing!.id, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/recurring-invoices"] });
      setOpen(false);
      setEditing(null);
      resetForm();
      toast({ title: "Schedule updated" });
    },
    onError: (e: Error) => toast({ title: "Failed to update schedule", description: e.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setOpen(true);
  };
  const openEdit = (r: Recurring) => {
    setEditing(r);
    setForm({
      clientId: r.clientId,
      label: r.label,
      frequency: r.frequency,
      currency: r.currency,
      nextRunDate: r.nextRunDate,
      items: r.items.length
        ? r.items.map((it) => ({
            ...emptyLineItem(),
            ...it,
            name: it.name,
            description: it.description ?? "",
            details: it.details ?? "",
            quantity: it.quantity,
            price: it.price,
          }))
        : [{ ...emptyLineItem(), name: "" }],
      enabled: r.enabled,
    });
    setOpen(true);
  };
  const toggleMut = useMutation({
    mutationFn: (r: Recurring) => apiUpdateRecurring(r.id, { enabled: !r.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/recurring-invoices"] }),
    onError: (e: Error) => toast({ title: "Failed to update schedule", description: e.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDeleteRecurring(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/recurring-invoices"] }),
    onError: (e: Error) => toast({ title: "Failed to delete schedule", description: e.message, variant: "destructive" }),
  });
  const runDueMut = useMutation({
    mutationFn: apiRunDueRecurring,
    onSuccess: ({ generated }) => {
      qc.invalidateQueries({ queryKey: ["/recurring-invoices"] });
      toast({
        title: generated ? `Generated ${generated} invoice(s)` : "No schedules due",
      });
    },
    onError: (e: Error) => toast({ title: "Failed to run due schedules", description: e.message, variant: "destructive" }),
  });

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? "—";

  const item = form.items?.[0] ?? emptyLineItem();

  const setFirstItem = (patch: Partial<typeof item>) =>
    setForm({ ...form, items: [{ ...item, ...patch }] });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Recurring Invoices</h1>
          <p className="text-muted-foreground text-sm">
            Schedule invoices to auto-generate on a set frequency.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => runDueMut.mutate()} disabled={runDueMut.isPending}>
            <Zap className="h-4 w-4 mr-2" />
            Run due now
          </Button>
          <Dialog
            open={open}
            onOpenChange={(v) => {
              setOpen(v);
              if (!v) {
                setEditing(null);
                setClientOpen(false);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                New schedule
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit recurring invoice" : "New recurring invoice"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Label</Label>
                  <Input
                    value={form.label ?? ""}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Client</Label>
                  <Popover modal open={clientOpen} onOpenChange={setClientOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={clientOpen}
                        className="w-full justify-between font-normal h-9 px-3"
                      >
                        <span className="truncate">
                          {form.clientId
                            ? (clients.find((c) => c.id === form.clientId)?.name ?? "Select client")
                            : "Search or select client…"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search client…" />
                        <CommandList>
                          <CommandEmpty>No client found.</CommandEmpty>
                          <CommandGroup>
                            {clients.map((c) => (
                              <CommandItem
                                key={c.id}
                                value={`${c.name} ${c.clientCode} ${c.id}`}
                                onSelect={() => {
                                  setForm({ ...form, clientId: c.id });
                                  setClientOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    form.clientId === c.id ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                {c.name}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Frequency</Label>
                    <Select
                      value={form.frequency}
                      onValueChange={(v) =>
                        setForm({ ...form, frequency: v as Recurring["frequency"] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FREQS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select
                      value={form.currency}
                      onValueChange={(v) =>
                        setForm({ ...form, currency: v as Recurring["currency"] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Next run date</Label>
                  <Input
                    type="date"
                    value={form.nextRunDate ?? ""}
                    onChange={(e) => setForm({ ...form, nextRunDate: e.target.value })}
                  />
                </div>
                <div className="border-t pt-3 space-y-2">
                  <Label>Line item</Label>
                  <Input
                    placeholder="Title (e.g. Service fee)"
                    value={item.name}
                    onChange={(e) => setFirstItem({ name: e.target.value })}
                  />
                  <div>
                    <Label className="text-muted-foreground text-xs font-normal">Description</Label>
                    <Textarea
                      placeholder="Longer summary for this line — use Enter for more lines (optional)"
                      rows={3}
                      className="mt-1 text-sm resize-y"
                      value={item.description ?? ""}
                      onChange={(e) => setFirstItem({ description: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs font-normal">Details</Label>
                    <Textarea
                      placeholder="Fine print; one line per bullet on the invoice PDF (optional)"
                      rows={3}
                      className="mt-1 text-sm resize-y"
                      value={item.details ?? ""}
                      onChange={(e) => setFirstItem({ details: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      placeholder="Qty"
                      value={item.quantity}
                      onChange={(e) => setFirstItem({ quantity: Number(e.target.value) })}
                    />
                    <Input
                      type="number"
                      placeholder="Price"
                      value={item.price}
                      onChange={(e) => setFirstItem({ price: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={() => (editing ? updateMut.mutate() : createMut.mutate())}
                  disabled={!form.clientId || !form.label || !form.nextRunDate}
                >
                  {editing ? "Save changes" : "Create schedule"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Schedules</CardTitle>
        </CardHeader>
        <CardContent>
          <ListQueryState
            isLoading={isLoading}
            isError={isError}
            error={error}
            isEmpty={data.length === 0}
            emptyMessage="No recurring schedules yet."
            onRetry={() => void refetch()}
            isRetrying={isFetching}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell>{clientName(r.clientId)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.frequency}</Badge>
                    </TableCell>
                    <TableCell>{r.nextRunDate}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch checked={r.enabled} onCheckedChange={() => toggleMut.mutate(r)} />
                        <span className="text-xs text-muted-foreground">
                          {r.enabled ? "Active" : "Paused"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteMut.mutate(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ListQueryState>
        </CardContent>
      </Card>
    </div>
  );
}
