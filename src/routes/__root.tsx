import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "../lib/auth-context";
import { PreferencesProvider } from "../lib/preferences";
import { ToastProvider } from "../lib/toast";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display font-bold text-noir" style={{ fontSize: "72px" }}>404</h1>
        <h2 className="mt-4 font-display font-bold text-noir">Page not found</h2>
        <p className="mt-2 text-meta text-muted">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <p className="mt-4 text-meta text-muted">
          Once you're signed in, press{" "}
          <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-caption text-muted">
            ⌘K
          </kbd>{" "}
          to search.
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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display font-bold tracking-tight text-noir">
          This page didn't load
        </h1>
        <p className="mt-2 text-meta text-muted">
          Something went wrong on our end. You can try refreshing or head back home.
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
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-line bg-surface px-4 py-2 text-ui font-bold text-noir transition-colors hover:bg-rail"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Gio Docs" },
      { name: "description", content: "Virgilio's knowledge, findable. No folders, no six-level nesting, no three competing sources of truth — just pages that tell you when they've gone stale." },
      { property: "og:title", content: "Gio Docs" },
      { property: "og:description", content: "Virgilio's knowledge, findable. No folders, no six-level nesting, no three competing sources of truth — just pages that tell you when they've gone stale." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Gio Docs" },
      { name: "twitter:description", content: "Virgilio's knowledge, findable. No folders, no six-level nesting, no three competing sources of truth — just pages that tell you when they've gone stale." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/iM05FhWwZITw5zQUP1QfNJjzeoj1/social-images/social-1785131985135-DECK_-_Virgilio_-_Find_your_people_EN_(4).webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/iM05FhWwZITw5zQUP1QfNJjzeoj1/social-images/social-1785131985135-DECK_-_Virgilio_-_Find_your_people_EN_(4).webp" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Runs BEFORE React hydrates, so a dark-mode user never sees a white flash
// on load. Reads gio.theme from localStorage (falling back to matchMedia)
// and sets data-theme on <html> before body content paints. Deliberately
// minified and quote-safe for inline injection.
const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('gio.theme');if(t!=='light'&&t!=='dark'&&t!=='system')t='system';var d=t==='system'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches):t==='dark';document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}


function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PreferencesProvider>
          <ToastProvider>
            <Outlet />
          </ToastProvider>
        </PreferencesProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
