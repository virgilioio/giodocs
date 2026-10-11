import type { ReactNode } from "react";

/* Preview cards for block types (2026-10-11, Notion's): a small example of
 * the block, drawn in Gio's own style, and one line saying what it's for.
 * Shown beside the highlighted row of the slash menu and of Turn into.
 * Pure presentation: no data, no state. */

export type PreviewKey =
  | "text" | "h1" | "h2" | "h3" | "bullet" | "numbered" | "todo" | "toggle"
  | "toggleH1" | "toggleH2" | "toggleH3" | "quote" | "caption" | "callout"
  | "divider" | "code" | "diagram" | "table" | "sheet" | "image" | "imagerow"
  | "file" | "page" | "columns" | "viewTable" | "viewBoard" | "viewList"
  | "viewCalendar" | "viewLinked";

const INK = "var(--color-noir)";
const BODY = "var(--color-body)";
const MUTED = "var(--color-muted)";
const LINE = "var(--color-line)";

const line = (w: string, h = 4, c = "var(--color-lineStrong)") => (
  <span style={{ display: "block", width: w, height: h, borderRadius: 2, background: c }} />
);
const P = ({ children, size = 10.5, weight = 400, color = BODY }: { children: ReactNode; size?: number; weight?: number; color?: string }) => (
  <span style={{ display: "block", fontSize: size, fontWeight: weight, color, lineHeight: 1.35 }}>{children}</span>
);

function Grid({ cols, rows, head = true, total = false }: { cols: number; rows: number; head?: boolean; total?: boolean }) {
  const cells = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push(
        <span
          key={`${r}-${c}`}
          style={{
            height: 13,
            borderRight: c < cols - 1 ? `1px solid ${LINE}` : undefined,
            borderBottom: r < rows - 1 ? `1px solid ${LINE}` : undefined,
            background: head && r === 0 ? "var(--color-canvas)" : undefined,
            fontSize: 8,
            color: MUTED,
            padding: "1px 3px",
          }}
        >
          {total && r === rows - 1 && c === 0 ? "Σ" : ""}
        </span>,
      );
  return (
    <span style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, border: `1px solid ${LINE}`, borderRadius: 3, width: "100%" }}>
      {cells}
    </span>
  );
}

function Chip({ label, tint, ink }: { label: string; tint: string; ink: string }) {
  return (
    <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: `var(--color-${tint})`, color: `var(--color-${ink})` }}>
      {label}
    </span>
  );
}

function RowsTable() {
  const rows: Array<[string, string, string, string]> = [
    ["Ana Ruiz", "Interview", "amberTint", "amberInk"],
    ["Leo Park", "Offer", "accentTint", "accent"],
    ["Mia Chen", "Screen", "blueTint", "blueInk"],
  ];
  return (
    <span style={{ display: "block", width: "100%" }}>
      <span style={{ display: "flex", fontSize: 8, color: MUTED, borderBottom: `1px solid ${LINE}`, paddingBottom: 2 }}>
        <span style={{ flex: 1 }}>Name</span>
        <span style={{ width: 52 }}>Stage</span>
      </span>
      {rows.map(([n, s, t, i]) => (
        <span key={n} style={{ display: "flex", alignItems: "center", fontSize: 9, color: INK, padding: "3px 0", borderBottom: `1px solid var(--color-lineSoft)` }}>
          <span style={{ flex: 1 }}>{n}</span>
          <span style={{ width: 52 }}>
            <Chip label={s} tint={t} ink={i} />
          </span>
        </span>
      ))}
    </span>
  );
}

