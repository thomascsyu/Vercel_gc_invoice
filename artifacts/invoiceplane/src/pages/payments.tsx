import { useState, useRef, useMemo, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useListPayments,
  useListInvoices,
  useCreatePayment,
  useDeletePayment,
  useGenerateReceiptFromPayment,
  getListPaymentsQueryKey,
  useListPaymentReceipts,
  useUploadPaymentReceipt,
  useDeletePaymentReceipt,
  getListPaymentReceiptsQueryKey,
  type Payment,
  type PaymentReceipt,
  type Invoice,
  UploadPaymentReceiptBodyReceiptType,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDate, formatFileSize } from "@/lib/utils";
import {
  CreditCard,
  Plus,
  Download,
  Upload,
  Trash2,
  X,
  FileImage,
  FileText,
  Paperclip,
  Receipt,
  Camera,
  Landmark,
  File,
  Eye,
  Search,
  ChevronDown,
  ChevronUp,
  ReceiptIcon,
  CheckCircle,
  AlertCircle,
  Filter,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PaginationControls } from "@/components/pagination-controls";
import { CsvImportDialog } from "@/components/csv-import-dialog";
import { DeletedItemsDialog } from "@/components/deleted-items-dialog";
import { apiUrl } from "@/lib/api-base";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { describeApiFailure } from "@/lib/describeApiFailure";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

// Receipt type definitions
const RECEIPT_TYPE_LABELS: Record<string, string> = {
  receipt: "Receipt",
  screenshot: "Screenshot",
  cheque_deposit: "Cheque Deposit",
  other: "Other",
};

const RECEIPT_TYPE_ICONS: Record<string, React.ReactNode> = {
  receipt: <Receipt className="h-4 w-4" />,
  screenshot: <Camera className="h-4 w-4" />,
  cheque_deposit: <Landmark className="h-4 w-4" />,
  other: <File className="h-4 w-4" />,
};

// Payment method definitions
const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  echeque: "E-cheque",
  cheque_deposit: "Cheque Deposit",
  other: "Other",
};

const PAYMENT_METHODS = ["bank_transfer", "cheque", "echeque", "cheque_deposit", "other"];
const RECEIPT_TYPES = ["receipt", "screenshot", "cheque_deposit", "other"];

// Payment status badge component
function PaymentStatusBadge({ payment }: { payment: Payment }) {
  if (!payment.invoiceTotal || !payment.invoicePaidAmount) return null;

  const isFullyPaid = payment.invoicePaidAmount >= payment.invoiceTotal;
  const remaining = payment.invoiceTotal - payment.invoicePaidAmount;
  const percentPaid = payment.invoiceTotal > 0
    ? Math.min(100, Math.round((payment.invoicePaidAmount / payment.invoiceTotal) * 100))
    : 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <Badge variant={isFullyPaid ? "default" : "secondary"} className={cn(
        isFullyPaid
          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
      )}>
        {isFullyPaid ? (
          <><CheckCircle className="h-3 w-3 mr-1" /> Fully Paid</>
        ) : (
          <><AlertCircle className="h-3 w-3 mr-1" /> Partially Paid</>
        )}
      </Badge>
      {!isFullyPaid && (
        <>
          <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={percentPaid} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-amber-500" style={{ width: `${percentPaid}%` }} />
          </div>
          <span className="text-xs text-muted-foreground">
            {percentPaid}% paid{remaining > 0 ? ` · ${formatCurrency(remaining, payment.currency)} left` : ""}
          </span>
        </>
      )}
    </div>
  );
}

