import { Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProposalTestimonial } from "@/lib/modulesApi";
import {
  TESTIMONIAL_TEMPLATES,
  templateToTestimonial,
  testimonialMatchesTemplate,
  type TestimonialTemplate,
} from "@/lib/proposalTestimonialTemplates";

type TestimonialTemplatePickerProps = {
  testimonials: ProposalTestimonial[];
  onChange: (testimonials: ProposalTestimonial[]) => void;
  onAddBlank?: () => void;
  className?: string;
};

function isTemplateSelected(template: TestimonialTemplate, testimonials: ProposalTestimonial[]): boolean {
  return testimonials.some((item) => testimonialMatchesTemplate(item, template));
}

export function TestimonialTemplatePicker({
  testimonials,
  onChange,
  onAddBlank,
  className,
}: TestimonialTemplatePickerProps) {
  const toggleTemplate = (template: TestimonialTemplate, checked: boolean) => {
    if (checked) {
      if (isTemplateSelected(template, testimonials)) return;
      onChange([...testimonials, templateToTestimonial(template)]);
      return;
    }
    onChange(testimonials.filter((item) => !testimonialMatchesTemplate(item, template)));
  };

  const selectedCount = testimonials.length;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Select client quotes to include. Each testimonial can be customised on the next pages.
        </p>
        {selectedCount > 0 && (
          <span className="text-xs font-medium text-primary">
            {selectedCount} selected
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {TESTIMONIAL_TEMPLATES.map((template) => {
          const checked = isTemplateSelected(template, testimonials);
          return (
            <label
              key={template.id}
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
                checked ? "border-primary bg-primary/5" : "hover:bg-muted/40",
              )}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(value) => toggleTemplate(template, value === true)}
                className="mt-0.5"
              />
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{template.label}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {template.industry}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-3">{template.quote}</p>
                <p className="text-[10px] text-muted-foreground">
                  {template.authorName}, {template.authorTitle} — {template.companyName}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      {onAddBlank && (
        <Button type="button" variant="outline" size="sm" onClick={onAddBlank}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add blank testimonial
        </Button>
      )}
    </div>
  );
}
