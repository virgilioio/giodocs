/**
 * The single popover shell used by every `⋯` in the product (sidebar rows,
 * view toolbar, block handles, property pickers).
 *
 * Two ways in — one shell:
 *   (a) Declarative:  <RowMenu spec={…} anchor={btn} onClose={…} />
 *       Caller owns the spec state; a submenu is a spec swap on the same
 *       anchor, so the panel never moves. Preferred for new menus. Use
 *       <SpecMenuTrigger> when you just need a ⋯ button that opens a spec.
 *   (b) Imperative:   useRowMenu().open(anchorEl, node)  +  <RowMenuList>
 *       Retained ONLY as a compat surface for menus not yet migrated to the
 *       spec API. Both paths render through `MenuShell` — there is exactly
 *       one panel geometry in this file.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { IC } from "@/lib/menu-icons";

/* ═══════════════════════ SPEC TYPES (declarative API) ═══════════════════════ */

export type MenuHint = { text: string; mono?: boolean };

export type MenuRow =
  | { kind: "sep" }
  | {
      kind: "row";
      label: string;
      /** 15px single-path icon key (from `IC`) or explicit path string. */
      icon?: string;
      /** 8px status dot — mutually exclusive with icon/person. */
      dot?: string;
      /** 20px pastel avatar — mutually exclusive with icon/dot. */
      person?: { initials: string; tint: string; ink: string };
      hint?: MenuHint;
      checked?: boolean;
      danger?: boolean;
      onPick: () => void;
    };

export type MenuSpec = {
  title: string;
  rows: MenuRow[];
  footer?: string;
  input?: {
    placeholder: string;
    initial?: string;
    selectOnFocus?: boolean;
    onCommit: (v: string) => void;
  };
  confirm?: {
    title: string;
    body: string;
    cta: string;
    danger?: boolean;
    onConfirm: () => void;
  };
  /** When set, the title bar renders a ‹ Back button that calls this. */
  onBack?: () => void;
  width?: number;
};

/** Ergonomic type for spec-builder callers: swap the spec (submenu) or close. */
export type MenuBuildCtx = {
  setSpec: (s: MenuSpec) => void;
  close: () => void;
};

/* ═══════════════════════ ONE SHELL ═══════════════════════ */

function usePlacement(
  anchor: HTMLElement | null,
  width: number,
): { top: number; left: number; flipped: boolean } | null {
  const [pos, setPos] = useState<
    { top: number; left: number; flipped: boolean } | null
  >(null);
  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const margin = 8;
      const gap = 6;
      // Opens DOWN AND LEFT — panel's right edge aligns with button's right.
      let left = r.right - width;
      if (left < margin) left = margin;
      const maxLeft = window.innerWidth - width - margin;
      if (left > maxLeft) left = maxLeft;
      const estHeight = 320;
      let top_ = r.bottom + gap;
      let flipped = false;
      if (
        top_ + estHeight + margin > window.innerHeight &&
        r.top - gap - estHeight > margin
      ) {
        top_ = Math.max(margin, r.top - gap - estHeight);
        flipped = true;
      }
      setPos({ top: top_, left, flipped });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, width]);
  return pos;
}

/**
 * The ONE panel — transparent scrim + positioned box with the exact spec
 * geometry. All menu contents (spec-driven and legacy) render through here.
 */
