/*
 * Page-route ⋯ menu. This is a distinct component from RowMenu — 302px wide,
 * with four deliberate groups (appearance, page, file, destructive) plus a
 * font picker and three per-page-per-device toggles. Do not merge into
 * RowMenu; the group order and shell width are part of the spec.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PageAppearance, PageFont } from "@/lib/page-appearance";
import type { PageAccessRow, PageFull } from "@/lib/types";

/* ────────────── Icons ────────────── */

function Ic({ path, size = 15, stroke = 1.9, className, color }: {
  path: string; size?: number; stroke?: number; className?: string; color?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke={color ?? "currentColor"} strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={path} />
    </svg>
  );
}

const P = {
  more: "M5 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zM12 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zM19 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z",
  people: "M9 3.6a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM2 20.4v-1.8a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1.8M16.5 3.9a3.6 3.6 0 0 1 0 7M22 20.4v-1.8a4 4 0 0 0-3-3.8",
  arrow: "M4 12h14m-5-5 5 5-5 5",
  shieldCheck: "M12 2.6l7.6 3.6v5.6c0 4.8-3.3 8.1-7.6 9.6-4.3-1.5-7.6-4.8-7.6-9.6V6.2zM9 11.8l2 2 4-4",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12.3 19",
  download: "M12 3v12M7.5 10.5 12 15l4.5-4.5M4 19h16",
  copy: "M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  box: "M4 7h16v13H4zM4 7l2-3h12l2 3M4 7h16M10 12h4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3",
  search: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-3.5-3.5",
  check: "M5 12l5 5 9-11",
  chev: "m9 6 6 6-6 6",
  small: "M4 17V7M4 7h7M14 17v-6M14 11h5",
  wide: "m8 8-4 4 4 4M16 8l4 4-4 4M4 12h16",
  lock: "M5 11h14v9H5zM8 11V7a4 4 0 0 1 8 0v4",
};

/* ────────────── The trigger button ────────────── */

export function PageMoreButton({ open, onClick, className }: {
  open: boolean; onClick: (e: React.MouseEvent) => void; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      aria-label="Page actions"
      aria-expanded={open}
      className={className}
      style={{
        width: 26, height: 26, borderRadius: 6, display: "grid", placeItems: "center",
        background: open ? "var(--color-sunken)" : "transparent",
        color: open ? "var(--color-strong)" : "var(--color-muted)",
        transition: "background .12s, color .12s",
      }}
      onMouseEnter={(e) => {
        if (open) return;
        (e.currentTarget as HTMLButtonElement).style.background = "var(--color-sunken)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--color-strong)";
      }}
      onMouseLeave={(e) => {
        if (open) return;
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--color-muted)";
      }}
    >
      <Ic path={P.more} size={15} />
    </button>
  );
}

/* ────────────── Row primitives ────────────── */

function GroupSep() {
  return <div style={{ borderBottom: "1px solid var(--color-sunken)", padding: "4px 0" }} />;
}

