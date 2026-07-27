/**
 * BulkBar — sticky selection bar and its Actions menu.
 *
 * Mirrors the block-selection bar shell: same dark noir surface, same
 * radius / shadow, same slot order. A selection reads the same way
 * whatever was selected.
 *
 * The actions live in ONE MenuSpec builder — submenus swap in place via
 * `mctx.setSpec` and `onBack`, so a stray click never leaves the panel
 * anchored on an empty selection.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { RowMenu, type MenuSpec, type MenuRow, type MenuBuildCtx } from "./row-menu";
import type { PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";
import type { Filter, SortSpec } from "@/lib/run-view";
import { runView } from "@/lib/run-view";

type PropDef = Database["public"]["Tables"]["property_defs"]["Row"];
type ViewRow = Database["public"]["Tables"]["views"]["Row"];
type MemberRow = {
  user_id: string;
  role: string;
  profiles: {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_tint: string | null;
    avatar_ink: string | null;
  } | null;
};

function propsOf(p: PageListItem): Record<string, unknown> {
  return p.props && typeof p.props === "object" && !Array.isArray(p.props)
    ? (p.props as Record<string, unknown>)
    : {};
}

function firstNameOf(m: MemberRow | undefined): string {
  const full = m?.profiles?.full_name ?? m?.profiles?.email ?? "";
  return (full.split(" ")[0] ?? full).trim() || "someone";
}

/** Compact "n page(s)" helper. */
function nPages(n: number): string {
  return `${n} ${n === 1 ? "page" : "pages"}`;
}

export type BulkActions = {
  /** Bulk verify — MUST use verify_page per page. Never touch edited_at. */
  verify: (pageIds: string[]) => Promise<void> | void;
  setStatus: (pageIds: string[], value: string, label: string) => Promise<void> | void;
  setOwner: (pageIds: string[], userId: string | null, label: string) => Promise<void> | void;
  moveArea: (pageIds: string[], area: string | null) => Promise<void> | void;
  addTag: (pageIds: string[], tag: string) => Promise<void> | void;
  archive: (pageIds: string[]) => Promise<void> | void;
  deletePages: (pageIds: string[]) => Promise<void> | void;
  toast: (message: string) => void;
  staleDays: number;
  meId: string;
};

type BulkContext = {
  pages: PageListItem[];
  selectedIds: string[];
  propDefs: PropDef[];
  members: MemberRow[];
  areas: string[];
  tags: string[];
  views: ViewRow[];
  actions: BulkActions;
  onClear: () => void;
};

/* ─────────────────────── consequence toasts ─────────────────────── */

function countStale(selected: PageListItem[], staleDays: number): number {
  const cutoff = Date.now() - staleDays * 86400_000;
  return selected.filter((p) => new Date(p.verified_at).getTime() < cutoff).length;
}

/**
 * Names the "Needs review" view if one exists — a view whose filter contains
 * an `op:"stale"` clause. Falls back to the literal "Needs review" only
 * when the user has such a view; otherwise we phrase without a view name.
 */
function needsReviewViewName(views: ViewRow[]): string | null {
  for (const v of views) {
    const filter = (v.filter ?? []) as Filter[];
    if (Array.isArray(filter) && filter.some((f) => f.op === "stale")) {
      return v.name;
    }
  }
  return null;
}

/* ─────────────────────── menu spec builders ─────────────────────── */

function selectOptions(def: PropDef | undefined): Array<{
  value: string;
  label: string;
  tint: string;
  ink: string;
}> {
  return (def?.options as unknown as Array<{
    value: string;
    label: string;
    tint: string;
    ink: string;
  }>) ?? [];
}

