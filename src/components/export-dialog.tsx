/**
 * Export dialog — 460px card, in-browser export via src/lib/export.ts.
 *
 * The Format popover and Paper popover reuse the product's RowMenu popover
 * (via useRowMenu), matching the rest of the app — NOT native <select>.
 * Escape order (RowMenu handles its own): open popover → dialog → beneath.
 */

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { useRowMenu, RowMenuList } from "./row-menu";
import { useToast } from "@/lib/toast";
import {
  download,
  printPdf,
  slugOf,
  toHtml,
  toMarkdown,
  type ExportContext,
} from "@/lib/export";

export type ExportFormat = "PDF" | "HTML" | "Markdown";
type Paper = "Letter" | "A4" | "Legal" | "Tabloid" | "A3";

const FORMATS: ExportFormat[] = ["PDF", "HTML", "Markdown"];
const PAPERS: Paper[] = ["Letter", "A4", "Legal", "Tabloid", "A3"];

const LS_KEY = "gio.exportFormat";

function readSavedFormat(): ExportFormat {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw === "PDF" || raw === "HTML" || raw === "Markdown") return raw;
  } catch {
    /* localStorage may be unavailable in embedded contexts. */
  }
  return "PDF";
}

function defaultPaper(): Paper {
  try {
    return typeof navigator !== "undefined" && navigator.language === "en-US"
      ? "Letter"
      : "A4";
  } catch {
    return "A4";
  }
}

export function ExportDialog({
  ctx,
  onClose,
}: {
  ctx: ExportContext;
  onClose: () => void;
}) {
  const [fmt, setFmt] = useState<ExportFormat>(() => readSavedFormat());
  const [paper, setPaper] = useState<Paper>(() => defaultPaper());
  const [scale, setScale] = useState<string>("100");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<null | "popup-blocked" | "generic">(null);
  const menu = useRowMenu();
  const toast = useToast();

  // Persist the last chosen format; never persist paper.
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, fmt);
    } catch {
      /* ignore */
    }
  }, [fmt]);

  // Dialog Escape closes the dialog — but only when no menu popover is open,
  // because RowMenu already handles Escape for its own popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu.isOpen) return; // popover consumes it
      if (busy) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu.isOpen, busy, onClose]);

  const filename = useMemo(() => {
    const slug = slugOf(ctx.title);
    const ext = fmt === "Markdown" ? "md" : fmt === "HTML" ? "html" : "pdf";
    return `${slug}.${ext}`;
  }, [ctx.title, fmt]);

  const fmtBtn = useRef<HTMLButtonElement>(null);
  const paperBtn = useRef<HTMLButtonElement>(null);

  const openFmtPicker = () => {
    if (!fmtBtn.current) return;
    menu.open(
      fmtBtn.current,
      <RowMenuList
        title="Format"
        items={FORMATS.map((f) => ({
          id: f,
          label: f,
          check: f === fmt,
          onSelect: () => setFmt(f),
        }))}
      />,
      { width: 160 },
    );
  };

  const openPaperPicker = () => {
    if (!paperBtn.current) return;
    menu.open(
      paperBtn.current,
      <RowMenuList
        title="Paper size"
        items={PAPERS.map((p) => ({
          id: p,
          label: p,
          check: p === paper,
          onSelect: () => setPaper(p),
        }))}
      />,
      { width: 160 },
    );
  };

  async function onExport() {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      if (fmt === "Markdown") {
        const text = toMarkdown(ctx);
        download(filename, new Blob([text], { type: "text/markdown;charset=utf-8" }));
        toast.push(`Exported ${filename}`);
        onClose();
      } else if (fmt === "HTML") {
        const html = toHtml(ctx);
        download(filename, new Blob([html], { type: "text/html;charset=utf-8" }));
        toast.push(`Exported ${filename}`);
        onClose();
      } else {
        // PDF — clamp scale into 50..200 on the way in.
        const clamped = Math.max(50, Math.min(200, Number(scale) || 100));
        await printPdf(ctx, paper, clamped);
        toast.push("Opening your print dialog");
        onClose();
      }
    } catch (e) {
      // BUG 2: previously the generic "nothing left your workspace" copy
      // swallowed the real cause. Log the exception verbatim so the next
      // failure is diagnosable in the console.
      console.error("[export] failed", { format: fmt, error: e });
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg === "popup-blocked" ? "popup-blocked" : "generic");
    } finally {
      setBusy(false);
    }
  }

  const inert = busy;

  return (
    <>
      {/* Scrim */}
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
      {/* Card */}
      <div
        role="dialog"
        aria-label="Export page"
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
          Export page
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
          title={ctx.title || "Untitled"}
        >
          {ctx.title || "Untitled"}
        </div>

        <div style={{ marginTop: 12 }}>
          <Row label="Format" last={fmt !== "PDF"}>
            <PickerButton
              ref={fmtBtn}
              value={fmt}
              onClick={openFmtPicker}
              width={160}
            />
          </Row>
          {fmt === "PDF" && (
            <>
              <Row label="Paper size">
                <PickerButton
                  ref={paperBtn}
                  value={paper}
                  onClick={openPaperPicker}
                  width={160}
                />
              </Row>
              <Row label="Scale" last>
                <ScaleInput value={scale} onChange={setScale} />
              </Row>
            </>
          )}
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
            {err === "popup-blocked"
              ? "Your browser blocked the print window. Allow pop-ups for this site, or export HTML instead."
              : "Export failed — nothing left your workspace. Try again?"}
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
              <strong>One page, one file.</strong> Its properties travel with
              it. The views it appears in do not — a view is a query, and a
              query has no contents to export.
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
            disabled={busy}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 700,
              borderRadius: 9,
              background: busy
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

function ScaleInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "var(--color-track)",
        border: "1px solid var(--color-line)",
        borderRadius: 8,
        padding: "4px 8px",
      }}
    >
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => {
          const n = Math.max(50, Math.min(200, Number(value) || 100));
          onChange(String(n));
        }}
        style={{
          width: 64,
          background: "transparent",
          border: "none",
          outline: "none",
          fontSize: 14,
          color: "var(--color-body)",
          textAlign: "right",
        }}
        aria-label="Scale percent"
      />
      <span style={{ fontSize: 14, color: "var(--color-whisper)" }}>%</span>
    </div>
  );
}
