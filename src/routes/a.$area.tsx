import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/require-auth";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { AppShell } from "@/components/app-shell";
import { RouteErrorFallback, RouteNotFound } from "@/components/route-boundaries";

export const Route = createFileRoute("/a/$area")({
  head: () => ({
    meta: [
      { title: "Area — Gio Docs" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AreaRoute,
  errorComponent: ({ error, reset }) => (
    <RouteErrorFallback error={error} reset={reset} scope="area" />
  ),
  notFoundComponent: () => <RouteNotFound what="This area" />,
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
