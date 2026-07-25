import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/require-auth";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { AppShell } from "@/components/app-shell";
import { RouteErrorFallback, RouteNotFound } from "@/components/route-boundaries";

export const Route = createFileRoute("/v/$viewId")({
  head: () => ({
    meta: [
      { title: "View — Gio Docs" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ViewRoute,
  errorComponent: ({ error, reset }) => (
    <RouteErrorFallback error={error} reset={reset} scope="view" />
  ),
  notFoundComponent: () => <RouteNotFound what="This view" />,
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
