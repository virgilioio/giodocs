/**
 * The `page` block — a page that LIVES INSIDE this page.
 *
 * The block holds a REFERENCE (`pid`), never a copy. Placement lives on the
 * child (`pages.parent_id`), so the child can move or be deleted without the
 * block knowing; a stored title or emoji would lie the moment either changed.
 * Every state below is derived on each render from the reader's own
 * RLS-filtered pages array — nothing here is cached.
 *
 * Four states:
 *   ok      — pid set, page readable, and parent_id === this page
 *   empty   — pid === ''
 *   moved   — readable, but parent_id points somewhere else
 *   gone    — pid set, absent from the readable array
 *
 * `gone` deliberately also covers LOST ACCESS: a page you can no longer read
 * is indistinguishable from a deleted one, and saying "restricted" would
 * reveal that it exists.
 *
 * Removing a block UNPLACES the child (parent_id → null) and deletes the
 * block. It never deletes the page: deleting a reference must never delete
 * its referent.
 */

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FRESH_PAGE_BLOCKS, type Blk } from "@/lib/block-ops";
import { Ico } from "./emoji-icon";
import { Popover } from "./popover";
import { MiniAvatar, StatusChip, hashTag, type MemberLike } from "./property-pickers";
import { PageImageCtx } from "@/components/image-block";
import { childrenOf, placementRows, type PlacementRow } from "@/lib/page-tree";
import { useFormatDate } from "@/lib/format";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import {
  useCreatePage,
  useRenamePage,
  useSetPageParent,
} from "@/hooks/use-page-mutations";

export type PageBlockItem = {
  id: string;
  title?: string | null;
  icon?: string | null;
  parent_id?: string | null;
  props?: unknown;
  edited_at?: string | null;
  edited_by?: string | null;
};

export type PageBlockState<P extends PageBlockItem> =
  | { kind: "empty" }
  | { kind: "gone" }
  | { kind: "ok"; child: P }
  | { kind: "moved"; child: P; newParent: P | undefined };

/** Derived every render — never cached. */
export function pageBlockState<P extends PageBlockItem>(
  pid: string | undefined,
  thisPageId: string,
  pages: readonly P[],
): PageBlockState<P> {
  if (!pid) return { kind: "empty" };
  const child = pages.find((p) => p.id === pid);
  if (!child) return { kind: "gone" };
  if ((child.parent_id ?? null) === thisPageId) return { kind: "ok", child };
  const newParent = child.parent_id
    ? pages.find((p) => p.id === child.parent_id)
    : undefined;
  return { kind: "moved", child, newParent };
}

function propsOf(p: PageBlockItem): Record<string, unknown> {
  return p.props && typeof p.props === "object" && !Array.isArray(p.props)
    ? (p.props as Record<string, unknown>)
    : {};
}

/* ────────────── Glyphs ────────────── */

function Glyph({ d, size = 17 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flex: "none" }}
    >
      <path d={d} />
    </svg>
  );
}

const MOVE_ICON = "M5 12h14M13 6l6 6-6 6";
const TRASH_ICON = "M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3";

/* ────────────── Dashed shell, shared by empty / moved / gone ────────────── */

