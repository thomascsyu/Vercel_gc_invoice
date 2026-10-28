import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiCreateConsultant,
  apiDeleteConsultant,
  apiListConsultants,
  apiListConsultantPerformance,
  apiUpdateConsultant,
  type Consultant,
} from "@/lib/modulesApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Edit,
  Trash2,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ListQueryState } from "@/components/list-query-state";
import { describeApiFailure } from "@/lib/describeApiFailure";

export default function ConsultantsPage() {
  const [location] = useLocation();
  const isPerformance = location === "/consultants/performance";
  const qc = useQueryClient();
  const { toast } = useToast();
  const {
    data = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({ queryKey: ["/consultants"], queryFn: apiListConsultants });
  const [editing, setEditing] = useState<Consultant | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Consultant>>({
    shortCode: "",
    name: "",
    email: "",
    isActive: true,
  });

  const performanceQuery = useQuery({
    queryKey: ["/consultants/performance"],
    queryFn: apiListConsultantPerformance,
    enabled: isPerformance,
  });

  const resetForm = () =>
    setForm({ shortCode: "", name: "", email: "", isActive: true });

  const createMut = useMutation({
    mutationFn: () => apiCreateConsultant(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/consultants"] });
      toast({ title: "Consultant added" });
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) =>
      toast({
        title: "Failed",
        description: describeApiFailure(e),
        variant: "destructive",
      }),
  });
  const updateMut = useMutation({
    mutationFn: () => apiUpdateConsultant(editing!.id, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/consultants"] });
      toast({ title: "Consultant updated" });
      setEditing(null);
      setOpen(false);
      resetForm();
    },
    onError: (e: Error) =>
      toast({
        title: "Failed to update",
        description: describeApiFailure(e),
        variant: "destructive",
      }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDeleteConsultant(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/consultants"] }),
    onError: (e: Error) =>
      toast({
        title: "Failed to delete",
        description: describeApiFailure(e),
        variant: "destructive",
      }),
  });

  const openEdit = (c: Consultant) => {
    setEditing(c);
    setForm({
      shortCode: c.shortCode,
      name: c.name,
      email: c.email ?? "",
      isActive: c.isActive,
    });
    setOpen(true);
  };
  const openCreate = () => {
    setEditing(null);
    resetForm();
    setOpen(true);
  };

  const performanceMonths = useMemo(
    () => [...new Set((performanceQuery.data ?? []).map((row) => row.month))],
    [performanceQuery.data],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Consultants</h1>
          <p className="text-muted-foreground text-sm">
            {isPerformance
              ? "Monthly invoiced revenue attributed to each consultant."
              : "Manage consultant registrations and availability."}
          </p>
        </div>
        {!isPerformance && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                New consultant
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editing ? "Edit consultant" : "New consultant"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="consultant-short-code">Short code</Label>
                  <Input
                    id="consultant-short-code"
                    value={form.shortCode ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        shortCode: e.target.value.toUpperCase(),
                      })
                    }
                    maxLength={8}
                  />
                </div>
                <div>
                  <Label htmlFor="consultant-name">Name</Label>
                  <Input
                    id="consultant-name"
                    value={form.name ?? ""}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="consultant-email">Email (optional)</Label>
                  <Input
                    id="consultant-email"
                    type="email"
                    value={form.email ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="consultant-active"
                    checked={form.isActive ?? true}
                    onCheckedChange={(v) => setForm({ ...form, isActive: v })}
                  />
                  <Label htmlFor="consultant-active">Active</Label>
                </div>
                <Button
                  className="w-full"
                  onClick={() =>
                    editing ? updateMut.mutate() : createMut.mutate()
                  }
                  disabled={!form.shortCode || !form.name}
                >
                  {editing ? "Save" : "Create"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <nav
        className="inline-flex rounded-lg border bg-muted/40 p-1"
        aria-label="Consultant sections"
      >
        <Link
          href="/consultants/settings"
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${!isPerformance ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <SlidersHorizontal className="h-4 w-4" /> Settings
        </Link>
        <Link
          href="/consultants/performance"
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${isPerformance ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <TrendingUp className="h-4 w-4" /> Performance
        </Link>
      </nav>

      {isPerformance ? (
        <Card>
          <CardHeader>
            <CardTitle>Monthly revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <ListQueryState
              isLoading={performanceQuery.isLoading}
              isError={performanceQuery.isError}
              error={performanceQuery.error}
              isEmpty={(performanceQuery.data ?? []).length === 0}
              emptyMessage="No consultant revenue has been recorded yet."
              onRetry={() => void performanceQuery.refetch()}
              isRetrying={performanceQuery.isFetching}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Consultant</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {performanceMonths.flatMap((month) =>
                    (performanceQuery.data ?? [])
                      .filter((row) => row.month === month)
                      .map((row) => (
                        <TableRow
                          key={`${row.month}-${row.consultantId}-${row.currency}`}
                        >
                          <TableCell className="font-medium">
                            {new Intl.DateTimeFormat("en", {
                              month: "long",
                              year: "numeric",
                              timeZone: "UTC",
                            }).format(new Date(`${row.month}-01T00:00:00Z`))}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{row.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.shortCode}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.invoiceCount}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {new Intl.NumberFormat("en-HK", {
                              style: "currency",
                              currency: row.currency,
                            }).format(row.revenue)}
                          </TableCell>
                        </TableRow>
                      )),
                  )}
                </TableBody>
              </Table>
            </ListQueryState>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All consultants</CardTitle>
          </CardHeader>
          <CardContent>
            <ListQueryState
              isLoading={isLoading}
              isError={isError}
              error={error}
              isEmpty={data.length === 0}
              emptyMessage="No consultants yet."
              onRetry={() => void refetch()}
              isRetrying={isFetching}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono">{c.shortCode}</TableCell>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>{c.email ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={c.isActive ? "default" : "secondary"}>
                          {c.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(c)}
                          aria-label={`Edit ${c.name}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (!confirm(`Delete consultant ${c.name}?`))
                              return;
                            deleteMut.mutate(c.id);
                          }}
                          aria-label={`Delete ${c.name}`}
                        >
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
      )}
    </div>
  );
}
