import {
  JOB_REFERENCE_TEMPLATES,
  templateToJobReference,
} from "@/lib/proposalJobReferenceTemplates";
import type { ProposalJobReference } from "@/lib/proposals-api";

export function resolveJobReferencesFromTemplateIds(
  ids: string[] | undefined,
): ProposalJobReference[] {
  if (!ids?.length) return [];
  return ids
    .map((id) => JOB_REFERENCE_TEMPLATES.find((template) => template.id === id))
    .filter((template): template is NonNullable<typeof template> => Boolean(template))
    .map((template) => templateToJobReference(template));
}
