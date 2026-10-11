import { useMemo } from "react";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useHomePrefs } from "@/hooks/use-home";
import { favoritePages } from "@/lib/home";
import type { PageListItem } from "@/lib/types";

export const STAR_GLYPH =
  "M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z";

export function useFavoritePages(): PageListItem[] {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const prefsQ = useHomePrefs();
  const ids = prefsQ.data?.favorite_pages;
  const pages = shell.pages.data as PageListItem[] | undefined;
  return useMemo(() => favoritePages(ids ?? [], pages ?? []), [ids, pages]);
}