// Invoice selector component
function InvoiceSelector({
  invoices,
  selectedInvoiceId,
  onSelect,
  disabled = false,
}: {
  invoices: Invoice[];
  selectedInvoiceId: string | null;
  onSelect: (invoice: Invoice) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedInvoice = invoices.find((i) => i.id === selectedInvoiceId);

  const filteredInvoices = useMemo(() => {
    if (!search.trim()) return invoices.filter(i => i.status !== "paid");
    const searchLower = search.toLowerCase();
    return invoices.filter(
      (i) =>
        i.invoiceNumber.toLowerCase().includes(searchLower) ||
        (i.clientName?.toLowerCase() || "").includes(searchLower)
    );
  }, [invoices, search]);

  // Group invoices by status
  const unpaidInvoices = filteredInvoices.filter((i) => i.status !== "paid");
  const paidInvoices = filteredInvoices.filter((i) => i.status === "paid");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
        >
          {selectedInvoice ? (
            <div className="flex items-center gap-2">
              <span className="font-medium">{selectedInvoice.invoiceNumber}</span>
              <span className="text-muted-foreground">-</span>
              <span className="truncate">{selectedInvoice.clientName}</span>
              <Badge variant="outline" className="ml-2 text-xs">
                {formatCurrency(selectedInvoice.total, selectedInvoice.currency)}
              </Badge>
            </div>
          ) : (
            <span className="text-muted-foreground">Select an invoice...</span>
          )}
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0">
        <Command>
          <CommandInput
            placeholder="Search invoices by number or client..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No invoices found.</CommandEmpty>
            <CommandGroup heading="Unpaid Invoices">
              {unpaidInvoices.map((invoice) => (
                <CommandItem
                  key={invoice.id}
                  value={invoice.id}
                  onSelect={() => {
                    onSelect(invoice);
                    setOpen(false);
                  }}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{invoice.invoiceNumber}</span>
                      <span className="text-muted-foreground">-</span>
                      <span className="text-sm">{invoice.clientName}</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {formatCurrency(invoice.total, invoice.currency)}
                      {invoice.paidAmount > 0 && (
                        <span className="text-green-600 ml-1">
                          (Paid: {formatCurrency(invoice.paidAmount, invoice.currency)})
                        </span>
                      )}
                    </Badge>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {paidInvoices.length > 0 && (
              <CommandGroup heading="Paid Invoices">
                {paidInvoices.map((invoice) => (
                  <CommandItem
                    key={invoice.id}
                    value={invoice.id}
                    onSelect={() => {
                      onSelect(invoice);
                      setOpen(false);
                    }}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{invoice.invoiceNumber}</span>
                        <span className="text-muted-foreground">-</span>
                        <span className="text-sm">{invoice.clientName}</span>
                      </div>
                      <Badge variant="outline" className="text-xs bg-green-50">
                        Paid
                      </Badge>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Generates a formal receipt pre-filled from this payment's amount, date, and
// invoice — closing the gap where recording a payment and issuing its
// receipt were two disconnected manual steps.
function GenerateReceiptButton({ payment }: { payment: Payment }) {
  const { toast } = useToast();
  const generateReceipt = useGenerateReceiptFromPayment();

  const handleClick = () => {
    generateReceipt.mutate(
      { id: payment.id },
      {
        onSuccess: (receipt) => {
          toast({ title: `Receipt ${receipt.receiptNumber} created` });
          const url = apiUrl(`/receipts/${receipt.id}/pdf`);
          window.open(url, "_blank", "noopener,noreferrer");
        },
        onError: (err: Error) => {
          toast({ title: "Could not generate receipt", description: err.message, variant: "destructive" });
        },
      },
    );
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={handleClick}
      disabled={generateReceipt.isPending}
      title="Generate receipt from this payment"
      aria-label="Generate receipt from this payment"
    >
      <ReceiptIcon className="h-4 w-4" />
    </Button>
  );
}

// Payment Receipts Dialog Component
function PaymentReceiptsDialog({ payment }: { payment: Payment }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [receiptType, setReceiptType] = useState<UploadPaymentReceiptBodyReceiptType>(
    UploadPaymentReceiptBodyReceiptType.receipt
  );
  const [description, setDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: receipts = [] } = useListPaymentReceipts(
    payment.id,
    { query: { enabled: isOpen, queryKey: getListPaymentReceiptsQueryKey(payment.id) } }
  );

  const uploadMutation = useUploadPaymentReceipt();
  const deleteMutation = useDeletePaymentReceipt();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: "File too large", description: "Maximum file size is 10MB", variant: "destructive" });
        return;
      }
      // Validate file type
      const validTypes = ["image/jpeg", "image/png", "application/pdf"];
      if (!validTypes.includes(file.type)) {
        toast({ title: "Invalid file type", description: "Only JPEG, PNG, and PDF files are accepted", variant: "destructive" });
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (!selectedFile) return;

    uploadMutation.mutate(
      {
        id: payment.id,
        data: {
          file: selectedFile,
          receiptType,
          description,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Receipt uploaded successfully" });
          setSelectedFile(null);
          setDescription("");
          setReceiptType(UploadPaymentReceiptBodyReceiptType.receipt);
          if (fileInputRef.current) fileInputRef.current.value = "";
          queryClient.invalidateQueries({ queryKey: getListPaymentReceiptsQueryKey(payment.id) });
        },
        onError: (err: Error) => {
          toast({ title: "Failed to upload receipt", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = (receiptId: string) => {
    if (confirm("Delete this receipt?")) {
      deleteMutation.mutate(
        { paymentId: payment.id, receiptId },
        {
          onSuccess: () => {
            toast({ title: "Receipt deleted" });
            queryClient.invalidateQueries({ queryKey: getListPaymentReceiptsQueryKey(payment.id) });
          },
          onError: (err: Error) => {
            toast({ title: "Failed to delete receipt", description: err.message, variant: "destructive" });
          },
        }
      );
    }
  };

  const handleDownload = (receipt: PaymentReceipt) => {
    const url = apiUrl(`/payments/${payment.id}/receipts/${receipt.id}/download`);
    const a = document.createElement("a");
    a.href = url;
    a.download = receipt.fileName;
    a.click();
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return <FileImage className="h-4 w-4" />;
    if (mimeType === "application/pdf") return <FileText className="h-4 w-4" />;
    return <File className="h-4 w-4" />;
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1">
          <Paperclip className="h-3.5 w-3.5" />
          {receipts.length > 0 && <span className="text-xs">({receipts.length})</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptIcon className="h-5 w-5" />
            Payment Documents
            {payment.invoiceNumber && (
              <span className="text-muted-foreground font-normal">
                - {payment.invoiceNumber}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Upload Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Upload New Document</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Document Type</Label>
                  <Select
                    value={receiptType}
                    onValueChange={(v) => setReceiptType(v as UploadPaymentReceiptBodyReceiptType)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECEIPT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          <div className="flex items-center gap-2">
                            {RECEIPT_TYPE_ICONS[type]}
                            {RECEIPT_TYPE_LABELS[type]}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Description (optional)</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Enter details like cheque number, bank name, deposit date, etc."
                    className="min-h-[60px]"
                  />
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">File</Label>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={handleFileSelect}
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Accepted: JPEG, PNG, PDF. Max 10MB.
                  </p>
                </div>

                {selectedFile && (
                  <div className="flex items-center gap-2 text-sm bg-muted/50 p-2 rounded">
                    {getFileIcon(selectedFile.type)}
                    <span className="truncate flex-1">{selectedFile.name}</span>
                    <span className="text-muted-foreground text-xs">{formatFileSize(selectedFile.size)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}

                <Button
                  onClick={handleUpload}
                  disabled={!selectedFile || uploadMutation.isPending}
                  className="w-full"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {uploadMutation.isPending ? "Uploading..." : "Upload Document"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Receipts List */}
          <div className="space-y-3">
            <h4 className="font-medium text-sm">Uploaded Documents</h4>
            {receipts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border rounded-lg bg-muted/20">
                <Receipt className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No documents uploaded yet.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload cheque copies, deposit slips, or payment screenshots
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {receipts.map((receipt) => (
                  <div
                    key={receipt.id}
                    className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-shrink-0 text-muted-foreground mt-0.5">
                      {RECEIPT_TYPE_ICONS[receipt.receiptType] || <File className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{receipt.fileName}</span>
                        <Badge variant="secondary" className="text-xs">
                          {RECEIPT_TYPE_LABELS[receipt.receiptType]}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                        <span>{formatFileSize(receipt.fileSize)}</span>
                        <span>•</span>
                        <span>{formatDate(receipt.uploadedAt)}</span>
                      </div>
                      {receipt.description && (
                        <p className="text-xs text-muted-foreground mt-2 bg-muted/30 p-1.5 rounded">
                          {receipt.description}
                        </p>
                      )}
                      {/* Thumbnail preview for images */}
                      {receipt.mimeType.startsWith("image/") && (
                        <div className="mt-2">
                          <img
                            src={apiUrl(`/payments/${payment.id}/receipts/${receipt.id}/download`)}
                            alt={receipt.fileName}
                            className="max-h-32 max-w-full rounded border object-contain"
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleDownload(receipt)}
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(receipt.id)}
                        disabled={deleteMutation.isPending}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Create Payment Dialog Component
function CreatePaymentDialog({
  open,
  onOpenChange,
  onSuccess,
  initialInvoiceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  initialInvoiceId?: string;
}) {
  const { toast } = useToast();
  const createPayment = useCreatePayment();
  const { data: invoicesResponse } = useListInvoices({ pageSize: 500 });
  const invoices = invoicesResponse?.data ?? [];

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [note, setNote] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [depositDate, setDepositDate] = useState("");

  // Document upload states
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const uploadMutation = useUploadPaymentReceipt();

  useEffect(() => {
    if (!open || !initialInvoiceId || selectedInvoice) return;
    const invoice = invoices.find((candidate) => candidate.id === initialInvoiceId);
    if (invoice) handleInvoiceSelect(invoice);
  }, [initialInvoiceId, invoices, open, selectedInvoice]);

  // Calculate remaining amount
  const remainingAmount = selectedInvoice
    ? selectedInvoice.total - (selectedInvoice.paidAmount || 0)
    : 0;

  const handleInvoiceSelect = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    // Auto-fill amount with remaining amount
    const remaining = invoice.total - (invoice.paidAmount || 0);
    setAmount(remaining.toString());
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const validFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: "File too large", description: `${file.name} exceeds 10MB limit`, variant: "destructive" });
        continue;
      }
      // Validate file type - same policy as the post-hoc Documents dialog (PNG, JPEG, PDF)
      const validTypes = ["image/jpeg", "image/png", "application/pdf"];
      if (!validTypes.includes(file.type)) {
        toast({ title: "Invalid file type", description: `${file.name} is not a PNG, JPEG, or PDF file`, variant: "destructive" });
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return <FileImage className="h-4 w-4" />;
    return <File className="h-4 w-4" />;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) {
      toast({ title: "Please select an invoice", variant: "destructive" });
      return;
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      toast({ title: "Please enter a valid amount", variant: "destructive" });
      return;
    }

    createPayment.mutate(
      {
        data: {
          invoiceId: selectedInvoice.id,
          amount: Number(amount),
          paymentDate,
          paymentMethod,
          note: note || undefined,
          chequeNumber: chequeNumber || undefined,
          bankName: bankName || undefined,
          depositDate: depositDate || undefined,
        },
      },
      {
        onSuccess: (payment) => {
          toast({ title: "Payment recorded successfully" });

          // Upload documents if any are selected
          if (selectedFiles.length > 0 && payment?.id) {
            const uploadPromises = selectedFiles.map(file =>
              uploadMutation.mutateAsync({
                id: payment.id,
                data: {
                  file,
                  receiptType: UploadPaymentReceiptBodyReceiptType.cheque_deposit,
                  description: `Document for ${paymentMethod} payment`,
                },
              })
            );

            Promise.all(uploadPromises)
              .then(() => {
                toast({ title: `${selectedFiles.length} document(s) uploaded` });
                queryClient.invalidateQueries({ queryKey: getListPaymentReceiptsQueryKey(payment.id) });
              })
              .catch((err: Error) => {
                toast({ title: "Failed to upload some documents", description: err.message, variant: "destructive" });
              });
          }

          onSuccess();
          onOpenChange(false);
          // Reset form
          setSelectedInvoice(null);
          setAmount("");
          setPaymentDate(new Date().toISOString().split("T")[0]);
          setPaymentMethod("bank_transfer");
          setNote("");
          setChequeNumber("");
          setBankName("");
          setDepositDate("");
          setSelectedFiles([]);
          if (fileInputRef.current) fileInputRef.current.value = "";
        },
        onError: (err: Error) => {
          toast({ title: "Failed to record payment", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Record Payment
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
              {/* Invoice Selection */}
              <div className="space-y-2">
                <Label>Invoice <span className="text-destructive">*</span></Label>
                <InvoiceSelector
                  invoices={invoices}
                  selectedInvoiceId={selectedInvoice?.id || null}
                  onSelect={handleInvoiceSelect}
                  disabled={createPayment.isPending}
                />
              </div>

              {/* Invoice Summary */}
              {selectedInvoice && (
                <Card className="bg-muted/50">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Invoice Total</span>
                      <span className="font-medium">
                        {formatCurrency(selectedInvoice.total, selectedInvoice.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Already Paid</span>
                      <span className="font-medium text-green-600">
                        {formatCurrency(selectedInvoice.paidAmount || 0, selectedInvoice.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t">
                      <span className="text-sm font-medium">Remaining Balance</span>
                      <span className="font-bold text-lg">
                        {formatCurrency(remainingAmount, selectedInvoice.currency)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Amount */}
              <div className="space-y-2">
                <Label htmlFor="amount">Payment Amount <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {selectedInvoice?.currency || "HKD"}
                  </span>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="pl-12"
                    placeholder="Enter amount"
                    disabled={createPayment.isPending}
                  />
                </div>
                {selectedInvoice && Number(amount) > remainingAmount && (
                  <p className="text-xs text-amber-600">
                    Warning: Payment exceeds remaining balance
                  </p>
                )}
              </div>

              {/* Payment Date */}
              <div className="space-y-2">
                <Label htmlFor="paymentDate">Payment Date <span className="text-destructive">*</span></Label>
                <Input
                  id="paymentDate"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  disabled={createPayment.isPending}
                />
              </div>

              {/* Payment Method */}
              <div className="space-y-2">
                <Label>Payment Method <span className="text-destructive">*</span></Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod} disabled={createPayment.isPending}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((method) => (
                      <SelectItem key={method} value={method}>
                        {METHOD_LABELS[method]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Cheque / bank details — relevant for cheque-based methods */}
              {(paymentMethod === "cheque" || paymentMethod === "echeque" || paymentMethod === "cheque_deposit") && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="chequeNumber">Cheque number</Label>
                    <Input
                      id="chequeNumber"
                      value={chequeNumber}
                      onChange={(e) => setChequeNumber(e.target.value)}
                      placeholder="e.g. 000123"
                      disabled={createPayment.isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bankName">Bank name</Label>
                    <Input
                      id="bankName"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder="e.g. HSBC"
                      disabled={createPayment.isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="depositDate">Deposit date</Label>
                    <Input
                      id="depositDate"
                      type="date"
                      value={depositDate}
                      onChange={(e) => setDepositDate(e.target.value)}
                      disabled={createPayment.isPending}
                    />
                  </div>
                </div>
              )}

              {/* Note */}
              <div className="space-y-2">
                <Label htmlFor="note">Note (optional)</Label>
                <Textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Additional notes about this payment..."
                  disabled={createPayment.isPending}
                />
              </div>
          {/* Documents Upload Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileImage className="h-4 w-4" />
                Documents (PNG, JPEG, PDF)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  onChange={handleFileSelect}
                  disabled={createPayment.isPending}
                  multiple
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Upload PNG, JPEG, or PDF files. Maximum file size: 10MB per file.
                </p>
              </div>

              {selectedFiles.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium">Selected Files:</p>
                  <div className="space-y-2">
                    {selectedFiles.map((file, index) => (
                      <div key={index} className="flex items-center gap-2 text-sm bg-muted/50 p-2 rounded">
                        {getFileIcon(file)}
                        <span className="truncate flex-1">{file.name}</span>
                        <span className="text-muted-foreground text-xs">{formatFileSize(file.size)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeFile(index)}
                          disabled={createPayment.isPending}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createPayment.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createPayment.isPending || !selectedInvoice}>
              {createPayment.isPending ? "Recording..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Main Payments Page Component
export default function Payments() {
  const searchString = useSearch();
  const [, setLocation] = useLocation();
  const requestedInvoiceId = new URLSearchParams(searchString).get("invoiceId") ?? undefined;
  const requestedNewPayment = new URLSearchParams(searchString).get("new") === "1";
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [importOpen, setImportOpen] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (requestedNewPayment) setCreateDialogOpen(true);
  }, [requestedNewPayment]);

  const setPaymentDialogOpen = (open: boolean) => {
    setCreateDialogOpen(open);
    if (!open && requestedNewPayment) setLocation("/payments", { replace: true });
  };

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [filterInvoiceNumber, setFilterInvoiceNumber] = useState("");
  const [filterMethod, setFilterMethod] = useState<string>("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 250);

  const params = {
    page,
    pageSize,
    ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
    ...(filterInvoiceNumber.trim() ? { invoiceNumber: filterInvoiceNumber.trim() } : {}),
    ...(filterMethod ? { paymentMethod: filterMethod } : {}),
    ...(filterDateFrom ? { dateFrom: filterDateFrom } : {}),
    ...(filterDateTo ? { dateTo: filterDateTo } : {}),
  };

  const { data: paymentsPage, isLoading, isFetching, isError: listError, error: listFetchError, refetch: refetchPayments } = useListPayments(
    params,
    { query: { queryKey: getListPaymentsQueryKey(params), placeholderData: keepPreviousData } },
  );
  const payments: Payment[] = paymentsPage?.data ?? [];
  const total = paymentsPage?.total ?? 0;
  const showListSkeleton = isLoading && !paymentsPage;

  const { data: allInvoicesResponse } = useListInvoices({ pageSize: 100 });
  const allInvoices = allInvoicesResponse?.data ?? [];

  const deleteMutation = useDeletePayment();

  const hasFilters = !!(searchQuery || filterInvoiceNumber || filterMethod || filterDateFrom || filterDateTo);

  const clearFilters = () => {
    setSearchQuery("");
    setFilterInvoiceNumber("");
    setFilterMethod("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setPage(1);
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this payment record? This will also delete all associated documents.")) {
      deleteMutation.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
            toast({ title: "Payment deleted" });
          },
          onError: (err: Error) =>
            toast({ title: "Failed to delete payment", description: err.message, variant: "destructive" }),
        },
      );
    }
  };

  const handleExport = () => {
    const url = apiUrl("/payments/export");
    const a = document.createElement("a");
    a.href = url;
    a.download = "payments.csv";
    a.click();
  };

  const handlePaymentSuccess = () => {
    queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Payments</h2>
          <p className="text-muted-foreground text-sm hidden sm:block">Record and manage payments against invoices.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExport} className="hidden sm:inline-flex">
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="hidden sm:inline-flex">
            <Upload className="h-4 w-4 mr-2" /> Import CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDeletedOpen(true)} title="Deleted payments">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button onClick={() => setPaymentDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Record Payment
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Collapsible open={filterExpanded} onOpenChange={setFilterExpanded}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by cheque #, ref #, transaction ID..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className={cn(filterExpanded && "bg-muted")}>
              <Filter className="h-4 w-4 mr-2" />
              Filters
              {hasFilters && <Badge variant="secondary" className="ml-1 text-xs">!</Badge>}
            </Button>
          </CollapsibleTrigger>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          )}
        </div>

        <CollapsibleContent className="mt-3">
          <Card className="bg-muted/30">
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Invoice Number</Label>
                  <Input
                    placeholder="Search invoice #"
                    value={filterInvoiceNumber}
                    onChange={(e) => { setFilterInvoiceNumber(e.target.value); setPage(1); }}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Payment Method</Label>
                  <Select
                    value={filterMethod || "all"}
                    onValueChange={(v) => { setFilterMethod(v === "all" ? "" : v); setPage(1); }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All methods" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All methods</SelectItem>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Date From</Label>
                  <Input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Date To</Label>
                  <Input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }}
                    className="h-9"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {total > 0 && (
            <span>Showing {payments.length} of {total} payments</span>
          )}
        </div>
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          isLoading={isFetching}
        />
      </div>

      {/* Payments Table */}
      <Card className="bg-card">
        <CardContent className="p-0">
          {listError ? (
            <div className="text-center py-12 px-4 space-y-3">
              <p className="text-destructive text-sm">{describeApiFailure(listFetchError)}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetchPayments()}>
                Retry
              </Button>
            </div>
          ) : showListSkeleton ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded"></div>
              ))}
            </div>
          ) : !payments.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p>{hasFilters ? "No payments match the current filters." : "No payments yet. Record your first payment."}</p>
              {!hasFilters && (
                <Button variant="outline" className="mt-4" onClick={() => setPaymentDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Record Payment
                </Button>
              )}
            </div>
          ) : (
            <div className="relative w-full overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b bg-muted/30">
                  <tr className="border-b transition-colors">
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Invoice</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Client</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Date</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Method</th>
                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Amount</th>
                    <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground">Status</th>
                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-b transition-colors hover:bg-muted/50">
                      <td className="p-4 align-middle">
                        <div className="font-medium">{payment.invoiceNumber ?? payment.invoiceId.slice(0, 8)}</div>
                        {payment.note && (
                          <div className="text-xs text-muted-foreground mt-0.5 max-w-[150px] truncate" title={payment.note}>
                            {payment.note}
                          </div>
                        )}
                      </td>
                      <td className="p-4 align-middle">
                        <div className="text-sm">{payment.clientName || "-"}</div>
                      </td>
                      <td className="p-4 align-middle">
                        <div className="text-sm">{formatDate(payment.paymentDate)}</div>
                        {(payment.chequeNumber || payment.referenceNumber) && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {payment.chequeNumber && `Chq: ${payment.chequeNumber}`}
                            {payment.chequeNumber && payment.referenceNumber && " • "}
                            {payment.referenceNumber && `Ref: ${payment.referenceNumber}`}
                          </div>
                        )}
                      </td>
                      <td className="p-4 align-middle">
                        <Badge variant="outline">
                          {METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod}
                        </Badge>
                        {payment.bankName && (
                          <div className="text-xs text-muted-foreground mt-1">{payment.bankName}</div>
                        )}
                      </td>
                      <td className="p-4 align-middle text-right">
                        <div className="font-bold">{formatCurrency(payment.amount, payment.currency)}</div>
                        {payment.invoiceTotal && (
                          <div className="text-xs text-muted-foreground">
                            of {formatCurrency(payment.invoiceTotal, payment.currency)}
                          </div>
                        )}
                      </td>
                      <td className="p-4 align-middle text-center">
                        <PaymentStatusBadge payment={payment} />
                      </td>
                      <td className="p-4 align-middle text-right">
                        <div className="flex items-center justify-end gap-1">
                          <GenerateReceiptButton payment={payment} />
                          <PaymentReceiptsDialog payment={payment} />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(payment.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Payment Dialog */}
      <CreatePaymentDialog
        open={createDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        onSuccess={handlePaymentSuccess}
        initialInvoiceId={requestedInvoiceId}
      />

      {/* CSV Import Dialog */}
      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importUrl={apiUrl("/payments/import")}
        entityName="Payments"
        onSuccess={() => queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() })}
        templateUrl={apiUrl("/payments/import/template")}
      />

      <DeletedItemsDialog
        open={deletedOpen}
        onOpenChange={setDeletedOpen}
        entity="payments"
        title="Deleted payments"
        renderLabel={(row) =>
          `${formatCurrency(Number(row.amount ?? 0), (row.currency as string) ?? "HKD")}${row.invoiceNumber ? ` — ${row.invoiceNumber}` : ""}`
        }
        renderSubLabel={(row) => (row.paymentMethod ? METHOD_LABELS[row.paymentMethod as string] ?? String(row.paymentMethod) : undefined)}
        onRestored={() => queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() })}
      />
    </div>
  );
}
