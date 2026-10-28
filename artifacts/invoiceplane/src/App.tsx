import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { AuthSessionProvider, useAuthSession } from "@/context/auth-session";
import NotFound from "@/pages/not-found";
import NotAuthorized from "@/pages/not-authorized";
import { Spinner } from "@/components/ui/spinner";

import Home from "@/pages/home";
import LoginPage from "@/pages/login";
import QuotationPreview from "@/pages/quotation-preview";
import InvoicePreview from "@/pages/invoice-preview";
import ProposalPreview from "@/pages/proposal-preview";
import ProposalsDisabled from "@/pages/proposals-disabled";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const Clients = lazy(() => import("@/pages/clients"));
const Invoices = lazy(() => import("@/pages/invoices"));
const Quotations = lazy(() => import("@/pages/quotations"));
const Payments = lazy(() => import("@/pages/payments"));
const Consultants = lazy(() => import("@/pages/consultants"));
const ConsultantPerformance = lazy(
  () => import("@/pages/consultant-performance"),
);
const JobOrders = lazy(() => import("@/pages/job-orders"));
const DocumentLayouts = lazy(() => import("@/pages/document-layouts"));
const RecurringInvoices = lazy(() => import("@/pages/recurring-invoices"));
const AdminPage = lazy(() => import("@/pages/admin"));
const Receipts = lazy(() => import("@/pages/receipts"));

import AppLayout from "@/components/layout/app-layout";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * Vite `base: "./"` yields `BASE_URL` of `./` so asset URLs stay relative. Wouter
 * treats a non-empty `base` as a URL prefix; `.` does not match `/`, so every
 * route fails and `<Switch>` renders nothing (blank home). Normalize to `""`.
 */
const rawBase = import.meta.env.BASE_URL.replace(/\/$/, "");
const basePath = rawBase === "." || rawBase === "./" ? "" : rawBase;

function ProtectedRoute({
  component: Component,
  adminOnly,
  suspense = false,
}: {
  component: React.ComponentType;
  adminOnly?: boolean;
  suspense?: boolean;
}) {
  const { data, isLoading, error } = useAuthSession();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="size-8 text-primary" />
      </div>
    );
  }

  if (error || !data) {
    const currentPath =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/dashboard";
    return <Redirect to={`/login?next=${encodeURIComponent(currentPath)}`} />;
  }

  if (adminOnly && data.role !== "admin") {
    return (
      <AppLayout>
        <NotAuthorized />
      </AppLayout>
    );
  }

  const page = (
    <AppLayout>
      <Component />
    </AppLayout>
  );

  if (!suspense) return page;

  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner className="size-8 text-primary" />
        </div>
      }
    >
      {page}
    </Suspense>
  );
}

function AppRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/login" component={LoginPage} />

          <Route path="/dashboard">
            <ProtectedRoute component={Dashboard} suspense />
          </Route>
          <Route path="/clients">
            <ProtectedRoute component={Clients} suspense />
          </Route>
          <Route path="/invoices">
            <ProtectedRoute component={Invoices} suspense />
          </Route>
          <Route path="/quotations">
            <ProtectedRoute component={Quotations} suspense />
          </Route>
          <Route path="/payments">
            <ProtectedRoute component={Payments} suspense />
          </Route>
          <Route path="/consultants/performance">
            <ProtectedRoute component={ConsultantPerformance} suspense />
          </Route>
          <Route path="/consultants/settings">
            <ProtectedRoute component={Consultants} suspense />
          </Route>
          <Route path="/consultants">
            <Redirect to="/consultants/settings" />
          </Route>
          <Route path="/job-orders">
            <ProtectedRoute component={JobOrders} suspense />
          </Route>
          <Route path="/proposals">
            <ProtectedRoute component={ProposalsDisabled} />
          </Route>
          <Route path="/proposals/new">
            <ProtectedRoute component={ProposalsDisabled} />
          </Route>
          <Route path="/proposals/:id/build">
            <ProtectedRoute component={ProposalsDisabled} />
          </Route>
          <Route path="/document-layouts">
            <ProtectedRoute component={DocumentLayouts} suspense />
          </Route>
          <Route path="/recurring-invoices">
            <ProtectedRoute component={RecurringInvoices} suspense />
          </Route>
          <Route path="/receipts">
            <ProtectedRoute component={Receipts} suspense />
          </Route>
          <Route path="/admin">
            <ProtectedRoute component={AdminPage} adminOnly suspense />
          </Route>

          <Route path="/quotations/:id/preview" component={QuotationPreview} />
          <Route path="/proposals/:id/preview" component={ProposalPreview} />
          <Route path="/invoices/:id/preview" component={InvoicePreview} />

          <Route component={NotFound} />
        </Switch>
      </AuthSessionProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <AppRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
