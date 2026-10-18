import { avatarInitials } from "@/lib/mention-trigger-ui";
import type { MentionCandidate } from "@/lib/mention-trigger";
import { exitOnly } from "@/lib/exit-motion";
import { Ico } from "./emoji-icon";
import { MenuLead } from "./menu-parts";

/* The "@" menu: people, then pages. Opened and driven from <Editable>,
 * which keeps the caret; this only draws the list. Rows never animate as
 * you type or move the highlight. */

export function MentionMenu({
  rect,
  items,
  highlight,
  query,
  onPick,
  onHover,
}: {
  rect: { top: number; left: number; bottom: number };
  items: MentionCandidate[];
  highlight: number;
  query: string;
  onPick: (c: MentionCandidate) => void;
  onHover: (i: number) => void;
}) {
  const width = 300;
  const gap = 4;
  const rowH = 28;
  const people = items.filter((c) => c.kind === "user").length;
  const estH = Math.min(
    320,
    items.length * rowH + (people && people < items.length ? 2 : 1) * 28 + 8,
  );
  const margin = 8;
  let top = rect.bottom + gap;
  const above = top + estH + margin > window.innerHeight;
  if (above) top = Math.max(margin, rect.top - gap - estH);
  let left = rect.left;
  if (left + width + margin > window.innerWidth)
    left = Math.max(margin, window.innerWidth - width - margin);
  if (left < margin) left = margin;

  const row = (c: MentionCandidate, i: number) => {
    const on = i === highlight;
    return (
      <div
        key={`${c.kind}:${c.id}`}
        id={`mention-opt-${i}`}
        role="option"
        aria-selected={on}
        onMouseMove={() => {
          if (!on) onHover(i);
        }}
        onClick={() => onPick(c)}
        data-active={on || undefined}
        className="gio-mrow"
      >
        <MenuLead>
          {c.kind === "user" ? (
            <span
              className="grid place-items-center rounded-full bg-accentTint text-accent"
              style={{ width: 20, height: 20, fontSize: 10.5, fontWeight: 700 }}
            >
              {avatarInitials(c.name)}
            </span>
          ) : (
            <Ico icon={c.icon || "📄"} size={16} />
          )}
        </MenuLead>
        <span className="truncate">{c.kind === "user" ? c.name : c.title || "Untitled"}</span>
      </div>
    );
  };

  return (
    <div
      ref={exitOnly("pop")}
      role="listbox"
      aria-label="Mention a person or page"
      // Keep the caret in the block while clicking the menu.
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        top,
        left,
        width,
        zIndex: 95,
        maxHeight: 320,
        overflowY: "auto",
        transformOrigin: above ? "bottom left" : "top left",
      }}
      className="gio-menu animate-popIn"
      data-keynav
    >
      {items.length === 0 ? (
        <div className="gio-mfoot">No one or no page matches “{query}”.</div>
      ) : null}
      {people > 0 ? <div className="gio-mhead">People</div> : null}
      {items.slice(0, people).map((c, i) => row(c, i))}
      {items.length > people ? <div className="gio-mhead">Pages</div> : null}
      {items.slice(people).map((c, i) => row(c, i + people))}
    </div>
  );
}
