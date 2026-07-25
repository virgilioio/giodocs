import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/require-auth";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/v/$viewId")({
  head: () => ({
    meta: [
      { title: "View — Gio Docs" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ViewRoute,
});

function ViewRoute() {
  return (
    <RequireAuth>
      <WorkspaceProvider>
        <AppShell />
      </WorkspaceProvider>
    </RequireAuth>
  );
}
