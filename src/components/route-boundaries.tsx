import { useEffect } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { reportLovableError } from "@/lib/lovable-error-reporting";

/** Keyboard hint shown in the 404 boundary. Matches the palette shortcut. */
function KeyHint() {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-caption text-muted">
      {isMac ? "⌘K" : "Ctrl+K"}
    </kbd>
  );
}

export function RouteNotFound({ what }: { what?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-display text-noir">Not found</h1>
        <p className="mt-2 text-prose text-secondary">
          {what ?? "This page"} doesn't exist, has moved, or you don't have access.
        </p>
        <p className="mt-4 text-meta text-muted">
          Press <KeyHint /> to search for what you're looking for.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-btn px-4 py-2 text-ui font-bold text-btnFg transition-colors hover:bg-strong"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export function RouteErrorFallback({
  error,
  reset,
  scope,
}: {
  error: Error;
  reset: () => void;
  scope: string;
}) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: `route:${scope}` });
  }, [error, scope]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-title text-noir">This didn't load</h1>
        <p className="mt-2 text-prose text-secondary">
          Something went wrong loading this {scope}. You can try again, or search for
          something else.
        </p>
        <p className="mt-4 text-meta text-muted">
          Press <KeyHint /> to open search.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-btn px-4 py-2 text-ui font-bold text-btnFg transition-colors hover:bg-strong"
          >
            Try again
          </button>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-line bg-surface px-4 py-2 text-ui font-bold text-noir transition-colors hover:bg-rail"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
