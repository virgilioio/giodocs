import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/require-auth";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/p/$pageId")({
  head: () => ({
    meta: [
      { title: "Page — Gio Docs" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PageRoute,
});

function PageRoute() {
  return (
    <RequireAuth>
      <WorkspaceProvider>
        <AppShell />
      </WorkspaceProvider>
    </RequireAuth>
  );
}
