import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useAllPropDefs, useWorkspaceShell } from "@/hooks/use-workspace-data";
import {
  useAddPropertyOption,
  useCreateProperty,
  useRenamePropertyOption,
  useSetPropertyArchived,
  useUpdateProperty,
} from "@/hooks/use-property-mutations";
import { PROPERTY_KINDS, kindLabel, needsSetup, type PropertyType } from "@/lib/property-kinds";
import { Popover } from "./popover";
import type { SelectOption } from "./property-pickers";
import type { Database } from "@/integrations/supabase/types";
import type { PageListItem } from "@/lib/types";

/* Settings › Properties — every database's properties, database by database.
 *
 * Anyone who can edit a database adds a property to it, renames one and
 * adds options to a select or status. Only owners archive (hide; values
 * stay) or restore. The database enforces all of this; the pane just
 * doesn't offer what you can't do. */

type PropDef = Database["public"]["Tables"]["property_defs"]["Row"];

const GRID = "26px minmax(0, 1.5fr) minmax(0, 0.9fr) minmax(0, 0.8fr) 168px";

function iconFor(type: string): string {
  return (
    PROPERTY_KINDS.find((k) => k.type === type)?.icon ??
    "M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z"
  );
}

function TypeIcon({ type }: { type: string }) {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-muted">
      <path d={iconFor(type)} />
    </svg>
  );
}

