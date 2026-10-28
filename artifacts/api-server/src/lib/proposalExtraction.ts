import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { z } from "zod/v4";
import { renderApproachPhase } from "./proposalTemplateVars";
import { parseProposalText, extractIsoStandards, type ParsedApproachPhase } from "./proposalExtractionParse";

function linesFromUnknown(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") {
    return v
      .split(/\n|;|,/)
      .map((s) => s.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean);
  }
  return [];
}

const ApproachPhaseSchema = z
  .object({
    phase: z.coerce.number().int().optional(),
    title: z.coerce.string().optional().default(""),
    clientService: z.coerce.string().optional().default(""),
    clientResponsibility: z.coerce.string().optional().default(""),
    deliverable: z.coerce.string().optional().default(""),
  })
  .transform((p) => ({
    phase: p.phase && p.phase > 0 ? p.phase : 0,
    title: p.title.trim(),
    clientService: p.clientService.trim(),
    clientResponsibility: p.clientResponsibility.trim(),
    deliverable: p.deliverable.trim(),
  }));

const ProposalFieldsSchema = z.object({
  contactPerson: z.coerce.string().optional().default(""),
  contactEmail: z.coerce.string().optional().default(""),
  contactPhone: z.coerce.string().optional().default(""),
  isoStandards: z.unknown().optional().transform(linesFromUnknown),
  proposedScopeOfCertification: z.coerce.string().optional().default(""),
  stages: z.unknown().optional().transform(linesFromUnknown),
  scopeOfService: z.coerce.string().optional().default(""),
  clientService: z.coerce.string().optional().default(""),
  clientResponsibilities: z.coerce.string().optional().default(""),
  approachPhases: z
    .unknown()
    .optional()
    .transform((v) => {
      if (!Array.isArray(v)) return [] as ParsedApproachPhase[];
      return v.flatMap((item, i) => {
        const parsed = ApproachPhaseSchema.safeParse(item);
        if (!parsed.success) return [];
        const phase = parsed.data.phase > 0 ? parsed.data.phase : i + 1;
        return [{ ...parsed.data, phase }];
      });
    }),
  deliverables: z.unknown().optional().transform(linesFromUnknown),
  timeline: z.coerce.string().optional().default(""),
});

export type ProposalExtractionFields = z.infer<typeof ProposalFieldsSchema>;
export type ProposalApproachPhase = ParsedApproachPhase;

export function emptyExtractionFields(): ProposalExtractionFields {
  return {
    contactPerson: "",
    contactEmail: "",
    contactPhone: "",
    isoStandards: [],
    proposedScopeOfCertification: "",
    stages: [],
    scopeOfService: "",
    clientService: "",
    clientResponsibilities: "",
    approachPhases: [],
    deliverables: [],
    timeline: "",
  };
}

