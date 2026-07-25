import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "./auth-context";

/**
 * Reads session from AuthContext (does NOT fetch).
 * - session === undefined → render neutral shell (unknown)
 * - session === null       → redirect to /login
 * - session               → render children
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (session === null && pathname !== "/login") {
      navigate({ to: "/login", replace: true });
    }
  }, [session, pathname, navigate]);

  if (session === undefined || session === null) {
    return <div className="min-h-screen bg-canvas" aria-hidden />;
  }

  return <>{children}</>;
}
