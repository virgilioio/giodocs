import { useRef, useState, type ReactNode } from "react";
import { STARTERS } from "@/lib/starter-templates";
import { IMPORT_ACCEPT, IMPORT_MAX_BYTES } from "@/lib/file-import";
import { LAYOUT_NAMES, type StartLayout } from "@/hooks/use-start-database";
import { TemplatePicker } from "./templates-ui";
import { Ico } from "./emoji-icon";
import { Popover } from "./popover";
import { MenuHead, MenuIcon, MenuLead } from "./menu-parts";

/* A blank page's starting points (Notion's new-page screen, 2026-10-11):
 * "Get started with" and a row of chips — Empty page, Templates ▾ (the
 * workspace's templates and the starters), Database ▾ (Table, Board,
 * List, Calendar) and Import. It floats under the first line and goes the
 * moment you type. */

const LAYOUT_ICONS: Record<StartLayout, string> = {
  table: "M4 5h16v14H4zM4 10h16M10 10v9",
  board: "M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v11h-4z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  calendar: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4",
};

export function NewPageStarter({
  databaseId,
  canBeDatabase,
  onEmpty,
  onTemplate,
  onStarter,
  onImport,
  onDatabase,
}: {
  /** The database this page is a row of, or null. */
  databaseId: string | null;
  /** Rows of a database stay pages; only a plain page can become one. */
  canBeDatabase: boolean;
  onEmpty: () => void;
  onTemplate: (templateId: string) => Promise<void>;
  onStarter: (starterId: string) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onDatabase: (layout: StartLayout) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error)?.message || "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const chip = "flex items-center rounded-full border border-line bg-surface text-ui text-body hover:bg-sunken disabled:opacity-60";
  const chipStyle = { gap: 7, height: 32, padding: "0 13px" } as const;
  return (
    <section aria-label="Start this page" className="animate-fadeIn">
      <p className="text-meta text-faint" style={{ marginBottom: 8 }}>
        Get started with
      </p>
      <ul className="flex flex-wrap items-center" style={{ gap: 6 }}>
        <li>
          <button type="button" onClick={onEmpty} className={chip} style={chipStyle}>
            <Glyph d="M7 3h7l5 5v13H7zM14 3v5h5" />
            Empty page
          </button>
        </li>
        <li>
          <Popover
            width={300}
            trigger={({ onClick, ref, open }) => (
              <button ref={ref} type="button" onClick={onClick} aria-expanded={open} disabled={!!busy} className={chip} style={chipStyle}>
                <Glyph d="M5 4h14v5H5zM5 13h6v7H5zM15 13h4M15 17h4" />
                Templates
                <Glyph d="m6 9 6 6 6-6" />
              </button>
            )}
          >
            {(close) => (
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                <TemplatePicker
                  databaseId={databaseId}
                  onPick={async (id) => {
                    close();
                    await run(`t:${id}`, () => onTemplate(id));
                  }}
                />
                <Heading>Starters</Heading>
                <ul>
                  {STARTERS.map((st) => (
                    <Item
                      key={st.id}
                      icon={<Ico icon={st.icon} size={16} />}
                      label={st.name}
                      hint={st.hint}
                      disabled={!!busy}
                      onClick={() => {
                        close();
                        void run(`s:${st.id}`, () => onStarter(st.id));
                      }}
                    />
                  ))}
                </ul>
              </div>
            )}
          </Popover>
        </li>
        {canBeDatabase ? (
          <li>
            <Popover
              width={220}
              trigger={({ onClick, ref, open }) => (
                <button ref={ref} type="button" onClick={onClick} aria-expanded={open} disabled={!!busy} className={chip} style={chipStyle}>
                  <Glyph d={LAYOUT_ICONS.table} />
                  {busy?.startsWith("d:") ? "Making…" : "Database"}
                  <Glyph d="m6 9 6 6 6-6" />
                </button>
              )}
            >
              {(close) => (
                <ul>
                  {(Object.keys(LAYOUT_NAMES) as StartLayout[]).map((l) => (
                    <Item
                      key={l}
                      icon={<MenuIcon path={LAYOUT_ICONS[l]} />}
                      label={LAYOUT_NAMES[l]}
                      disabled={!!busy}
                      onClick={() => {
                        close();
                        void run(`d:${l}`, () => onDatabase(l));
                      }}
                    />
                  ))}
                </ul>
              )}
            </Popover>
          </li>
        ) : null}
        <li>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => fileRef.current?.click()}
            className={chip}
            style={chipStyle}
            title="Markdown, HTML or CSV, up to 2 MB"
          >
            <Glyph d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            {busy === "import" ? "Reading…" : "Import"}
          </button>
        </li>
      </ul>
      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > IMPORT_MAX_BYTES) {
            setError(`"${f.name}" is larger than 2 MB. Split it into smaller files and import them one by one.`);
            return;
          }
          void run("import", () => onImport(f));
        }}
      />
      <p role="alert" className="text-meta text-danger" style={{ minHeight: 18, marginTop: 6 }}>
        {error ?? ""}
      </p>
    </section>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <MenuHead>{children}</MenuHead>;
}

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-muted">
      <path d={d} />
    </svg>
  );
}

function Item({
  icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button type="button" disabled={disabled} onClick={onClick} className="gio-mrow">
        <MenuLead>{icon}</MenuLead>
        <span className="truncate">{label}</span>
        {hint ? <span className="gio-mrow-hint">{hint}</span> : null}
      </button>
    </li>
  );
}
