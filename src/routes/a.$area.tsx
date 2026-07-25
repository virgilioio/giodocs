import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/require-auth";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/a/$area")({
  head: () => ({
    meta: [
      { title: "Area — Gio Docs" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AreaRoute,
});

function AreaRoute() {
  return (
    <RequireAuth>
      <WorkspaceProvider>
        <AppShell />
      </WorkspaceProvider>
    </RequireAuth>
  );
}
