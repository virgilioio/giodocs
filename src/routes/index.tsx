import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/lib/require-auth";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";

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
  const [workspace, setWorkspace] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from("workspace_members")
      .select("workspaces(name)")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setWorkspace(data?.workspaces?.name ?? null);
      });
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="text-center">
        <p className="text-label text-secondary">{workspace ?? "—"}</p>
        <h1 className="mt-2 font-display text-title text-noir">
          {profile?.full_name || user?.email || ""}
        </h1>
      </div>
    </div>
  );
}