function MenuShell({
  anchor,
  width,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  width: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const pos = usePlacement(anchor, width);
  if (!anchor || !pos) return null;
  return createPortal(
    <>
      {/* Transparent scrim catches outside clicks. */}
      <div
        aria-hidden
        onMouseDown={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 100 }}
      />
      <div
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-popIn"
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width,
          zIndex: 101,
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          borderRadius: 12,
          padding: 6,
          boxShadow: "0 18px 48px rgba(13,13,9,.16)",
          transformOrigin: pos.flipped ? "bottom right" : "top right",
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/* ═══════════════════════ SPEC RENDERER ═══════════════════════ */

/**
 * Filter separators so they belong to the row that follows: strip leading
 * seps, collapse consecutive seps, and drop trailing seps. This is what
 * makes "a conditionally hidden row takes its separator with it" work — the
 * caller just omits the row and the surrounding sep drops on its own.
 */
function cleanRows(rows: MenuRow[]): MenuRow[] {
  const out: MenuRow[] = [];
  let sepPending = false;
  let sawContent = false;
  for (const r of rows) {
    if (r.kind === "sep") {
      if (sawContent) sepPending = true;
      continue;
    }
    if (sepPending) {
      out.push({ kind: "sep" });
      sepPending = false;
    }
    out.push(r);
    sawContent = true;
  }
  return out;
}

function MenuHintView({ hint }: { hint: MenuHint }) {
  return (
    <span
      style={{
        flex: "none",
        maxWidth: 112,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: "var(--color-whisper)",
        fontFamily: hint.mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: hint.mono ? 11.5 : 12,
        letterSpacing: hint.mono ? 0 : undefined,
      }}
    >
      {hint.text}
    </span>
  );
}

function MenuIcon({ path, danger }: { path: string; danger?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      aria-hidden
      style={{ flex: "none", color: danger ? "currentColor" : "var(--color-muted)" }}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden style={{ flex: "none" }}>
      <path
        d="M20 6 9 17l-5-5"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpecRow({ row }: { row: Extract<MenuRow, { kind: "row" }> }) {
  const iconPath =
    row.icon && (row.icon in IC ? IC[row.icon as keyof typeof IC] : row.icon);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        row.onPick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className={
        "flex w-full items-center rounded-md text-left " +
        (row.danger ? "hover:bg-dangerTint" : "hover:bg-rail")
      }
      style={{
        padding: "7px 10px",
        gap: 9,
        color: row.danger ? "var(--color-danger)" : "var(--color-body)",
        cursor: "pointer",
      }}
    >
      {/* Leading slot — shared, never additive. */}
      {row.person ? (
        <span
          aria-hidden
          className="grid place-items-center"
          style={{
            width: 20,
            height: 20,
            borderRadius: 99,
            background: row.person.tint,
            color: row.person.ink,
            fontSize: 10.5,
            fontWeight: 700,
            flex: "none",
          }}
        >
          {row.person.initials}
        </span>
      ) : row.dot ? (
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            background: row.dot,
            flex: "none",
            marginLeft: 3,
            marginRight: 4,
          }}
        />
      ) : iconPath ? (
        <MenuIcon path={iconPath} danger={row.danger} />
      ) : (
        <span aria-hidden style={{ width: 15, flex: "none" }} />
      )}

      <span
        className="truncate"
        style={{ flex: 1, minWidth: 0, fontSize: 14.5 }}
      >
        {row.label}
      </span>

      {row.checked && <CheckIcon />}
      {row.hint && <MenuHintView hint={row.hint} />}

    </button>
  );
}

function SpecBody({ spec, onClose }: { spec: MenuSpec; onClose: () => void }) {
  if (spec.confirm) {
    const c = spec.confirm;
    return (
      <div style={{ padding: "9px 10px 3px" }}>
        <div
          style={{
            fontSize: 14.5,
            fontWeight: 700,
            color: "var(--color-noir)",
            fontFamily: "var(--font-display)",
          }}
        >
          {c.title}
        </div>
        <div
          style={{
            fontSize: 13.5,
            color: "var(--color-secondary)",
            lineHeight: 1.45,
            marginTop: 6,
          }}
        >
          {c.body}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md text-secondary hover:bg-rail"
            style={{ padding: "6px 10px", fontSize: 13.5 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              c.onConfirm();
              onClose();
            }}
            className="rounded-md"
            style={{
              padding: "6px 12px",
              fontSize: 13.5,
              fontWeight: 700,
              background: c.danger ? "var(--color-danger)" : "var(--color-noir)",
              color: c.danger ? "var(--color-surface)" : "var(--color-track)",
            }}
          >
            {c.cta}
          </button>
        </div>
      </div>
    );
  }

  const rows = cleanRows(spec.rows);
  return (
    <div style={{ maxHeight: 280, overflow: "auto" }}>
      <div
        className="flex items-center gap-1 truncate"
        style={{
          padding: "7px 10px 3px",
          fontFamily: "var(--font-display)",
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "var(--color-faint)",
        }}
      >
        {spec.onBack && (
          <button
            type="button"
            aria-label="Back"
            onClick={spec.onBack}
            className="grid place-items-center rounded-sm hover:bg-rail"
            style={{ width: 16, height: 16, marginRight: 2 }}
          >
            <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden>
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
        <span className="truncate">{spec.title}</span>
      </div>
      <div>
        {rows.map((r, i) =>
          r.kind === "sep" ? (
            <div
              key={`s-${i}`}
              aria-hidden
              style={{
                height: 1,
                background: "var(--color-lineSoft)",
                margin: "4px 3px",
              }}
            />
          ) : (
            <SpecRow key={`r-${i}`} row={r} />
          ),
        )}
      </div>
      {spec.input && <SpecInput input={spec.input} onClose={onClose} />}
      {spec.footer && (
        <div
          style={{
            borderTop: "1px solid var(--color-lineSoft)",
            margin: "4px 4px 0",
            padding: "8px 7px 4px",
            fontSize: 12.5,
            lineHeight: 1.45,
            color: "var(--color-whisper)",
          }}
        >
          {spec.footer}
        </div>
      )}
    </div>
  );
}

function SpecInput({
  input,
  onClose,
}: {
  input: NonNullable<MenuSpec["input"]>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(input.initial ?? "");
  const ref = useRef<HTMLInputElement | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (input.selectOnFocus) el.select();
    focused.current = true;
  }, [input.selectOnFocus]);
  return (
    <div
      style={{
        borderTop: "1px solid var(--color-lineSoft)",
        margin: 4,
        paddingTop: 5,
      }}
    >
      <input
        ref={ref}
        value={value}
        placeholder={input.placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const v = value.trim();
            if (v) input.onCommit(v);
            onClose();
          }
        }}
        className="w-full bg-rail focus:outline-none"
        style={{
          borderRadius: 7,
          padding: "7px 10px",
          fontSize: 14,
          color: "var(--color-body)",
          border: "none",
        }}
      />
    </div>
  );
}

