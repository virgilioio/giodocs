import { createFileRoute } from "@tanstack/react-router";

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
    <div className="flex min-h-screen items-center justify-center">
      <h1 className="font-display font-bold text-noir">Gio Docs</h1>
    </div>
  );
}
