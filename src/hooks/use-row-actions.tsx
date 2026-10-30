import { useNavigate } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";
import type { MenuSpec } from "@/components/row-menu";
import { PlacePicker } from "@/components/page-block";
import { toClipboard } from "@/lib/clipboard";
import { setPageOrigin, type PageOrigin } from "@/lib/page-origin";
import { buildPageRowSpec, firstNameOf, type MemberLite } from "@/lib/page-row-spec";
import { openPageSomewhere } from "@/lib/peek";
import { isManualSort, MANUAL_SORT, type SortSpec } from "@/lib/run-view";
import { pageUrl } from "@/lib/slug";
import { sortLabel } from "@/lib/sort-label";
import { useToast } from "@/lib/toast";
import type { PageListItem } from "@/lib/types";
import { seedForGroup } from "@/lib/view-seed";
import { useWorkspaceId } from "@/lib/workspace-context";
import { usePages } from "@/hooks/use-workspace-data";
import {
  useDeletePage,
  useDuplicatePage,
  useMovePage,
  useRestorePage,
  useSetPageParent,
  useSetPageProperty,
  useVerifyPage,
} from "@/hooks/use-page-mutations";

type PropDef = Database["public"]["Tables"]["property_defs"]["Row"];

function propsOf(p: PageListItem): Record<string, unknown> {
  return p.props && typeof p.props === "object" && !Array.isArray(p.props)
    ? (p.props as Record<string, unknown>)
    : {};
}

/**
 * What a database row can do from a view (2026-10-30): Notion's row menu
 * (⋮⋮, right-click or ⋯), rows dragged into place, and new rows placed
 * where they were asked for. One hook for the database page and views
 * inside pages, so both offer the same menu and the same moves.
 *
 * Manual order is the database's own order of its rows (move_page). In a
 * sorted view a drag doesn't snap back silently: it offers to switch the
 * view to manual order. A drop in another group sets the grouped property
 * when it's a select, status or checkbox.
 */
