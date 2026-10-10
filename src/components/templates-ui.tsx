import { useState } from "react";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useTemplates } from "@/hooks/use-workspace-data";
import { useNewPageFromTemplate, useSetTemplate } from "@/hooks/use-templates";
import { Ico } from "./emoji-icon";

/* Templates on the page itself: a banner on a template, and a short list
 * of templates on a blank page to start from. */

const TEMPLATE_ICON = "M5 4h14v5H5zM5 13h6v7H5zM15 13h4M15 17h4";

export function TemplateBanner({ pageId, title }: { pageId: string; title: string }) {
  const setTemplate = useSetTemplate();
  const startFrom = useNewPageFromTemplate();
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="mt-4 flex w-full flex-wrap items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-row"
      style={{ borderRadius: 10 }}
    >
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-muted">
        <path d={TEMPLATE_ICON} />
      </svg>
      <span className="min-w-0 flex-1 text-body">
        This page is a template. A page started from it gets a copy of its content, icon and properties.
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await startFrom(pageId);
          setBusy(false);
        }}
        className="rounded-md bg-btn px-3 text-meta text-btnFg disabled:opacity-60"
        style={{ height: 28, minWidth: 148 }}
      >
        {busy ? "Starting…" : "New page from this"}
      </button>
      <button
        type="button"
        onClick={() => setTemplate.mutate({ pageId, title, on: false })}
        className="rounded-md border border-line bg-surface px-3 text-meta text-body hover:bg-rail"
        style={{ height: 28 }}
      >
        Stop using as template
      </button>
    </div>
  );
}

const SHOWN = 6;

/** A blank page's templates: a row is offered its own database's
 *  templates, a plain page the plain-page ones. */
export function TemplatePicker({
  databaseId,
  onPick,
}: {
  databaseId: string | null;
  onPick: (templateId: string) => Promise<void>;
}) {
  const ws = useWorkspaceId();
  const q = useTemplates(ws);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = (q.data ?? []).filter((t) => (t.database_id ?? null) === databaseId);
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <section aria-label="Start from a template" className="animate-fadeIn">
      <div className="text-label uppercase text-faint" style={{ marginBottom: 6 }}>
        Start from a template
      </div>
      <ul>
        {shown.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(t.id);
                try {
                  await onPick(t.id);
                } finally {
                  setBusy(null);
                }
              }}
              className="flex w-full min-w-0 items-center rounded-md text-left hover:bg-sunken disabled:opacity-60"
              style={{ gap: 9, padding: "5px 6px", marginLeft: -6 }}
            >
              <Ico icon={t.icon || "📄"} size={16} />
              <span className="min-w-0 truncate text-row text-body">{t.title || "Untitled"}</span>
              {busy === t.id ? <span className="ml-auto shrink-0 text-caption text-muted">Applying…</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1 rounded-md px-1.5 text-meta text-muted hover:bg-sunken hover:text-strong"
          style={{ marginLeft: -6, height: 26 }}
        >
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      ) : null}
    </section>
  );
}
