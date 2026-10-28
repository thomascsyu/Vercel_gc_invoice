import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Shield, Building2, BarChart3, Receipt } from "lucide-react";
import { useAuthSession } from "@/context/auth-session";
import { Spinner } from "@/components/ui/spinner";

const GOOGLE_OAUTH_START_PATH = "/api/auth/google";

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: session, isLoading } = useAuthSession();

  useEffect(() => {
    if (!isLoading && session) setLocation("/dashboard");
  }, [isLoading, session, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="size-8 text-primary" />
      </div>
    );
  }

  if (session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="size-8 text-primary" />
      </div>
    );
  }

  const currentUrl = typeof window !== "undefined" ? window.location.origin : "";
  const googleHref = `${currentUrl}${GOOGLE_OAUTH_START_PATH}?next=/dashboard`;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold tracking-tight">GC-INV</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login">
              <Button>Sign in</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 sm:px-6 lg:px-8 py-24">
        <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight text-foreground mb-6 max-w-4xl">
          Internal invoice control for your team.
        </h1>
        <p className="text-xl text-muted-foreground mb-10 max-w-2xl">
          Manage clients, invoices, quotations, and payments in one high-performance workspace.
        </p>
        <div className="flex flex-col items-center gap-4">
          <Link href="/login">
            <Button size="lg" className="h-14 px-8 text-lg rounded-full">
              Sign in
            </Button>
          </Link>
          <a
            href={googleHref}
            className="flex h-12 items-center justify-center gap-3 rounded-full border border-zinc-300 bg-white px-6 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </a>
        </div>

        <div className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl w-full text-left">
          <div className="p-6 rounded-2xl bg-card border">
            <Building2 className="h-10 w-10 text-primary mb-4" />
            <h3 className="text-xl font-semibold mb-2">Internal Workspace</h3>
            <p className="text-muted-foreground">Built for finance and operations teams who need reliable invoicing workflows.</p>
          </div>
          <div className="p-6 rounded-2xl bg-card border">
            <BarChart3 className="h-10 w-10 text-primary mb-4" />
            <h3 className="text-xl font-semibold mb-2">Real-time Insights</h3>
            <p className="text-muted-foreground">Track outstanding balances, revenue, and recent activity instantly on your dashboard.</p>
          </div>
          <div className="p-6 rounded-2xl bg-card border">
            <Shield className="h-10 w-10 text-primary mb-4" />
            <h3 className="text-xl font-semibold mb-2">Focused Control</h3>
            <p className="text-muted-foreground">Role-based admin tools for company settings and user management.</p>
          </div>
        </div>
      </main>

      <footer className="border-t py-8 text-center text-muted-foreground text-sm">
        <p>&copy; {new Date().getFullYear()} Gabriel Consultant Limited.</p>
      </footer>
    </div>
  );
}