/* ═══════════════════════ DECLARATIVE API ═══════════════════════ */

export function RowMenu({
  spec,
  anchor,
  onClose,
}: {
  spec: MenuSpec | null;
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  // Provider-level Escape covers imperative menus; declarative <RowMenu>
  // needs its own — but it's still ONE listener per open menu, not per row.
  useEffect(() => {
    if (!anchor || !spec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchor, spec, onClose]);
  if (!spec || !anchor) return null;
  const baseWidth = spec.width ?? 272;
  const width = spec.confirm ? Math.max(baseWidth, 320) : baseWidth;
  return (
    <MenuShell anchor={anchor} width={width} onClose={onClose}>
      <SpecBody spec={spec} onClose={onClose} />
    </MenuShell>
  );
}

/**
 * A ⋯ button that manages its own menu state. `build` runs on each open and
 * receives `{ setSpec, close }` — `setSpec` swaps the panel to a submenu (or
 * an input/confirm frame) IN PLACE, without moving the anchor.
 */
export function SpecMenuTrigger({
  build,
  size = "sm",
  ariaLabel = "More",
  visible = true,
  className = "",
}: {
  build: (ctx: MenuBuildCtx) => MenuSpec;
  size?: "sm" | "toolbar" | "row" | "board-row";
  ariaLabel?: string;
  visible?: boolean;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [spec, setSpec] = useState<MenuSpec | null>(null);
  const close = useCallback(() => {
    setAnchor(null);
    setSpec(null);
  }, []);
  const px =
    size === "toolbar" ? 26 : size === "row" ? 24 : size === "board-row" ? 22 : 17;
  const hoverClass =
    size === "row" || size === "board-row"
      ? "text-faint hover:bg-line hover:text-strong"
      : "text-whisper hover:bg-railHover hover:text-strong";
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const btn = e.currentTarget;
          const initial = build({ setSpec, close });
          setSpec(initial);
          setAnchor(btn);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={
          "grid place-items-center rounded-md " +
          hoverClass +
          " " +
          (visible ? "" : "pointer-events-none opacity-0 ") +
          className
        }
        style={{ width: px, height: px, flex: "none" }}
      >
        <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden>
          <path
            d="M5 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zM12 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zM19 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z"
            fill="currentColor"
          />
        </svg>
      </button>
      <RowMenu spec={spec} anchor={anchor} onClose={close} />
    </>
  );
}

/* ═══════════════════════ LEGACY IMPERATIVE API (compat) ═══════════════════════
 *
 * Retained for menus not yet migrated to the spec API — page-row ⋯, view
 * toolbar ⋯, block-handle ⋯, property pickers, export dialogs. Rendering
 * goes through the SAME `MenuShell` above.
 * ─────────────────────────────────────────────────────────────────────────── */

type Anchor = HTMLElement;
type Frame = { node: ReactNode; width: number };

type Ctx = {
  open: (anchor: Anchor, node: ReactNode, opts?: { width?: number }) => void;
  push: (node: ReactNode, opts?: { width?: number }) => void;
  pop: () => void;
  close: () => void;
  isOpen: boolean;
  canGoBack: boolean;
};

const RowMenuCtx = createContext<Ctx | null>(null);

export function useRowMenu(): Ctx {
  const c = useContext(RowMenuCtx);
  if (!c) throw new Error("useRowMenu must be used within RowMenuProvider");
  return c;
}

export function RowMenuProvider({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [stack, setStack] = useState<Frame[]>([]);

  const close = useCallback(() => {
    setAnchor(null);
    setStack([]);
  }, []);

  const open = useCallback<Ctx["open"]>((el, node, opts) => {
    setAnchor(el);
    setStack([{ node, width: opts?.width ?? 272 }]);
  }, []);

  const push = useCallback<Ctx["push"]>((node, opts) => {
    setStack((s) => [
      ...s,
      { node, width: opts?.width ?? s[s.length - 1]?.width ?? 272 },
    ]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const top = stack[stack.length - 1] ?? null;

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchor, close]);

  const ctx = useMemo<Ctx>(
    () => ({
      open,
      push,
      pop,
      close,
      isOpen: !!anchor,
      canGoBack: stack.length > 1,
    }),
    [open, push, pop, close, anchor, stack.length],
  );

  return (
    <RowMenuCtx.Provider value={ctx}>
      {children}
      {top ? (
        <MenuShell anchor={anchor} width={top.width} onClose={close}>
          {top.node}
        </MenuShell>
      ) : null}
    </RowMenuCtx.Provider>
  );
}

export type RowMenuItem =
  | {
      kind?: "item";
      id?: string;
      label: string;
      onSelect?: () => void;
      hint?: ReactNode;
      danger?: boolean;
      disabled?: boolean;
      check?: boolean;
      dot?: string;
      avatar?: { tint: string; ink: string; initials: string };
      submenu?: boolean;
      keepOpen?: boolean;
    }
  | { kind: "divider" };

export function Sc({ children }: { children: ReactNode }) {
  return (
    <span
      className="font-mono"
      style={{ fontSize: 12, color: "var(--color-whisper)", letterSpacing: 0 }}
    >
      {children}
    </span>
  );
}

export function Val({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 12,
        color: "var(--color-whisper)",
        maxWidth: 120,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function RowMenuList({
  title,
  items,
  footer,
  input,
  onBack,
}: {
  title: string;
  items: RowMenuItem[];
  footer?: ReactNode;
  input?: {
    initialValue?: string;
    placeholder?: string;
    autoSelect?: boolean;
    onSubmit: (value: string) => void;
  };
  onBack?: () => void;
}) {
  return (
    <div style={{ maxHeight: 280, overflow: "auto" }}>
      <div
        className="flex items-center gap-1"
        style={{
          padding: "7px 10px 3px",
          fontFamily: "var(--font-display)",
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: ".07em",
          textTransform: "uppercase",
          color: "var(--color-faint)",
        }}
      >
        {onBack && (
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="grid place-items-center rounded-sm hover:bg-rail"
            style={{ width: 16, height: 16, marginRight: 2 }}
          >
            <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden>
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
        <span className="truncate">{title}</span>
      </div>
      <div>
        {items.map((it, i) =>
          it.kind === "divider" ? (
            <div
              key={`d-${i}`}
              style={{
                height: 1,
                background: "var(--color-lineSoft)",
                margin: "4px 3px",
              }}
            />
          ) : (
            <RowMenuRow key={it.id ?? `${it.label}-${i}`} item={it} />
          ),
        )}
      </div>
      {input && <RowMenuInput {...input} />}
      {footer && (
        <div
          style={{
            borderTop: "1px solid var(--color-lineSoft)",
            padding: "8px 10px 6px",
            fontSize: 12.5,
            lineHeight: 1.45,
            color: "var(--color-whisper)",
            margin: "4px 0 0",
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

function RowMenuRow({ item }: { item: Exclude<RowMenuItem, { kind: "divider" }> }) {
  const { close } = useRowMenu();
  const disabled = item.disabled;
  const color = item.danger ? "var(--color-danger)" : "var(--color-body)";
  const bg = item.danger ? "hover:bg-dangerTint" : "hover:bg-rail";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (disabled) return;
        item.onSelect?.();
        if (!item.keepOpen && !item.submenu) close();
      }}
      className={"flex w-full items-center rounded-md text-left " + bg}
      style={{
        padding: "7px 10px",
        gap: 9,
        color: disabled ? "var(--color-faint)" : color,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {item.dot && (
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 99,
            background: item.dot,
            flex: "none",
          }}
        />
      )}
      {item.avatar && (
        <span
          aria-hidden
          className="grid place-items-center"
          style={{
            width: 20,
            height: 20,
            borderRadius: 99,
            background: item.avatar.tint,
            color: item.avatar.ink,
            fontSize: 10.5,
            fontWeight: 700,
            flex: "none",
          }}
        >
          {item.avatar.initials}
        </span>
      )}
      <span
        className="truncate"
        style={{ flex: 1, minWidth: 0, fontSize: 14.5 }}
      >
        {item.label}
      </span>
      {item.check && <CheckIcon />}
      {item.hint != null && (
        <span style={{ flex: "none", display: "inline-flex", alignItems: "center" }}>
          {item.hint}
        </span>
      )}
      {item.submenu && (
        <span
          aria-hidden
          style={{ flex: "none", fontSize: 12, color: "var(--color-whisper)" }}
        >
          ›
        </span>
      )}
    </button>
  );
}

function RowMenuInput({
  initialValue = "",
  placeholder,
  autoSelect,
  onSubmit,
}: {
  initialValue?: string;
  placeholder?: string;
  autoSelect?: boolean;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement | null>(null);
  const focused = useRef(false);
  const { close } = useRowMenu();
  useEffect(() => {
    if (focused.current) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (autoSelect) el.select();
    focused.current = true;
  }, [autoSelect]);
  return (
    <div
      style={{
        borderTop: "1px solid var(--color-lineSoft)",
        margin: 4,
        paddingTop: 5,
      }}
    >
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const v = value.trim();
            if (v) onSubmit(v);
            close();
          }
        }}
        className="w-full bg-rail focus:outline-none"
        style={{
          borderRadius: 7,
          padding: "7px 10px",
          fontSize: 14,
          color: "var(--color-body)",
          border: "none",
        }}
      />
    </div>
  );
}

export function RowMenuConfirm({
  title,
  body,
  cancelLabel = "Cancel",
  confirmLabel,
  variant = "publish",
  onConfirm,
}: {
  title: string;
  body: ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  variant?: "danger" | "publish";
  onConfirm: () => void;
}) {
  const { close } = useRowMenu();
  return (
    <div style={{ padding: "9px 10px 3px" }}>
      <div
        style={{
          fontSize: 14.5,
          fontWeight: 700,
          color: "var(--color-noir)",
          fontFamily: "var(--font-display)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 13.5,
          color: "var(--color-secondary)",
          lineHeight: 1.45,
          marginTop: 6,
        }}
      >
        {body}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={close}
          className="rounded-md text-secondary hover:bg-rail"
          style={{ padding: "6px 10px", fontSize: 13.5 }}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            close();
          }}
          className="rounded-md"
          style={{
            padding: "6px 12px",
            fontSize: 13.5,
            fontWeight: 700,
            background:
              variant === "danger" ? "var(--color-danger)" : "var(--color-noir)",
            color: variant === "danger" ? "var(--color-surface)" : "var(--color-track)",
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * The legacy imperative `⋯` trigger. Kept for menus not yet migrated to the
 * spec API. New menus should use `SpecMenuTrigger` (above).
 */
export function MoreButton({
  size = "sm",
  ariaLabel = "More",
  build,
  width,
  className,
  visible = true,
}: {
  size?: "sm" | "md" | "view";
  ariaLabel?: string;
  build: () => ReactNode;
  width?: number;
  className?: string;
  visible?: boolean;
}) {
  const { open } = useRowMenu();
  const px = size === "md" ? 30 : size === "view" ? 26 : 17;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open(e.currentTarget, build(), { width });
      }}
      className={
        "grid place-items-center rounded-md text-whisper hover:bg-railHover hover:text-strong " +
        (visible ? "" : "opacity-0 pointer-events-none ") +
        (className ?? "")
      }
      style={{ width: px, height: px, flex: "none" }}
    >
      <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden>
        <path
          d="M5 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zM12 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zM19 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z"
          fill="currentColor"
        />
      </svg>
    </button>
  );
}
