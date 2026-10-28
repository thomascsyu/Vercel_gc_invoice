import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiCreateApiKey,
  apiListApiKeys,
  apiRevokeApiKey,
} from "@/lib/modulesApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Ban, Copy, KeyRound, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ApiKeysPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data = [] } = useQuery({
    queryKey: ["/api-keys"],
    queryFn: apiListApiKeys,
  });
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [permission, setPermission] = useState<"read" | "read_write">(
    "read_write",
  );
  const [expiryDays, setExpiryDays] = useState(90);
  const [newToken, setNewToken] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => apiCreateApiKey({ label, permission, expiryDays }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["/api-keys"] });
      setNewToken(row.token ?? null);
      setLabel("");
    },
    onError: (e: Error) =>
      toast({
        title: "Failed",
        description: e.message,
        variant: "destructive",
      }),
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => apiRevokeApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api-keys"] }),
  });

  const close = () => {
    setOpen(false);
    setNewToken(null);
    setLabel("");
    setPermission("read_write");
    setExpiryDays(90);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="rounded-lg bg-primary/10 p-2.5 text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold">Programmatic access</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Generate expiring keys for integrations. Send the key in the{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  X-API-Key
                </code>{" "}
                header.
              </p>
            </div>
          </div>
          <Dialog
            open={open}
            onOpenChange={(v) => (v ? setOpen(true) : close())}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Generate key
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {newToken ? "Your new API key" : "Generate API key"}
                </DialogTitle>
              </DialogHeader>
              {newToken ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Copy this token now — it won't be shown again.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={newToken}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        navigator.clipboard.writeText(newToken);
                        toast({ title: "Copied" });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button className="w-full" onClick={close}>
                    Done
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label>Label</Label>
                    <Input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="e.g. Zapier sync"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Access</Label>
                      <Select
                        value={permission}
                        onValueChange={(v) =>
                          setPermission(v as "read" | "read_write")
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="read_write">
                            Read & write
                          </SelectItem>
                          <SelectItem value="read">Read only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="expiry-days">Expires after (days)</Label>
                      <Input
                        id="expiry-days"
                        type="number"
                        min={1}
                        max={3650}
                        value={expiryDays}
                        onChange={(e) => setExpiryDays(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    disabled={
                      !label ||
                      expiryDays < 1 ||
                      expiryDays > 3650 ||
                      createMut.isPending
                    }
                    onClick={() => createMut.mutate()}
                  >
                    Generate
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active & revoked keys</CardTitle>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <p className="text-muted-foreground text-sm">No API keys yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Last 4</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.label}</TableCell>
                    <TableCell className="font-mono">…{k.last4}</TableCell>
                    <TableCell>
                      {new Date(k.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {k.permission === "read_write"
                          ? "Read & write"
                          : "Read only"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(k.expiresAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {k.lastUsedAt
                        ? new Date(k.lastUsedAt).toLocaleString()
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          k.revoked || new Date(k.expiresAt) <= new Date()
                            ? "secondary"
                            : "default"
                        }
                      >
                        {k.revoked
                          ? "Revoked"
                          : new Date(k.expiresAt) <= new Date()
                            ? "Expired"
                            : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!k.revoked && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => revokeMut.mutate(k.id)}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> API endpoints
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Base path{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">/api</code>.
            Read-only keys may call GET endpoints; read & write keys may call
            every method shown.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            [
              "Clients",
              "GET · POST",
              "/clients",
              "PATCH · DELETE",
              "/clients/:id",
            ],
            [
              "Invoices",
              "GET · POST",
              "/invoices",
              "GET · PATCH · DELETE",
              "/invoices/:id",
            ],
            [
              "Quotations",
              "GET · POST",
              "/quotations",
              "GET · PATCH · DELETE",
              "/quotations/:id",
            ],
            [
              "Payments",
              "GET · POST",
              "/payments",
              "PATCH · DELETE",
              "/payments/:id",
            ],
            [
              "Receipts",
              "GET · POST",
              "/receipts",
              "GET · PATCH · DELETE",
              "/receipts/:id",
            ],
            [
              "Job orders",
              "GET · POST",
              "/job-orders",
              "PATCH · DELETE",
              "/job-orders/:id",
            ],
            [
              "Recurring invoices",
              "GET · POST",
              "/recurring-invoices",
              "PATCH · DELETE",
              "/recurring-invoices/:id",
            ],
            [
              "Proposals",
              "GET · POST",
              "/proposals",
              "GET · PATCH · DELETE",
              "/proposals/:id",
            ],
            ["Dashboard", "GET", "/dashboard", "GET", "/activity"],
          ].map(([name, methods, path, detailMethods, detailPath]) => (
            <div key={name} className="rounded-lg border bg-muted/20 p-3">
              <p className="mb-2 font-medium">{name}</p>
              <div className="space-y-1 text-xs">
                <p>
                  <span className="font-semibold text-primary">{methods}</span>{" "}
                  <code className="ml-1">{path}</code>
                </p>
                <p>
                  <span className="font-semibold text-primary">
                    {detailMethods}
                  </span>{" "}
                  <code className="ml-1">{detailPath}</code>
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
