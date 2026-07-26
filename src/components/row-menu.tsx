/**
 * RowMenu — the single popover shell used by every `⋯` in the product
 * (sidebar rows, view toolbar, block handles, property pickers).
 *
 * A caller opens the menu with `useRowMenu().open(anchorEl, node)` and passes
 * a `<RowMenuList>` or `<RowMenuConfirm>` as the content. Submenus swap the
 * content in place via the same context. There is exactly one open menu at
 * a time.
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

/* ─────────────────────── Provider ─────────────────────── */

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
  const [pos, setPos] = useState<{ top: number; left: number; flipped: boolean } | null>(
    null,
  );

  const close = useCallback(() => {
    setAnchor(null);
    setStack([]);
    setPos(null);
  }, []);

  const open = useCallback<Ctx["open"]>((el, node, opts) => {
    setAnchor(el);
    setStack([{ node, width: opts?.width ?? 264 }]);
  }, []);

  const push = useCallback<Ctx["push"]>((node, opts) => {
    setStack((s) => [...s, { node, width: opts?.width ?? s[s.length - 1]?.width ?? 264 }]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const top = stack[stack.length - 1] ?? null;

  // Position: anchor to button, opening down and right-aligned to the button.
  useLayoutEffect(() => {
    if (!anchor || !top) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = top.width;
      const margin = 8;
      const gap = 6;
      let left = r.right - w;
      if (left < margin) left = margin;
      const maxLeft = window.innerWidth - w - margin;
      if (left > maxLeft) left = maxLeft;
      // Flip above if the menu would clip the viewport bottom.
      const estHeight = 320;
      let top_ = r.bottom + gap;
      let flipped = false;
      if (top_ + estHeight + margin > window.innerHeight && r.top - gap - estHeight > margin) {
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
  }, [anchor, top]);

  // One provider-level Escape listener. Individual menu contents must never
  // attach their own — see AGENTS.md ordered-Escape rule.
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
      {anchor && top && pos
        ? createPortal(
            <>
              {/* Scrim — transparent, catches outside clicks */}
              <div
                aria-hidden
                onMouseDown={close}
                style={{ position: "fixed", inset: 0, zIndex: 100 }}
              />
              <div
                onMouseDown={(e) => e.stopPropagation()}
                className="animate-popIn"
                style={{
                  position: "fixed",
                  top: pos.top,
                  left: pos.left,
                  width: top.width,
                  zIndex: 101,
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-line)",
                  borderRadius: 12,
                  padding: 6,
                  boxShadow: "0 18px 48px rgba(13,13,9,.16)",
                  transformOrigin: pos.flipped ? "bottom right" : "top right",
                }}
              >
                {top.node}
              </div>
            </>,
            document.body,
          )
        : null}
    </RowMenuCtx.Provider>
  );
}

/* ─────────────────────── Content primitives ─────────────────────── */

export type RowMenuItem =
  | {
      kind?: "item";
      id?: string;
      label: string;
      onSelect?: () => void;
      /** trailing hint (value or shortcut). Shortcuts should be wrapped in <Sc>. */
      hint?: ReactNode;
      danger?: boolean;
      disabled?: boolean;
      check?: boolean;
      /** leading 8px dot (status/priority pickers) */
      dot?: string;
      /** leading 20px pastel avatar (people pickers) */
      avatar?: { tint: string; ink: string; initials: string };
      submenu?: boolean;
      /** if true, don't auto-close after onSelect */
      keepOpen?: boolean;
    }
  | { kind: "divider" };

/** Renders a shortcut hint in Spline Sans Mono. */
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

/** Renders a value-hint in Lato. */
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
                borderTop: "1px solid var(--color-lineSoft)",
                margin: "4px 4px",
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
      className={"flex w-full items-center rounded-lg text-left " + bg}
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
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 14.5,
        }}
      >
        {item.label}
      </span>
      {item.check && (
        <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden style={{ flex: "none" }}>
          <path
            d="M5 12.5l4.5 4.5L19 7"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
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

  // Autofocus exactly once — subsequent renders must not steal the caret.
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

/* ─────────────────────── Confirm ─────────────────────── */

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

/* ─────────────────────── ⋯ trigger button ─────────────────────── */

/**
 * The `⋯` button itself. Two sizes:
 *  - `sm` (17×17) — used inside sidebar rows.
 *  - `md` (30×30) — used in the view toolbar.
 * `build(anchorEl)` returns the menu content node to open with.
 */
export function MoreButton({
  size = "sm",
  ariaLabel = "More",
  build,
  width,
  className,
  visible = true,
}: {
  size?: "sm" | "md";
  ariaLabel?: string;
  build: () => ReactNode;
  width?: number;
  className?: string;
  visible?: boolean;
}) {
  const { open } = useRowMenu();
  const px = size === "md" ? 30 : 17;
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
