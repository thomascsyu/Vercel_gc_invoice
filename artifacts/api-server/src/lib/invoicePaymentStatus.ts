/** Amounts are stored to 2 decimal places; treat ½ cent as rounding noise. */
export const MONEY_EPS = 0.005;

export function remainingInvoiceBalance(total: number, paidAmount: number): number {
  return Math.round((total - paidAmount) * 100) / 100;
}

export function wouldOverpay(total: number, paidAmount: number, extra: number): boolean {
  return extra - remainingInvoiceBalance(total, paidAmount) > MONEY_EPS;
}

export type PaymentSyncStatus = {
  status: string;
  statusBeforePaid: string | null;
};

/**
 * Invoice status after recomputing paid amounts from the payments table.
 * Promotes to `paid` when the balance is covered (remembering the prior status);
 * demotes `paid` back to the remembered status (or `sent`) when payments no longer
 * cover the total.
 */
export function invoiceStatusAfterPaymentSync(
  currentStatus: string,
  paidAmount: number,
  total: number,
  statusBeforePaid: string | null = null,
): PaymentSyncStatus {
  const fullyPaid = paidAmount + MONEY_EPS >= total;

  if (fullyPaid) {
    if (currentStatus === "paid") {
      return { status: "paid", statusBeforePaid };
    }
    return { status: "paid", statusBeforePaid: currentStatus };
  }

  if (currentStatus === "paid") {
    const restored =
      statusBeforePaid && statusBeforePaid !== "paid" ? statusBeforePaid : "sent";
    return { status: restored, statusBeforePaid: null };
  }

  return { status: currentStatus, statusBeforePaid };
}

export function isInvoiceFullyPaid(paidAmount: number, total: number): boolean {
  return paidAmount + MONEY_EPS >= total;
}
