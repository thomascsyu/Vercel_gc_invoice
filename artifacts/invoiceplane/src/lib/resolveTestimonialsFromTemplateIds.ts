import {
  TESTIMONIAL_TEMPLATES,
  templateToTestimonial,
} from "@/lib/proposalTestimonialTemplates";
import type { ProposalTestimonial } from "@/lib/proposals-api";

export function resolveTestimonialsFromTemplateIds(
  ids: string[] | undefined,
): ProposalTestimonial[] {
  if (!ids?.length) return [];
  return ids
    .map((id) => TESTIMONIAL_TEMPLATES.find((template) => template.id === id))
    .filter((template): template is NonNullable<typeof template> => Boolean(template))
    .map((template) => templateToTestimonial(template));
}
