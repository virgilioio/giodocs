import { useEffect, useRef, useState } from "react";
import { RowMenu, type MenuBuildCtx, type MenuSpec } from "./row-menu";

/* The database toolbar (2026-10-11, Notion's): icon buttons on the right of
 * a database's title — Filter, Sort, Search, Open as full page, View
 * settings — and the New button with its ▾ (templates). Every icon button
 * has an aria-label and a title, so the shared tooltip names it. Inside a
 * page it shows while the database is pointed at or holds focus
 * (.gio-db-tools in styles.css); on a database page it always shows. */

const P = {
  filter: "M4 6h16M7 12h10M10 18h4",
  sort: "M7 4v12m0 0-3-3m3 3 3-3M17 20V8m0 0-3 3m3-3 3 3",
  search: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.3-4.3",
  open: "M14 4h6v6M20 4l-7 7M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4",
  settings: "M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4",
  chevron: "m6 9 6 6 6-6",
  close: "M6 6l12 12M18 6 6 18",
};

function Ico({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ flex: "none" }}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconButton({
  label,
  d,
  onClick,
  pressed,
  innerRef,
}: {
  label: string;
  d: string;
  onClick: (el: HTMLButtonElement) => void;
  pressed?: boolean;
  innerRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={innerRef}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={(e) => onClick(e.currentTarget)}
      className={`grid place-items-center rounded-md hover:bg-sunken hover:text-strong ${pressed ? "bg-sunken text-strong" : "text-muted"}`}
      style={{ width: 28, height: 28 }}
    >
      <Ico d={d} />
    </button>
  );
}

/** A button that opens a MenuSpec menu (View settings, New ▾). */
function useSpecMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [spec, setSpec] = useState<MenuSpec | null>(null);
  const close = () => {
    setAnchor(null);
    setSpec(null);
  };
  const open = (el: HTMLElement, build: (ctx: MenuBuildCtx) => MenuSpec) => {
    setSpec(build({ setSpec, close }));
    setAnchor(el);
  };
  const node = <RowMenu spec={spec} anchor={anchor} onClose={close} />;
  return { open, node, isOpen: !!anchor };
}

export function DatabaseToolbar({
  onFilter,
  onSort,
  search,
  onSearch,
  onOpenFull,
  settings,
  onNew,
  newMenu,
  always = false,
}: {
  onFilter?: () => void;
  onSort?: () => void;
  /** The search text (rows whose title contains it); "" when closed. */
  search: string;
  onSearch: (q: string) => void;
  /** Inside a page: open the database as its own page. */
  onOpenFull?: () => void;
  /** View settings. */
  settings: (ctx: MenuBuildCtx) => MenuSpec;
  /** New row; omitted for people who can't add one. */
  onNew?: () => void;
  /** New ▾: templates of this database. */
  newMenu?: (ctx: MenuBuildCtx) => MenuSpec;
  /** On a database page the toolbar always shows. */
  always?: boolean;
}) {
  const [searching, setSearching] = useState(search !== "");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (searching) inputRef.current?.focus();
  }, [searching]);
  const settingsMenu = useSpecMenu();
  const newMenuState = useSpecMenu();
  const pinned = searching || settingsMenu.isOpen || newMenuState.isOpen;

  return (
    <div
      className="gio-db-tools flex shrink-0 items-center"
      data-db-tools
      data-always={always || undefined}
      data-pinned={pinned || undefined}
      style={{ gap: 2 }}
    >
      {onFilter ? <IconButton label="Filter" d={P.filter} onClick={() => onFilter()} /> : null}
      {onSort ? <IconButton label="Sort" d={P.sort} onClick={() => onSort()} /> : null}
      {searching ? (
        <span className="flex items-center rounded-md border border-line" style={{ height: 28, padding: "0 4px 0 6px", gap: 4 }}>
          <span className="text-muted">
            <Ico d={P.search} size={14} />
          </span>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onSearch("");
                setSearching(false);
              }
            }}
            onBlur={() => {
              if (!search) setSearching(false);
            }}
            placeholder="Type to search…"
            aria-label="Search rows"
            className="w-36 bg-transparent text-ui text-strong focus:outline-none"
          />
          <button
            type="button"
            aria-label="Clear search"
            title="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onSearch("");
              setSearching(false);
            }}
            className="grid place-items-center rounded-sm text-faint hover:text-strong"
            style={{ width: 18, height: 18 }}
          >
            <Ico d={P.close} size={12} />
          </button>
        </span>
      ) : (
        <IconButton label="Search" d={P.search} onClick={() => setSearching(true)} />
      )}
      {onOpenFull ? <IconButton label="Open as full page" d={P.open} onClick={() => onOpenFull()} /> : null}
      <IconButton
        label="View settings"
        d={P.settings}
        pressed={settingsMenu.isOpen}
        onClick={(el) => settingsMenu.open(el, settings)}
      />
      {onNew ? (
        <span className="ml-1 inline-flex items-stretch overflow-hidden rounded-md bg-btn text-btnFg" style={{ height: 28 }}>
          <button
            type="button"
            onClick={onNew}
            className="flex items-center text-ui font-bold"
            style={{ padding: "0 10px" }}
            title="New page in this database"
          >
            New
          </button>
          {newMenu ? (
            <button
              type="button"
              aria-label="New from a template"
              title="New from a template"
              onClick={(e) => newMenuState.open(e.currentTarget, newMenu)}
              className="grid place-items-center border-l"
              style={{ width: 24, borderColor: "rgba(255,255,255,.18)" }}
            >
              <Ico d={P.chevron} size={14} />
            </button>
          ) : null}
        </span>
      ) : null}
      {settingsMenu.node}
      {newMenuState.node}
    </div>
  );
}
