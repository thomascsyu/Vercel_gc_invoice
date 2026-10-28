import { ScrollText } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function ProposalsDisabled() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <ScrollText className="h-12 w-12 text-muted-foreground mb-4" />
      <h1 className="text-2xl font-bold mb-2">Proposals module disabled</h1>
      <p className="text-muted-foreground mb-6 max-w-sm">
        The Proposals module is currently turned off. Existing proposal PDFs and client links keep
        working, but creating or editing proposals is unavailable.
      </p>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
