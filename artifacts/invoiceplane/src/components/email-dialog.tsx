import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, Loader2 } from "lucide-react";

export type EmailSendParams = {
  to: string;
  slot: 1 | 2;
  cc?: string;
  bcc?: string;
  /** When set, replaces {{contact_person}} in the email template (quotation send). */
  contactPersonOverride?: string;
};

export interface EmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  defaultEmail?: string;
  /** When true, show a field that overrides {{contact_person}} in the email body (quotation templates). */
  showRecipientOverride?: boolean;
  senderEmail1?: string | null;
  senderEmail2?: string | null;
  onSend: (params: {
    to: string;
    slot: 1 | 2;
    cc?: string;
    bcc?: string;
    contactPersonOverride?: string;
  }) => Promise<void>;
  isSending?: boolean;
  /** @deprecated Use showRecipientOverride instead */
  showContactPersonOverride?: boolean;
  /** When true, show a "Skip" button to skip sending email */
  showSkip?: boolean;
  /** Called when the user clicks the Skip button */
  onSkip?: () => void;
}

export function EmailDialog({
  open,
  onOpenChange,
  title,
  description,
  defaultEmail = "",
  showRecipientOverride = false,
  senderEmail1,
  senderEmail2,
  onSend,
  isSending = false,
  showSkip = false,
  onSkip,
}: EmailDialogProps) {
  const [to, setTo] = useState(defaultEmail);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [contactPersonOverride, setContactPersonOverride] = useState("");
  const [slot, setSlot] = useState<"1" | "2">("1");
  const [emailError, setEmailError] = useState("");

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setTo("");
      setCc("");
      setBcc("");
      setContactPersonOverride("");
      setEmailError("");
      if (senderEmail1) {
        setSlot("1");
      } else if (senderEmail2) {
        setSlot("2");
      }
    }
  }, [open, senderEmail1, senderEmail2]);

  // Prefill recipient when client email arrives; never overwrite user typing.
  React.useEffect(() => {
    if (!open || !defaultEmail) return;
    setTo((current) => (current.trim() === "" ? defaultEmail : current));
  }, [open, defaultEmail]);

  const handleSend = async () => {
    const toAddr = to.trim();
    if (!toAddr) {
      setEmailError("Enter a recipient email address.");
      return;
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const split = (value: string) =>
      value.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
    const invalid = [...split(toAddr), ...split(cc), ...split(bcc)].filter((addr) => !emailRe.test(addr));
    if (invalid.length > 0) {
      setEmailError(`Invalid email: ${invalid.join(", ")}`);
      return;
    }
    setEmailError("");
    await onSend({
      to: toAddr,
      slot: parseInt(slot, 10) as 1 | 2,
      cc: cc.trim() || undefined,
      bcc: bcc.trim() || undefined,
      contactPersonOverride: showRecipientOverride
        ? contactPersonOverride.trim() || undefined
        : undefined,
    });
  };

  const hasSlot1 = Boolean(senderEmail1);
  const hasSlot2 = Boolean(senderEmail2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* From / Sender Account Selection */}
          <div className="space-y-2">
            <Label htmlFor="email-from">From</Label>
            <Select
              value={slot}
              onValueChange={(v) => setSlot(v as "1" | "2")}
              disabled={isSending || (!hasSlot1 && !hasSlot2)}
            >
              <SelectTrigger id="email-from">
                <SelectValue placeholder="Select sender account" />
              </SelectTrigger>
              <SelectContent>
                {hasSlot1 && (
                  <SelectItem value="1">
                    {senderEmail1} (primary sender)
                  </SelectItem>
                )}
                {hasSlot2 && (
                  <SelectItem value="2">
                    {senderEmail2} (second sender)
                  </SelectItem>
                )}
                {!hasSlot1 && !hasSlot2 && (
                  <SelectItem value="1" disabled>
                    No email accounts configured
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {!hasSlot1 && !hasSlot2 && (
              <p className="text-xs text-destructive">
                No Gmail accounts configured. Please set up email in Admin → Email settings.
              </p>
            )}
          </div>

          {showRecipientOverride && (
            <div className="space-y-2">
              <Label htmlFor="email-contact-override">Recipient name override (optional)</Label>
              <Input
                id="email-contact-override"
                type="text"
                placeholder='Name for "Dear …" in the email (optional)'
                value={contactPersonOverride}
                onChange={(e) => setContactPersonOverride(e.target.value)}
                disabled={isSending}
              />
              <p className="text-xs text-muted-foreground">
                Replaces <code className="text-xs">{"{{contact_person}}"}</code> in the template. Does not change the To address.
              </p>
            </div>
          )}

          {/* To */}
          <div className="space-y-2">
            <Label htmlFor="email-to">To</Label>
            <Input
              id="email-to"
              type="email"
              placeholder="recipient@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={isSending}
            />
          </div>

          {/* CC */}
          <div className="space-y-2">
            <Label htmlFor="email-cc">CC (optional)</Label>
            <Input
              id="email-cc"
              type="email"
              placeholder="cc@example.com"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              disabled={isSending}
            />
          </div>

          {/* BCC */}
          <div className="space-y-2">
            <Label htmlFor="email-bcc">BCC (optional)</Label>
            <Input
              id="email-bcc"
              type="email"
              placeholder="bcc@example.com"
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              disabled={isSending}
            />
          </div>
        </div>

        {emailError ? <p className="text-sm text-destructive">{emailError}</p> : null}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            Cancel
          </Button>
          {showSkip && (
            <Button
              variant="secondary"
              onClick={() => {
                onSkip?.();
                onOpenChange(false);
              }}
              disabled={isSending}
            >
              Skip
            </Button>
          )}
          <Button
            onClick={handleSend}
            disabled={!to.trim() || isSending || (!hasSlot1 && !hasSlot2)}
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
