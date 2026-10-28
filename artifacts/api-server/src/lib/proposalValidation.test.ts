import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  formatZodError,
  paymentScheduleTotal,
  stripNulls,
  validateProposalContentFields,
} from "./proposalValidation";

test("validateProposalContentFields rejects invalid payment totals", () => {
  const issues = validateProposalContentFields({
    totalAmount: 1000,
    paymentSchedule: [
      { label: "Deposit", percentage: 50 },
      { label: "Final", percentage: 40 },
    ],
    requirePayment: true,
  });
  assert.ok(issues.some((issue) => issue.includes("100%")));
});

test("validateProposalContentFields requires phase deliverables", () => {
  const issues = validateProposalContentFields({
    scopePhases: [
      {
        phase: 1,
        title: "Phase 1",
        description: "Do work",
        deliverable: "",
        weeks: 4,
        startMonth: 1,
        spanMonths: 1,
      },
    ],
    requirePhases: true,
  });
  assert.ok(issues.some((issue) => issue.includes("deliverable")));
});

test("paymentScheduleTotal sums milestone percentages", () => {
  assert.equal(
    paymentScheduleTotal([
      { label: "A", percentage: 25 },
      { label: "B", percentage: 75 },
    ]),
    100,
  );
});

test("stripNulls converts null optional fields so Zod accepts them", () => {
  const schema = z.object({ termsConditions: z.string().optional() });
  const parsed = schema.safeParse(stripNulls({ termsConditions: null }));
  assert.equal(parsed.success, true);
});

test("formatZodError joins issue messages", () => {
  const result = z.object({ clientId: z.string().uuid() }).safeParse({ clientId: "not-a-uuid" });
  assert.ok(!result.success);
  assert.ok(formatZodError(result.error).length > 0);
});