function ActionRow({
  icon, label, hint, hintKind, onClick, danger,
}: {
  icon?: string;
  label: string;
  hint?: ReactNode;
  hintKind?: "shortcut" | "value";
  onClick?: () => void;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const bg = hover ? (danger ? "var(--color-dangerTint)" : "var(--color-rail)") : "transparent";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "6px 9px", borderRadius: 8, background: bg,
        color: danger ? "var(--color-danger)" : "var(--color-body)",
        textAlign: "left", cursor: "pointer",
      }}
    >
      {icon != null && (
        <Ic path={icon} size={15} stroke={1.9}
          color={danger ? "currentColor" : "var(--color-muted)"}
          className="shrink-0" />
      )}
      <span style={{ flex: 1, fontSize: 14.5, lineHeight: 1.3 }}>{label}</span>
      {hint != null && (
        <span
          style={{
            marginLeft: "auto",
            fontFamily: hintKind === "shortcut"
              ? "'Spline Sans Mono', ui-monospace, monospace"
              : "'Lato', system-ui, sans-serif",
            fontSize: hintKind === "shortcut" ? 11.5 : 12.5,
            color: "var(--color-whisper)",
            maxWidth: 118,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

/* ────────────── Font picker (Group 1) ────────────── */

function FontCard({
  glyph, label, selected, family, size, weight, letterSpacing, onClick,
}: {
  glyph: string; label: string; selected: boolean;
  family: string; size: number; weight: number | string;
  letterSpacing?: string; onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const bg = selected ? "var(--color-line)" : hover ? "var(--color-rail)" : "transparent";
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 2, padding: "7px 0 5px", borderRadius: 8, background: bg,
        cursor: "pointer", width: "100%",
      }}
    >
      <span style={{
        fontFamily: family, fontSize: size, fontWeight: weight,
        lineHeight: 1, color: "var(--color-body)",
        letterSpacing: letterSpacing ?? "normal",
      }}>{glyph}</span>
      <span style={{ fontSize: 11.5, color: "var(--color-faint)" }}>{label}</span>
    </button>
  );
}

/* ────────────── Toggle pill (Group 2) ────────────── */

function TogglePill({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      style={{
        position: "relative", width: 30, height: 17, borderRadius: 9,
        background: on ? "var(--color-accent)" : "var(--color-lineStrong)",
        transition: "background .15s", flex: "none",
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: on ? 15 : 2,
        width: 13, height: 13, borderRadius: "50%",
        background: "var(--color-surface)",
        boxShadow: "0 1px 2px rgba(30,24,12,.28)",
        transition: "left .15s",
      }} />
    </button>
  );
}

function ToggleRow({ icon, label, on, onChange }: {
  icon: string; label: string; on: boolean; onChange: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onChange}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 9px", borderRadius: 8,
        background: hover ? "var(--color-rail)" : "transparent",
        color: "var(--color-body)", cursor: "pointer",
      }}
    >
      <Ic path={icon} size={15} stroke={1.9} color="var(--color-muted)" className="shrink-0" />
      <span style={{ flex: 1, fontSize: 14.5 }}>{label}</span>
      <TogglePill on={on} onChange={onChange} />
    </div>
  );
}

/* ────────────── Delete confirm ────────────── */

function DeleteConfirm({
  title, onCancel, onConfirm,
}: { title: string; onCancel: () => void; onConfirm: () => void }) {
  return createPortal(
    <>
      <div
        onClick={onCancel}
        style={{ position: "fixed", inset: 0, background: "rgba(13,13,9,.35)", zIndex: 90 }}
      />
      <div
        role="dialog"
        aria-modal
        style={{
          position: "fixed", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)", zIndex: 91,
          width: 420, background: "var(--color-surface)", borderRadius: 12,
          border: "1px solid var(--color-line)",
          boxShadow: "0 24px 64px rgba(13,13,9,.22)",
          padding: "20px 20px 16px",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-body)", marginBottom: 6 }}>
          Delete "{title || "Untitled"}"?
        </div>
        <div style={{ fontSize: 13.5, color: "var(--color-secondary)", lineHeight: 1.45 }}>
          It disappears from every view at once — there is no folder it stays in.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button
            type="button" onClick={onCancel}
            style={{
              height: 32, padding: "0 14px", borderRadius: 8,
              border: "1px solid var(--color-line)", background: "var(--color-surface)",
              fontSize: 13.5, color: "var(--color-body)", cursor: "pointer",
            }}
          >Cancel</button>
          <button
            type="button" onClick={onConfirm}
            style={{
              height: 32, padding: "0 14px", borderRadius: 8,
              background: "var(--color-danger)", color: "var(--color-surface)",
              fontSize: 13.5, border: "1px solid var(--color-danger)", cursor: "pointer",
            }}
          >Delete</button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ────────────── Area sub-screen ────────────── */

function AreaScreen({
  areas, current, onPick, onBack,
}: {
  areas: string[]; current: string | null;
  onPick: (a: string | null) => void; onBack: () => void;
}) {
  return (
    <div>
      <button
        type="button" onClick={onBack}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 9px", borderRadius: 8, width: "100%",
          background: "transparent", cursor: "pointer",
          color: "var(--color-secondary)", fontSize: 13,
        }}
      >
        <Ic path="M15 6l-6 6 6 6" size={14} color="var(--color-muted)" />
        <span>Change area</span>
      </button>
      <div style={{ borderTop: "1px solid var(--color-sunken)", margin: "4px 0" }} />
      <ActionRow
        label="No area"
        hint={current == null ? <Ic path={P.check} size={14} color="var(--color-accent)" /> : undefined}
        hintKind="value"
        onClick={() => onPick(null)}
      />
      {areas.map((a) => (
        <ActionRow
          key={a}
          label={a}
          hint={a === current ? <Ic path={P.check} size={14} color="var(--color-accent)" /> : undefined}
          hintKind="value"
          onClick={() => onPick(a)}
        />
      ))}
    </div>
  );
}

