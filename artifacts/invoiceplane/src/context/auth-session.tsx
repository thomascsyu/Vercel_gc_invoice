import { createContext, useContext, type ReactNode } from "react";
import { useMe } from "@/hooks/use-me";

type UseMeResult = ReturnType<typeof useMe>;

const AuthSessionContext = createContext<UseMeResult | undefined>(undefined);

/** Single `useMe()` per tree — route guards and layout read the same session state. */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const session = useMe();
  return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): UseMeResult {
  const ctx = useContext(AuthSessionContext);
  if (ctx === undefined) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return ctx;
}