function buildRoot(ctx: BulkContext, mctx: MenuBuildCtx): MenuSpec {
  const n = ctx.selectedIds.length;

  if (n === 0) {
    return {
      title: "Nothing selected",
      rows: [],
      footer: "Select pages with the checkbox at the start of a row.",
    };
  }

  const selected = ctx.pages.filter((p) => ctx.selectedIds.includes(p.id));
  const staleN = countStale(selected, ctx.actions.staleDays);
  const statusDef = ctx.propDefs.find((d) => d.key === "status");

  // Snapshot the id list at build time — used by every action closure below
  // so a selection mutation while a submenu is up cannot leak into the
  // command (the delete confirm also captures on open, see below).
  const ids = ctx.selectedIds.slice();

  const rows: MenuRow[] = [];

  rows.push({
    kind: "row",
    label: "Mark verified",
    icon: "shield",
    hint: { text: staleN > 0 ? `${staleN} stale` : "all fresh" },
    onPick: () => {
      void doVerify(ctx, ids);
      mctx.close();
      ctx.onClear();
    },
  });

  if (statusDef) {
    rows.push({
      kind: "row",
      label: "Set status",
      icon: "dot",
      hint: { text: "›" },
      onPick: () => mctx.setSpec(buildStatusSubmenu(ctx, ids, mctx)),
    });
  }

  rows.push({
    kind: "row",
    label: "Set owner",
    icon: "person",
    hint: { text: "›" },
    onPick: () => mctx.setSpec(buildOwnerSubmenu(ctx, ids, mctx)),
  });

  rows.push({
    kind: "row",
    label: "Move to area",
    icon: "arrow",
    hint: { text: "›" },
    onPick: () => mctx.setSpec(buildAreaSubmenu(ctx, ids, mctx)),
  });

  rows.push({
    kind: "row",
    label: "Add tag",
    icon: "tag",
    hint: { text: "›" },
    onPick: () => mctx.setSpec(buildTagSubmenu(ctx, ids, mctx)),
  });

  rows.push({ kind: "sep" });

  rows.push({
    kind: "row",
    label: "Archive",
    icon: "eyeOff",
    hint: { text: "stays searchable" },
    onPick: () => {
      void doArchive(ctx, ids);
      mctx.close();
      ctx.onClear();
    },
  });

  rows.push({
    kind: "row",
    label: `Delete ${nPages(n)}`,
    icon: "trash",
    danger: true,
    // Capture ids AT THE MOMENT THE CONFIRM OPENS so a selection change
    // while the dialog is up cannot silently rewrite the target set.
    onPick: () => {
      const captured = ids.slice();
      mctx.setSpec({
        title: `${n} pages selected`,
        rows: [],
        confirm: {
          title: `Delete ${nPages(captured.length)}?`,
          body: "They will leave every view at once. Undo is per-page.",
          cta: `Delete ${nPages(captured.length)}`,
          danger: true,
          onConfirm: () => {
            void doDelete(ctx, captured);
            ctx.onClear();
          },
        },
      });
    },
  });

  return {
    title: `${n} pages selected`,
    rows,
    footer:
      "A selection is a set of pages, not a query — which is why it cannot be saved as a view.",
  };
}

function buildStatusSubmenu(
  ctx: BulkContext,
  ids: string[],
  mctx: MenuBuildCtx,
): MenuSpec {
  const def = ctx.propDefs.find((d) => d.key === "status");
  const opts = selectOptions(def);
  return {
    title: "Set status",
    onBack: () => mctx.setSpec(buildRoot(ctx, mctx)),
    rows: opts.map<MenuRow>((o) => ({
      kind: "row",
      label: o.label,
      dot: `var(--color-${o.ink})`,
      onPick: () => {
        void doSetStatus(ctx, ids, o.value, o.label);
        mctx.close();
        ctx.onClear();
      },
    })),
    footer:
      "Applies to every selected page. Pages may leave views that filtered the old value.",
  };
}

