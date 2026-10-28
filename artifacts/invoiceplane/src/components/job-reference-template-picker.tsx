import { Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProposalJobReference } from "@/lib/modulesApi";
import {
  JOB_REFERENCE_TEMPLATES,
  jobReferenceMatchesTemplate,
  templateToJobReference,
  type JobReferenceTemplate,
} from "@/lib/proposalJobReferenceTemplates";

type JobReferenceTemplatePickerProps = {
  jobReferences: ProposalJobReference[];
  onChange: (refs: ProposalJobReference[]) => void;
  onAddBlank?: () => void;
  className?: string;
};

function isTemplateSelected(template: JobReferenceTemplate, refs: ProposalJobReference[]): boolean {
  return refs.some((ref) => jobReferenceMatchesTemplate(ref, template));
}

export function JobReferenceTemplatePicker({
  jobReferences,
  onChange,
  onAddBlank,
  className,
}: JobReferenceTemplatePickerProps) {
  const toggleTemplate = (template: JobReferenceTemplate, checked: boolean) => {
    if (checked) {
      if (isTemplateSelected(template, jobReferences)) return;
      onChange([...jobReferences, templateToJobReference(template)]);
      return;
    }
    onChange(jobReferences.filter((ref) => !jobReferenceMatchesTemplate(ref, template)));
  };

  const selectedCount = jobReferences.length;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Select one or more past projects to include. Each reference can be customised on the next pages.
        </p>
        {selectedCount > 0 && (
          <span className="text-xs font-medium text-primary">
            {selectedCount} selected
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {JOB_REFERENCE_TEMPLATES.map((template) => {
          const checked = isTemplateSelected(template, jobReferences);
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
                <p className="text-xs text-muted-foreground line-clamp-3">{template.description}</p>
              </div>
            </label>
          );
        })}
      </div>

      {onAddBlank && (
        <Button type="button" variant="outline" size="sm" onClick={onAddBlank}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add blank reference
        </Button>
      )}
    </div>
  );
}