function Dashed({
  glyph,
  text,
  action,
  onRemove,
  removeLabel,
}: {
  glyph?: string;
  text: string;
  action?: React.ReactNode;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div
      className="flex items-center border border-dashed border-line bg-track"
      style={{ borderRadius: 10, padding: "9px 10px 9px 12px", gap: 9 }}
      data-page-block
    >
      {glyph ? (
        <span className="text-faint">
          <Glyph d={glyph} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-secondary" style={{ fontSize: 14 }}>
        {text}
      </span>
      {action}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
        className="text-muted hover:bg-sunken"
        style={{
          borderRadius: 6,
          border: 0,
          background: "transparent",
          padding: "2px 7px",
          fontSize: 12.5,
          cursor: "pointer",
        }}
      >
        {removeLabel}
      </button>
    </div>
  );
}

/* ────────────── The picker ────────────── */

export function PlacePicker<P extends PageBlockItem>({
  pages,
  thisPageId,
  onPick,
  onCreate,
}: {
  pages: readonly P[];
  thisPageId: string;
  onPick: (page: P) => void;
  onCreate: (title: string) => void;
}) {
  const [q, setQ] = useState("");
  const focused = useRef(false);
  const rows = useMemo(
    () => placementRows(q, pages, thisPageId),
    [q, pages, thisPageId],
  );

  const pick = (row: PlacementRow<P>) => {
    if (row.kind === "create") onCreate(row.title);
    else onPick(row.page);
  };

  const hasMatches = rows.some((r) => r.kind === "page");
  const footer = hasMatches
    ? "Placing a page that already lives somewhere moves it here — a page has one place."
    : "No page by that name. Enter creates it here.";

  return (
    <div style={{ maxHeight: 340, overflow: "auto" }}>
      <div
        className="truncate"
        style={{
          padding: "7px 10px 3px",
          fontFamily: "var(--font-display)",
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "var(--color-faint)",
        }}
      >
        Place a page
      </div>
      <div style={{ padding: "2px 4px 4px" }}>
        <input
          ref={(el) => {
            if (el && !focused.current) {
              focused.current = true;
              el.focus();
            }
          }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = rows[0];
              if (first) pick(first);
            }
          }}
          placeholder="Search pages, or type a new name"
          className="w-full border border-line bg-track"
          style={{ borderRadius: 7, padding: "5px 7px", fontSize: 13 }}
        />
      </div>

      {rows.map((row, i) =>
        row.kind === "page" ? (
          <PickRow
            key={row.page.id}
            icon={row.page.icon}
            label={row.page.title?.trim() || "Untitled"}
            hint={row.hint}
            onPick={() => pick(row)}
          />
        ) : (
          <PickRow
            key={`create-${i}`}
            label={row.title ? `Create "${row.title}" here` : "Create a new page here"}
            hint="new"
            onPick={() => pick(row)}
          />
        ),
      )}

      <div
        style={{
          padding: "6px 10px 8px",
          fontSize: 11.5,
          lineHeight: 1.45,
          color: "var(--color-faint)",
        }}
      >
        {footer}
      </div>
    </div>
  );
}

function PickRow({
  icon,
  label,
  hint,
  onPick,
}: {
  icon?: string | null;
  label: string;
  hint?: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center hover:bg-sunken"
      style={{
        gap: 7,
        border: 0,
        background: "transparent",
        borderRadius: 7,
        padding: "5px 7px",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {icon !== undefined ? <Ico icon={icon} size={15} /> : null}
      <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13.5 }}>
        {label}
      </span>
      {hint ? (
        <span className="shrink-0 truncate text-faint" style={{ fontSize: 11.5, maxWidth: 110 }}>
          {hint}
        </span>
      ) : null}
    </button>
  );
}

/* ────────────── The view ────────────── */

