import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { exitRef } from "@/lib/exit-motion";
import { IC } from "@/lib/menu-icons";
import { MenuIcon, MenuLead, MenuSep } from "./menu-parts";
import { SLASH_GROUP_LABELS, type SlashEntry, type SlashItemLike } from "@/lib/slash-entries";
import { useIsPhone } from "@/lib/use-media";
import { BlockPreview } from "./block-previews";

/* The slash menu (2026-10-11, Notion's): sections, one-line rows with an
 * icon, the name and the typing shortcut, a preview card beside the
 * highlighted row, and "Close menu · esc" at the bottom. Keyboard
 * navigation runs over the flat list of entries (a Suggested pick appears
 * twice: once in Suggested, once in its own section). */

const W = 324;
const PREVIEW_W = 190;

export function SlashMenu<T extends SlashItemLike>({
  x,
  y,
  yTop,
  items,
  activeIdx,
  onHover,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  yTop: number;
  items: SlashEntry<T>[];
  activeIdx: number;
  onHover: (i: number) => void;
  onPick: (m: T) => void;
  onClose: () => void;
}) {
  const phone = useIsPhone();
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.max(12, Math.min(vw - W - 12, x));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [above, setAbove] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const h = panelRef.current?.offsetHeight ?? 420;
    setAbove(y + h + 12 > vh && yTop - h >= 12);
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const top = Math.max(12, Math.min(vh - 420 - 12, y));
  const placement: React.CSSProperties = above
    ? { left, bottom: vh - yTop, transformOrigin: "bottom left" }
    : { left, top, transformOrigin: "top left", visibility: above === null ? "hidden" : undefined };

  // Keep the highlighted row in view, and put the preview beside it.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [pvTop, setPvTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    row?.scrollIntoView({ block: "nearest" });
    const panel = panelRef.current;
    if (!row || !panel) {
      setPvTop(null);
      return;
    }
    setPvTop(row.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8);
  }, [activeIdx, items.length, above]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-slash-menu]")) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const active = items[activeIdx];
  // The preview sits to the right of the menu, or to its left when the
  // window has no room there. Never on a phone.
  const pvRight = left + W + 8 + PREVIEW_W <= vw - 8;

  return createPortal(
    <div
      ref={exitRef("pop", panelRef)}
      data-slash-menu
      data-keynav
      role="listbox"
      aria-label="Blocks"
      className="gio-menu fixed flex animate-popIn flex-col"
      // Above dialogs (the new-page peek is one), like every menu.
      style={{ ...placement, width: W, maxHeight: 420, zIndex: "var(--z-menu)" }}
    >
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="gio-mfoot">No matches.</div>
        ) : (
          items.map((m, i) => (
            <div key={m.key}>
              {i === 0 || items[i - 1].section !== m.section ? (
                <div className="gio-mhead" data-slash-section={m.section}>
                  {SLASH_GROUP_LABELS[m.section]}
                </div>
              ) : null}
              <button
                type="button"
                role="option"
                aria-selected={i === activeIdx}
                data-active={i === activeIdx ? "true" : undefined}
                data-slash-item={m.name}
                onMouseEnter={() => onHover(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(m);
                }}
                className="gio-mrow"
              >
                <MenuLead>
                  <MenuIcon path={IC[m.ic]} />
                </MenuLead>
                <span className="truncate">{m.name}</span>
                {m.md ? <span className="gio-mrow-hint">{m.md}</span> : null}
              </button>
            </div>
          ))
        )}
      </div>
      <MenuSep />
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
        className="gio-mrow shrink-0"
      >
        <span className="truncate">Close menu</span>
        <span className="gio-mrow-hint">esc</span>
      </button>
      {active && !phone && pvTop !== null ? (
        <div
          aria-hidden
          className="absolute"
          style={{
            top: Math.max(0, pvTop),
            ...(pvRight ? { left: W + 8 } : { right: W + 8 }),
          }}
        >
          <BlockPreview k={active.pv} />
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
