import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useCreatePage } from "@/hooks/use-page-mutations";
import { Ico } from "./emoji-icon";
import { setPageOrigin } from "@/lib/page-origin";

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

type SearchHit = {
  id: string;
  title: string;
  icon: string | null;
  props: Record<string, unknown>;
  snippets: Array<{ id: string | null; text: string | null }>;
  rank: number;
};

type Row =
  | { kind: "page"; page: SearchHit | PageListItem }
  | { kind: "block"; pageId: string; pageTitle: string; pageIcon: string | null; area: string | null; blockId: string | null; sentence: string; term: string }
  | { kind: "view"; view: ViewRow }
  | { kind: "action"; label: string; run: () => void };

const GROUP_ORDER = ["Pages", "Blocks", "Views", "Actions"] as const;
type Group = (typeof GROUP_ORDER)[number];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function extractSentence(text: string, term: string): string {
  const lower = text.toLowerCase();
  const at = lower.indexOf(term.toLowerCase());
  if (at < 0) return text.slice(0, 120);
  let start = at;
  while (start > 0 && !".!?\n".includes(text[start - 1]!)) start--;
  let end = at + term.length;
  while (end < text.length && !".!?\n".includes(text[end]!)) end++;
  let s = text.slice(start, Math.min(end + 1, text.length)).trim();
  if (s.length > 140) {
    const relAt = at - start;
    const from = Math.max(0, relAt - 60);
    const to = Math.min(s.length, relAt + term.length + 60);
    s = (from > 0 ? "…" : "") + s.slice(from, to).trim() + (to < s.length ? "…" : "");
  }
  return s;
}

function highlight(text: string, term: string): ReactNode {
  if (!term) return text;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-highlight text-body">{text.slice(idx, idx + term.length)}</mark>
      {text.slice(idx + term.length)}
    </>
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

  const searchQ = useQuery({
    queryKey: ["search", ws, debounced],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_pages", {
        p_workspace: ws,
        p_q: debounced,
        p_limit: 12,
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
      const recents = [...pages]
        .sort((a, b) =>
          (b.edited_at ?? "").localeCompare(a.edited_at ?? ""),
        )
        .slice(0, 6);
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

    // Pages
    for (const h of hits) list.push({ kind: "page", page: h });

    // Blocks — max 2 per page, 8 total
    let blockTotal = 0;
    for (const h of hits) {
      if (blockTotal >= 8) break;
      const snips = (h.snippets ?? []).slice(0, 2);
      const area = (h.props?.area as string | undefined) ?? null;
      for (const s of snips) {
        if (blockTotal >= 8) break;
        const text = s?.text ?? "";
        if (!text) continue;
        list.push({
          kind: "block",
          pageId: h.id,
          pageTitle: h.title || "Untitled",
          pageIcon: h.icon,
          area,
          blockId: s?.id ?? null,
          sentence: extractSentence(text, term),
          term,
        });
        blockTotal++;
      }
    }

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
  }, [debounced, pages, searchQ.data, views, createPage, navigate, onClose]);

  // Group rows preserving group order
  const grouped = useMemo(() => {
    const m = new Map<Group, { row: Row; index: number }[]>();
    rows.forEach((row, index) => {
      const g: Group =
        row.kind === "page"
          ? "Pages"
          : row.kind === "block"
            ? "Blocks"
            : row.kind === "view"
              ? "Views"
              : "Actions";
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
        (setPageOrigin(row.page.id, { kind: "search" }), navigate({ to: "/p/$pageId", params: { pageId: row.page.id } }));
      } else if (row.kind === "block") {
        onClose();
        navigate({
          to: "/p/$pageId",
          params: { pageId: row.pageId },
          hash: row.blockId ? `block-${row.blockId}` : undefined,
        });
      } else if (row.kind === "view") {
        onClose();
        navigate({ to: "/v/$viewId", params: { viewId: row.view.id } });
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
        className="animate-palIn rounded-card bg-surface shadow-modal"
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
            placeholder="Search pages, blocks, views…"
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
                {group === "Pages" && !debounced ? "Recently edited" : group}
              </div>
              <ul>
                {items.map(({ row, index }) => (
                  <li key={`${group}-${index}`}>
                    <PaletteRow
                      row={row}
                      active={index === cursor}
                      onEnter={() => setCursor(index)}
                      onSelect={() => runRow(row)}
                      memberBy={memberBy}
                      propDefs={propDefs}
                      staleDays={staleDays}
                      term={debounced}
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
          <em className="text-caption text-faint">One object. Many views.</em>
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
}: {
  row: Row;
  active: boolean;
  onEnter: () => void;
  onSelect: () => void;
  memberBy: Map<string, string>;
  propDefs: PropDef[];
  staleDays: number;
  term: string;
}) {
  const cls =
    "flex w-full items-center gap-3 px-3.5 py-2 text-left " +
    (active ? "bg-selected" : "hover:bg-rail");

  if (row.kind === "page") {
    const p = row.page as SearchHit | PageListItem;
    const props = (p.props ?? {}) as Record<string, unknown>;
    const area = typeof props.area === "string" ? (props.area as string) : "";
    const ownerId = typeof props.owner === "string" ? (props.owner as string) : "";
    const owner = ownerId ? memberBy.get(ownerId) ?? "" : "";
    const sub = [area, owner].filter(Boolean).join(" · ");
    return (
      <button type="button" className={cls} onMouseEnter={onEnter} onClick={onSelect}>
        <Ico icon={p.icon || "📄"} size={20} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-body">
            {highlight(p.title || "Untitled", term)}
          </span>
          {sub && <span className="block text-meta text-muted">{sub}</span>}
        </span>
      </button>
    );
  }
  if (row.kind === "block") {
    const sub =
      [row.pageTitle, row.area].filter(Boolean).join(" · ");
    return (
      <button type="button" className={cls} onMouseEnter={onEnter} onClick={onSelect}>
        <span className="text-ui">{row.pageIcon || "📄"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-body">
            {highlight(row.sentence, row.term)}
          </span>
          <span className="block text-meta text-muted">in {sub}</span>
        </span>
      </button>
    );
  }
  if (row.kind === "view") {
    const v = row.view;
    const filters = (v.filter ?? []) as Filter[];
    const people = Array.from(memberBy, ([id, full_name]) => ({ id, full_name }));
    const desc = filters.length
      ? filters.map((f) => filterLabel(f, { people, staleDays })).join(" · ")
      : "all pages";
    const glyph =
      v.layout === "board"
        ? "M4 5v14M10 5v14M16 5v14"
        : v.layout === "list"
          ? "M4 6h16M4 12h16M4 18h16"
          : "M3 6h18M3 12h18M3 18h18M9 6v12M15 6v12";
    return (
      <button type="button" className={cls} onMouseEnter={onEnter} onClick={onSelect}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-muted" aria-hidden>
          <path d={glyph} />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-body">
            {highlight(v.name, term)}
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