const SPEC: Record<PreviewKey, { what: string; draw: () => ReactNode }> = {
  text: {
    what: "Just start writing with plain text.",
    draw: () => (
      <P>
        Every great hire starts with a <i>clear</i> picture of the role, the team and what <b>success</b> looks like.
      </P>
    ),
  },
  h1: { what: "Big section heading.", draw: () => <P size={20} weight={700} color={INK}>Hiring plan</P> },
  h2: {
    what: "Medium section heading.",
    draw: () => (
      <>
        <P size={15} weight={700} color={INK}>Our values</P>
        <P>• Ownership</P>
        <P>• Candour</P>
      </>
    ),
  },
  h3: {
    what: "Small section heading.",
    draw: () => (
      <>
        <P size={12} weight={700} color={INK}>Next steps</P>
        <P>Send the scorecard to the panel by Friday.</P>
      </>
    ),
  },
  bullet: {
    what: "A simple bulleted list.",
    draw: () => (
      <>
        <P>• Source 20 profiles</P>
        <P>• Screen the shortlist</P>
        <P>• Book panel interviews</P>
      </>
    ),
  },
  numbered: {
    what: "A list with numbering.",
    draw: () => (
      <>
        <P>1. Intake call</P>
        <P>2. Sourcing</P>
        <P>3. Offer</P>
      </>
    ),
  },
  todo: {
    what: "Track tasks with a to-do list.",
    draw: () => (
      <>
        <P>☑ <s style={{ color: MUTED }}>Write the brief</s></P>
        <P>☐ Share with the client</P>
        <P>☐ Post the role</P>
      </>
    ),
  },
  toggle: {
    what: "Tuck details away behind a toggle.",
    draw: () => (
      <>
        <P color={INK}>▾ Interview questions</P>
        <span style={{ display: "block", paddingLeft: 12 }}>
          <P>Tell me about a deal you lost.</P>
        </span>
      </>
    ),
  },
  toggleH1: { what: "A big heading that hides what's under it.", draw: () => <P size={17} weight={700} color={INK}>▸ Hiring plan</P> },
  toggleH2: { what: "A medium heading that hides what's under it.", draw: () => <P size={14} weight={700} color={INK}>▸ Our values</P> },
  toggleH3: { what: "A small heading that hides what's under it.", draw: () => <P size={12} weight={700} color={INK}>▸ Next steps</P> },
  quote: {
    what: "Capture a quote.",
    draw: () => (
      <span style={{ display: "block", borderLeft: `3px solid ${INK}`, paddingLeft: 8 }}>
        <P>The best way to predict the future is to hire for it.</P>
      </span>
    ),
  },
  caption: {
    what: "A quiet note under something.",
    draw: () => (
      <>
        <span style={{ display: "block", height: 34, borderRadius: 3, background: "var(--color-sunken)" }} />
        <P size={8.5} color={MUTED}>Org chart, October</P>
      </>
    ),
  },
  callout: {
    what: "Make writing stand out.",
    draw: () => (
      <span style={{ display: "flex", gap: 6, padding: 7, borderRadius: 4, background: "var(--color-yellowTint)" }}>
        <span>💡</span>
        <P>Ask about notice periods before the first interview.</P>
      </span>
    ),
  },
  divider: {
    what: "Visually divide blocks.",
    draw: () => (
      <span style={{ display: "grid", gap: 7 }}>
        {line("80%")}
        <span style={{ display: "block", height: 1, background: "var(--color-lineStrong)" }} />
        {line("60%")}
      </span>
    ),
  },
  code: {
    what: "Capture a code snippet, verbatim.",
    draw: () => (
      <span style={{ display: "block", padding: 6, borderRadius: 4, background: "var(--color-sunken)", fontFamily: "var(--font-mono)", fontSize: 8.5, color: BODY }}>
        {"const hired = true;"}
        <br />
        {"notify(team);"}
      </span>
    ),
  },
  diagram: {
    what: "Draw a flowchart with Mermaid.",
    draw: () => (
      <svg viewBox="0 0 160 50" width="100%" height={50} aria-hidden>
        <rect x="2" y="15" width="40" height="20" rx="3" fill="none" stroke="currentColor" />
        <rect x="60" y="15" width="40" height="20" rx="3" fill="none" stroke="currentColor" />
        <rect x="118" y="15" width="40" height="20" rx="3" fill="none" stroke="currentColor" />
        <path d="M42 25h16M100 25h16" stroke="currentColor" />
      </svg>
    ),
  },
  table: { what: "Simple rows and columns.", draw: () => <Grid cols={3} rows={4} /> },
  sheet: { what: "A spreadsheet with formulas and totals.", draw: () => <Grid cols={3} rows={4} total /> },
  image: {
    what: "Upload or paste an image.",
    draw: () => (
      <svg viewBox="0 0 160 70" width="100%" height={70} aria-hidden>
        <rect x="1" y="1" width="158" height="68" rx="4" fill="var(--color-sunken)" />
        <path d="M20 58 60 26l26 22 18-12 36 22z" fill="var(--color-lineStrong)" />
        <circle cx="118" cy="20" r="7" fill="var(--color-lineStrong)" />
      </svg>
    ),
  },
  imagerow: {
    what: "Two or three images side by side.",
    draw: () => (
      <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        <span style={{ height: 48, borderRadius: 3, background: "var(--color-sunken)" }} />
        <span style={{ height: 48, borderRadius: 3, background: "var(--color-sunken)" }} />
      </span>
    ),
  },
  file: {
    what: "Attach a document to the page.",
    draw: () => (
      <span style={{ display: "flex", alignItems: "center", gap: 6, padding: 6, border: `1px solid ${LINE}`, borderRadius: 4 }}>
        <span style={{ fontSize: 8, padding: "2px 4px", borderRadius: 2, background: "var(--color-dangerTint)", color: "var(--color-danger)" }}>PDF</span>
        <P color={INK}>Job description.pdf</P>
      </span>
    ),
  },
  page: {
    what: "A page that lives inside this one.",
    draw: () => (
      <>
        <P color={INK}>📄 <u>Interview guide</u></P>
        <P>📄 <u>Offer checklist</u></P>
      </>
    ),
  },
  columns: {
    what: "Put blocks side by side.",
    draw: () => (
      <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <span style={{ display: "grid", gap: 4 }}>{line("100%")}{line("80%")}{line("90%")}</span>
        <span style={{ display: "grid", gap: 4 }}>{line("90%")}{line("100%")}{line("70%")}</span>
      </span>
    ),
  },
  viewTable: { what: "A new database inside this page, as a table.", draw: () => <RowsTable /> },
  viewBoard: {
    what: "A new database as a board, grouped by Status.",
    draw: () => (
      <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
        {[["Not started", "sunken", "muted"], ["In progress", "amberTint", "amberInk"], ["Done", "accentTint", "accent"]].map(([l, t, i]) => (
          <span key={l} style={{ display: "grid", gap: 3, alignContent: "start" }}>
            <Chip label={l} tint={t} ink={i} />
            <span style={{ height: 14, borderRadius: 3, border: `1px solid ${LINE}`, background: "var(--color-surface)" }} />
            {l !== "Done" ? <span style={{ height: 14, borderRadius: 3, border: `1px solid ${LINE}` }} /> : null}
          </span>
        ))}
      </span>
    ),
  },
  viewList: {
    what: "A new database as a simple list of pages.",
    draw: () => (
      <>
        {["Brief: Account Executive", "Brief: SDR, Mexico", "Brief: Head of Sales"].map((t) => (
          <span key={t} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid var(--color-lineSoft)" }}>
            <P color={INK}>📄 {t}</P>
          </span>
        ))}
      </>
    ),
  },
  viewCalendar: {
    what: "A new database on a calendar, by Date.",
    draw: () => {
      const days = Array.from({ length: 14 }, (_, i) => i + 1);
      return (
        <span style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", border: `1px solid ${LINE}`, borderRadius: 3 }}>
          {days.map((d) => (
            <span key={d} style={{ height: 22, fontSize: 7, color: MUTED, padding: 2, borderRight: d % 7 ? `1px solid ${LINE}` : undefined, borderBottom: d <= 7 ? `1px solid ${LINE}` : undefined }}>
              {d}
              {d === 3 || d === 10 ? <span style={{ display: "block", height: 4, marginTop: 2, borderRadius: 1, background: "var(--color-accentTint)" }} /> : null}
            </span>
          ))}
        </span>
      );
    },
  },
  viewLinked: { what: "Show a database that already exists, as a table, board or list.", draw: () => <RowsTable /> },
};

/** The card: a small example on white, and what it's for underneath. */
export function BlockPreview({ k }: { k: PreviewKey }) {
  const s = SPEC[k];
  return (
    <div
      data-block-preview={k}
      className="pointer-events-none rounded-lg bg-btn"
      style={{ width: 190, padding: 8, boxShadow: "0 10px 28px rgba(13,13,9,.22)" }}
    >
      <div className="overflow-hidden rounded-md bg-surface" style={{ padding: "10px 12px", minHeight: 64, color: BODY }}>
        <span style={{ display: "grid", gap: 3 }}>{s.draw()}</span>
      </div>
      <div className="text-caption text-btnFg" style={{ padding: "7px 2px 1px", lineHeight: 1.35 }}>
        {s.what}
      </div>
    </div>
  );
}