export function useRowActions(o: {
  databaseId: string;
  databaseTitle: string | null;
  /** The view's rows, in the order shown. */
  rows: PageListItem[];
  sort: SortSpec | SortSpec[];
  groupKey: string | null;
  propDefs: PropDef[];
  members: MemberLite[];
  staleThreshold: number;
  /** Can change the database's rows (duplicate, move, reorder). */
  canEdit: boolean;
  /** Where an opened row says it came from. */
  origin?: PageOrigin | null;
  /** Switch the view to manual order (an offer after a drag). Absent: the
   *  view's order can't be changed from here. */
  onChangeSort?: (s: SortSpec) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const setProp = useSetPageProperty();
  const verifyPage = useVerifyPage();
  const deletePage = useDeletePage();
  const restorePage = useRestorePage();
  const duplicatePage = useDuplicatePage();
  const movePage = useMovePage();
  const setParent = useSetPageParent();
  // Move to… lists every page in the workspace, not just this database's rows.
  const allPages = usePages(useWorkspaceId()).data ?? [];
  const manualOrder = isManualSort(o.sort);

  const specPropDefs = o.propDefs.map((d) => ({
    key: d.key,
    label: d.label ?? d.key,
    type: d.type,
    options: d.options,
    archived_at: d.archived_at,
  }));

  const deleteWithUndo = (row: PageListItem) =>
    deletePage.mutate(row.id, {
      onSuccess: () =>
        toast.push({
          message: "Row deleted, with the pages inside it.",
          action: { label: "Undo", onClick: () => restorePage.mutate({ pageId: row.id, row }) },
          durationMs: 10_000,
        }),
    });

  /** Duplicate a row; in manual order the copy goes right below it. */
  const duplicateRow = async (p: PageListItem) => {
    const copy = await duplicatePage.mutateAsync({ pageId: p.id, quiet: true });
    if (!copy || !manualOrder) return;
    const at = o.rows.findIndex((r) => r.id === p.id);
    movePage.mutate({
      pageId: copy.id,
      target: { parentId: o.databaseId, beforeId: o.rows[at + 1]?.id ?? null },
      quiet: true,
    });
  };

  /** A new row (already made) put where it was asked for, in manual order;
   *  otherwise it would land among the rows never placed. */
  const placeNewRow = (pageId: string, placeBefore?: string | null) => {
    if (!manualOrder) return;
    movePage.mutate({
      pageId,
      target: { parentId: o.databaseId, beforeId: placeBefore ?? null },
      quiet: true,
    });
  };

  const onMoveRow = (
    pageId: string,
    t: { beforeId: string | null; groupValue?: string | null },
  ) => {
    const p = o.rows.find((r) => r.id === pageId);
    if (!p) return;
    const groupDef = o.groupKey ? o.propDefs.find((d) => d.key === o.groupKey) : undefined;
    const regroupable = !!groupDef && ["select", "status", "checkbox"].includes(groupDef.type);
    const regroup =
      regroupable && t.groupValue !== undefined
        ? seedForGroup(o.groupKey, t.groupValue, o.propDefs)
        : null;
    const sameGroup =
      !regroupable ||
      t.groupValue === undefined ||
      String(propsOf(p)[o.groupKey!] ?? "") === String(t.groupValue ?? "");
    const setGroup = () =>
      setProp.mutate({ pageId, key: o.groupKey!, value: regroup?.[o.groupKey!] ?? null });
    const doMove = () => {
      if (!sameGroup) setGroup();
      movePage.mutate({
        pageId,
        target: { parentId: o.databaseId, beforeId: t.beforeId },
        message: `Moved "${p.title || "Untitled"}".`,
      });
    };
    if (manualOrder) return doMove();
    // Into another group of a sorted view: only the group changes.
    if (!sameGroup) return setGroup();
    if (!o.onChangeSort) return;
    const switchSort = o.onChangeSort;
    toast.push({
      message: `This view is sorted by ${sortLabel(o.sort, specPropDefs).toLowerCase()}. Drag rows in manual order.`,
      action: {
        label: "Use manual order",
        onClick: () => {
          switchSort({ prop: MANUAL_SORT, dir: "asc" });
          doMove();
        },
      },
      durationMs: 8_000,
    });
  };

  const open = (p: PageListItem, full: boolean) => {
    if (o.origin) setPageOrigin(p.id, o.origin);
    if (full) void navigate({ to: "/p/$pageId", params: { pageId: p.id } });
    else openPageSomewhere(navigate, p.id);
  };

  const getMenu =
    (p: PageListItem) =>
    (mctx: { setSpec: (s: MenuSpec) => void; close: () => void }): MenuSpec =>
      buildPageRowSpec(
        {
          p,
          isStale: new Date(p.verified_at).getTime() < o.staleThreshold,
          propDefs: specPropDefs,
          members: o.members,
          editedByFirstName: firstNameOf(o.members.find((m) => m.user_id === p.edited_by)),
          // Open does what a click on the title does (the dialog on a
          // desktop), in every view.
          onOpen: () => open(p, false),
          onOpenFull: () => open(p, true),
          onOpenNewTab: () => window.open(pageUrl(p.id, p.title ?? null), "_blank", "noopener"),
          onCopyLink: () => {
            toClipboard(pageUrl(p.id, p.title ?? null));
            toast.push("Link copied");
          },
          onDuplicate: o.canEdit ? () => void duplicateRow(p) : undefined,
          renderMoveTo: o.canEdit
            ? (close) => (
                <PlacePicker
                  pages={allPages}
                  thisPageId={p.id}
                  onPick={(to) => {
                    close();
                    setParent.mutate({
                      pageId: p.id,
                      parentId: to.id,
                      title: p.title ?? "",
                      oldParentTitle: o.databaseTitle,
                    });
                  }}
                  onCreate={() => close()}
                />
              )
            : undefined,
          onVerify: () => verifyPage.mutate(p.id),
          onSetValue: (key, value) => setProp.mutate({ pageId: p.id, key, value }),
          onDelete: () => deleteWithUndo(p),
        },
        mctx,
      );

  return { manualOrder, getMenu, onMoveRow, placeNewRow, deleteWithUndo };
}
