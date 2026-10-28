import type { ProposalPhase } from "@/lib/modulesApi";
import { cn } from "@/lib/utils";

const TOTAL_MONTHS = 6;
const BAR_COLOR = "bg-primary/70";

type ProposalGanttPreviewProps = {
  phases: ProposalPhase[];
  className?: string;
};

export function ProposalGanttPreview({ phases, className }: ProposalGanttPreviewProps) {
  if (!phases.length) {
    return <p className="text-sm text-muted-foreground">Add scope phases to see the timeline.</p>;
  }

  const totalWeeks = phases.reduce((sum, p) => sum + (p.weeks || 0), 0);

  return (
    <div className={cn("rounded-lg border overflow-hidden text-xs", className)}>
      <div className="bg-muted/60 px-3 py-2 flex items-center justify-between gap-2 border-b">
        <span className="font-medium">Project timeline (6-month view)</span>
        <span className="text-muted-foreground tabular-nums">{totalWeeks} weeks total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left font-medium px-3 py-2 w-[38%]">Phase</th>
              <th className="text-right font-medium px-2 py-2 w-12">Wks</th>
              {Array.from({ length: TOTAL_MONTHS }, (_, i) => (
                <th key={i} className="text-center font-medium px-1 py-2 w-[10%]">
                  M{i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {phases.map((phase) => (
              <tr key={phase.phase} className="border-b last:border-0">
                <td className="px-3 py-2 align-middle">
                  <span className="font-medium">Phase {phase.phase}</span>
                  <span className="text-muted-foreground"> — {phase.title}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{phase.weeks}</td>
                {Array.from({ length: TOTAL_MONTHS }, (_, i) => {
                  const month = i + 1;
                  const active = month >= phase.startMonth && month < phase.startMonth + phase.spanMonths;
                  return (
                    <td key={month} className="px-1 py-2 align-middle">
                      <div className="h-5 rounded-sm bg-muted/40 relative">
                        {active ? (
                          <div
                            className={cn("absolute inset-y-0.5 inset-x-0.5 rounded-sm", BAR_COLOR)}
                            title={`${phase.title} (month ${month})`}
                          />
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