function buildOwnerSubmenu(
  ctx: BulkContext,
  ids: string[],
  mctx: MenuBuildCtx,
): MenuSpec {
  const rows: MenuRow[] = ctx.members.map((m) => ({
    kind: "row",
    label: m.profiles?.full_name ?? m.profiles?.email ?? "Someone",
    person: {
      initials: (m.profiles?.full_name ?? m.profiles?.email ?? "?")
        .slice(0, 1)
        .toUpperCase(),
      tint: `var(--color-${m.profiles?.avatar_tint ?? "sunken"})`,
      ink: `var(--color-${m.profiles?.avatar_ink ?? "body"})`,
    },
    onPick: () => {
      void doSetOwner(ctx, ids, m.user_id, firstNameOf(m));
      mctx.close();
      ctx.onClear();
    },
  }));
  rows.push({ kind: "sep" });
  rows.push({
    kind: "row",
    label: "Clear owner",
    icon: "clear",
    onPick: () => {
      void doSetOwner(ctx, ids, null, "no one");
      mctx.close();
      ctx.onClear();
    },
  });
  return {
    title: "Set owner",
    onBack: () => mctx.setSpec(buildRoot(ctx, mctx)),
    rows,
    footer:
      "Reassigning is how a departure gets handled — no page is left orphaned.",
  };
}

function buildAreaSubmenu(
  ctx: BulkContext,
  ids: string[],
  mctx: MenuBuildCtx,
): MenuSpec {
  const rows: MenuRow[] = ctx.areas.map<MenuRow>((a) => ({
    kind: "row",
    label: a,
    icon: "arrow",
    onPick: () => {
      void doMoveArea(ctx, ids, a);
      mctx.close();
      ctx.onClear();
    },
  }));
  rows.push({ kind: "sep" });
  rows.push({
    kind: "row",
    label: "Clear area",
    icon: "clear",
    onPick: () => {
      void doMoveArea(ctx, ids, null);
      mctx.close();
      ctx.onClear();
    },
  });
  return {
    title: "Move to area",
    onBack: () => mctx.setSpec(buildRoot(ctx, mctx)),
    rows,
    footer:
      "An area is a property. Moving pages rewrites it — nothing is filed anywhere.",
  };
}

function buildTagSubmenu(
  ctx: BulkContext,
  ids: string[],
  mctx: MenuBuildCtx,
): MenuSpec {
  const rows: MenuRow[] =
    ctx.tags.length === 0
      ? []
      : ctx.tags.map<MenuRow>((t) => ({
          kind: "row",
          label: t,
          icon: "tag",
          onPick: () => {
            void doAddTag(ctx, ids, t);
            mctx.close();
            ctx.onClear();
          },
        }));
  return {
    title: "Add tag",
    onBack: () => mctx.setSpec(buildRoot(ctx, mctx)),
    rows,
    footer: "Tags accumulate — existing tags stay.",
  };
}

/* ─────────────────────── action dispatchers ─────────────────────── */

async function doVerify(ctx: BulkContext, ids: string[]) {
  const selected = ctx.pages.filter((p) => ids.includes(p.id));
  const staleBefore = countStale(selected, ctx.actions.staleDays);
  await ctx.actions.verify(ids);
  const nrName = needsReviewViewName(ctx.views);
  if (staleBefore > 0 && nrName) {
    ctx.actions.toast(
      `${nPages(ids.length)} verified — ${staleBefore} left "${nrName}". Last edited is untouched.`,
    );
  } else if (staleBefore > 0) {
    ctx.actions.toast(
      `${nPages(ids.length)} verified — ${staleBefore} were stale, now fresh. Last edited is untouched.`,
    );
  } else {
    ctx.actions.toast(`${nPages(ids.length)} verified.`);
  }
}

async function doSetStatus(
  ctx: BulkContext,
  ids: string[],
  value: string,
  label: string,
) {
  await ctx.actions.setStatus(ids, value, label);
  ctx.actions.toast(`${nPages(ids.length)} set to "${label}".`);
}

async function doSetOwner(
  ctx: BulkContext,
  ids: string[],
  userId: string | null,
  label: string,
) {
  await ctx.actions.setOwner(ids, userId, label);
  if (userId) {
    ctx.actions.toast(`${nPages(ids.length)} reassigned to ${label}.`);
  } else {
    ctx.actions.toast(`${nPages(ids.length)} — owner cleared.`);
  }
}

async function doMoveArea(
  ctx: BulkContext,
  ids: string[],
  area: string | null,
) {
  await ctx.actions.moveArea(ids, area);
  if (area) {
    ctx.actions.toast(`${nPages(ids.length)} moved to ${area} — joined "${area}".`);
  } else {
    ctx.actions.toast(`${nPages(ids.length)} — area cleared.`);
  }
}

