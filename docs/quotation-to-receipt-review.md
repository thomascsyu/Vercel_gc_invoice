# Quotation-to-receipt workflow review

## Scope

The reviewed operational path is:

1. prepare and approve a quotation;
2. send it and record customer confirmation;
3. convert the confirmed quotation into an invoice;
4. approve and send the invoice;
5. record one or more payments against the invoice; and
6. issue a formal receipt for each payment.

The API correctly keeps the important accounting links: conversion associates the new invoice with its source quotation, payments belong to an invoice, and a generated receipt belongs to a specific payment. The main friction was in the user-interface handoff between invoices and payments: staff had to leave the invoice list, open Payments, start a payment, and find the same invoice again.

## Improvement implemented

Outstanding invoices now expose **Record payment** in their actions menu. The action opens the payment form with that invoice already selected and its remaining balance pre-filled. Closing the form removes the handoff parameters from the URL, so refreshing the Payments page does not unexpectedly reopen it.

This shortens a common handoff, reduces the risk of applying money to the wrong invoice, and preserves the existing server-side overpayment validation.

## Recommended next improvements

### High priority

- Add a compact lifecycle indicator to quotation and invoice detail views so staff can see quotation, invoice, payment, and receipt completion in one place.
- After recording a payment, offer explicit **Issue receipt** and **View invoice** next actions instead of relying on the icon-only action in the payments table.
- Show whether a payment already has a formal receipt, and change the action from **Issue receipt** to **View receipt** to avoid a preventable conflict response.
- Add an end-to-end browser test covering confirmed quotation → invoice → payment → receipt, including partial-payment and final-payment cases.

### Medium priority

- Preserve a backlink to the originating quotation on the invoice screen and expose linked payments and receipts from invoice details.
- Distinguish uploaded payment evidence (bank screenshot, cheque deposit slip) from the formal customer receipt in labels and counts.
- Require confirmation before recording an amount above the displayed remaining balance in the UI; the server should remain the final enforcement point.
- Replace icon-only document and receipt actions with visible text at common desktop widths and accessible tooltips at compact widths.

## Acceptance criteria for the complete flow

- A confirmed quotation can be converted only once, and both records expose their link.
- The payment form opened from an invoice selects the intended invoice and pre-fills only its outstanding balance.
- Partial payments update the outstanding balance without prematurely completing the invoice.
- A final payment marks the invoice paid through the server's payment reconciliation logic.
- Each payment can produce at most one formal receipt, while supporting multiple evidence attachments.
- Users can reach every adjacent record in the lifecycle without searching for its number again.