export function PageBlockView<P extends PageBlockItem>({
  block,
  locked,
  thisPageId,
  pages,
  members = [],
  onSetPid,
  onPick,
  onCreate,
  onRemove,
  onOpen,
  onRename,
}: {
  block: Blk;
  locked: boolean;
  thisPageId: string;
  pages: readonly P[];
  members?: MemberLike[];
  onSetPid: (pid: string) => void;
  /** Place an existing page here — a MOVE, never a copy. Resolves false when
   *  the DB trigger rejects the placement, and the block must not change. */
  onPick: (page: P) => boolean | Promise<boolean>;
  /** Create a page here. Resolves with the new page id, or null on failure. */
  onCreate: (title: string) => Promise<string | null>;
  onRemove: () => void;
  onOpen: (pageId: string) => void;
  onRename: (pageId: string, title: string) => void;
}) {
  const fmt = useFormatDate();
  const chooseRef = useRef<HTMLButtonElement | null>(null);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const state = pageBlockState(block.pid, thisPageId, pages);

  // `/page` OPENS THE PICKER — it must not create a page. Only for a block
  // inserted in this session; an empty block found on reload stays quiet.
  useEffect(() => {
    if (locked) return;
    if (!FRESH_PAGE_BLOCKS.has(block.id)) return;
    FRESH_PAGE_BLOCKS.delete(block.id);
    chooseRef.current?.click();
  }, [block.id, locked]);

  const create = async (title: string) => {
    const id = await onCreate(title);
    if (!id) return;
    onSetPid(id);
    if (!title.trim()) {
      setDraft("");
      setNaming(true);
    }
  };

  if (state.kind === "empty") {
    return (
      <Dashed
        text="Choose a page to place here, or create one"
        onRemove={onRemove}
        removeLabel="Remove"
        action={
          locked ? null : (
            <Popover
              width={300}
              trigger={({ onClick, ref }) => (
                <button
                  ref={(el) => {
                    if (typeof ref === "function") ref(el);
                    else if (ref)
                      (ref as React.MutableRefObject<HTMLButtonElement | null>).current =
                        el;
                    chooseRef.current = el;
                  }}
                  type="button"
                  onClick={onClick}
                  className="text-noir hover:bg-sunken"
                  style={{
                    borderRadius: 6,
                    border: "1px solid var(--color-line)",
                    background: "var(--color-surface)",
                    padding: "3px 9px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Choose
                </button>
              )}
            >
              {(close) => (
                <PlacePicker
                  pages={pages}
                  thisPageId={thisPageId}
                  onPick={(p) => {
                    close();
                    void (async () => {
                      const ok = await onPick(p);
                      if (ok) onSetPid(p.id);
                    })();
                  }}
                  onCreate={(title) => {
                    close();
                    void create(title);
                  }}
                />
              )}
            </Popover>
          )
        }
      />
    );
  }

  if (state.kind === "gone") {
    return (
      <Dashed
        glyph={TRASH_ICON}
        text="This page was deleted"
        onRemove={onRemove}
        removeLabel="Remove"
      />
    );
  }

  if (state.kind === "moved") {
    const where = state.newParent?.title?.trim() || "another page";
    return (
      <Dashed
        glyph={MOVE_ICON}
        text={`Now lives in ${where}`}
        onRemove={onRemove}
        removeLabel="Remove"
      />
    );
  }

  const child = state.child;
  const title = child.title?.trim() || "Untitled";
  const status = propsOf(child)["status"];
  const statusLabel = typeof status === "string" && status ? status : "";
  const pair = statusLabel ? hashTag(statusLabel) : null;
  const member = members.find((m) => m.user_id === child.edited_by);
  const kids = childrenOf(child.id, pages).length;

  return (
    <div
      className="flex flex-col border border-line bg-surface shadow-card hover:border-rule hover:bg-track"
      style={{ borderRadius: 10, padding: "9px 10px 9px 12px" }}
      data-page-block
      data-page-card
    >
      <div className="flex min-w-0 items-center" style={{ gap: 9 }}>
        <Ico icon={child.icon} size={21} />
        {naming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft.trim()) onRename(child.id, draft.trim());
              setNaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (draft.trim()) onRename(child.id, draft.trim());
                setNaming(false);
              }
            }}
            placeholder="Untitled"
            aria-label="Name this page"
            className="min-w-0 flex-1 border border-line bg-track"
            style={{ borderRadius: 7, padding: "3px 7px", fontSize: 15, fontWeight: 700 }}
          />
        ) : (
          <button
            type="button"
            onClick={() => onOpen(child.id)}
            className="min-w-0 flex-1 truncate text-left text-noir"
            style={{
              border: 0,
              background: "transparent",
              padding: 0,
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {title}
          </button>
        )}
        {pair ? <StatusChip label={statusLabel} tint={pair.tint} ink={pair.ink} /> : null}
        {member ? <MiniAvatar profile={member.profiles} /> : null}
        {child.edited_at ? (
          <span className="shrink-0 text-whisper" style={{ fontSize: 12 }}>
            {fmt(child.edited_at)}
          </span>
        ) : null}
        <Popover
          width={272}
          align="end"
          trigger={({ onClick, ref }) => (
            <button
              ref={ref}
              type="button"
              onClick={onClick}
              aria-label="Page block options"
              className="text-muted hover:bg-sunken"
              style={{
                borderRadius: 6,
                border: 0,
                background: "transparent",
                padding: "0 5px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              ⋯
            </button>
          )}
        >
          {(close) => (
            <div>
              <PickRow
                label="Remove from this page"
                onPick={() => {
                  close();
                  onRemove();
                }}
              />
              <div
                style={{
                  padding: "6px 10px 8px",
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  color: "var(--color-faint)",
                }}
              >
                Deleting a page happens on the page itself.
              </div>
            </div>
          )}
        </Popover>
      </div>
      {kids > 0 ? (
        <div className="text-faint" style={{ paddingLeft: 30, fontSize: 12 }}>
          {`› ${kids} ${kids === 1 ? "page" : "pages"} inside`}
        </div>
      ) : null}
    </div>
  );
}

/* ────────────── The wired block ────────────── */

export function PageBlock({
  block,
  locked,
  onChange,
  onDelete,
}: {
  block: Blk;
  locked: boolean;
  onChange: (patch: Partial<Blk>) => void;
  onDelete: () => void;
}) {
  const ctx = useContext(PageImageCtx);
  const thisPageId = ctx?.pageId ?? "";
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const navigate = useNavigate();
  const setParent = useSetPageParent();
  const createPage = useCreatePage();
  const rename = useRenamePage();

  const pages = (shell.pages.data ?? []) as PageBlockItem[];
  const members = (shell.members.data ?? []) as unknown as MemberLike[];
  const me = pages.find((p) => p.id === thisPageId);
  const myArea = propsOf(me ?? { id: "" })["area"];

  return (
    <PageBlockView
      block={block}
      locked={locked}
      thisPageId={thisPageId}
      pages={pages}
      members={members}
      onSetPid={(pid) => onChange({ pid })}
      onPick={async (page) => {
        // Await the DB. `blockedParents` only sees the reader's VISIBLE pages,
        // so the picker can legitimately offer a placement that is secretly a
        // cycle; the trigger rejects it. Storing the pid before that verdict
        // left the block showing a card that claimed the OLD parent while the
        // toast said the move had failed.
        const old = page.parent_id
          ? pages.find((p) => p.id === page.parent_id)
          : undefined;
        try {
          await setParent.mutateAsync({
            pageId: page.id,
            parentId: thisPageId,
            title: page.title ?? "",
            oldParentTitle: old?.title ?? null,
          });
          return true;
        } catch {
          // Rejected — leave the block exactly as it was. The toast explains.
          return false;
        }
      }}
      onCreate={async (title) => {
        // A page filed inside a Hiring page IS a Hiring page — inherit the
        // parent's area rather than making someone set it twice.
        const seedProps: Record<string, unknown> =
          typeof myArea === "string" && myArea ? { area: myArea } : {};
        try {
          const row = await createPage.mutateAsync({
            seedProps,
            title: title.trim(),
            parentId: thisPageId,
          });
          return row.id;
        } catch {
          return null;
        }
      }}
      onRemove={() => {
        // Unplace, then drop the block. NEVER delete the page.
        if (block.pid) {
          const child = pages.find((p) => p.id === block.pid);
          setParent.mutate({
            pageId: block.pid,
            parentId: null,
            title: child?.title ?? "",
          });
        }
        onDelete();
      }}
      onOpen={(pageId) => {
        void navigate({ to: "/p/$pageId", params: { pageId } });
      }}
      onRename={(pageId, title) => rename.mutate({ pageId, title })}
    />
  );
}