function pickText(...candidates: Array<string | undefined | null>): string {
  for (const c of candidates) {
    const t = (c ?? "").trim();
    if (t) return t;
  }
  return "";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function mergeExtractionFields(
  base: ProposalExtractionFields,
  overlay?: ProposalExtractionFields | null,
): ProposalExtractionFields {
  if (!overlay) return base;
  const baseApproachHasContent = base.approachPhases.some(
    (p) => p.clientService || p.deliverable || p.clientResponsibility || p.title,
  );
  const approachPhases = baseApproachHasContent ? base.approachPhases : overlay.approachPhases;
  return {
    contactPerson: pickText(base.contactPerson, overlay.contactPerson),
    contactEmail: pickText(base.contactEmail, overlay.contactEmail),
    contactPhone: pickText(base.contactPhone, overlay.contactPhone),
    isoStandards: extractIsoStandards([...base.isoStandards, ...overlay.isoStandards].join(" ")),
    proposedScopeOfCertification: pickText(
      base.proposedScopeOfCertification,
      overlay.proposedScopeOfCertification,
    ),
    stages: uniqueStrings(base.stages.length ? base.stages : overlay.stages),
    scopeOfService: pickText(base.scopeOfService, overlay.scopeOfService),
    clientService: pickText(base.clientService, overlay.clientService),
    clientResponsibilities: pickText(base.clientResponsibilities, overlay.clientResponsibilities),
    approachPhases,
    deliverables: uniqueStrings(base.deliverables.length ? base.deliverables : overlay.deliverables),
    timeline: pickText(base.timeline, overlay.timeline),
  };
}

function parsedToFields(parsed: ReturnType<typeof parseProposalText>): ProposalExtractionFields {
  return {
    ...emptyExtractionFields(),
    contactPerson: parsed.contactPerson,
    contactEmail: parsed.contactEmail,
    contactPhone: parsed.contactPhone,
    isoStandards: parsed.isoStandards,
    proposedScopeOfCertification: parsed.proposedScopeOfCertification,
    stages: parsed.stages,
    scopeOfService: parsed.proposedScopeOfCertification,
    clientService: parsed.clientService,
    clientResponsibilities: parsed.clientResponsibilities,
    approachPhases: parsed.approachPhases,
    deliverables: parsed.deliverables,
    timeline: parsed.timeline,
  };
}

export function extractProposalFieldsFromText(text: string, coverText?: string): ProposalExtractionFields {
  return parsedToFields(parseProposalText(text, coverText));
}

function extensionLower(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export async function extractTextFromProposalBuffer(
  buffer: Buffer,
  opts: { mimetype?: string; originalname?: string },
): Promise<{ text: string; coverText: string } | { error: string }> {
  const ext = extensionLower(opts.originalname ?? "");
  const mt = (opts.mimetype ?? "").toLowerCase();

  if (mt.includes("pdf") || ext === "pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      await parser.destroy();
      const text = (result.text ?? "").trim();
      if (!text) return { error: "No readable text found in the PDF (it may be scanned images only)." };
      const pages = (result as { pages?: Array<{ text?: string }> }).pages;
      const coverText = (pages?.[0]?.text ?? text.slice(0, 3500)).trim();
      return { text, coverText };
    } catch (e) {
      await parser.destroy().catch(() => {});
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `Failed to read PDF: ${msg}` };
    }
  }

  if (
    mt.includes("wordprocessingml") ||
    mt.includes("officedocument") ||
    ext === "docx"
  ) {
    try {
      const { value } = await mammoth.extractRawText({ buffer });
      const text = (value ?? "").trim();
      if (!text) return { error: "No text extracted from the Word document." };
      return { text, coverText: text.slice(0, 3500) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: `Failed to read DOCX: ${msg}` };
    }
  }

  if (mt.startsWith("text/") || ext === "txt") {
    const text = buffer.toString("utf8").trim();
    if (!text) return { error: "The text file is empty." };
    return { text, coverText: text.slice(0, 3500) };
  }

  return {
    error: "Unsupported file type. Upload a PDF (.pdf), Word document (.docx), or plain text (.txt).",
  };
}

function formatApproachPhase(p: ParsedApproachPhase): string[] {
  const lines: string[] = [];
  const heading = p.title ? `Phase ${p.phase}: ${p.title}` : `Phase ${p.phase}`;
  lines.push(heading);
  if (p.clientService.trim()) {
    lines.push(`Client service: ${p.clientService.trim()}`);
  }
  if (p.clientResponsibility.trim()) {
    lines.push(`Client responsibility: ${p.clientResponsibility.trim()}`);
  }
  if (p.deliverable.trim()) {
    lines.push(`Deliverable: ${p.deliverable.trim()}`);
  }
  return lines;
}

function buildNotesFromFields(f: ProposalExtractionFields): string {
  const lines: string[] = [];
  lines.push("Proposal summary");
  lines.push("");

  const contactBits = [
    f.contactPerson.trim() ? `Contact person: ${f.contactPerson.trim()}` : "",
    f.contactEmail.trim() ? `Email: ${f.contactEmail.trim()}` : "",
    f.contactPhone.trim() ? `Telephone: ${f.contactPhone.trim()}` : "",
  ].filter(Boolean);
  if (contactBits.length) {
    lines.push(...contactBits);
    lines.push("");
  }

  if (f.isoStandards.length) {
    lines.push(`ISO standard: ${f.isoStandards.join(", ")}`);
    lines.push("");
  }

  const scope = pickText(f.proposedScopeOfCertification, f.scopeOfService);
  if (scope) {
    lines.push("Proposed scope of certification");
    lines.push(scope);
    lines.push("");
  }

  if (f.approachPhases.length) {
    lines.push("The Approach");
    for (const phase of f.approachPhases) {
      lines.push(...formatApproachPhase(phase));
      lines.push("");
    }
  } else {
    if (f.stages.length) {
      lines.push("Stages");
      for (const s of f.stages) lines.push(`- ${s}`);
      lines.push("");
    }

    if (f.clientService.trim()) {
      lines.push("Client service");
      lines.push(f.clientService.trim());
      lines.push("");
    }

    if (f.clientResponsibilities.trim()) {
      lines.push("Client responsibilities");
      lines.push(f.clientResponsibilities.trim());
      lines.push("");
    }

    if (f.deliverables.length) {
      lines.push("Deliverables:");
      for (const d of f.deliverables) lines.push(`- ${d}`);
      lines.push("");
    }
  }

  if (f.timeline.trim()) {
    lines.push("Timeline:");
    lines.push(f.timeline.trim());
  }

  return lines.join("\n").trim();
}

