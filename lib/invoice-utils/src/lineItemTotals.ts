export type LineItemLike = {
  quantity: number;
  price: number;
  taxRate?: number;
};

export function calculateDocumentTotals(items: readonly LineItemLike[], discountAmount = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const taxAmount = items.reduce(
    (sum, item) => sum + item.quantity * item.price * ((item.taxRate ?? 0) / 100),
    0,
  );
  const total = Math.max(subtotal + taxAmount - discountAmount, 0);
  return { subtotal, taxAmount, discountAmount, total };
}

/** Amounts are stored to 2 decimal places; treat ½ cent as rounding noise. */
export const MONEY_EPS = 0.005;

export function isInvoiceFullyPaid(paidAmount: number, total: number): boolean {
  return paidAmount + MONEY_EPS >= total;
}
