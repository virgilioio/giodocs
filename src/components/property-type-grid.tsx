import { useEffect, useRef, useState } from "react";
import { PROPERTY_KINDS, type PropertyType } from "@/lib/property-kinds";
import { useIsPhone } from "@/lib/use-media";

/* Add property in one step (2026-10-11, Notion's): a name field on top,
 * then every type in a two-column grid with its icon, grouped — the
 * everyday types, the ones that work things out (relation, rollup,
 * formula, ID) and, in a view, the built-ins (created and edited). Picking
 * a type adds the property at once, named as typed or after its type. */

const BASIC: PropertyType[] = [
  "text", "number", "select", "multi_select", "status", "date",
  "person", "files", "checkbox", "url", "phone", "email",
];
const WORKED: PropertyType[] = ["relation", "rollup", "formula", "unique_id", "links"];

const BUILT_INS: Array<{ key: string; label: string; icon: string }> = [
  { key: "@created", label: "Created time", icon: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2" },
  { key: "@edited", label: "Last edited time", icon: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5V12l3 2" },
  { key: "@created_by", label: "Created by", icon: "M12 3.4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20.6v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" },
  { key: "@edited_by", label: "Last edited by", icon: "M12 3.4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20.6v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" },
];

function Cell({ label, icon, onPick, title }: { label: string; icon?: string; onPick: () => void; title?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPick}
      title={title}
      data-type-option={label}
      className="flex min-w-0 items-center gap-2 rounded-md text-left text-ui text-body hover:bg-rail"
      style={{ height: 32, padding: "0 8px" }}
    >
      <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden className="shrink-0 text-muted">
        {icon ? <path d={icon} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /> : null}
      </svg>
      <span className="truncate">{label}</span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "4px 0" }}>
      <div className="px-2 pb-1 text-label text-faint">{title}</div>
      <div className="grid grid-cols-2" style={{ gap: 1 }}>
        {children}
      </div>
    </div>
  );
}

export function PropertyTypeGrid({
  onPick,
  onBuiltIn,
  shownBuiltIns = [],
}: {
  /** A type was picked, with the name typed so far ("" when none). */
  onPick: (type: PropertyType, name: string) => void;
  /** In a view: show a built-in property as a column. */
  onBuiltIn?: (key: string) => void;
  /** Built-ins the view already shows (left out). */
  shownBuiltIns?: string[];
}) {
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);
  const phone = useIsPhone();
  useEffect(() => {
    // On a phone the keyboard would cover the list; the field waits for a tap.
    if (!phone) ref.current?.focus();
  }, [phone]);
  const kind = (t: PropertyType) => PROPERTY_KINDS.find((k) => k.type === t);
  const cell = (t: PropertyType) => {
    const k = kind(t);
    return k ? <Cell key={t} label={k.label} icon={k.icon} title={k.hint} onPick={() => onPick(t, name.trim())} /> : null;
  };
  const builtIns = onBuiltIn ? BUILT_INS.filter((b) => !shownBuiltIns.includes(b.key)) : [];
  return (
    <div data-property-type-grid style={{ padding: "2px 2px 4px" }}>
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          // Enter with a name makes a text property, like Notion.
          if (e.key === "Enter" && name.trim()) {
            e.preventDefault();
            onPick("text", name.trim());
          }
        }}
        placeholder="Type property name…"
        aria-label="Property name"
        className="mb-1 w-full rounded-md border border-line bg-surface text-ui text-strong focus:border-accent focus:outline-none"
        style={{ padding: "6px 9px" }}
      />
      <Section title="Select type">{BASIC.map(cell)}</Section>
      <div className="mx-2 border-t border-lineSoft" />
      <Section title="Worked out or linked">{WORKED.map(cell)}</Section>
      {builtIns.length ? (
        <>
          <div className="mx-2 border-t border-lineSoft" />
          <Section title="Built in">
            {builtIns.map((b) => (
              <Cell key={b.key} label={b.label} icon={b.icon} onPick={() => onBuiltIn!(b.key)} />
            ))}
          </Section>
        </>
      ) : null}
    </div>
  );
}
