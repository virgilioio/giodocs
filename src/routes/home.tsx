import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/require-auth";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { AppShell } from "@/components/app-shell";
import { RouteErrorFallback } from "@/components/route-boundaries";

export const Route = createFileRoute("/home")({
  // Phones show Inbox and Templates as tabs of Home (/home?tab=inbox).
  validateSearch: (search: Record<string, unknown>): { tab?: "inbox" | "templates" } =>
    search.tab === "inbox" || search.tab === "templates" ? { tab: search.tab } : {},
  head: () => ({
    meta: [
      { title: "Home — Gio Docs" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: HomeRoute,
  errorComponent: ({ error, reset }) => (
    <RouteErrorFallback error={error} reset={reset} scope="home page" />
  ),
});

function HomeRoute() {
  return (
    <RequireAuth>
      <WorkspaceProvider>
        <AppShell />
      </WorkspaceProvider>
    </RequireAuth>
  );
}
