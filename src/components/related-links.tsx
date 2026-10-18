/* Related links — the strip's value cell and its picker.
 *
 * Reading and editing are deliberately asymmetric:
 *   • The STRIP omits an unresolved entry entirely — no grey badge, no 🔒,
 *     no "Deleted page", and no "N more" counter. A badge title is often
 *     the whole secret ("Acme acquisition terms") and a counter leaks that
 *     something exists. Two people therefore see different numbers of
 *     badges with no indication anything was withheld. That is CORRECT.
 *   • The PICKER lists unresolved entries, because a dead id would
 *     otherwise be unremovable forever. Cleanup lives where editing lives.
 *
 * Resolution uses only `pages` — the reader's own RLS-filtered list. There
 * is no second permission rule here and no can_read_page call. */

import { useMemo, useRef, useState } from "react";
import { Popover } from "./popover";
import { Ico } from "./emoji-icon";
import { MenuFoot, MenuHead, MenuLead, MenuSearch, MenuSep } from "./menu-parts";
import {
  hrefOf,
  isUrlish,
  linkKind,
  relList,
  relResolve,
  type RelPage,
} from "@/lib/related-links";

export type RelPageItem = RelPage & { props?: unknown; edited_at?: string | null };


const BADGE_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  maxWidth: 240,
  borderRadius: 6,
  padding: "2px 5px 2px 7px",
  fontSize: 13,
  fontWeight: 700,
  border: 0,
  cursor: "pointer",
};

function Remove({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      className="gio-rel-x"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        fontSize: 12,
        lineHeight: 1,
        opacity: 0.5,
        cursor: "pointer",
        padding: "0 1px",
      }}
    >
      ×
    </span>
  );
}

