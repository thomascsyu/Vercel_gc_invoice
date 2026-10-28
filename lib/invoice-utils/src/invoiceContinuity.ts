/**
 * Invoice number continuity (tax / audit).
 *
 * Auto-allocated numbers are `{YY}{MM}{seq}` (see `nextDocumentNumber`): a
 * two-digit year, month stamp, and a global sequence padded to at least 3
 * digits, with an optional `-REVISED` / `-REVISED-N` suffix. Continuity is
 * the global sequence from the lowest present number to the highest.
 *
 * Soft-deleted invoices (or an explicit void) stay in the sequence so their
 * number is not reported as missing; they are listed as voided instead.
 * Permanently purged invoices are removed from the dataset and may appear as
 * sequence gaps.
 */

export const INVOICE_REVISED_SUFFIX = /-REVISED(?:-\d+)?$/i;

/** YYMM + sequence (min 3 digits), optional revision suffix. */
export const STANDARD_INVOICE_NUMBER =
  /^(\d{2})(\d{2})(\d{3,})(?:-REVISED(?:-\d+)?)?$/i;

export type ParsedInvoiceNumber = {
  invoiceNumber: string;
  baseNumber: string;
  stamp: string;
  yearMonth: string;
  sequence: number;
  isRevised: boolean;
};

export type InvoiceContinuityInput = {
  id?: string;
  invoiceNumber: string;
  invoiceDate?: string | null;
  status?: string | null;
  deletedAt?: string | Date | null;
  voided?: boolean;
  cancellationReason?: string | null;
};

export type VoidedInvoice = {
  id?: string;
  invoiceNumber: string;
  invoiceDate?: string;
  month: string;
  status?: string;
  deletedAt?: string;
  cancellationReason?: string;
};

export type MissingSequenceSlot = {
  sequence: number;
  /** Best-guess invoice number for this global sequence slot. */
  likelyNumber: string;
  /** Other plausible numbers when the YYMM stamp is ambiguous across months. */
  alternates?: string[];
};

export type DuplicateSequenceSlot = {
  sequence: number;
  /** Distinct base numbers (YYMM + seq) sharing this global sequence index. */
  baseNumbers: string[];
  invoiceNumbers: string[];
};

export type DuplicateBaseNumber = {
  baseNumber: string;
  invoiceNumbers: string[];
};

export type ReissuedInvoiceNumber = {
  invoiceNumber: string;
  voidedInvoiceId?: string;
  activeInvoiceId?: string;
};

export type MonthContinuity = {
  /** Calendar month `YYYY-MM`, or `unknown` when the number and date cannot be parsed. */
  month: string;
  lastInvoiceNumber: string | null;
  invoiceCount: number;
  /** Best-guess missing numbers assigned to this month (see `missingSequenceSlots`). */
  missingNumbers: string[];
  voidedInvoices: VoidedInvoice[];
};

export type InvoiceContinuityReport = {
  months: MonthContinuity[];
  /** Last invoice number keyed by `YYYY-MM` (same values as `months`). */
  lastInvoiceNumberByMonth: Record<string, string | null>;
  /** Best-guess missing numbers between the lowest and highest present sequence. */
  missingNumbers: string[];
  /** Detailed missing slots, including alternate stamps when ambiguous. */
  missingSequenceSlots: MissingSequenceSlot[];
  voidedInvoices: VoidedInvoice[];
  /** Same global sequence index reused with different YYMM stamps (import / purge replay). */
  duplicateSequenceSlots: DuplicateSequenceSlot[];
  /** Same base number on multiple rows. */
  duplicateBaseNumbers: DuplicateBaseNumber[];
  /** Number reissued after soft delete while the voided copy still exists. */
  reissuedNumbers: ReissuedInvoiceNumber[];
  unparsedInvoiceNumbers: string[];
  /** True when there are no missing sequence slots. */
  intact: boolean;
};

export function baseInvoiceNumber(invoiceNumber: string): string {
  return invoiceNumber.trim().replace(INVOICE_REVISED_SUFFIX, "");
}

export function formatStandardInvoiceNumber(stamp: string, sequence: number): string {
  return `${stamp}${String(sequence).padStart(3, "0")}`;
}

export function parseInvoiceNumber(invoiceNumber: string): ParsedInvoiceNumber | null {
  const trimmed = invoiceNumber.trim();
  const match = trimmed.match(STANDARD_INVOICE_NUMBER);
  if (!match) return null;
  const yy = match[1]!;
  const mm = match[2]!;
  const seq = match[3]!;
  const monthNum = Number(mm);
  if (monthNum < 1 || monthNum > 12) return null;
  return {
    invoiceNumber: trimmed,
    baseNumber: `${yy}${mm}${seq}`,
    stamp: `${yy}${mm}`,
    yearMonth: `${2000 + Number(yy)}-${mm}`,
    sequence: Number(seq),
    isRevised: INVOICE_REVISED_SUFFIX.test(trimmed),
  };
}

export function isVoidedInvoice(invoice: InvoiceContinuityInput): boolean {
  if (invoice.voided === true) return true;
  if (invoice.status === "voided") return true;
  if (invoice.deletedAt != null && invoice.deletedAt !== "") return true;
  return false;
}

