import type { ZodError } from "zod";
import type { ProposalPaymentScheduleItem, ProposalPhase } from "@workspace/db";

/** Recursively convert JSON `null` to `undefined` so Zod `.optional()` fields accept API payloads. */
export function stripNulls(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.map(stripNulls);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, stripNulls(nested)]),
    );
  }
  return value;
}

export function formatZodError(error: ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

export function paymentScheduleTotal(schedule: ProposalPaymentScheduleItem[]): number {
  return schedule.reduce((sum, row) => sum + (row.percentage || 0), 0);
}

export function validateProposalContentFields(input: {
  totalAmount?: number;
  scopePhases?: ProposalPhase[];
  paymentSchedule?: ProposalPaymentScheduleItem[];
  requireAmount?: boolean;
  requirePhases?: boolean;
  requirePayment?: boolean;
}): string[] {
  const issues: string[] = [];

  if (input.requireAmount || input.totalAmount !== undefined) {
    if ((input.totalAmount ?? 0) <= 0) {
      issues.push("Consultancy fee must be greater than 0");
    }
  }

  if (input.scopePhases !== undefined || input.requirePhases) {
    const phases = input.scopePhases ?? [];
    if (input.requirePhases && phases.length === 0) {
      issues.push("At least one scope phase is required");
    }
    phases.forEach((phase, index) => {
      if (!phase.description?.trim()) {
        issues.push(`Scope phase ${index + 1} needs a description`);
      }
      if (!(phase.deliverable ?? "").trim()) {
        issues.push(`Scope phase ${index + 1} needs a deliverable`);
      }
    });
  }

  if (input.paymentSchedule !== undefined || input.requirePayment) {
    const schedule = input.paymentSchedule ?? [];
    if (input.requirePayment && schedule.length === 0) {
      issues.push("At least one payment milestone is required");
    }
    if (schedule.length > 0) {
      schedule.forEach((row, index) => {
        if (!row.label?.trim()) {
          issues.push(`Payment milestone ${index + 1} needs a label`);
        }
      });
      if (paymentScheduleTotal(schedule) !== 100) {
        issues.push("Payment milestone percentages must total 100%");
      }
    }
  }

  return issues;
}

export function assertValidProposalContent(
  input: Parameters<typeof validateProposalContentFields>[0],
): void {
  const issues = validateProposalContentFields(input);
  if (issues.length > 0) {
    throw new Error(issues[0]);
  }
}
