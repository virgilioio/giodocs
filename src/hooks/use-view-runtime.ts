import { useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import type { PropInfo, RunViewCtx } from "@/lib/run-view";
import {
  buildRelationIndex,
  readValueWith,
  relationCandidates,
  relationConfig,
  valueWords,
  type RelationIndex,
} from "@/lib/relations";
import type { PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";
import type { TableRelations, TableMember } from "@/components/view-table";

/* Everything a view needs to run over the workspace's pages: the page list,
 * properties, members and views, and the context run-view reads with
 * (property types and options, people's names, page titles, and worked-out
 * values for relations and rollups). Shared by the main view and views
 * placed inside a page, so the two can never compute a view differently. */

type PropDef = Database["public"]["Tables"]["property_defs"]["Row"];
type ViewRow = Database["public"]["Tables"]["views"]["Row"];

export type ViewRunCtx = RunViewCtx & {
  nameOf: (userId: string) => string;
  titleOf: (pageId: string) => string;
  readValue: (page: PageListItem, key: string) => unknown;
};

function propsOf(p: PageListItem): Record<string, unknown> {
  return p.props && typeof p.props === "object" && !Array.isArray(p.props)
    ? (p.props as Record<string, unknown>)
    : {};
}

export function useViewRuntime() {
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const shell = useWorkspaceShell(ws);

  const pagesData = shell.pages.data;
  const pages = useMemo(() => (pagesData ?? []) as PageListItem[], [pagesData]);
  const viewsData = shell.views.data;
  const views = useMemo(() => (viewsData ?? []) as ViewRow[], [viewsData]);
  const membersData = shell.members.data;
  const members = useMemo(() => (membersData ?? []) as unknown as TableMember[], [membersData]);
  const propDefsData = shell.propDefs.data;
  const propDefs = useMemo(() => (propDefsData ?? []) as PropDef[], [propDefsData]);
  const workspace = shell.workspace.data;
  const staleDays = workspace?.stale_days ?? 30;

  const relIdx: RelationIndex = useMemo(
    () => buildRelationIndex(pages, propDefs),
    [pages, propDefs],
  );

  // What sorting needs to know: each property's type and option order, and
  // people's names (so Owner sorts by name, not by id).
  const runCtx: ViewRunCtx = useMemo(() => {
    const props = new Map<string, PropInfo>(
      propDefs.map((d) => [
        d.key,
        {
          type: d.type,
          options: (d.options as unknown as Array<{ value: string; label?: string }> | null) ?? [],
        },
      ]),
    );
    const names = new Map(
      members.map((m) => [m.user_id, m.profiles?.full_name || m.profiles?.email || ""]),
    );
    const nameOf = (id: string) => names.get(id) || id;
    const titleOf = (id: string) => {
      const p = relIdx.byId.get(id);
      return p ? p.title || "Untitled" : "Private page";
    };
    return {
      me: user?.id ?? "",
      staleDays,
      props,
      nameOf,
      titleOf,
      // Relations (both sides) and rollups are worked out from the pages.
      readValue: readValueWith(relIdx, valueWords({ defs: relIdx.defs, nameOf, titleOf })),
    };
  }, [propDefs, members, user?.id, staleDays, relIdx]);

  // What tables need to show and edit relations and rollups.
  const tableRelations = useMemo<TableRelations>(() => {
    const words = valueWords({ defs: relIdx.defs, nameOf: runCtx.nameOf, titleOf: runCtx.titleOf });
    const viewName = (id: string | null) => views.find((v) => v.id === id)?.name;
    return {
      idx: relIdx,
      words,
      readValue: runCtx.readValue,
      candidates: (def, page) => relationCandidates(def, page, relIdx, views, runCtx),
      scopeNote: (def) => {
        const name = viewName(relationConfig(def).viewId);
        return name ? `Pages in ${name}` : undefined;
      },
    };
  }, [relIdx, runCtx, views]);

  const areas = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) {
      const a = propsOf(p).area;
      if (typeof a === "string" && a) s.add(a);
    }
    return [...s].sort();
  }, [pages]);

  const people = useMemo(
    () => members.map((m) => ({ id: m.user_id, full_name: m.profiles?.full_name ?? null })),
    [members],
  );

  return {
    shell,
    pages,
    views,
    members,
    propDefs,
    workspace,
    staleDays,
    relIdx,
    runCtx,
    tableRelations,
    areas,
    people,
  };
}
