import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/require-auth";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { AppShell } from "@/components/app-shell";
import { RouteErrorFallback, RouteNotFound } from "@/components/route-boundaries";

export const Route = createFileRoute("/p/$pageId")({
  head: () => ({
    meta: [
      { title: "Page — Gio Docs" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PageRoute,
  errorComponent: ({ error, reset }) => (
    <RouteErrorFallback error={error} reset={reset} scope="page" />
  ),
  notFoundComponent: () => <RouteNotFound what="This page" />,
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
