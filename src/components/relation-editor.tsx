import { useMemo, useState } from "react";
import { Ico } from "./emoji-icon";
import { MenuLead, MenuPageRow, MenuSearch } from "./menu-parts";
import type { PageListItem } from "@/lib/types";

/* Editing a relation: the pages it links to (open one, or take it off),
 * then a search over the pages it can link to. Used by table cells and the
 * page's property strip; both sides of a two-way relation use it, and the
 * caller decides which page's value a change is written to. */

const MAX_SHOWN = 40;

export function RelationEditor({
  linked,
  candidates,
  onAdd,
  onRemove,
  onOpenPage,
  scopeNote,
}: {
  linked: PageListItem[];
  candidates: PageListItem[];
  onAdd: (pageId: string) => void;
  onRemove: (pageId: string) => void;
  onOpenPage: (pageId: string) => void;
  /** Where the candidates come from ("Pages in Projects"), if limited. */
  scopeNote?: string;
}) {
  const [q, setQ] = useState("");
  const linkedIds = useMemo(() => new Set(linked.map((p) => p.id)), [linked]);
  const query = q.trim().toLowerCase();
  const matches = useMemo(
    () =>
      candidates
        .filter((p) => !linkedIds.has(p.id))
        .filter((p) => !query || (p.title || "Untitled").toLowerCase().includes(query)),
    [candidates, linkedIds, query],
  );

  return (
    <div>
      {linked.length > 0 ? (
        <ul aria-label="Linked pages" style={{ maxHeight: 180, overflowY: "auto" }}>
          {linked.map((p) => (
            <li key={p.id} className="gio-mrow group/rel" style={{ gap: 4 }}>
              <button
                type="button"
                onClick={() => onOpenPage(p.id)}
                className="flex min-w-0 flex-1 items-center text-left text-strong hover:underline"
                style={{ gap: 8 }}
              >
                <MenuLead>
                  <Ico icon={p.icon || "📄"} size={16} />
                </MenuLead>
                <span className="truncate">{p.title || "Untitled"}</span>
              </button>
              <button
                type="button"
                aria-label={`Unlink ${p.title || "Untitled"}`}
                title="Unlink"
                onClick={() => onRemove(p.id)}
                className="grid shrink-0 place-items-center rounded-sm text-faint hover:bg-line hover:text-strong"
                style={{ width: 20, height: 20 }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <MenuSearch
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) {
            e.preventDefault();
            onAdd(matches[0].id);
            setQ("");
          }
        }}
        placeholder="Link a page…"
        aria-label="Find a page to link"
      />
      {scopeNote ? (
        <div className="gio-mfoot" style={{ paddingTop: 0 }}>
          {scopeNote}
        </div>
      ) : null}
      <ul aria-label="Pages you can link" style={{ maxHeight: 220, overflowY: "auto" }}>
        {matches.slice(0, MAX_SHOWN).map((p) => (
          <li key={p.id}>
            <MenuPageRow
              icon={p.icon || "📄"}
              label={p.title || "Untitled"}
              onPick={() => {
                onAdd(p.id);
                setQ("");
              }}
            />
          </li>
        ))}
        {matches.length === 0 ? (
          <li className="gio-mfoot">
            {query ? "No pages match." : "Every page that fits is linked."}
          </li>
        ) : matches.length > MAX_SHOWN ? (
          <li className="gio-mfoot">{matches.length - MAX_SHOWN} more. Type to narrow it down.</li>
        ) : null}
      </ul>
    </div>
  );
}