async function doAddTag(ctx: BulkContext, ids: string[], tag: string) {
  await ctx.actions.addTag(ids, tag);
  ctx.actions.toast(`${nPages(ids.length)} tagged "${tag}".`);
}

async function doArchive(ctx: BulkContext, ids: string[]) {
  await ctx.actions.archive(ids);
  ctx.actions.toast(`${nPages(ids.length)} archived — still in ⌘K.`);
}

async function doDelete(ctx: BulkContext, ids: string[]) {
  await ctx.actions.deletePages(ids);
  ctx.actions.toast(`${nPages(ids.length)} deleted — they left every view at once.`);
}

/* keep runView referenced so `views` prop stays typechecked even if a
 * future toast needs it directly. Cheap sanity call. */
void runView;

/* ─────────────────────── component ─────────────────────── */

export function BulkBar(props: {
  pages: PageListItem[];
  selectedIds: string[];
  propDefs: PropDef[];
  members: MemberRow[];
  areas: string[];
  tags: string[];
  views: ViewRow[];
  actions: BulkActions;
  onClear: () => void;
}) {
  const ctx: BulkContext = props;
  const n = props.selectedIds.length;
  const staleN = useMemo(() => {
    const sel = props.pages.filter((p) => props.selectedIds.includes(p.id));
    return countStale(sel, props.actions.staleDays);
  }, [props.pages, props.selectedIds, props.actions.staleDays]);

  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [spec, setSpec] = useState<MenuSpec | null>(null);
  const closeMenu = () => {
    setAnchor(null);
    setSpec(null);
  };
  const openMenu = (btn: HTMLButtonElement) => {
    const built = buildRoot(ctx, { setSpec, close: closeMenu });
    setSpec(built);
    setAnchor(btn);
  };

  const btnRef = useRef<HTMLButtonElement>(null);

  if (n === 0) return null;

  return (
    <>
      <div
        role="toolbar"
        aria-label="Selection"
        className="animate-fadeIn"
        style={{
          position: "sticky",
          top: 6,
          zIndex: 40,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--color-noir)",
          color: "#FAFAF7",
          borderRadius: 9,
          padding: "7px 8px 7px 13px",
          boxShadow: "0 8px 24px rgba(13,13,9,.22)",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>
          {n === 1 ? "1 page selected" : `${n} pages selected`}
        </span>
        <span style={{ fontSize: 13, color: "var(--color-whisper)" }}>
          shift-click to extend · esc to clear
        </span>
        <span style={{ flex: 1 }} />
        <VerifyPill
          staleN={staleN}
          onClick={() => {
            const ids = props.selectedIds.slice();
            void doVerify(ctx, ids);
            props.onClear();
          }}
        />
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openMenu(e.currentTarget);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 13,
            color: "var(--color-line)",
            padding: "4px 8px",
            borderRadius: 6,
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,.08)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          Actions <span aria-hidden style={{ fontSize: 10, marginTop: 1 }}>⌄</span>
        </button>
        <button
          type="button"
          aria-label="Clear selection"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            closeMenu();
            props.onClear();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            display: "grid",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "transparent",
            border: "none",
            color: "var(--color-whisper)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,.08)";
            e.currentTarget.style.color = "#FAFAF7";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--color-whisper)";
          }}
        >
          <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden>
            <path
              d="M6 6l12 12M18 6 6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <RowMenu spec={spec} anchor={anchor} onClose={closeMenu} />
    </>
  );
}

function VerifyPill({ staleN, onClick }: { staleN: number; onClick: () => void }): ReactNode {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        color: "var(--color-accentRing)",
        padding: "4px 8px",
        borderRadius: 6,
        background: "transparent",
        border: "none",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,.08)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      title={staleN > 0 ? `${staleN} stale` : "all fresh"}
    >
      <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden>
        <path
          d="M12 2.6l7.6 3.6v5.6c0 4.8-3.3 8.1-7.6 9.6-4.3-1.5-7.6-4.8-7.6-9.6V6.2zM9 11.8l2 2 4-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Mark verified
    </button>
  );
}
