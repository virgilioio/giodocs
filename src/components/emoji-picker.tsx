import { useEffect, useMemo, useRef, useState } from "react";
import { firstGrapheme } from "@/lib/area-icon";
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  emojisByCategory,
  searchEmoji,
  type Emoji,
  type EmojiCategory,
} from "@/lib/emoji-data";
import { useWorkspaceId } from "@/lib/workspace-context";
import { usePages, usePropDefs, useViews } from "@/hooks/use-workspace-data";

/**
 * Derive the "used in this workspace" set from already-cached data — same
 * discipline as areas being derived from the pages cache. Sources:
 *   - pages.icon (live pages only)
 *   - the `area` property_def's options[].icon
 *   - views.icon (non-null)
 * Ordered by frequency desc, then by emoji for stability, capped at 16.
 * Hidden when fewer than 3 distinct icons — a two-entry "frequently used"
 * row is noise.
 */
function useUsedInWorkspace(): string[] {
  const ws = useWorkspaceId();
  const pagesQ = usePages(ws);
  const propDefsQ = usePropDefs(ws);
  const viewsQ = useViews(ws);

  return useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (raw: unknown) => {
      if (typeof raw !== "string") return;
      const g = firstGrapheme(raw);
      if (!g) return;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    };
    for (const p of pagesQ.data ?? []) bump(p.icon);
    const areaDef = (propDefsQ.data ?? []).find(
      (d) => (d as { key?: string }).key === "area",
    ) as { options?: unknown } | undefined;
    const options = Array.isArray(areaDef?.options)
      ? (areaDef!.options as Array<{ icon?: unknown }>)
      : [];
    for (const opt of options) bump(opt?.icon);
    for (const v of viewsQ.data ?? []) bump((v as { icon?: unknown }).icon);

    const entries = [...counts.entries()];
    if (entries.length < 3) return [];
    entries.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
    return entries.slice(0, 16).map(([e]) => e);
  }, [pagesQ.data, propDefsQ.data, viewsQ.data]);
}

/**
 * Shared emoji picker — one component, three sites (page icon, view icon,
 * area emoji), plus the inline ":" trigger's popup (via EmojiInlineList).
 *
 * A hand-authored dataset lives in src/lib/emoji-data.ts. Categories are
 * scrollable with sticky section headers; a search box replaces the
 * sectioned view with a flat result grid. Keyboard nav highlights a
 * single cell — arrows to move, Enter to pick, Escape clears the query
 * or closes.
 *
 * `firstGrapheme` still supports typing/pasting an emoji not in the
 * dataset — that raw grapheme is surfaced as the first result so
 * anything outside the file remains reachable.
 */

const CELL = 30;
const COLS = 8;

