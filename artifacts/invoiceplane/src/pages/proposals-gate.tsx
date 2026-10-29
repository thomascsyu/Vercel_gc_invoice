import { lazy, Suspense } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useAuthSession } from "@/context/auth-session";
import ProposalsDisabled from "@/pages/proposals-disabled";

const ProposalsPage = lazy(() => import("@/pages/proposals"));
const ProposalBuilderPage = lazy(() => import("@/pages/proposal-builder"));

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="size-8 text-primary" />
    </div>
  );
}

export function ProposalsListGate() {
  const { data } = useAuthSession();
  if (!data?.capabilities?.proposals) return <ProposalsDisabled />;
  return (
    <Suspense fallback={<PageFallback />}>
      <ProposalsPage />
    </Suspense>
  );
}

export function ProposalBuilderGate() {
  const { data } = useAuthSession();
  if (!data?.capabilities?.proposals) return <ProposalsDisabled />;
  return (
    <Suspense fallback={<PageFallback />}>
      <ProposalBuilderPage />
    </Suspense>
  );
}
