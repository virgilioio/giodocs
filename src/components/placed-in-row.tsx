/**
 * The "Placed in" property row.
 *
 * Parenthood is the COLUMN `parent_id`, not a props key and not a
 * property_defs row — this row is presentation over STRUCTURAL storage, so it
 * is deliberately absent from TYPE_LABEL, seedFor and the Add-a-property list.
 *
 * NEVER AMBER here. Unplaced is the NORMAL case — most pages have no parent —
 * and amber in this product means stale-or-unsaved. Spending it here would
 * devalue it where it matters. Unplaced is `muted`; a deleted parent is a
 * neutral `track` chip with an `accent` call to action.
 *
 * The picker is the SAME component the /page block uses; there is one picker
 * in this product.
 */

import { useNavigate } from "@tanstack/react-router";
import { Ico } from "./emoji-icon";
import { Popover } from "./popover";
import { PlacePicker, type PageBlockItem } from "./page-block";
import { useSetPageParent, useCreatePage } from "@/hooks/use-page-mutations";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";

export type PlacedInState<P extends PageBlockItem> =
  | { kind: "unplaced" }
  | { kind: "placed"; parent: P }
  | { kind: "lost" };

export function placedInState<P extends PageBlockItem>(
  parentId: string | null | undefined,
  pages: readonly P[],
): PlacedInState<P> {
  if (!parentId) return { kind: "unplaced" };
  const parent = pages.find((p) => p.id === parentId);
  return parent ? { kind: "placed", parent } : { kind: "lost" };
}

function PickerButton<P extends PageBlockItem>({
  label,
  accent,
  pages,
  pageId,
  onPick,
  onCreate,
}: {
  label: string;
  accent?: boolean;
  pages: readonly P[];
  pageId: string;
  onPick: (page: P) => void;
  onCreate: (title: string) => void;
}) {
  return (
    <Popover
      width={300}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="hover:bg-sunken"
          style={{
            border: `1px solid ${accent ? "var(--color-accentRing)" : "var(--color-line)"}`,
            background: accent ? "var(--color-accentTint)" : "transparent",
            color: accent ? "var(--color-accent)" : "var(--color-secondary)",
            borderRadius: 7,
            padding: "3px 9px",
            fontSize: 12.5,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {label}
        </button>
      )}
    >
      {(close) => (
        <PlacePicker
          pages={pages}
          thisPageId={pageId}
          onPick={(p) => {
            close();
            onPick(p);
          }}
          onCreate={(title) => {
            close();
            onCreate(title);
          }}
        />
      )}
    </Popover>
  );
}

export function PlacedInRowView<P extends PageBlockItem>({
  pageId,
  parentId,
  pages,
  onOpen,
  onUnplace,
  onPick,
  onCreate,
}: {
  pageId: string;
  parentId: string | null | undefined;
  pages: readonly P[];
  onOpen: (id: string) => void;
  onUnplace: () => void;
  onPick: (page: P) => void;
  onCreate: (title: string) => void;
}) {
  const state = placedInState(parentId, pages);

  return (
    <div
      className="min-w-0 flex items-center flex-wrap"
      data-placed-in
      style={{ gap: 8, padding: "3px 7px", marginLeft: -7 }}
    >
      {state.kind === "placed" ? (
        <>
          <button
            type="button"
            onClick={() => onOpen(state.parent.id)}
            className="flex items-center hover:bg-sunken"
            style={{
              gap: 6,
              border: "1px solid var(--color-line)",
              background: "var(--color-surface)",
              borderRadius: 7,
              padding: "2px 8px",
              fontSize: 13.5,
              fontWeight: 700,
              color: "var(--color-noir)",
              cursor: "pointer",
            }}
          >
            <Ico icon={state.parent.icon} size={15} />
            <span className="max-w-[240px] truncate">
              {String(state.parent.title ?? "").trim() || "Untitled"}
            </span>
          </button>
          <button
            type="button"
            onClick={onUnplace}
            aria-label="Unplace this page"
            title="Unplace this page"
            style={{
              border: 0,
              background: "transparent",
              color: "var(--color-rule)",
              padding: 2,
              fontSize: 12,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </>
      ) : state.kind === "lost" ? (
        <>
          <span
            style={{
              border: "1px solid var(--color-line)",
              background: "var(--color-track)",
              borderRadius: 7,
              padding: "2px 8px",
              fontSize: 13.5,
              color: "var(--color-muted)",
            }}
          >
            The page it was in has been deleted
          </span>
          <PickerButton
            label="File it somewhere"
            accent
            pages={pages}
            pageId={pageId}
            onPick={onPick}
            onCreate={onCreate}
          />
        </>
      ) : (
        <>
          <span style={{ fontSize: 14, color: "var(--color-muted)" }}>
            Nowhere — it stands on its own
          </span>
          <PickerButton
            label="Place it in a page"
            pages={pages}
            pageId={pageId}
            onPick={onPick}
            onCreate={onCreate}
          />
        </>
      )}
    </div>
  );
}

/** Wired row — the strip renders this inside its own 132px label grid. */
export function PlacedInRow({
  pageId,
  parentId,
}: {
  pageId: string;
  parentId: string | null | undefined;
}) {
  const navigate = useNavigate();
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const setParent = useSetPageParent();
  const createPage = useCreatePage();
  const pages = (shell.pages.data ?? []) as PageBlockItem[];
  const me = pages.find((p) => p.id === pageId);
  const myArea = (() => {
    const props =
      me?.props && typeof me.props === "object" && !Array.isArray(me.props)
        ? (me.props as Record<string, unknown>)
        : {};
    const a = props["area"];
    return typeof a === "string" ? a : "";
  })();

  return (
    <PlacedInRowView
      pageId={pageId}
      parentId={parentId}
      pages={pages}
      onOpen={(id) => {
        void navigate({ to: "/p/$pageId", params: { pageId: id } });
      }}
      onUnplace={() =>
        setParent.mutate({
          pageId,
          parentId: null,
          title: me?.title ?? "",
        })
      }
      onPick={(parent) => {
        // The page MOVES into `parent`; the trigger is the real cycle guard
        // and its rejection surfaces as a toast from useSetPageParent.
        const old = me?.parent_id
          ? pages.find((p) => p.id === me.parent_id)
          : undefined;
        setParent.mutate({
          pageId,
          parentId: parent.id,
          title: me?.title ?? "",
          oldParentTitle: old?.title ?? null,
        });
      }}
      onCreate={async (title) => {
        // A new parent created from here inherits this page's area.
        try {
          const row = await createPage.mutateAsync({
            seedProps: myArea ? { area: myArea } : {},
            title: title.trim(),
          });
          setParent.mutate({
            pageId,
            parentId: row.id,
            title: me?.title ?? "",
          });
        } catch {
          /* the mutation's own toast explains */
        }
      }}
    />
  );
}
