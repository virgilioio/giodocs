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

/* Everything a view of ONE database needs: its rows, its properties, its
 * views, the workspace's members, and the context run-view reads with
 * (property types and options, people's names, page titles, and
 * worked-out values for relations and rollups, which can reach across
 * databases). Shared by the database page and by views placed inside
 * pages, so the two can never compute a view differently.
 *
 * Property keys are unique per workspace, so one relation index over
 * every page and every property serves all databases. */

type PropDef = Database["public"]["Tables"]["property_defs"]["Row"];
type ViewRow = Database["public"]["Tables"]["views"]["Row"];

export type ViewRunCtx = RunViewCtx & {
  nameOf: (userId: string) => string;
  titleOf: (pageId: string) => string;
  readValue: (page: PageListItem, key: string) => unknown;
};

const NONE: never[] = [];

export function useViewRuntime(databaseId: string | null) {
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const shell = useWorkspaceShell(ws);

  const pagesData = shell.pages.data;
  const allPages = useMemo(() => (pagesData ?? []) as PageListItem[], [pagesData]);
  const viewsData = shell.views.data;
  const allViews = useMemo(() => (viewsData ?? []) as ViewRow[], [viewsData]);
  const membersData = shell.members.data;
  const members = useMemo(() => (membersData ?? []) as unknown as TableMember[], [membersData]);
  const propDefsData = shell.propDefs.data;
  const allPropDefs = useMemo(() => (propDefsData ?? []) as PropDef[], [propDefsData]);
  const workspace = shell.workspace.data;
  const staleDays = workspace?.stale_days ?? 30;

  // This database's own rows, properties and views.
  const pages = useMemo(
    () => (databaseId ? allPages.filter((p) => p.database_id === databaseId) : NONE),
    [allPages, databaseId],
  );
  const propDefs = useMemo(
    () => (databaseId ? allPropDefs.filter((d) => d.database_id === databaseId) : NONE),
    [allPropDefs, databaseId],
  );
  const views = useMemo(
    () =>
      databaseId
        ? allViews
            .filter((v) => v.database_id === databaseId)
            .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        : NONE,
    [allViews, databaseId],
  );
  const database = useMemo(
    () => (databaseId ? (allPages.find((p) => p.id === databaseId) ?? null) : null),
    [allPages, databaseId],
  );

  const relIdx: RelationIndex = useMemo(
    () => buildRelationIndex(allPages, allPropDefs),
    [allPages, allPropDefs],
  );

  // What sorting needs to know: each property's type and option order, and
  // people's names (so a person property sorts by name, not by id).
  const runCtx: ViewRunCtx = useMemo(() => {
    const props = new Map<string, PropInfo>(
      allPropDefs.map((d) => [
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
  }, [allPropDefs, members, user?.id, staleDays, relIdx]);

  // What tables need to show and edit relations and rollups.
  const tableRelations = useMemo<TableRelations>(() => {
    const words = valueWords({ defs: relIdx.defs, nameOf: runCtx.nameOf, titleOf: runCtx.titleOf });
    const dbName = (id: string | null) =>
      id ? allPages.find((p) => p.id === id && p.is_database)?.title : undefined;
    return {
      idx: relIdx,
      words,
      readValue: runCtx.readValue,
      candidates: (def, page) => relationCandidates(def, page, relIdx),
      scopeNote: (def) => {
        const name = dbName(relationConfig(def).databaseId);
        return name ? `Rows of ${name}` : undefined;
      },
    };
  }, [relIdx, runCtx, allPages]);

  const people = useMemo(
    () => members.map((m) => ({ id: m.user_id, full_name: m.profiles?.full_name ?? null })),
    [members],
  );

  return {
    shell,
    allPages,
    allViews,
    allPropDefs,
    database,
    pages,
    views,
    members,
    propDefs,
    workspace,
    staleDays,
    relIdx,
    runCtx,
    tableRelations,
    people,
  };
}
