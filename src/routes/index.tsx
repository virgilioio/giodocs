import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RequireAuth } from "@/lib/require-auth";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/hooks/use-workspace-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gio Docs" },
      { name: "description", content: "Gio Docs" },
      { property: "og:title", content: "Gio Docs" },
      { property: "og:description", content: "Gio Docs" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <RequireAuth>
      <Home />
    </RequireAuth>
  );
}

function Home() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();

  const membershipQ = useQuery({
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
  });

  const workspaceQ = useWorkspace(membershipQ.data ?? undefined);
  const workspaceName = workspaceQ.data?.name ?? null;

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="text-center">
        <p className="text-label text-secondary">{workspaceName ?? "—"}</p>
        <h1 className="mt-2 font-display text-title text-noir">
          {profile?.full_name || user?.email || ""}
        </h1>
        {user?.email && (
          <p className="mt-1 text-caption text-muted">{user.email}</p>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-4 text-meta text-secondary hover:text-strong"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