export function RelatedLinks({
  value,
  pages,
  currentPageId,
  onSet,
  onOpenPage,
  onOpenChange,
}: {
  value: unknown;
  pages: readonly RelPageItem[];
  currentPageId?: string;
  onSet: (next: string[]) => void;
  /** In-app navigation — a page badge NEVER opens a new tab. */
  onOpenPage: (pageId: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const entries = relList(value);
  const remove = (entry: string) => onSet(entries.filter((e) => e !== entry));
  const add = (entry: string) => {
    if (entries.includes(entry)) return;
    onSet([...entries, entry]);
  };

  const resolved = entries.map((e) => ({ entry: e, r: relResolve(e, pages) }));

  return (
    <div
      className="flex min-w-0 flex-wrap items-center"
      style={{ gap: 5, padding: "3px 7px", marginLeft: -7 }}
      data-related-links
    >
      {resolved.map(({ entry, r }) => {
        if (r.kind === "unresolved") return null;
        if (r.kind === "page") {
          const title = r.page.title?.trim() || "Untitled";
          return (
            <span
              key={entry}
              data-rel-badge="page"
              style={{
                ...BADGE_STYLE,
                background: "var(--color-sunken)",
                color: "var(--color-strong)",
              }}
            >
              <button
                type="button"
                onClick={() => onOpenPage(r.page.id)}
                className="flex min-w-0 items-center"
                style={{
                  gap: 4,
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  font: "inherit",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                <Ico icon={r.page.icon} size={14} />
                <span className="truncate">{title}</span>
              </button>
              <Remove onClick={() => remove(entry)} label={`Remove ${title}`} />
            </span>
          );
        }
        const k = linkKind(r.url);
        return (
          <span
            key={entry}
            data-rel-badge="url"
            style={{
              ...BADGE_STYLE,
              background: `var(--color-${k.tint})`,
              color: `var(--color-${k.ink})`,
            }}
          >
            <a
              href={hrefOf(r.url)}
              target="_blank"
              rel="noreferrer noopener"
              className="flex min-w-0 items-center"
              style={{ gap: 4, color: "inherit", textDecoration: "none" }}
            >
              <span className="truncate">{k.label}</span>
              <svg
                viewBox="0 0 24 24"
                width={9}
                height={9}
                aria-hidden
                style={{ flex: "none", opacity: 0.65 }}
              >
                <path
                  d="M8 16 16 8M9.5 8H16v6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            <Remove onClick={() => remove(entry)} label={`Remove ${k.label}`} />
          </span>
        );
      })}

      <Popover
        width={272}
        onOpenChange={onOpenChange}
        trigger={({ onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            style={{
              borderRadius: 6,
              border: "1px dashed var(--color-line)",
              padding: "2px 7px",
              fontSize: 13,
              color: "var(--color-faint)",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            {entries.length === 0 ? "Link a page or paste a URL" : "Add"}
          </button>
        )}
      >
        {(close) => (
          <RelatedPicker
            entries={entries}
            pages={pages}
            currentPageId={currentPageId}
            onAdd={(v) => {
              add(v);
              close();
            }}
            onRemove={remove}
          />
        )}
      </Popover>
    </div>
  );
}

/* ── The picker body. Rendered inside the existing Popover panel — the
 * shell (border, radius, shadow, popIn) is NOT rebuilt here. ── */

function RelatedPicker({
  entries,
  pages,
  currentPageId,
  onAdd,
  onRemove,
}: {
  entries: string[];
  pages: readonly RelPageItem[];
  currentPageId?: string;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const [q, setQ] = useState("");
  const focused = useRef(false);
  const query = q.trim();

  const candidates = useMemo(() => {
    const linked = new Set(entries);
    const ql = query.toLowerCase();
    return pages
      .filter((p) => p.id !== currentPageId && !linked.has(p.id))
      .filter((p) => {
        if (!ql) return true;
        return (p.title ?? "").toLowerCase().includes(ql);
      })
      .slice()
      .sort((a, b) => (b.edited_at ?? "").localeCompare(a.edited_at ?? ""))
      .slice(0, 8);
  }, [pages, entries, currentPageId, query]);

  const urlRow = isUrlish(query) && !entries.includes(query) ? query : null;
  const unresolved = entries.filter(
    (e) => relResolve(e, pages).kind === "unresolved",
  );

  const pickFirst = () => {
    if (urlRow) return onAdd(urlRow);
    const first = candidates[0];
    if (first) onAdd(first.id);
  };

  const footer =
    query && !urlRow && candidates.length === 0
      ? "No page matches. Paste a full URL to link something outside Gio Docs."
      : "Pages you cannot open are not listed. External links open in a new tab.";

  return (
    <div style={{ maxHeight: 340, overflow: "auto" }}>
      <MenuHead>Related links</MenuHead>
      <MenuSearch
        inputRef={(el) => {
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
            pickFirst();
          }
        }}
        placeholder="Search pages, or paste a URL"
      />

      {urlRow ? (
        <PickRow
          label={`Link this ${linkKind(urlRow).label}`}
          hint="external"
          onPick={() => onAdd(urlRow)}
        />
      ) : null}

      {candidates.map((p) => (
        <PickRow
          key={p.id}
          icon={p.icon}
          label={p.title?.trim() || "Untitled"}
          onPick={() => onAdd(p.id)}
        />
      ))}

      {unresolved.length > 0 ? (
        <>
          <MenuSep />
          {unresolved.map((e) => (
            <PickRow
              key={e}
              label="Unresolved reference"
              onRemove={() => onRemove(e)}
            />
          ))}
        </>
      ) : null}

      <MenuFoot>{footer}</MenuFoot>
    </div>
  );
}

function PickRow({
  icon,
  label,
  hint,
  onPick,
  onRemove,
}: {
  icon?: string | null;
  label: string;
  hint?: string;
  onPick?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center" style={{ gap: 4 }}>
      <button
        type="button"
        onClick={onPick}
        disabled={!onPick}
        className="gio-mrow min-w-0 flex-1"
        style={onPick ? undefined : { cursor: "default", color: "var(--color-muted)" }}
      >
        <MenuLead>{icon !== undefined ? <Ico icon={icon} size={16} /> : null}</MenuLead>
        <span className="truncate">{label}</span>
        {hint ? <span className="gio-mrow-hint">{hint}</span> : null}
      </button>
      {onRemove ? (
        <Remove onClick={onRemove} label={`Remove ${label}`} />
      ) : null}
    </div>
  );
}
