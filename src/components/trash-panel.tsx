import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useFormatDate } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { useRestoreFromTrash, useTrash, type TrashItem } from "@/hooks/use-trash";
import { Ico } from "./emoji-icon";
import { Sk } from "./sk";

/* Trash (Allan, 2026-10-11; Notion's): the pages you deleted and could
 * bring back, newest first, searchable by title. Restore brings a page
 * back where it was, with what went to the bin with it (and the pages it
 * lives in, when those are in the bin too). A deleted page can't be
 * opened — only restored. Nothing is ever emptied from here. */

const RESTORE = "M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5";

function placeOf(t: TrashItem): string {
  if (t.parent_id) {
    const name = t.parent_title?.trim() || "Untitled";
    return t.trashed_ancestors.length ? `In “${name}”, also in Trash` : `In “${name}”`;
  }
  return t.access_type === "workspace" ? "Workspace" : "Private";
}

export function TrashPanel({ close, page = false }: { close: () => void; page?: boolean }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);
  const q = useTrash(debounced);
  const restore = useRestoreFromTrash();
  const toast = useToast();
  const fmt = useFormatDate();
  const navigate = useNavigate();
  const items = q.data ?? [];

  const onRestore = (t: TrashItem) => {
    const name = t.title?.trim() || "Untitled";
    restore.mutate(t, {
      onSuccess: () =>
        toast.push({
          message:
            t.trashed_ancestors.length > 0
              ? `Restored “${name}” and the page it lives in.`
              : `Restored “${name}”.`,
          action: {
            label: "Open",
            onClick: () => {
              close();
              void navigate({ to: "/p/$pageId", params: { pageId: t.id } });
            },
          },
        }),
      onError: (e) => toast.push(`Couldn't restore “${name}”: ${(e as Error).message}`),
    });
  };

  return (
    <div role="dialog" aria-label="Trash" data-trash-panel>
      {/* In a phone sheet the sheet's own title names it. */}
      {page ? null : (
        <div className="flex items-center" style={{ padding: "6px 8px 6px 10px", gap: 8 }}>
          <span className="font-display text-strong" style={{ fontSize: 15, fontWeight: 700 }}>
            Trash
          </span>
        </div>
      )}
      <div style={{ padding: "0 10px 6px" }}>
        <input
          autoFocus={!page}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages in Trash"
          aria-label="Search pages in Trash"
          className="w-full rounded-md border border-line bg-surface px-2 text-ui text-body outline-none focus:border-accent"
          style={{ height: 30 }}
        />
      </div>
      <div style={page ? { paddingBottom: 6 } : { height: "min(360px, 55vh)", overflowY: "auto", paddingBottom: 6 }}>
        {q.isPending ? (
          <div role="status" aria-busy="true">
            <span className="sr-only">Loading…</span>
            {["52%", "38%", "64%", "46%"].map((w, i) => (
              <div key={i} className="flex items-center" style={{ height: 48, gap: 10, padding: "0 10px" }}>
                <Sk w={18} h={18} r={5} />
                <div className="min-w-0 flex-1">
                  <Sk h={11} w={w} r={5} />
                  <Sk tone="soft" h={9} w="34%" r={5} style={{ marginTop: 7 }} />
                </div>
                <Sk tone="soft" w={64} h={24} r={6} />
              </div>
            ))}
          </div>
        ) : q.isError ? (
          <p className="px-3 py-2 text-meta text-danger">
            Couldn't load Trash.{" "}
            <button type="button" className="underline" onClick={() => void q.refetch()}>
              Retry
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-meta text-muted" style={{ lineHeight: 1.5 }}>
            {debounced.trim()
              ? `No page in Trash is called “${debounced.trim()}”.`
              : "Trash is empty. Pages you delete wait here, so you can bring them back."}
          </p>
        ) : (
          <ul>
            {items.map((t) => {
              const name = t.title?.trim();
              return (
                <li key={t.id} data-trash-row={t.id} className="flex items-center rounded-md hover:bg-rail" style={{ gap: 10, padding: page ? "10px 10px" : "6px 10px" }}>
                  <span className="shrink-0">
                    <Ico icon={t.icon || (t.is_database ? "🗂️" : "📄")} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-ui ${name ? "text-strong" : "text-muted"}`}>
                      {name || (t.excerpt ? `Untitled — ${t.excerpt}` : "Untitled")}
                    </span>
                    <span className="block truncate text-caption text-faint">
                      {placeOf(t)} · deleted {fmt(t.deleted_at)}
                      {t.inside ? ` · ${t.inside} ${t.inside === 1 ? "page" : "pages"} inside` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    data-trash-restore
                    onClick={() => onRestore(t)}
                    className="flex shrink-0 items-center rounded-md border border-line bg-surface text-meta text-body hover:bg-sunken"
                    style={{ height: 26, gap: 5, padding: "0 8px" }}
                  >
                    <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden fill="none">
                      <path d={RESTORE} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Restore
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="border-t border-lineSoft px-3 pt-2 text-caption text-faint" style={{ lineHeight: 1.45 }}>
        Restoring brings back the pages that were inside too. Pages stay here until restored.
      </div>
    </div>
  );
}
