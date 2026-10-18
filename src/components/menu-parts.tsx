/**
 * The parts every desktop menu is built from (Notion's menus, Allan
 * 2026-10-18). The look lives in styles.css (MENUS: .gio-menu, .gio-mrow,
 * .gio-mrow-lead, .gio-mrow-hint, .gio-mrow-chev, .gio-mrow-check,
 * .gio-msep, .gio-mhead, .gio-mfoot); these components only spare each
 * menu from copying the markup. A row is a plain element with className
 * "gio-mrow": its label is a `.truncate` span, a leading icon sits in
 * <MenuLead>, and `data-danger` / `data-active` mark Delete-like rows and the
 * keyboard highlight.
 */
import type { ReactNode } from "react";

/** The 20px leading slot, so every label in a menu starts on one line. */
export function MenuLead({ children }: { children?: ReactNode }) {
  return (
    <span className="gio-mrow-lead" aria-hidden>
      {children}
    </span>
  );
}

/** A 20px line icon; a 1.6 stroke draws about 1.3px, Notion's weight. */
export function MenuIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The chosen option's tick, at the row's end. */
export function MenuCheck() {
  return (
    <svg className="gio-mrow-check" viewBox="0 0 24 24" width={16} height={16} aria-hidden>
      <path
        d="M20 6 9 17l-5-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A row that opens a submenu ends in Notion's chevron. */
export function MenuChevron() {
  return (
    <svg className="gio-mrow-chev" viewBox="0 0 24 24" width={16} height={16} aria-hidden>
      <path
        d="m9 18 6-6-6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MenuSep() {
  return <div aria-hidden className="gio-msep" />;
}

/** The 12px sentence-case header, with a ‹ Back button on a submenu step. */
export function MenuHead({
  children,
  onBack,
  trailing,
}: {
  children: ReactNode;
  onBack?: () => void;
  /** A small control at the header's end (Show all / Hide all). */
  trailing?: ReactNode;
}) {
  return (
    <div className="gio-mhead">
      {onBack && (
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="grid place-items-center rounded-sm hover:bg-rail"
          style={{ width: 20, height: 20 }}
        >
          <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden>
            <path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </div>
  );
}

/** A note under the rows, after a divider. */
export function MenuFoot({ children }: { children: ReactNode }) {
  return (
    <>
      <MenuSep />
      <div className="gio-mfoot">{children}</div>
    </>
  );
}
