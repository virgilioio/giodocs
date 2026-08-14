/**
 * The topbar breadcrumb — ANCESTORS ONLY.
 *
 * The current page's own title is never rendered here: it already sits in
 * 38px display type ~80px below, and repeating it spends the one horizontal
 * run in a 48px bar that could carry context instead.
 *
 * Each crumb's chevron opens ITS SIBLINGS — pages sharing that crumb's
 * parent_id — so the user can step SIDEWAYS, not only back up. That is the
 * widening move a folder tree gives for free and a breadcrumb usually
 * withholds.
 *
 * `ancestorsOf` is already root-first, already excludes the page, and already
 * returns a PARTIAL chain when an ancestor is unreadable. Nothing is rendered
 * for a root page.
 */

import { useNavigate } from "@tanstack/react-router";
import { ancestorsOf, type TreePage } from "@/lib/page-tree";
import { Ico } from "./emoji-icon";
import { Popover } from "./popover";

const FOOTER = "A page is also reachable from any view that matches it.";

function titleOf(p: TreePage): string {
  return String(p.title ?? "").trim() || "Untitled";
}

function MenuRow({
  icon,
  label,
  onPick,
}: {
  icon?: string | null;
  label: string;
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
      <Ico icon={icon} size={15} />
      <span className="min-w-0 flex-1 truncate" style={{ fontSize: 13.5 }}>
        {label}
      </span>
    </button>
  );
}

function MenuFooter() {
  return (
    <div
      style={{
        padding: "6px 10px 8px",
        fontSize: 11.5,
        lineHeight: 1.45,
        color: "var(--color-faint)",
      }}
    >
      {FOOTER}
    </div>
  );
}

function Chev({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => React.ReactNode;
}) {
  return (
    <Popover
      width={272}
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          aria-label={label}
          title={label}
          className="text-rule hover:text-secondary"
          style={{
            border: 0,
            background: "transparent",
            padding: "0 1px",
            fontSize: 13,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          ›
        </button>
      )}
    >
      {children}
    </Popover>
  );
}

export function PageBreadcrumbView<P extends TreePage>({
  pageId,
  pages,
  onOpen,
}: {
  pageId: string;
  pages: readonly P[];
  onOpen: (id: string) => void;
}) {
  const chain = ancestorsOf(pageId, pages);
  if (!chain.length) return null;

  // Over 3 ancestors, the middle collapses to a single … whose menu lists
  // the full chain — the bar keeps its width budget, nothing is lost.
  const collapsed = chain.length > 3;
  const shown = collapsed ? [chain[0]!, chain[chain.length - 1]!] : chain;

  const siblingsOf = (crumb: P) =>
    pages.filter(
      (p) => (p.parent_id ?? null) === (crumb.parent_id ?? null),
    );

  const crumb = (c: P) => (
    <span key={c.id} className="flex shrink-0 items-center" style={{ gap: 4 }}>
      <button
        type="button"
        onClick={() => onOpen(c.id)}
        className="max-w-[180px] truncate text-secondary hover:text-strong"
        style={{
          border: 0,
          background: "transparent",
          padding: 0,
          fontSize: 13.5,
          cursor: "pointer",
        }}
      >
        {titleOf(c)}
      </button>
      <Chev label={`Pages beside ${titleOf(c)}`}>
        {(close) => (
          <div>
            {siblingsOf(c).map((s) => (
              <MenuRow
                key={s.id}
                icon={s.icon}
                label={titleOf(s)}
                onPick={() => {
                  close();
                  onOpen(s.id);
                }}
              />
            ))}
            <MenuFooter />
          </div>
        )}
      </Chev>
    </span>
  );

  return (
    <nav
      aria-label="Ancestors"
      data-breadcrumb
      className="flex min-w-0 items-center"
      style={{ gap: 6 }}
    >
      {collapsed ? (
        <>
          {crumb(shown[0]!)}
          <Popover
            width={272}
            trigger={({ onClick, ref }) => (
              <button
                ref={ref}
                type="button"
                onClick={onClick}
                aria-label="Show the full chain"
                title="Show the full chain"
                className="shrink-0 text-faint hover:text-secondary"
                style={{
                  border: 0,
                  background: "transparent",
                  padding: "0 2px",
                  fontSize: 13.5,
                  lineHeight: 1,
                  cursor: "pointer",
                }}
              >
                …
              </button>
            )}
          >
            {(close) => (
              <div>
                {chain.map((c) => (
                  <MenuRow
                    key={c.id}
                    icon={c.icon}
                    label={titleOf(c)}
                    onPick={() => {
                      close();
                      onOpen(c.id);
                    }}
                  />
                ))}
                <MenuFooter />
              </div>
            )}
          </Popover>
          {crumb(shown[1]!)}
        </>
      ) : (
        shown.map((c) => crumb(c))
      )}
    </nav>
  );
}

export function PageBreadcrumb<P extends TreePage>({
  pageId,
  pages,
}: {
  pageId: string;
  pages: readonly P[];
}) {
  const navigate = useNavigate();
  return (
    <PageBreadcrumbView
      pageId={pageId}
      pages={pages}
      onOpen={(id) => {
        void navigate({ to: "/p/$pageId", params: { pageId: id } });
      }}
    />
  );
}
