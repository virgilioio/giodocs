import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/require-auth";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gio Docs" },
      { name: "description", content: "Virgilio's knowledge, findable. No folders, no six-level nesting, no three competing sources of truth — just pages that tell you when they've gone stale." },
      { property: "og:title", content: "Gio Docs" },
      { property: "og:description", content: "Virgilio's knowledge, findable. No folders, no six-level nesting, no three competing sources of truth — just pages that tell you when they've gone stale." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <RequireAuth>
      <WorkspaceProvider>
        <AppShell />
      </WorkspaceProvider>
    </RequireAuth>
  );
}