export function EmojiPicker({
  onPick,
  removable = false,
}: {
  onPick: (emoji: string | null) => void;
  removable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [activeCat, setActiveCat] = useState<EmojiCategory>("people");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const focusedOnce = useRef(false);

  // Autofocus once. A ref guard keeps re-renders from stealing the caret.
  useEffect(() => {
    if (focusedOnce.current) return;
    focusedOnce.current = true;
    searchRef.current?.focus();
  }, []);

  const sections = useMemo(
    () =>
      CATEGORY_ORDER.map((c) => ({ cat: c, items: emojisByCategory(c) })),
    [],
  );

  const searching = query.trim().length > 0;

  const results = useMemo<Emoji[]>(() => {
    if (!searching) return [];
    const found = searchEmoji(query, 80);
    const g = firstGrapheme(query);
    // If the query itself is an emoji grapheme and not already first,
    // surface it as the first result so raw emoji stays reachable.
    if (g && (!found[0] || found[0].char !== g)) {
      return [
        { char: g, name: query.trim(), keywords: [], category: "symbols" as EmojiCategory },
        ...found,
      ];
    }
    return found;
  }, [query, searching]);

  const flatSectioned = useMemo<Emoji[]>(
    () => sections.flatMap((s) => s.items),
    [sections],
  );
  const flat = searching ? results : flatSectioned;

  // Reset the highlight when the visible list changes.
  useEffect(() => {
    setHighlight(0);
  }, [query, searching]);

  const pick = (e: Emoji | undefined) => {
    if (!e) return;
    onPick(e.char);
  };

  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      if (query.length > 0) setQuery("");
      else onPick(undefined as unknown as null); // no-op close hook; caller closes popover
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      pick(flat[highlight]);
      return;
    }
    if (ev.key === "ArrowRight") {
      ev.preventDefault();
      setHighlight((h) => Math.min(flat.length - 1, h + 1));
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setHighlight((h) => Math.min(flat.length - 1, h + COLS));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setHighlight((h) => Math.max(0, h - COLS));
    }
  };

  const scrollToCategory = (c: EmojiCategory) => {
    const el = sectionRefs.current[c];
    const s = scrollRef.current;
    if (!el || !s) return;
    s.scrollTop = el.offsetTop - s.offsetTop;
    setActiveCat(c);
  };

  // Update active tab based on scroll position of section headers.
  const onScroll = () => {
    const s = scrollRef.current;
    if (!s) return;
    const y = s.scrollTop;
    let cur: EmojiCategory = "people";
    for (const c of CATEGORY_ORDER) {
      const el = sectionRefs.current[c];
      if (el && el.offsetTop - s.offsetTop <= y + 4) cur = c;
    }
    setActiveCat(cur);
  };

  return (
    <div
      className="rounded-xl border border-line bg-surface shadow-popover animate-popIn"
      style={{ width: 320 }}
      onKeyDown={onKey}
    >
      <div className="p-2">
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji…"
          aria-label="Search emoji"
          className="w-full rounded-md border border-line bg-track px-2 py-1.5 text-meta outline-none placeholder:text-faint"
          style={{ borderRadius: 9, padding: "7px 9px", fontSize: 14 }}
        />
      </div>

      {!searching ? (
        <div
          className="flex items-center gap-1 px-2 pb-1"
          role="tablist"
          aria-label="Emoji categories"
        >
          {CATEGORY_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={activeCat === c}
              aria-label={CATEGORY_LABEL[c]}
              title={CATEGORY_LABEL[c]}
              onClick={() => scrollToCategory(c)}
              className={
                "grid place-items-center rounded-md " +
                (activeCat === c ? "bg-selected" : "hover:bg-sunken")
              }
              style={{ width: 26, height: 26, fontSize: 15, lineHeight: 1 }}
            >
              {CATEGORY_ICON[c]}
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="overflow-y-auto px-2 pb-2"
        style={{ maxHeight: 320 }}
      >
        {searching ? (
          results.length === 0 ? (
            <div className="px-1 py-6 text-center text-meta text-faint">
              No emoji matches “{query}”.
            </div>
          ) : (
            <EmojiGrid
              items={results}
              highlight={highlight}
              onPick={pick}
              onHover={setHighlight}
            />
          )
        ) : (
          sections.map(({ cat, items }, sectionIdx) => {
            // Compute the highlight index offset for this section within the flat list.
            const offset = sections
              .slice(0, sectionIdx)
              .reduce((n, s) => n + s.items.length, 0);
            return (
              <div
                key={cat}
                ref={(el) => { sectionRefs.current[cat] = el; }}
              >
                <div
                  className="sticky top-0 z-[1] bg-surface pb-1 pt-2 text-label uppercase text-faint"
                >
                  {CATEGORY_LABEL[cat]}
                </div>
                <EmojiGrid
                  items={items}
                  highlight={highlight - offset}
                  onPick={pick}
                  onHover={(i) => setHighlight(offset + i)}
                />
              </div>
            );
          })
        )}
      </div>

      {removable ? (
        <>
          <div className="mx-2 border-t border-lineSoft" />
          <button
            type="button"
            onClick={() => onPick(null)}
            className="w-full rounded-sm px-3 py-1.5 text-left text-meta text-muted hover:bg-rail"
          >
            Remove
          </button>
        </>
      ) : null}
    </div>
  );
}

/** Shared grid used by the picker and the inline trigger popup. */
export function EmojiGrid({
  items,
  highlight,
  onPick,
  onHover,
}: {
  items: Emoji[];
  highlight: number;
  onPick: (e: Emoji) => void;
  onHover?: (idx: number) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Emoji"
      className="grid"
      style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 2 }}
    >
      {items.map((e, i) => {
        const isHi = i === highlight;
        return (
          <button
            key={e.char + i}
            type="button"
            role="option"
            aria-selected={isHi}
            aria-label={e.name}
            title={`:${e.name}:`}
            onMouseEnter={() => onHover?.(i)}
            onClick={() => onPick(e)}
            className={
              "grid place-items-center rounded-md hover:bg-sunken " +
              (isHi ? "ring-2 ring-accent" : "")
            }
            style={{ width: CELL, height: CELL, fontSize: 20, lineHeight: 1 }}
          >
            {e.char}
          </button>
        );
      })}
    </div>
  );
}
