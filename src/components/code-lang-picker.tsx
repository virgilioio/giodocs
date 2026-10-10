import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "./popover";
import { CODE_LANGS, langLabel } from "@/lib/code-langs";

/* The language of a code block, chosen from its corner like Notion's.
 * "Mermaid" turns the block into a diagram (src/lib/diagram.ts). The
 * language is stored as `lang`; "" is Plain text, chosen on purpose. */

export function CodeLangPicker({
  value,
  onPick,
  disabled,
}: {
  /** The block's language as shown ("mermaid" for a detected diagram). */
  value: string;
  onPick: (lang: string) => void;
  disabled?: boolean;
}) {
  const label = langLabel(value) || "Plain text";
  if (disabled) {
    return value ? (
      <span className="rounded-md px-1.5 text-caption text-faint" data-code-lang>
        {label}
      </span>
    ) : null;
  }
  return (
    <span
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      data-code-lang
    >
      <Popover
        width={200}
        trigger={({ open, onClick, ref }) => (
          <button
            ref={ref}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Code language: ${label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
            className="inline-flex items-center gap-1 rounded-md px-1.5 text-caption text-faint hover:bg-line hover:text-secondary"
            style={{ height: 22 }}
          >
            {label}
            <svg viewBox="0 0 24 24" width={10} height={10} aria-hidden>
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      >
        {(close) => <LangList value={value} onPick={(l) => (onPick(l), close())} />}
      </Popover>
    </span>
  );
}

function LangList({ value, onPick }: { value: string; onPick: (lang: string) => void }) {
  const [q, setQ] = useState("");
  // The panel is placed after its first paint (hidden until then), so
  // autoFocus would land on an invisible field: focus once it shows.
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let n = 0;
    const tick = () => {
      const el = inputRef.current;
      if (!el) return;
      if (getComputedStyle(el.closest("[style]") ?? el).visibility !== "hidden") el.focus();
      else if (n++ < 10) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? CODE_LANGS.filter((l) => l.label.toLowerCase().includes(s) || l.value.includes(s)) : CODE_LANGS;
  }, [q]);
  return (
    <div className="p-1" role="listbox" aria-label="Code language">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && rows[0]) {
            e.preventDefault();
            onPick(rows[0].value);
          }
        }}
        placeholder="Search for a language"
        aria-label="Search for a language"
        className="mb-1 w-full rounded-md border border-line bg-surface px-2 text-meta focus:border-accent focus:outline-none"
        style={{ height: 28 }}
      />
      <div className="max-h-64 overflow-y-auto">
        {rows.map((l) => (
          <button
            key={l.value || "plain"}
            type="button"
            role="option"
            aria-selected={l.value === value.toLowerCase()}
            onClick={() => onPick(l.value)}
            className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-meta text-body hover:bg-sunken"
          >
            <span>{l.label}</span>
            {l.value === value.toLowerCase() ? <span className="text-accent">✓</span> : null}
          </button>
        ))}
        {rows.length === 0 ? <div className="px-2 py-1 text-meta text-faint">No language matches.</div> : null}
      </div>
    </div>
  );
}