/** Fine-print block for the first line item's `details` field. */
export function buildDetailsFromFields(f: ProposalExtractionFields): string {
  const lines: string[] = [];

  if (f.approachPhases.length) {
    for (let i = 0; i < f.approachPhases.length; i++) {
      if (i > 0) lines.push("");
      lines.push(...formatApproachPhase(f.approachPhases[i]));
    }
    return lines.join("\n").trim();
  }

  if (f.stages.length) {
    lines.push("Stages");
    for (const s of f.stages) lines.push(`- ${s}`);
    lines.push("");
  }

  if (f.clientService.trim()) {
    lines.push("Client service");
    lines.push(f.clientService.trim());
    lines.push("");
  }

  if (f.clientResponsibilities.trim()) {
    lines.push("Client responsibilities");
    lines.push(f.clientResponsibilities.trim());
    lines.push("");
  }

  if (f.deliverables.length || f.timeline.trim()) {
    lines.push("Deliverables & timeline");
    if (f.deliverables.length) {
      for (const d of f.deliverables) lines.push(`- ${d}`);
    }
    if (f.timeline.trim()) {
      if (f.deliverables.length) lines.push("");
      lines.push(f.timeline.trim());
    }
  }

  return lines.join("\n").trim();
}

export type ProposalExtractionLineItem = {
  name: string;
  description: string;
  details: string;
};

function consultingTitle(isoStandards: string[]): string {
  if (!isoStandards.length) return "";
  return `${isoStandards.join(" / ")} consulting`;
}

/** Map extracted proposal fields onto job-order line item title, description, and details. */
export function buildLineItemFromFields(f: ProposalExtractionFields): ProposalExtractionLineItem {
  const description = pickText(f.proposedScopeOfCertification, f.scopeOfService);
  const details = buildDetailsFromFields(f);
  const scopeTitle = description.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const name =
    consultingTitle(f.isoStandards) ||
    f.stages[0]?.trim() ||
    scopeTitle.slice(0, 500) ||
    "Consulting services";
  return { name, description, details };
}

export function finalizeExtraction(fields: ProposalExtractionFields): {
  fields: ProposalExtractionFields;
  notes: string;
  lineItem: ProposalExtractionLineItem;
} {
  return { fields, notes: buildNotesFromFields(fields), lineItem: buildLineItemFromFields(fields) };
}

