/**
 * Export view — 460px dialog matching the Export page shell.
 *
 * The rows array MUST be the exact rows the table is rendering right now
 * (post-runView, post-local-filters). See CHUNK 6 spec §B.
 */

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { useRowMenu, RowMenuList } from "./row-menu";
import { useToast } from "@/lib/toast";
import {
  download,
  slugOf,
  toCsv,
  toMarkdownTable,
  type ExportViewColumnKey,
  type ExportViewRow,
} from "@/lib/export";

export type ExportViewFormat = "CSV" | "Markdown";

const FORMATS: ExportViewFormat[] = ["CSV", "Markdown"];

const LS_KEY = "gio.exportViewFormat";

function readSavedFormat(): ExportViewFormat {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw === "CSV" || raw === "Markdown") return raw;
  } catch {
    /* localStorage unavailable */
  }
  return "CSV";
}

const ALL_COLUMNS: ReadonlyArray<{ key: ExportViewColumnKey; label: string }> = [
  { key: "title", label: "Page" },
  { key: "area", label: "Area" },
  { key: "owner", label: "Owner" },
  { key: "status", label: "Status" },
  { key: "tags", label: "Tags" },
  { key: "verified", label: "Verified" },
  { key: "edited", label: "Edited" },
];

export function ExportViewDialog({
  name,
  rows,
  resolveOwner,
  onClose,
}: {
  /** View name or area name — used for the subtitle and filename. */
  name: string;
  rows: readonly ExportViewRow[];
  resolveOwner: (id: string | null) => string;
  onClose: () => void;
}) {
  const [fmt, setFmt] = useState<ExportViewFormat>(() => readSavedFormat());
  const [selected, setSelected] = useState<Set<ExportViewColumnKey>>(
    () => new Set(ALL_COLUMNS.map((c) => c.key)),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const menu = useRowMenu();
  const toast = useToast();

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, fmt);
    } catch {
      /* ignore */
    }
  }, [fmt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu.isOpen) return;
      if (busy) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu.isOpen, busy, onClose]);

  const filename = useMemo(
    () => `${slugOf(name)}.${fmt === "CSV" ? "csv" : "md"}`,
    [name, fmt],
  );

  const columns = useMemo<ExportViewColumnKey[]>(
    () => ALL_COLUMNS.filter((c) => selected.has(c.key)).map((c) => c.key),
    [selected],
  );

  const fmtBtn = useRef<HTMLButtonElement>(null);
  const openFmtPicker = () => {
    if (!fmtBtn.current) return;
    menu.open(
      fmtBtn.current,
      <RowMenuList
        title="Format"
        items={FORMATS.map((f) => ({
          id: f,
          label: f,
          hint: (
            <span style={{ fontSize: 12, color: "var(--color-whisper)" }}>
              {f === "CSV" ? "one row per page" : "for pasting into a doc"}
            </span>
          ),
          check: f === fmt,
          onSelect: () => setFmt(f),
        }))}
      />,
      { width: 240 },
    );
  };

  const toggleCol = (k: ExportViewColumnKey) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  async function onExport() {
    if (busy) return;
    if (columns.length === 0) return;
    setErr(false);
    setBusy(true);
    try {
      const text =
        fmt === "CSV"
          ? toCsv(rows, { columns, resolveOwner })
          : toMarkdownTable(rows, { columns, resolveOwner });
      const mime =
        fmt === "CSV"
          ? "text/csv;charset=utf-8"
          : "text/markdown;charset=utf-8";
      download(filename, new Blob([text], { type: mime }));
      toast.push(`Exported ${filename}`);
      onClose();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  const inert = busy;

  return (
    <>
      <div
        aria-hidden
        onMouseDown={() => (busy ? undefined : onClose())}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 90,
          background: "rgba(13,13,9,.32)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
        }}
      />
      <div
        role="dialog"
        aria-label="Export view"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-popIn"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 460,
          zIndex: 91,
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          borderRadius: 14,
          padding: "22px 24px 18px",
          boxShadow: "0 24px 64px rgba(13,13,9,.22)",
          pointerEvents: inert ? "none" : "auto",
          opacity: inert ? 0.7 : 1,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 21.5,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            color: "var(--color-strong)",
          }}
        >
          Export view
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 14,
            color: "var(--color-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={`${name} · ${rows.length} ${rows.length === 1 ? "page" : "pages"}`}
        >
          {name} · {rows.length} {rows.length === 1 ? "page" : "pages"}
        </div>

        <div style={{ marginTop: 12 }}>
          <Row label="Format">
            <PickerButton
              ref={fmtBtn}
              value={fmt}
              onClick={openFmtPicker}
              width={160}
            />
          </Row>
          <Row label="Columns" last>
            <div />
          </Row>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "6px 16px",
              padding: "4px 0 2px",
            }}
          >
            {ALL_COLUMNS.map((c) => (
              <label
                key={c.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14,
                  color: "var(--color-body)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.key)}
                  onChange={() => toggleCol(c.key)}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </div>

        {err ? (
          <div
            style={{
              marginTop: 14,
              padding: "10px 12px",
              background: "var(--color-dangerTint)",
              border: "1px solid var(--color-dangerRing)",
              borderRadius: 9,
              color: "var(--color-danger)",
              fontSize: 13.5,
              lineHeight: 1.45,
            }}
          >
            Export failed — nothing left your workspace. Try again?
          </div>
        ) : (
          <div
            style={{
              marginTop: 14,
              padding: "10px 12px",
              background: "var(--color-track)",
              border: "1px solid var(--color-line)",
              borderRadius: 9,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              fontSize: 13.5,
              lineHeight: 1.5,
              color: "var(--color-body)",
            }}
          >
            <span aria-hidden style={{ flex: "none", marginTop: 1 }}>
              <svg
                viewBox="0 0 24 24"
                width={14}
                height={14}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--color-muted)" }}
              >
                <circle cx={12} cy={12} r={9} />
                <path d="M12 8v.01M12 11v5" />
              </svg>
            </span>
            <span>
              This exports the rows you can see — the query&apos;s result right
              now, not the query.
            </span>
          </div>
        )}

        <div
          style={{
            marginTop: 14,
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg text-body hover:bg-sunken"
            style={{ padding: "8px 14px", fontSize: 14, fontWeight: 500 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={busy || columns.length === 0}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 700,
              borderRadius: 9,
              background:
                busy || columns.length === 0
                  ? "var(--color-secondary)"
                  : "var(--color-noir)",
              color: "var(--color-track)",
            }}
          >
            {busy ? "Preparing…" : "Export"}
          </button>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── Sub-parts ─────────────────────────── */

function Row({
  label,
  last,
  children,
}: {
  label: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "9px 0",
        borderBottom: last ? "none" : "1px solid var(--color-lineSoft)",
      }}
    >
      <span style={{ fontSize: 14, color: "var(--color-body)" }}>{label}</span>
      {children}
    </div>
  );
}

const PickerButton = forwardRef<
  HTMLButtonElement,
  { value: string; onClick: () => void; width: number }
>(function PickerButton({ value, onClick, width }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      style={{
        width,
        padding: "6px 10px",
        background: "var(--color-track)",
        border: "1px solid var(--color-line)",
        borderRadius: 8,
        fontSize: 14,
        color: "var(--color-body)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <span>{value}</span>
      <span aria-hidden style={{ color: "var(--color-whisper)" }}>
        ▾
      </span>
    </button>
  );
});