/* ────────────── Panel ────────────── */

export type PageActionsHandlers = {
  onCopyLink: () => void;
  onExport: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  onVerify: () => void;
  onOpenPermissions: () => void;      /* opens the existing permissions surface */
  onMoveArea: (a: string | null) => void;
};

export function PageActionsMenu({
  open, onClose, page, workspaceName, memberCount, access, areas, appearance,
  onAppearance, handlers,
}: {
  open: boolean;
  onClose: () => void;
  page: PageFull;
  workspaceName: string;
  memberCount: number;
  access: PageAccessRow[];
  areas: string[];
  appearance: PageAppearance;
  onAppearance: <K extends keyof PageAppearance>(key: K, value: PageAppearance[K]) => void;
  handlers: PageActionsHandlers;
}) {
  const [screen, setScreen] = useState<"root" | "area">("root");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset internal state on close.
  useEffect(() => { if (!open) { setScreen("root"); setConfirmDelete(false); } }, [open]);

  // Escape inside menu: close the menu (unless a sub-screen is up, which
  // handles its own back). Global escape stack in page-view keeps priority.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmDelete) { setConfirmDelete(false); e.stopPropagation(); return; }
      if (screen !== "root") { setScreen("root"); e.stopPropagation(); return; }
      onClose();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, screen, confirmDelete]);

  if (!open) return null;

  const isWorkspace = page.access_type === "workspace";
  const nExplicit = access.filter((a) => a.user_id).length;
  const whoLabel = isWorkspace
    ? `Everyone at ${workspaceName || `${memberCount} people`}`
    : `Only ${nExplicit} ${nExplicit === 1 ? "person" : "people"}`;

  const propsObj: Record<string, unknown> =
    page.props && typeof page.props === "object" && !Array.isArray(page.props)
      ? (page.props as Record<string, unknown>) : {};
  const currentArea =
    typeof propsObj.area === "string" && propsObj.area
      ? (propsObj.area as string) : null;
  const isArchived = !!page.archived_at;

  const isVerifiedToday = (() => {
    const d = new Date(page.verified_at); const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  })();

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 80 }}
      />
      <div
        ref={panelRef}
        role="menu"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed", top: 48, right: 12, zIndex: 81,
          width: 302, background: "var(--color-surface)",
          border: "1px solid var(--color-line)", borderRadius: 12,
          boxShadow: "0 18px 48px rgba(13,13,9,.16)",
          padding: 5, animation: "popIn .12s ease-out",
        }}
      >
        {screen === "area" ? (
          <AreaScreen
            areas={areas}
            current={currentArea}
            onPick={(a) => { handlers.onMoveArea(a); setScreen("root"); }}
            onBack={() => setScreen("root")}
          />
        ) : (
          <>
            {/* GROUP 1 — Typeface */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
              gap: 3, padding: "4px 3px 6px",
            }}>
              <FontCard
                glyph="Ag" label="Default"
                family="'Poppins', system-ui, sans-serif"
                size={17} weight={700} letterSpacing="-0.04em"
                selected={appearance.font === "default"}
                onClick={() => onAppearance("font", "default")}
              />
              <FontCard
                glyph="Ag" label="Serif"
                family="'Newsreader', Georgia, serif"
                size={19.5} weight={600}
                selected={appearance.font === "serif"}
                onClick={() => onAppearance("font", "serif" as PageFont)}
              />
              <FontCard
                glyph="Ag" label="Mono"
                family="'Spline Sans Mono', ui-monospace, monospace"
                size={17.5} weight={500}
                selected={appearance.font === "mono"}
                onClick={() => onAppearance("font", "mono" as PageFont)}
              />
            </div>
            <GroupSep />

            {/* GROUP 2 — Layout toggles */}
            <div>
              <ToggleRow
                icon={P.small} label="Small text"
                on={appearance.small}
                onChange={() => onAppearance("small", !appearance.small)}
              />
              <ToggleRow
                icon={P.wide} label="Full width"
                on={appearance.wide}
                onChange={() => onAppearance("wide", !appearance.wide)}
              />
              <ToggleRow
                icon={P.lock} label="Lock editing"
                on={appearance.locked}
                onChange={() => onAppearance("locked", !appearance.locked)}
              />
            </div>
            <GroupSep />

            {/* GROUP 3 — Page actions */}
            <div>
              <ActionRow
                icon={P.people}
                label="Who can see this"
                hint={whoLabel}
                hintKind="value"
                onClick={() => { onClose(); handlers.onOpenPermissions(); }}
              />
              <ActionRow
                icon={P.arrow}
                label="Change area"
                hint={currentArea ?? "None"}
                hintKind="value"
                onClick={() => setScreen("area")}
              />
              <ActionRow
                icon={P.shieldCheck}
                label={isVerifiedToday ? "Verified today" : "Mark verified today"}
                onClick={() => { onClose(); handlers.onVerify(); }}
              />
            </div>
            <GroupSep />

            {/* GROUP 4 — File actions */}
            <div>
              <ActionRow
                icon={P.link} label="Copy link"
                hint="⌘⌥L" hintKind="shortcut"
                onClick={() => { onClose(); handlers.onCopyLink(); }}
              />
              <ActionRow
                icon={P.download} label="Export"
                hint="PDF, HTML, MD" hintKind="value"
                onClick={() => { onClose(); handlers.onExport(); }}
              />
              <ActionRow
                icon={P.copy} label="Duplicate"
                hint="⌘D" hintKind="shortcut"
                onClick={() => { onClose(); handlers.onDuplicate(); }}
              />
              <ActionRow
                icon={P.box}
                label={isArchived ? "Unarchive" : "Archive"}
                hint="stays searchable" hintKind="value"
                onClick={() => {
                  onClose();
                  if (isArchived) handlers.onUnarchive(); else handlers.onArchive();
                }}
              />
            </div>
            <GroupSep />

            {/* GROUP 5 — Delete (danger) */}
            <div>
              <ActionRow
                icon={P.trash}
                label="Delete page"
                danger
                onClick={() => setConfirmDelete(true)}
              />
            </div>

            {/* FOOTER — no-op search hint */}
            <div style={{
              borderTop: "1px solid var(--color-sunken)", marginTop: 3,
              padding: "8px 10px 5px", display: "flex", gap: 8,
              alignItems: "center", fontSize: 13.5, color: "var(--color-whisper)",
            }}>
              <Ic path={P.search} size={12} color="var(--color-whisper)" />
              <span>Search all actions…</span>
            </div>
          </>
        )}
      </div>

      {confirmDelete && (
        <DeleteConfirm
          title={page.title}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); onClose(); handlers.onDelete(); }}
        />
      )}
    </>,
    document.body,
  );
}
