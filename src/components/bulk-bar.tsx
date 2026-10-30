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
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RowMenu, type MenuSpec, type MenuRow, type MenuBuildCtx } from "./row-menu";
import type { PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";
import type { Filter, SortSpec } from "@/lib/run-view";
import { runView } from "@/lib/run-view";
import { exitOnly } from "@/lib/exit-motion";
import {
  actionIcon,
  actionLabel,
  actionableDefs,
  valueRows,
} from "@/lib/prop-actions";

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


/** Compact "n page(s)" helper. */
function nPages(n: number): string {
  return `${n} ${n === 1 ? "page" : "pages"}`;
}

export type BulkActions = {
  /** Bulk verify — MUST use verify_page per page. Never touch edited_at. */
  verify: (pageIds: string[]) => Promise<void> | void;
  /** Set one of the database's own properties on every page. For a
   *  multi-select, `picked` is the option to ADD (the caller merges). */
  setValue: (pageIds: string[], def: PropDef, picked: unknown) => Promise<void> | void;
  archive: (pageIds: string[]) => Promise<void> | void;
  /** Undo for archive: back in every view. */
  unarchive: (pageIds: string[]) => Promise<void> | void;
  deletePages: (pageIds: string[]) => Promise<void> | void;
  /** Undo for delete: every page restored, with the pages inside it.
   *  The rows are as they were just before the delete. */
  restorePages: (rows: PageListItem[]) => Promise<void> | void;
  /** A toast, with an Undo when `undo` is given. */
  toast: (message: string, undo?: () => void) => void;
  staleDays: number;
  meId: string;
};

type BulkContext = {
  pages: PageListItem[];
  selectedIds: string[];
  propDefs: PropDef[];
  members: MemberRow[];
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

  // The database's own properties, by type — never a property found by
  // name (src/lib/prop-actions.ts).
  for (const def of actionableDefs(ctx.propDefs)) {
    rows.push({
      kind: "row",
      label: actionLabel(def),
      icon: actionIcon(def),
      hint: { text: "›" },
      onPick: () => mctx.setSpec(buildValueSubmenu(ctx, ids, def, mctx)),
    });
  }

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
          body: "They leave every view at once. You can undo for a moment afterwards.",
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

function buildValueSubmenu(
  ctx: BulkContext,
  ids: string[],
  def: PropDef,
  mctx: MenuBuildCtx,
): MenuSpec {
  const selected = ctx.pages.filter((p) => ids.includes(p.id));
  // Checked only when every selected page already has that value.
  const values = selected.map((p) => propsOf(p)[def.key] ?? null);
  const same = values.every((v) => JSON.stringify(v) === JSON.stringify(values[0]));
  const current = same && def.type !== "multi_select" ? values[0] : undefined;
  // Values typed into an open multi-select that aren't options yet.
  const extra = new Set<string>();
  if (def.type === "multi_select") {
    for (const p of ctx.pages) {
      const v = propsOf(p)[def.key];
      if (Array.isArray(v)) for (const x of v) if (typeof x === "string") extra.add(x);
    }
  }
  return {
    title: actionLabel(def),
    onBack: () => mctx.setSpec(buildRoot(ctx, mctx)),
    rows: valueRows(
      def,
      current,
      ctx.members,
      (value, label) => {
        void doSetValue(ctx, ids, def, value, label);
        mctx.close();
        ctx.onClear();
      },
      [...extra],
    ),
    footer:
      def.type === "multi_select"
        ? "Adds to every selected page. Values already there stay."
        : "Applies to every selected page. Pages may leave views that filtered the old value.",
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

async function doSetValue(
  ctx: BulkContext,
  ids: string[],
  def: PropDef,
  value: unknown,
  label: string,
) {
  await ctx.actions.setValue(ids, def, value);
  const name = def.label || def.key;
  if (def.type === "multi_select") ctx.actions.toast(`${nPages(ids.length)}: added "${label}" to ${name}.`);
  else if (value === null) ctx.actions.toast(`${nPages(ids.length)}: ${name} cleared.`);
  else ctx.actions.toast(`${nPages(ids.length)}: ${name} set to "${label}".`);
}

async function doArchive(ctx: BulkContext, ids: string[]) {
  await ctx.actions.archive(ids);
  ctx.actions.toast(`${nPages(ids.length)} archived — still in ⌘K.`, () => {
    void ctx.actions.unarchive(ids);
  });
}

/** One Undo brings every deleted page back, as a single row's delete does
 *  (until 2026-10-30 bulk delete had none). */
async function doDelete(ctx: BulkContext, ids: string[]) {
  const rows = ctx.pages.filter((p) => ids.includes(p.id));
  await ctx.actions.deletePages(ids);
  ctx.actions.toast(`${nPages(ids.length)} deleted — they left every view at once.`, () => {
    void ctx.actions.restorePages(rows);
  });
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
  views: ViewRow[];
  actions: BulkActions;
  onClear: () => void;
  /** Opens Actions when it changes (⌘/ on a selection). */
  menuAsk?: number;
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
  const openRef = useRef(openMenu);
  openRef.current = openMenu;
  useEffect(() => {
    if (props.menuAsk && btnRef.current) openRef.current(btnRef.current);
  }, [props.menuAsk]);

  if (n === 0) return null;

  return (
    <>
      {/* A zero-height sticky slot: the bar floats over the top of the list
          instead of pushing every row down when the first box is ticked. */}
      <div
        ref={exitOnly("fade")}
        style={{ position: "sticky", top: 6, zIndex: 40, height: 0 }}
      >
      <div
        role="toolbar"
        aria-label="Selection"
        className="animate-cardIn"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--color-btn)",
          color: "var(--color-btnFg)",
          borderRadius: 9,
          padding: "7px 8px 7px 13px",
          boxShadow: "0 8px 24px rgba(13,13,9,.22)",
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
            e.currentTarget.style.color = "var(--color-btnFg)";
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
