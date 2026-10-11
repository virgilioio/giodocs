import { useRef, useState, type ReactNode } from "react";
import { STARTERS } from "@/lib/starter-templates";
import { IMPORT_ACCEPT, IMPORT_MAX_BYTES } from "@/lib/file-import";
import { LAYOUT_NAMES, type StartLayout } from "@/hooks/use-start-database";
import { TemplatePicker } from "./templates-ui";
import { Ico } from "./emoji-icon";

/* A blank page's starting points (Notion's new-page screen): carry on with
 * an empty page, start from one of the workspace's templates or a starter,
 * import a file, or make the page a database. It floats under the first
 * line and goes the moment you type. */

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

  return (
    <section aria-label="Start this page" className="animate-fadeIn">
      <p className="text-meta text-faint" style={{ marginBottom: 8 }}>
        Press Enter or start typing for an empty page, or pick a starting point.
      </p>
      <ul>
        <Item icon={<Glyph d="M7 3h7l5 5v13H7zM14 3v5h5" />} label="Empty page" onClick={onEmpty} />
      </ul>

      <div style={{ marginTop: 10 }}>
        <TemplatePicker databaseId={databaseId} onPick={onTemplate} />
      </div>

      <Heading>Starters</Heading>
      <ul>
        {STARTERS.map((s) => (
          <Item
            key={s.id}
            icon={<Ico icon={s.icon} size={16} />}
            label={s.name}
            hint={busy === `s:${s.id}` ? "Adding…" : s.hint}
            disabled={!!busy}
            onClick={() => void run(`s:${s.id}`, () => onStarter(s.id))}
          />
        ))}
        <Item
          icon={<Glyph d="M12 4v11M7 10l5 5 5-5M5 20h14" />}
          label="Import a file"
          hint={busy === "import" ? "Reading…" : "Markdown, HTML or CSV"}
          disabled={!!busy}
          onClick={() => fileRef.current?.click()}
        />
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

      {canBeDatabase ? (
        <>
          <Heading>Or start with a database</Heading>
          <ul className="flex flex-wrap" style={{ gap: 4 }}>
            {(Object.keys(LAYOUT_NAMES) as StartLayout[]).map((l) => (
              <li key={l}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void run(`d:${l}`, () => onDatabase(l))}
                  className="flex items-center rounded-md border border-line bg-surface text-row text-body hover:bg-sunken disabled:opacity-60"
                  style={{ gap: 7, height: 30, padding: "0 10px" }}
                >
                  <Glyph d={LAYOUT_ICONS[l]} />
                  {busy === `d:${l}` ? "Making…" : LAYOUT_NAMES[l]}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p role="alert" className="text-meta text-danger" style={{ minHeight: 18, marginTop: 6 }}>
        {error ?? ""}
      </p>
    </section>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <div className="text-label uppercase text-faint" style={{ margin: "12px 0 6px" }}>
      {children}
    </div>
  );
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
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex w-full min-w-0 items-center rounded-md text-left hover:bg-sunken disabled:opacity-60"
        style={{ gap: 9, padding: "5px 6px", marginLeft: -6 }}
      >
        {icon}
        <span className="min-w-0 truncate text-row text-body">{label}</span>
        {hint ? <span className="ml-auto shrink-0 truncate text-caption text-faint">{hint}</span> : null}
      </button>
    </li>
  );
}