function monthFromInvoiceDate(invoiceDate?: string | null): string | null {
  if (!invoiceDate) return null;
  const match = /^(\d{4}-\d{2})/.exec(invoiceDate.trim());
  return match?.[1] ?? null;
}

function deletedAtIso(value: InvoiceContinuityInput["deletedAt"]): string | undefined {
  if (value == null || value === "") return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function voidedRecord(invoice: InvoiceContinuityInput, month: string): VoidedInvoice {
  const deletedAt = deletedAtIso(invoice.deletedAt);
  return {
    ...(invoice.id ? { id: invoice.id } : {}),
    invoiceNumber: invoice.invoiceNumber.trim(),
    ...(invoice.invoiceDate ? { invoiceDate: invoice.invoiceDate } : {}),
    month,
    ...(invoice.status ? { status: invoice.status } : {}),
    ...(deletedAt ? { deletedAt } : {}),
    ...(invoice.cancellationReason ? { cancellationReason: invoice.cancellationReason } : {}),
  };
}

function monthOf(invoice: InvoiceContinuityInput, parsed: ParsedInvoiceNumber | null): string {
  return parsed?.yearMonth ?? monthFromInvoiceDate(invoice.invoiceDate) ?? "unknown";
}

function yearMonthFromStamp(stamp: string): string {
  return `${2000 + Number(stamp.slice(0, 2))}-${stamp.slice(2, 4)}`;
}

function lastInvoiceNumber(
  invoices: readonly InvoiceContinuityInput[],
  parsedRows: readonly { invoice: InvoiceContinuityInput; parsed: ParsedInvoiceNumber }[],
): string | null {
  if (parsedRows.length > 0) {
    return parsedRows.reduce((best, row) =>
      row.parsed.sequence >= best.parsed.sequence ? row : best,
    ).invoice.invoiceNumber.trim();
  }
  if (invoices.length === 0) return null;
  return [...invoices]
    .sort((a, b) => {
      const dateA = a.invoiceDate ?? "";
      const dateB = b.invoiceDate ?? "";
      if (dateA !== dateB) return dateA < dateB ? -1 : 1;
      return a.invoiceNumber.localeCompare(b.invoiceNumber);
    })
    .at(-1)!
    .invoiceNumber.trim();
}

/** Infer the most likely missing invoice number for a global sequence slot. */
export function inferMissingSequenceSlot(
  sequence: number,
  previous: ParsedInvoiceNumber | undefined,
  next: ParsedInvoiceNumber | undefined,
): MissingSequenceSlot {
  if (!previous && next) {
    return { sequence, likelyNumber: formatStandardInvoiceNumber(next.stamp, sequence) };
  }
  if (previous && !next) {
    return { sequence, likelyNumber: formatStandardInvoiceNumber(previous.stamp, sequence) };
  }
  if (previous && next) {
    const fromPrevious = formatStandardInvoiceNumber(previous.stamp, sequence);
    const fromNext = formatStandardInvoiceNumber(next.stamp, sequence);
    if (fromPrevious === fromNext) {
      return { sequence, likelyNumber: fromPrevious };
    }
    // When stamps differ, prefer the next invoice's month — the missing slot
    // was issued before the next number in the global counter.
    return {
      sequence,
      likelyNumber: fromNext,
      alternates: [fromPrevious],
    };
  }
  return { sequence, likelyNumber: formatStandardInvoiceNumber("0000", sequence) };
}

function detectReissuedNumbers(
  invoices: readonly InvoiceContinuityInput[],
): ReissuedInvoiceNumber[] {
  const byBase = new Map<string, InvoiceContinuityInput[]>();
  for (const invoice of invoices) {
    const base = baseInvoiceNumber(invoice.invoiceNumber);
    const rows = byBase.get(base) ?? [];
    rows.push(invoice);
    byBase.set(base, rows);
  }

  const reissued: ReissuedInvoiceNumber[] = [];
  for (const [invoiceNumber, rows] of byBase) {
    const voided = rows.filter(isVoidedInvoice);
    const active = rows.filter((row) => !isVoidedInvoice(row));
    if (voided.length === 0 || active.length === 0) continue;
    for (const activeRow of active) {
      for (const voidedRow of voided) {
        reissued.push({
          invoiceNumber,
          ...(voidedRow.id ? { voidedInvoiceId: voidedRow.id } : {}),
          ...(activeRow.id ? { activeInvoiceId: activeRow.id } : {}),
        });
      }
    }
  }
  return reissued;
}

/**
 * Verify invoice number continuity.
 *
 * Returns the final (highest-sequence) invoice number for each month, any
 * missing numbers between the lowest and highest present sequence, and every
 * voided invoice. Voided invoices occupy their sequence slot.
 */
export function verifyInvoiceContinuity(
  invoices: readonly InvoiceContinuityInput[],
): InvoiceContinuityReport {
  const unparsedInvoiceNumbers: string[] = [];
  const byMonth = new Map<string, InvoiceContinuityInput[]>();
  const parsedByMonth = new Map<
    string,
    { invoice: InvoiceContinuityInput; parsed: ParsedInvoiceNumber }[]
  >();
  const bySequence = new Map<
    number,
    { invoice: InvoiceContinuityInput; parsed: ParsedInvoiceNumber }[]
  >();
  const byBaseNumber = new Map<
    string,
    { invoice: InvoiceContinuityInput; parsed: ParsedInvoiceNumber }[]
  >();
  const occupied = new Map<number, ParsedInvoiceNumber>();

  for (const invoice of invoices) {
    const parsed = parseInvoiceNumber(invoice.invoiceNumber);
    const month = monthOf(invoice, parsed);
    const monthRows = byMonth.get(month) ?? [];
    monthRows.push(invoice);
    byMonth.set(month, monthRows);

    if (!parsed) {
      unparsedInvoiceNumbers.push(invoice.invoiceNumber.trim());
      continue;
    }

    const parsedRows = parsedByMonth.get(month) ?? [];
    parsedRows.push({ invoice, parsed });
    parsedByMonth.set(month, parsedRows);

    const seqRows = bySequence.get(parsed.sequence) ?? [];
    seqRows.push({ invoice, parsed });
    bySequence.set(parsed.sequence, seqRows);

    const baseRows = byBaseNumber.get(parsed.baseNumber) ?? [];
    baseRows.push({ invoice, parsed });
    byBaseNumber.set(parsed.baseNumber, baseRows);

    if (!occupied.has(parsed.sequence)) {
      occupied.set(parsed.sequence, parsed);
    }
  }

  const duplicateSequenceSlots: DuplicateSequenceSlot[] = [...bySequence.entries()]
    .filter(([, rows]) => new Set(rows.map((row) => row.parsed.baseNumber)).size > 1)
    .map(([sequence, rows]) => ({
      sequence,
      baseNumbers: [...new Set(rows.map((row) => row.parsed.baseNumber))].sort(),
      invoiceNumbers: [...new Set(rows.map((row) => row.invoice.invoiceNumber.trim()))].sort(),
    }))
    .sort((a, b) => a.sequence - b.sequence);

  const duplicateBaseNumbers: DuplicateBaseNumber[] = [...byBaseNumber.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([baseNumber, rows]) => ({
      baseNumber,
      invoiceNumbers: [...new Set(rows.map((row) => row.invoice.invoiceNumber.trim()))].sort(),
    }))
    .sort((a, b) => a.baseNumber.localeCompare(b.baseNumber));

  const reissuedNumbers = detectReissuedNumbers(invoices);

  const sequences = [...occupied.keys()].sort((a, b) => a - b);
  const missingByMonth = new Map<string, string[]>();
  const missingNumbers: string[] = [];
  const missingSequenceSlots: MissingSequenceSlot[] = [];

  if (sequences.length > 0) {
    const minSeq = sequences[0]!;
    const maxSeq = sequences[sequences.length - 1]!;
    let previous = occupied.get(minSeq)!;

    for (let seq = minSeq; seq <= maxSeq; seq += 1) {
      const present = occupied.get(seq);
      if (present) {
        previous = present;
        continue;
      }
      const nextSeq = sequences.find((value) => value > seq);
      const next = nextSeq != null ? occupied.get(nextSeq) : undefined;
      const slot = inferMissingSequenceSlot(seq, previous, next);
      missingSequenceSlots.push(slot);
      missingNumbers.push(slot.likelyNumber);

      const parsedLikely = parseInvoiceNumber(slot.likelyNumber);
      const month = parsedLikely?.yearMonth ?? yearMonthFromStamp(previous.stamp);
      const bucket = missingByMonth.get(month) ?? [];
      bucket.push(slot.likelyNumber);
      missingByMonth.set(month, bucket);
    }
  }

  const monthKeys = new Set([...byMonth.keys(), ...missingByMonth.keys()]);
  const months = [...monthKeys].sort((a, b) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return a.localeCompare(b);
  });

  const monthReports: MonthContinuity[] = months.map((month) => {
    const rows = byMonth.get(month) ?? [];
    const parsedRows = parsedByMonth.get(month) ?? [];
    const voidedInvoices = rows.filter(isVoidedInvoice).map((invoice) => voidedRecord(invoice, month));
    return {
      month,
      lastInvoiceNumber: lastInvoiceNumber(rows, parsedRows),
      invoiceCount: rows.length,
      missingNumbers: missingByMonth.get(month) ?? [],
      voidedInvoices,
    };
  });

  const voidedInvoices = monthReports.flatMap((month) => month.voidedInvoices);
  const lastInvoiceNumberByMonth = Object.fromEntries(
    monthReports.map((month) => [month.month, month.lastInvoiceNumber]),
  );

  return {
    months: monthReports,
    lastInvoiceNumberByMonth,
    missingNumbers,
    missingSequenceSlots,
    voidedInvoices,
    duplicateSequenceSlots,
    duplicateBaseNumbers,
    reissuedNumbers,
    unparsedInvoiceNumbers,
    intact: missingNumbers.length === 0,
  };
}
