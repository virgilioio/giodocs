import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // SPA mode: no SSR. Combined with `spa: { enabled: true }` in vite.config.ts.
    // `defaultSsr` is stripped from RouterConstructorOptions at the type level
    // but honoured at runtime, hence the cast.
    ...({ defaultSsr: false } as Record<string, unknown>),
  });

  return router;
};