/** Map an in-app proposal document to job-order extraction fields (no AI). */
export function fieldsFromProposalDocument(input: {
  client?: {
    contactPerson?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  isoStandards?: string[] | null;
  proposalScope?: string | null;
  scopePhases?: Array<{
    phase: number;
    title: string;
    description: string;
    deliverable?: string;
    weeks?: number;
  }>;
  paymentSchedule?: Array<{ label: string; percentage: number }>;
  vars?: Record<string, string>;
}): ProposalExtractionFields {
  const phases = input.scopePhases ?? [];
  const approachPhases: ParsedApproachPhase[] = phases.map((p, i) => {
    const rendered = input.vars
      ? renderApproachPhase(i, input.vars, {
          title: p.title,
          description: p.description,
          deliverable: p.deliverable,
        })
      : null;
    const byLabel = (label: string) =>
      rendered?.blocks.find((b) => b.label.toLowerCase() === label.toLowerCase())?.text?.trim() ?? "";
    return {
      phase: p.phase || i + 1,
      title: (rendered?.title || p.title || "").trim(),
      clientService: (rendered ? byLabel("Our Activities") : p.description)?.trim() || p.description?.trim() || "",
      clientResponsibility: rendered ? byLabel("Your Involvement") : "",
      deliverable: (rendered ? byLabel("Key Outcome") : p.deliverable)?.trim() || p.deliverable?.trim() || "",
    };
  });

  const schedule = input.paymentSchedule ?? [];
  const timeline = [
    ...phases.map((p) => {
      const weeks = p.weeks != null ? ` (${p.weeks} weeks)` : "";
      return `Phase ${p.phase}: ${p.title}${weeks}`;
    }),
    ...schedule.map((row) => `${row.label}: ${row.percentage}%`),
  ].join("\n");

  const isoStandards = uniqueStrings(input.isoStandards ?? []);
  const scope = (input.proposalScope ?? "").trim();

  return {
    contactPerson: (input.client?.contactPerson ?? "").trim(),
    contactEmail: (input.client?.email ?? "").trim(),
    contactPhone: (input.client?.phone ?? "").trim(),
    isoStandards,
    proposedScopeOfCertification: scope,
    stages: approachPhases.map((p) => (p.title ? `Phase ${p.phase}: ${p.title}` : `Phase ${p.phase}`)),
    scopeOfService: scope,
    clientService: approachPhases.map((p) => p.clientService).filter(Boolean).join("\n\n"),
    clientResponsibilities: approachPhases
      .map((p) => (p.clientResponsibility ? `Phase ${p.phase}: ${p.clientResponsibility}` : ""))
      .filter(Boolean)
      .join("\n"),
    approachPhases,
    deliverables: approachPhases.map((p) => p.deliverable).filter(Boolean),
    timeline,
  };
}

/** Build plain text from an in-app proposal document for DeepSeek extraction. */
export function buildProposalDocumentText(input: {
  proposalNo: string;
  proposalRevision: number;
  clientName?: string | null;
  clientContactName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  proposalScope?: string | null;
  isoStandards?: string[];
  scopePhases?: Array<{
    phase: number;
    title: string;
    description: string;
    deliverable?: string;
    weeks: number;
    clientService?: string;
    clientResponsibility?: string;
  }>;
  paymentSchedule?: Array<{ label: string; percentage: number }>;
  firmIntro?: string | null;
  termsConditions?: string | null;
  totalAmount?: number | string;
  currency?: string;
}): string {
  const lines: string[] = [];
  lines.push("CONSULTING PROPOSAL");
  lines.push(`Proposal ${input.proposalNo} Revision ${input.proposalRevision}`);
  if (input.isoStandards?.length) lines.push(input.isoStandards.join(", "));
  lines.push("Prepared for:");
  if (input.clientContactName?.trim()) lines.push(input.clientContactName.trim());
  if (input.clientName) lines.push(input.clientName);
  if (input.clientPhone?.trim()) lines.push(`Tel: ${input.clientPhone.trim()}`);
  if (input.clientEmail?.trim()) lines.push(`Email: ${input.clientEmail.trim()}`);
  if (input.currency && input.totalAmount != null) {
    lines.push(`Fee: ${input.currency} ${input.totalAmount}`);
  }
  lines.push("");

  if (input.firmIntro?.trim()) {
    lines.push("Consultant firm background");
    lines.push(input.firmIntro.trim());
    lines.push("");
  }

  if (input.proposalScope?.trim()) {
    lines.push("Proposed scope of Certification");
    lines.push(input.proposalScope.trim());
    lines.push("");
  }

  if (input.isoStandards?.length) {
    lines.push(`ISO Standard: ${input.isoStandards.join(", ")}`);
    lines.push("");
  }

  const phases = input.scopePhases ?? [];
  if (phases.length) {
    lines.push("The Approach");
    for (const p of phases) {
      lines.push(`Phase ${p.phase}: ${p.title} (${p.weeks} weeks)`);
      const service = p.clientService?.trim() || p.description?.trim();
      if (service) {
        lines.push("Client Service:");
        lines.push(service);
      }
      if (p.clientResponsibility?.trim()) {
        lines.push("Client responsibility:");
        lines.push(p.clientResponsibility.trim());
      }
      if (p.deliverable?.trim()) {
        lines.push("Deliverable:");
        lines.push(p.deliverable.trim());
      }
      lines.push("");
    }
  }

  const schedule = input.paymentSchedule ?? [];
  if (schedule.length) {
    lines.push("Payment schedule / milestones");
    for (const row of schedule) {
      lines.push(`- ${row.label}: ${row.percentage}%`);
    }
    lines.push("");
  }

  if (input.termsConditions?.trim()) {
    lines.push("Terms and conditions");
    lines.push(input.termsConditions.trim());
  }

  return lines.join("\n").trim();
}

const MAX_CHARS_FOR_MODEL = 100_000;

export async function extractProposalFieldsWithDeepSeek(
  proposalText: string,
  apiKey: string,
  model: string,
  apiBase: string,
  coverText?: string,
): Promise<
  { fields: ProposalExtractionFields; notes: string; lineItem: ProposalExtractionLineItem } | { error: string; detail?: string }
> {
  const base = apiBase.replace(/\/$/, "");
  const trimmed = proposalText.length > MAX_CHARS_FOR_MODEL ? proposalText.slice(0, MAX_CHARS_FOR_MODEL) : proposalText;
  const cover = (coverText ?? trimmed.slice(0, 3500)).trim();

  const system = `You extract structured information from ISO consulting / certification proposals for a job order.
Return a single JSON object with these keys only (use empty string or empty array if not found):

Cover page (first page, "Prepared for"):
- "contactPerson": the client contact person named under "Prepared for" on the cover. Do not use the consultancy firm's sales "Contact:" block if a Prepared-for person is present.
- "contactEmail": that person's email when it appears on the cover (often omitted).
- "contactPhone": that person's telephone when it appears on the cover (often omitted). Empty string if none.

Body:
- "isoStandards": string[] — ISO standards (e.g. "ISO 9001:2015", "ISO 14001:2015", "ISO/IEC 27001:2022").
- "proposedScopeOfCertification": string — the proposed scope of certification (heading "Proposed scope of Certification", or Introduction "Scope:").
- "scopeOfService": string — same as proposed scope if no separate scope-of-service narrative.
- "clientService": string — overall consulting services offered to the client.
- "clientResponsibilities": string — what the client must provide or do; empty string if none.
- "stages": string[] — project phases or stages.
- "approachPhases": array of { "phase": number, "title": string, "clientService": string, "clientResponsibility": string, "deliverable": string } from the section titled "The Approach" (also "Consultancy approach"). For each phase:
  - clientService: text labeled "Client Service", "Our Activities", or "Consultancy service"
  - clientResponsibility: "Client responsibility", "Client's responsibility", or "Your Involvement" (empty if none)
  - deliverable: "Deliverable(s)" or "Key Outcome" (empty if none)
- "deliverables": string[] — concrete outputs; prefer per-phase deliverables.
- "timeline": string — schedule, milestones, or duration in plain text.

Respond with valid JSON only, no markdown fences.`;

  const user = `Cover page text:\n\n${cover}\n\nFull proposal text:\n\n${trimmed}`;

  try {
    const r = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "deepseek-v4-flashas",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!r.ok) {
      const detail = (await r.text()).slice(0, 800);
      return { error: `DeepSeek request failed (${r.status})`, detail };
    }

    const data = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) return { error: "Empty response from DeepSeek." };

    let jsonStr = raw;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence?.[1]) jsonStr = fence[1].trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return { error: "DeepSeek did not return valid JSON.", detail: raw.slice(0, 500) };
    }

    const fields = ProposalFieldsSchema.safeParse(parsed);
    if (!fields.success) {
      return { error: "Could not parse extraction result.", detail: fields.error.message };
    }

    return finalizeExtraction(fields.data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `DeepSeek request error: ${msg}` };
  }
}

export async function extractProposalFieldsForJobOrder(input: {
  text: string;
  coverText?: string;
  apiKey?: string;
  model?: string;
  apiBase?: string;
}): Promise<
  | { fields: ProposalExtractionFields; notes: string; lineItem: ProposalExtractionLineItem; source: string }
  | { error: string; detail?: string }
> {
  const heuristic = extractProposalFieldsFromText(input.text, input.coverText);
  const apiKey = (input.apiKey ?? "").trim();
  if (!apiKey) {
    return { ...finalizeExtraction(heuristic), source: "heuristic" };
  }

  const ai = await extractProposalFieldsWithDeepSeek(
    input.text,
    apiKey,
    input.model || "deepseek-v4-flashas",
    input.apiBase || "https://api.deepseek.com",
    input.coverText,
  );
  if ("error" in ai) {
    if (heuristic.contactPerson || heuristic.isoStandards.length || heuristic.approachPhases.length || heuristic.proposedScopeOfCertification) {
      return { ...finalizeExtraction(heuristic), source: "heuristic" };
    }
    return ai;
  }

  const merged = mergeExtractionFields(heuristic, ai.fields);
  return { ...finalizeExtraction(merged), source: "merged" };
}