export function PropertiesPaneBody() {
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const shell = useWorkspaceShell(ws);
  const all = (useAllPropDefs(ws).data ?? []) as PropDef[];
  const pagesData = shell.pages.data as PageListItem[] | undefined;
  const members = (shell.members.data ?? []) as Array<{ user_id: string; role: string }>;
  const isOwner = members.some((m) => m.user_id === user?.id && m.role === "owner");

  const usedOn = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pagesData ?? []) {
      for (const [k, v] of Object.entries((p.props ?? {}) as Record<string, unknown>)) {
        if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [pagesData]);

  const live = all.filter((d) => !d.archived_at);
  const archived = all.filter((d) => d.archived_at);
  const databases = useMemo(
    () =>
      (pagesData ?? [])
        .filter((p) => p.is_database && !p.archived_at)
        .map((p) => ({ id: p.id, title: p.title?.trim() || "Untitled", icon: p.icon }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [pagesData],
  );

  return (
    <div style={{ padding: "0 30px 30px" }}>
      <NewPropertyForm databases={databases} />

      {databases.map((db) => {
        const own = live.filter((d) => d.database_id === db.id);
        return (
          <div key={db.id}>
            <div className="mt-5 text-label uppercase text-faint">
              {db.title} · {own.length}
            </div>
            <div className="mt-2 overflow-hidden rounded-xl border border-line">
              <div
                className="grid items-center bg-rail text-label uppercase text-faint"
                style={{ gridTemplateColumns: GRID, gap: 10, padding: "8px 12px" }}
              >
                <span />
                <span>Name</span>
                <span>Type</span>
                <span>Used on</span>
                <span />
              </div>
              {own.length === 0 ? (
                <p className="px-3 py-2 text-meta text-muted">No properties yet.</p>
              ) : null}
              {own.map((d) => (
                <PropertyRow key={d.id} def={d} isOwner={isOwner} count={usedOn.get(d.key) ?? 0} />
              ))}
            </div>
          </div>
        );
      })}
      {databases.length === 0 ? (
        <p className="mt-5 text-meta text-muted">
          Properties belong to databases. Make a database first.
        </p>
      ) : null}

      {archived.length > 0 ? (
        <>
          <div className="mt-6 text-label uppercase text-faint">Archived · {archived.length}</div>
          <p className="mt-1 text-meta text-muted">
            Hidden from pages, views and filters. Every value is still on its page; restoring brings it all back.
          </p>
          <div className="mt-2 overflow-hidden rounded-xl border border-line">
            {archived.map((d) => (
              <PropertyRow key={d.id} def={d} isOwner={isOwner} count={usedOn.get(d.key) ?? 0} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function NewPropertyForm({
  databases,
}: {
  databases: Array<{ id: string; title: string; icon: string | null }>;
}) {
  const create = useCreateProperty();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [dbId, setDbId] = useState<string>("");
  const databaseId = databases.some((d) => d.id === dbId) ? dbId : (databases[0]?.id ?? "");
  const submit = () => {
    const l = label.trim();
    if (!l || !databaseId || create.isPending) return;
    create.mutate({ databaseId, label: l, type }, { onSuccess: () => setLabel("") });
  };
  if (databases.length === 0) return null;
  return (
    <>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <select
          value={databaseId}
          onChange={(e) => setDbId(e.target.value)}
          aria-label="Database"
          className="rounded-md border border-line bg-surface focus:border-accent focus:outline-none"
          style={{ padding: "6px 8px", fontSize: 14, maxWidth: 180 }}
        >
          {databases.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="New property name"
          aria-label="New property name"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface focus:border-accent focus:outline-none"
          style={{ padding: "6px 10px", fontSize: 14 }}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as PropertyType)}
          aria-label="Property type"
          className="rounded-md border border-line bg-surface focus:border-accent focus:outline-none"
          style={{ padding: "6px 8px", fontSize: 14 }}
        >
          {PROPERTY_KINDS.filter((k) => !needsSetup(k.type)).map((k) => (
            <option key={k.type} value={k.type}>
              {k.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!label.trim() || create.isPending}
          className="bg-btn text-btnFg disabled:opacity-40"
          style={{ fontSize: 13, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
        >
          {create.isPending ? "Adding…" : "Add property"}
        </button>
      </form>
      <p className="mt-2 text-caption text-faint">
        Relations and rollups take a few more choices: add them from a page, with Add a property.
      </p>
    </>
  );
}

function PropertyRow({ def, isOwner, count }: { def: PropDef; isOwner: boolean; count: number }) {
  const update = useUpdateProperty();
  const setArchived = useSetPropertyArchived();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(def.label);
  const isArchived = !!def.archived_at;
  const hasOptions = def.type === "select" || def.type === "status";

  const commit = () => {
    const v = draft.trim();
    setEditing(false);
    if (!v || v === def.label) {
      setDraft(def.label);
      return;
    }
    update.mutate({ id: def.id, patch: { label: v } });
  };

  return (
    <div
      className="grid items-center border-t border-lineSoft first:border-t-0"
      style={{ gridTemplateColumns: GRID, gap: 10, padding: "7px 12px", minHeight: 42, opacity: isArchived ? 0.75 : 1 }}
    >
      <TypeIcon type={def.type} />
      <div className="min-w-0">
        {editing ? (
          <input
            autoFocus
            value={draft}
            aria-label={`Rename ${def.label}`}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(def.label);
                setEditing(false);
              }
            }}
            className="w-full rounded-md border border-line bg-surface focus:border-accent focus:outline-none"
            style={{ padding: "3px 7px", fontSize: 14 }}
          />
        ) : def.is_system ? (
          <span className="flex min-w-0 items-center gap-2" style={{ fontSize: 14 }}>
            <span className="truncate text-strong">{def.label}</span>
            <span className="shrink-0 text-caption text-faint">Built in</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(def.label);
              setEditing(true);
            }}
            className="max-w-full truncate rounded-md px-1 text-left text-strong hover:bg-sunken"
            style={{ fontSize: 14, marginLeft: -4 }}
            title="Rename"
          >
            {def.label}
          </button>
        )}
      </div>
      <span className="truncate text-meta text-secondary">{kindLabel(def.type)}</span>
      <span className="tnum text-meta text-muted">
        {count === 0 ? "No pages" : count === 1 ? "1 page" : `${count} pages`}
      </span>
      <div className="flex items-center justify-end gap-1">
        {hasOptions && !isArchived && !def.is_system ? <OptionsEditor def={def} /> : null}
        {isOwner && !def.is_system ? (
          <button
            type="button"
            onClick={() =>
              setArchived.mutate({ id: def.id, label: def.label, archived: !isArchived })
            }
            className="rounded-md border border-line bg-surface px-2 text-meta text-body hover:bg-rail"
            style={{ height: 26 }}
          >
            {isArchived ? "Restore" : "Archive"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The options of a select or status: rename one, or add one. Options pages
 *  use are never removed (their pages would stop validating), so there is no
 *  delete here. */
function OptionsEditor({ def }: { def: PropDef }) {
  const renameOption = useRenamePropertyOption();
  const addOption = useAddPropertyOption();
  const options = (Array.isArray(def.options) ? def.options : []) as unknown as SelectOption[];
  const [adding, setAdding] = useState("");
  const rename = (value: string, label: string) => {
    const clean = label.trim();
    const cur = options.find((o) => o.value === value);
    if (!clean || !cur || cur.label === clean) return;
    renameOption.mutate({ id: def.id, value, label: clean });
  };
  return (
    <Popover
      width={260}
      align="end"
      trigger={({ onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          className="rounded-md px-2 text-meta text-secondary hover:bg-sunken"
          style={{ height: 26 }}
        >
          {options.length === 1 ? "1 option" : `${options.length} options`}
        </button>
      )}
    >
      {() => (
        <div style={{ padding: 4 }}>
          <div className="px-1 pb-1 text-label uppercase text-faint">{def.label} options</div>
          {options.length === 0 ? (
            <div className="px-1 py-1 text-meta text-muted">No options yet.</div>
          ) : null}
          {options.map((o) => (
            <div key={o.value} className="flex items-center gap-2 px-1 py-[3px]">
              <span
                aria-hidden
                style={{ width: 8, height: 8, borderRadius: 99, flex: "none", background: `var(--color-${o.ink})` }}
              />
              <input
                defaultValue={o.label}
                aria-label={`Rename option ${o.label}`}
                onBlur={(e) => rename(o.value, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-meta text-body hover:border-line focus:border-accent focus:outline-none"
                style={{ height: 24 }}
              />
            </div>
          ))}
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const l = adding.trim();
              if (!l) return;
              addOption.mutate({ id: def.id, label: l }, { onSuccess: () => setAdding("") });
            }}
            placeholder="Add an option…"
            aria-label={`Add an option to ${def.label}`}
            className="mt-1 w-full rounded-md border border-line bg-track px-2 py-1 text-meta outline-none placeholder:text-faint focus:border-accent"
          />
        </div>
      )}
    </Popover>
  );
}
