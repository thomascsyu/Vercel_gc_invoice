/** Deterministic parsers for ISO consulting proposal text (cover + The Approach). */

export type ParsedApproachPhase = {
  phase: number;
  title: string;
  clientService: string;
  clientResponsibility: string;
  deliverable: string;
};

export type ParsedProposalFields = {
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  isoStandards: string[];
  proposedScopeOfCertification: string;
  stages: string[];
  clientService: string;
  clientResponsibilities: string;
  approachPhases: ParsedApproachPhase[];
  deliverables: string[];
  timeline: string;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ISO_RE = /\bISO(?:\s*\/\s*IEC)?\s*\d{4,5}(?:\s*:\s*\d{4})?\b/gi;
const PHONE_LABEL_RE =
  /(?:tel(?:ephone)?|phone|mobile|mob\.?|whatsapp)\s*[:.\-–]?\s*(\+?\d[\d\s\-()]{6,18}\d)/i;
const BARE_HK_PHONE_RE = /^(?:\+?852[\s-]?)?\d{4}[\s-]?\d{4}$/;
const COMPANY_NAME_RE =
  /\b(limited|ltd\.?|llc|inc\.?|co\.|company|corporation|corp\.|gmbh|plc|有限公司)\b/i;
const PERSON_PREFIX_RE = /^(mr\.?|mrs\.?|ms\.?|miss|dr\.?|prof\.?|ir\.?|sir)\b/i;
const COVER_END_RE =
  /^(proposal\s+issued|proposal\s+valid|contact\s*:|the\s+company|introduction|benefit of|page\s+\d)/i;

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeIso(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*:\s*/g, ":")
    .replace(/^ISO\//i, "ISO/")
    .replace(/^ISO(?=\s)/i, "ISO")
    .trim();
}

export function extractIsoStandards(text: string): string[] {
  const found = text.match(ISO_RE) ?? [];
  const normalized = found.map(normalizeIso);
  const versionedBases = new Set(
    normalized.filter((n) => n.includes(":")).map((n) => n.split(":")[0].toUpperCase()),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of normalized) {
    const key = n.toUpperCase();
    if (seen.has(key)) continue;
    const base = n.split(":")[0].toUpperCase();
    if (!n.includes(":") && versionedBases.has(base)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

function firstEmail(text: string): string {
  const m = text.match(EMAIL_RE);
  return m?.[0]?.trim() ?? "";
}

function looksLikePersonName(line: string): boolean {
  if (!line) return false;
  if (EMAIL_RE.test(line)) return false;
  if (PHONE_LABEL_RE.test(line) || BARE_HK_PHONE_RE.test(line.replace(/[()]/g, "").trim())) return false;
  if (COMPANY_NAME_RE.test(line) && !PERSON_PREFIX_RE.test(line)) return false;
  if (/^prepared\s+for/i.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 1 || words.length > 8) return false;
  if (line.length > 80) return false;
  return /[A-Za-z\u00C0-\u024F\u4E00-\u9FFF]/.test(line);
}

function extractPhoneFromLine(line: string): string {
  const labeled = line.match(PHONE_LABEL_RE);
  if (labeled?.[1]) return labeled[1].replace(/\s+/g, " ").trim();
  const stripped = line.replace(/[()]/g, "").trim();
  if (BARE_HK_PHONE_RE.test(stripped)) return line.trim();
  return "";
}

function sliceUntil(text: string, startRe: RegExp, endRe: RegExp): string {
  const start = text.search(startRe);
  if (start < 0) return "";
  const afterStart = text.slice(start);
  const headerEnd = afterStart.search(/\n/);
  const body = headerEnd >= 0 ? afterStart.slice(headerEnd + 1) : "";
  const end = body.search(endRe);
  return (end >= 0 ? body.slice(0, end) : body).trim();
}

export function extractProposedScope(text: string): string {
  const fromHeading = sliceUntil(
    text,
    /proposed\s+scope\s+of\s+certification\b/i,
    /\n\s*(remark\s*:|the\s+approach|consultancy\s+approach|project\s+timeline|optional\s+maintenance|our\s+clients|terms\s*(and|&)\s*conditions|fee|payment\s+schedule)\b/i,
  );
  if (fromHeading) {
    return fromHeading
      .replace(/^remark\s*:.*$/gim, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const introScope = text.match(/\bscope\s*:\s*([^\n]+(?:\n(?!\s*(address|staff|remark|the\s+approach)\b)[^\n]+)*)/i);
  if (introScope?.[1]) return introScope[1].trim();
  return "";
}

function extractTimeline(text: string): string {
  const block = sliceUntil(
    text,
    /project\s+timeline\b/i,
    /\n\s*(optional\s+maintenance|our\s+clients|terms\s*(and|&)\s*conditions|fee|payment\s+schedule|the\s+company)\b/i,
  );
  return block.replace(/\s+/g, " ").trim().slice(0, 800);
}

type LabelKind = "clientService" | "clientResponsibility" | "deliverable";

function matchPhaseLabel(line: string): { kind: LabelKind; rest: string } | null {
  const m = line.match(
    /^(client'?s?\s+services?|our\s+activities|consultancy\s+services?|our\s+services?|client'?s?\s+responsibilit(?:y|ies)|your\s+involvement|deliverables?|key\s+outcomes?)\s*[:.\-–]?\s*(.*)$/i,
  );
  if (!m) return null;
  const label = m[1].toLowerCase();
  const rest = (m[2] ?? "").trim();
  if (/responsibilit|involvement/.test(label)) return { kind: "clientResponsibility", rest };
  if (/deliverable|key\s+outcome/.test(label)) return { kind: "deliverable", rest };
  return { kind: "clientService", rest };
}

function parseApproachSection(text: string): ParsedApproachPhase[] {
  const approachStart = text.search(/\b(?:the\s+approach|consultancy\s+approach|our\s+approach)\b/i);
  if (approachStart < 0) return [];
  const rest = text.slice(approachStart);
  const cut = rest.search(
    /\n\s*(project\s+timeline|optional\s+maintenance|our\s+clients|terms\s*(and|&)\s*conditions|fee|payment\s+schedule)\b/i,
  );
  const section = cut >= 0 ? rest.slice(0, cut) : rest;
  const lines = linesOf(section);
  const phases: ParsedApproachPhase[] = [];
  let current: ParsedApproachPhase | null = null;
  let currentKind: LabelKind | null = null;

  const flushKind = () => {
    currentKind = null;
  };

  const phaseHeader = /^(?:phase\s*)(\d+)\s*[:.\-–]\s*(.+)$/i;

  for (const line of lines) {
    const header = line.match(phaseHeader);
    if (header) {
      if (current) phases.push(current);
      current = {
        phase: Number(header[1]),
        title: header[2].trim(),
        clientService: "",
        clientResponsibility: "",
        deliverable: "",
      };
      currentKind = null;
      continue;
    }
    if (!current) continue;
    if (/^(objective)\s*[:.]/i.test(line)) {
      flushKind();
      continue;
    }
    const labeled = matchPhaseLabel(line);
    if (labeled) {
      currentKind = labeled.kind;
      if (labeled.rest) {
        const prev = current[labeled.kind];
        current[labeled.kind] = prev ? `${prev}\n${labeled.rest}` : labeled.rest;
      }
      continue;
    }
    if (currentKind) {
      current[currentKind] = current[currentKind] ? `${current[currentKind]}\n${line}` : line;
    }
  }
  if (current) phases.push(current);
  return phases.map((p) => ({
    ...p,
    clientService: p.clientService.trim(),
    clientResponsibility: p.clientResponsibility.trim(),
    deliverable: p.deliverable.trim(),
  }));
}

export function extractCoverContact(coverText: string): {
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
} {
  const lines = linesOf(coverText);
  const preparedIdx = lines.findIndex((l) => /^prepared\s+for\b/i.test(l));
  const contactIdx = lines.findIndex((l) => /^contact\s*:/i.test(l));

  const blockStart = preparedIdx >= 0 ? preparedIdx : -1;
  let blockEnd = lines.length;
  if (blockStart >= 0) {
    for (let i = blockStart + 1; i < lines.length; i++) {
      if (COVER_END_RE.test(lines[i])) {
        blockEnd = i;
        break;
      }
      if (i > blockStart + 8) {
        blockEnd = i;
        break;
      }
    }
  }

  const preparedLines = blockStart >= 0 ? lines.slice(blockStart, blockEnd) : [];
  const preparedBlob = preparedLines.join("\n");

  let contactPerson = "";
  for (const line of preparedLines) {
    const afterLabel = line.replace(/^prepared\s+for\s*:?\s*/i, "").trim();
    const candidate = afterLabel || line;
    if (/^prepared\s+for\b/i.test(line) && !afterLabel) continue;
    if (looksLikePersonName(candidate)) {
      contactPerson = candidate;
      break;
    }
  }

  let contactEmail = firstEmail(preparedBlob);
  let contactPhone = "";
  for (const line of preparedLines) {
    const phone = extractPhoneFromLine(line);
    if (phone) {
      contactPhone = phone;
      break;
    }
  }

  // Fallback: a lone "Contact: Name" block on the cover when Prepared for has no person.
  if (!contactPerson && contactIdx >= 0) {
    const contactLine = lines[contactIdx].replace(/^contact\s*:?\s*/i, "").trim();
    const namePart = contactLine.split(",")[0]?.trim() ?? "";
    if (looksLikePersonName(namePart)) contactPerson = namePart;
    const trailing = lines.slice(contactIdx, contactIdx + 4).join("\n");
    if (!contactEmail) contactEmail = firstEmail(trailing);
    if (!contactPhone) {
      for (const line of lines.slice(contactIdx, contactIdx + 4)) {
        const phone = extractPhoneFromLine(line);
        if (phone) {
          contactPhone = phone;
          break;
        }
      }
    }
  }

  return { contactPerson, contactEmail, contactPhone };
}

export function parseProposalText(text: string, coverText?: string): ParsedProposalFields {
  const cover = coverText?.trim() || text.slice(0, 3500);
  const contact = extractCoverContact(cover);
  const approachPhases = parseApproachSection(text);
  const isoStandards = extractIsoStandards(`${cover}\n${text.slice(0, 8000)}`);
  const proposedScopeOfCertification = extractProposedScope(text);
  const stages = approachPhases.map((p) => (p.title ? `Phase ${p.phase}: ${p.title}` : `Phase ${p.phase}`));
  const clientService = approachPhases
    .map((p) => p.clientService)
    .filter(Boolean)
    .join("\n\n");
  const clientResponsibilities = approachPhases
    .map((p) => {
      if (!p.clientResponsibility) return "";
      return approachPhases.length > 1 ? `Phase ${p.phase}: ${p.clientResponsibility}` : p.clientResponsibility;
    })
    .filter(Boolean)
    .join("\n");
  const deliverables = approachPhases.map((p) => p.deliverable).filter(Boolean);
  return {
    ...contact,
    isoStandards,
    proposedScopeOfCertification,
    stages,
    clientService,
    clientResponsibilities,
    approachPhases,
    deliverables,
    timeline: extractTimeline(text),
  };
}
