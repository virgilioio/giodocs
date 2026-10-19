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
import { installTooltips } from "../lib/tooltips";
import { installThemeColor } from "../lib/theme-color";
import { GioSplash } from "@/components/gio-splash";
import { AppUpdateToast } from "@/components/app-update-toast";
import { installStaleChunkReload } from "@/hooks/use-app-version-check";

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

function ErrorComponent({ error: raw, reset }: { error: unknown; reset: () => void }) {
  const error = raw instanceof Error ? raw : new Error(String(raw));
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
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Gio Docs" },
      { name: "apple-mobile-web-app-title", content: "Gio Docs" },
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
      // Inter 400/500 for the new-version toast, Gio ATS's toast face
      // (Allan, 2026-10-19), from Google Fonts as Gio ATS loads it.
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap",
      },
      // The dark tile with the cream mark (Allan, 2026-10-11). "?v=2" makes
      // phones and browsers fetch it again instead of keeping the old one.
      { rel: "icon", href: "/favicon.ico?v=2", sizes: "any" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png?v=2" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png?v=2" },
      // iPhone "Add to Home Screen" reads this: 180×180, opaque, the tile to
      // the edges (the phone rounds the corners itself).
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png?v=2" },
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
  useEffect(() => installTooltips(), []);
  useEffect(() => installThemeColor(), []);
  useEffect(() => installStaleChunkReload(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PreferencesProvider>
          <ToastProvider>
            <Outlet />
          </ToastProvider>
          <GioSplash ready />
          <AppUpdateToast />
        </PreferencesProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
