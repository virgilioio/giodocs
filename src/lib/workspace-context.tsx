import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth-context";

type WorkspaceCtx = { workspaceId: string };

const Ctx = createContext<WorkspaceCtx | null>(null);

/**
 * Resolves the current user's workspace id once (first workspace_members row)
 * and provides it via context. Callers must be inside <RequireAuth> so
 * user is non-null; while the membership query resolves this renders a
 * neutral shell.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const q = useQuery({
    queryKey: ["membership", user?.id ?? "none"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", user!.id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.workspace_id ?? null;
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  if (!q.data) {
    return <div className="min-h-screen bg-canvas" aria-hidden />;
  }

  return <Ctx.Provider value={{ workspaceId: q.data }}>{children}</Ctx.Provider>;
}

export function useWorkspaceId(): string {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspaceId must be used within <WorkspaceProvider>");
  return ctx.workspaceId;
}
