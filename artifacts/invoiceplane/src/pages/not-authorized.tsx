import { ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotAuthorized() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <ShieldAlert className="h-12 w-12 text-muted-foreground mb-4" />
      <h1 className="text-2xl font-bold mb-2">Not authorized</h1>
      <p className="text-muted-foreground mb-6 max-w-sm">
        This section is only available to administrators. If you need access, ask a workspace admin
        to update your role.
      </p>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
