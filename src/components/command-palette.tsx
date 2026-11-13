import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { placeOf } from "@/lib/page-place";
import { useRecentVisits } from "@/hooks/use-home";
import { recentPages } from "@/lib/home";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useCreatePage } from "@/hooks/use-page-mutations";
import { Ico } from "./emoji-icon";
import { setPageOrigin } from "@/lib/page-origin";
import { excerpt, highlightParts } from "@/lib/search-text";

import { filterLabel } from "@/lib/filter-label";
import type { PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";
import type { Filter } from "@/lib/run-view";

type PropDef = Database["public"]["Tables"]["property_defs"]["Row"];
type ViewRow = Database["public"]["Tables"]["views"]["Row"];
type MemberRow = {
  user_id: string;
  profiles: { full_name: string | null; email: string | null } | null;
};

/** One page search_workspace found (2026-11-13: everything on a page is
 *  searched, not only titles). `snippets` are its first matching blocks,
 *  in order (`id` is the block to open it at, null for a row's value). */
type SearchHit = {
  id: string;
  title: string;
  icon: string | null;
  parent_id: string | null;
  database_id: string | null;
  is_database: boolean;
  archived: boolean;
  template: boolean;
  edited_at: string;
  title_hit: boolean;
  snippets: Array<{ id: string | null; text: string | null }>;
  rank: number;
};

type Row =
  | { kind: "page"; page: SearchHit | PageListItem; hit?: SearchHit }
  | { kind: "view"; view: ViewRow }
  | { kind: "action"; label: string; run: () => void };

const GROUP_ORDER = ["Pages", "Views", "Actions"] as const;
type Group = (typeof GROUP_ORDER)[number];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Text with the typed words highlighted. */
function Marked({ text, term }: { text: string; term: string }): ReactNode {
  if (!term) return text;
  return highlightParts(text, term).map((p, i) =>
    p.hit ? (
      <mark key={i} className="bg-highlight text-body">
        {p.text}
      </mark>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ws = useWorkspaceId();
  const navigate = useNavigate();
  const shell = useWorkspaceShell(ws);
  const createPage = useCreatePage();

  const pages = (shell.pages.data ?? []) as PageListItem[];
  const views = (shell.views.data ?? []) as ViewRow[];
  const members = (shell.members.data ?? []) as unknown as MemberRow[];
  const propDefs = (shell.propDefs.data ?? []) as PropDef[];
  const staleDays = shell.workspace.data?.stale_days ?? 30;

  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const debounced = useDebounced(q.trim(), 200);
  const visitsQ = useRecentVisits(ws);

  const searchQ = useQuery({
    queryKey: ["search", ws, debounced],
    queryFn: async () => {
      // search_workspace joins the generated types when its migration is
      // applied; until then this is its shape.
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: "search_workspace",
        args: { p_workspace: string; p_q: string; p_limit: number },
      ) => PromiseLike<{ data: unknown; error: Error | null }>;
      const { data, error } = await rpc("search_workspace", {
        p_workspace: ws,
        p_q: debounced,
        p_limit: 20,
      });
      if (error) throw error;
      return (data ?? []) as unknown as SearchHit[];
    },
    enabled: !!open && debounced.length > 0,
    staleTime: 10_000,
  });

  const memberBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of members) {
      if (r.user_id) m.set(r.user_id, r.profiles?.full_name || r.profiles?.email || "");
    }
    return m;
  }, [members]);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    const term = debounced;

    if (!term) {
      // Recently visited first (Notion's way); pages you edited fill in
      // when you haven't opened six yet.
      const visited = recentPages(visitsQ.data ?? [], pages, 6);
      const seen = new Set(visited.map((p) => p.id));
      const edited = [...pages]
        .filter((p) => !seen.has(p.id))
        .sort((a, b) =>
          (b.edited_at ?? "").localeCompare(a.edited_at ?? ""),
        );
      const recents = [...visited, ...edited].slice(0, 6);
      for (const p of recents) list.push({ kind: "page", page: p });
      list.push({
        kind: "action",
        label: "New page",
        run: () => {
          createPage.mutate(
            { seedProps: {} },
            {
              onSuccess: (row) => {
                onClose();
                (setPageOrigin(row.id, { kind: "search" }), navigate({ to: "/p/$pageId", params: { pageId: row.id } }));
              },
            },
          );
        },
      });
      return list;
    }

    const hits = searchQ.data ?? [];

    // Pages, best first, each with where it matched (Notion's way).
    for (const h of hits) list.push({ kind: "page", page: h, hit: h });

    // Views
    const lowered = term.toLowerCase();
    for (const v of views) {
      if (v.name.toLowerCase().includes(lowered)) {
        list.push({ kind: "view", view: v });
      }
    }

    // Actions
    list.push({
      kind: "action",
      label: `New page titled "${term}"`,
      run: () => {
        createPage.mutate(
          { seedProps: {} },
          {
            onSuccess: (row) => {
              onClose();
              (setPageOrigin(row.id, { kind: "search" }), navigate({ to: "/p/$pageId", params: { pageId: row.id } }));
            },
          },
        );
      },
    });

    return list;
  }, [debounced, pages, searchQ.data, views, createPage, navigate, onClose, visitsQ.data]);

  // Group rows preserving group order
  const grouped = useMemo(() => {
    const m = new Map<Group, { row: Row; index: number }[]>();
    rows.forEach((row, index) => {
      const g: Group = row.kind === "page" ? "Pages" : row.kind === "view" ? "Views" : "Actions";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push({ row, index });
    });
    return GROUP_ORDER.filter((g) => m.has(g)).map((g) => ({ group: g, items: m.get(g)! }));
  }, [rows]);

  const flatCount = rows.length;

  useEffect(() => {
    if (cursor >= flatCount) setCursor(Math.max(0, flatCount - 1));
  }, [flatCount, cursor]);

  const runRow = useCallback(
    (row: Row) => {
      if (row.kind === "page") {
        onClose();
        // A match in its content opens the page at that block.
        const blockId = row.hit && !row.hit.title_hit ? row.hit.snippets?.[0]?.id : null;
        setPageOrigin(row.page.id, { kind: "search" });
        navigate({
          to: "/p/$pageId",
          params: { pageId: row.page.id },
          hash: blockId ? `block-${blockId}` : undefined,
        });
      } else if (row.kind === "view") {
        onClose();
        navigate({
          to: "/p/$pageId",
          params: { pageId: row.view.database_id },
          search: { v: row.view.id },
        });
      } else {
        row.run();
      }
    },
    [navigate, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(flatCount - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[cursor];
      if (row) runRow(row);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[14vh]"
      style={{
        background: "rgba(13,13,9,.32)",
        backdropFilter: "blur(3px)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="rounded-card bg-surface shadow-modal"
        style={{ width: "var(--container-palette)", maxWidth: "100%" }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
               strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted" aria-hidden>
            <path d="M11 4a7 7 0 100 14 7 7 0 000-14zm5.5 12.5l4 4" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            placeholder="Search pages and what’s in them…"
            className="flex-1 bg-transparent text-ui text-body outline-none placeholder:text-faint"
          />
        </div>

        <div
          className="max-h-[60vh] overflow-y-auto py-1.5"
          style={{
            opacity: searchQ.isFetching && flatCount > 0 ? 0.6 : 1,
            transition: "opacity 120ms linear",
          }}
        >
          {flatCount === 0 && (
            <div className="px-4 py-6 text-meta text-muted">
              {searchQ.isFetching ? "Searching…" : "No matches."}
            </div>
          )}
          {grouped.map(({ group, items }) => (
            <div key={group} className="mb-1">
              <div className="px-3.5 pt-2 pb-1 text-label uppercase text-faint">
                {group === "Pages" && !debounced ? "Recent" : group}
              </div>
              <ul>
                {items.map(({ row, index }) => (
                  <li
                    key={`${group}-${index}`}
                    ref={index === cursor ? keepInView : undefined}
                  >
                    <PaletteRow
                      row={row}
                      active={index === cursor}
                      onEnter={() => setCursor(index)}
                      onSelect={() => runRow(row)}
                      memberBy={memberBy}
                      propDefs={propDefs}
                      staleDays={staleDays}
                      term={debounced}
                      pages={pages}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2">
          <div className="flex items-center gap-3 text-caption text-muted">
            <Chip>↑↓</Chip><span>navigate</span>
            <Chip>↵</Chip><span>open</span>
            <Chip>esc</Chip><span>close</span>
          </div>
          <em className="text-caption text-faint">Titles, page content and row values.</em>
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-label text-muted">
      {children}
    </span>
  );
}

function PaletteRow({
  row,
  active,
  onEnter,
  onSelect,
  memberBy,
  propDefs,
  staleDays,
  term,
  pages,
}: {
  row: Row;
  active: boolean;
  onEnter: () => void;
  onSelect: () => void;
  memberBy: Map<string, string>;
  propDefs: PropDef[];
  staleDays: number;
  term: string;
  pages: PageListItem[];
}) {
  const cls =
    "flex w-full items-center gap-3 px-3.5 py-2 text-left " +
    (active ? "bg-selected" : "hover:bg-rail");

  if (row.kind === "page") {
    const p = row.page as SearchHit | PageListItem;
    const full = pages.find((x) => x.id === p.id);
    const props = (full?.props ?? ("props" in p ? p.props : null) ?? {}) as Record<string, unknown>;
    // Where it lives (its database, or the page it's inside), and who it's
    // assigned to by its database's first person property.
    const where = placeOf(full, pages);
    const personKey = full?.database_id
      ? propDefs.find((d) => d.database_id === full.database_id && d.type === "person" && !d.archived_at)?.key
      : undefined;
    const personId = personKey && typeof props[personKey] === "string" ? (props[personKey] as string) : "";
    const person = personId ? memberBy.get(personId) ?? "" : "";
    const sub = [where, person].filter(Boolean).join(" · ");
    // The line it matched in, when the match is in its content.
    const snippet = row.hit?.snippets?.find((x) => x?.text)?.text ?? "";
    const line = snippet ? excerpt(snippet, term) : "";
    const state = row.hit?.template ? "Template" : row.hit?.archived ? "Archived" : "";
    return (
      <button type="button" className={cls} onMouseEnter={onEnter} onClick={onSelect}>
        <Ico icon={p.icon || "📄"} size={20} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-ui text-body">
              <Marked text={p.title || "Untitled"} term={term} />
            </span>
            {state ? (
              <span className="shrink-0 rounded-sm bg-sunken px-1.5 text-label text-muted">
                {state}
              </span>
            ) : null}
          </span>
          {line ? (
            <span className="block truncate text-meta text-secondary" data-search-snippet>
              <Marked text={line} term={term} />
            </span>
          ) : null}
          {sub && <span className="block truncate text-meta text-muted">{sub}</span>}
        </span>
      </button>
    );
  }
  if (row.kind === "view") {
    const v = row.view;
    const filters = (v.filter ?? []) as Filter[];
    const people = Array.from(memberBy, ([id, full_name]) => ({ id, full_name }));
    const dbTitle = pages.find((p) => p.id === v.database_id)?.title?.trim() || "Untitled";
    const desc =
      `${dbTitle} · ` +
      (filters.length
        ? filters.map((f) => filterLabel(f, { people, staleDays, defs: propDefs })).join(" · ")
        : "all rows");
    const glyph =
      v.layout === "board"
        ? "M4 5v14M10 5v14M16 5v14"
        : v.layout === "list"
          ? "M4 6h16M4 12h16M4 18h16"
          : v.layout === "calendar"
            ? "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4"
            : "M3 6h18M3 12h18M3 18h18M9 6v12M15 6v12";
    return (
      <button type="button" className={cls} onMouseEnter={onEnter} onClick={onSelect}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted" aria-hidden>
          <path d={glyph} />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-body">
            <Marked text={v.name} term={term} />
          </span>
          <span className="block text-meta text-muted">{desc}</span>
        </span>
      </button>
    );
  }
  return (
    <button type="button" className={cls} onMouseEnter={onEnter} onClick={onSelect}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
           strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
      <span className="text-ui text-body">{row.label}</span>
    </button>
  );
}

/** Arrow keys move the highlight; keep it in view without animating. */
function keepInView(el: HTMLLIElement | null) {
  el?.scrollIntoView({ block: "nearest" });
}
