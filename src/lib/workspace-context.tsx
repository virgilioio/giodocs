import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth-context";
import { useIsPhone } from "./use-media";
import { PhoneBootSkeleton } from "@/components/phone-skeletons";
import { NoWorkspace } from "@/components/no-workspace";

type WorkspaceCtx = { workspaceId: string };

const Ctx = createContext<WorkspaceCtx | null>(null);

/**
 * Resolves the current user's workspace id once (first workspace_members row)
 * and provides it via context. Callers must be inside <RequireAuth> so
 * user is non-null; while the membership query resolves this renders a
 * neutral shell, and with no membership (or a failed lookup) NoWorkspace.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const phone = useIsPhone();

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

  // Signed in but in no workspace, or the lookup failed: say so, never a
  // blank screen (Allan, 2026-10-22).
  if (q.data === null || (q.isError && q.data === undefined)) {
    return (
      <NoWorkspace
        email={user?.email ?? null}
        failed={q.data !== null}
        checking={q.isFetching}
        onCheckAgain={() => void q.refetch()}
      />
    );
  }

  if (!q.data) {
    // A phone draws its frame and the screen's skeleton meanwhile.
    if (phone) return <PhoneBootSkeleton />;
    return <div className="min-h-screen bg-canvas" aria-hidden />;
  }

  return <Ctx.Provider value={{ workspaceId: q.data }}>{children}</Ctx.Provider>;
}

export function useWorkspaceId(): string {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspaceId must be used within <WorkspaceProvider>");
  return ctx.workspaceId;
}
