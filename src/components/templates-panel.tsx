import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useTemplates, useWorkspaceShell, type TemplateRow } from "@/hooks/use-workspace-data";
import { useNewPageFromTemplate, useSetTemplate } from "@/hooks/use-templates";
import { useCreatePage } from "@/hooks/use-page-mutations";
import { STARTERS, starterBlocks } from "@/lib/starter-templates";
import { groupTemplates } from "@/lib/template-groups";
import { useToast } from "@/lib/toast";
import type { PageListItem } from "@/lib/types";
import { Popover } from "./popover";
import { Ico } from "./emoji-icon";
import { TemplateRowsSkeleton } from "./phone-skeletons";

/* Templates in the sidebar (under Inbox): every template in the
 * workspace, grouped by where it makes pages (plain pages, or a database's
 * rows), plus the starters that ship with Gio Docs. Open one to edit it,
 * or Use it to start a page. */

export const TEMPLATE_ICON = "M5 4h14v5H5zM5 13h6v7H5zM15 13h4M15 17h4";

/** `rail`: a 44px tile on the collapsed black rail. */
export function TemplatesButton({ rail = false }: { rail?: boolean } = {}) {
  return (
    <Popover
      width={400}
      trigger={({ open, onClick, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          aria-expanded={open}
          aria-label={rail ? "Templates" : undefined}
          title={rail ? "Templates" : undefined}
          className={rail ? `gio-rail-tile ${open ? "bg-railHover" : ""}` : `mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-ui text-secondary hover:bg-railHover ${open ? "bg-railHover" : ""}`}
        >
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={rail ? "h-5 w-5" : "text-muted"}>
            <path d={TEMPLATE_ICON} />
          </svg>
          {rail ? null : <span className="flex-1 text-left">Templates</span>}
        </button>
      )}
    >
      {(close) => <TemplatesPanel close={close} />}
    </Popover>
  );
}

/** The templates list: in the sidebar's popover, or full screen on a phone. */
export function TemplatesPanel({ close }: { close: () => void }) {
  const ws = useWorkspaceId();
  const q = useTemplates(ws);
  const shell = useWorkspaceShell(ws);
  const navigate = useNavigate();
  const toast = useToast();
  const startFrom = useNewPageFromTemplate();
  const createPage = useCreatePage();
  const setTemplate = useSetTemplate();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const pages = useMemo(() => (shell.pages.data ?? []) as PageListItem[], [shell.pages.data]);
  const groups = useMemo(
    () => groupTemplates(q.data ?? [], pages, query),
    [q.data, pages, query],
  );
  const starters = STARTERS.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()));

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      close();
    } catch {
      toast.push("That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const startFromStarter = (id: string) =>
    run(`s:${id}`, async () => {
      const s = STARTERS.find((x) => x.id === id)!;
      const row = await createPage.mutateAsync({ seedProps: {}, title: s.name, icon: s.icon, blocks: starterBlocks(id) });
      await navigate({ to: "/p/$pageId", params: { pageId: row.id } });
    });

  const newTemplate = () =>
    run("new", async () => {
      const row = await createPage.mutateAsync({ seedProps: {}, title: "", quiet: true });
      await setTemplate.mutateAsync({ pageId: row.id, title: "", on: true, quiet: true });
      try {
        sessionStorage.setItem("gio.focus-title", row.id);
      } catch {
        /* storage unavailable */
      }
      await navigate({ to: "/p/$pageId", params: { pageId: row.id } });
    });

  const open = (t: TemplateRow) => {
    close();
    void navigate({ to: "/p/$pageId", params: { pageId: t.id } });
  };

  return (
    <div role="dialog" aria-label="Templates">
      <div className="flex items-center" style={{ padding: "6px 8px 6px 10px", gap: 8 }}>
        <span className="font-display text-strong" style={{ fontSize: 15, fontWeight: 700 }}>
          Templates
        </span>
        <span className="flex-1" />
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void newTemplate()}
          className="rounded-md px-2 text-meta text-muted hover:bg-sunken hover:text-strong disabled:opacity-60"
          style={{ height: 26 }}
        >
          {busy === "new" ? "Making…" : "+ New template"}
        </button>
      </div>
      <div style={{ padding: "0 10px 6px" }}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates"
          aria-label="Search templates"
          className="w-full rounded-md border border-line bg-surface px-2 text-ui text-body outline-none focus:border-accent"
          style={{ height: 30 }}
        />
      </div>
      <div style={{ maxHeight: "min(480px, 65vh)", overflowY: "auto", paddingBottom: 6 }}>
        {q.isLoading ? (
          <TemplateRowsSkeleton />
        ) : groups.length === 0 && (q.data ?? []).length === 0 && !query ? (
          <p className="px-3 py-2 text-meta text-muted" style={{ lineHeight: 1.5 }}>
            No templates yet. Make one with New template, or open any page's ⋯ menu and choose Use as
            template. For a database's rows, use the arrow beside its New button.
          </p>
        ) : null}
        {groups.map((g) => (
          <section key={g.key} aria-label={g.label}>
            <Heading>{g.label}</Heading>
            <ul>
              {g.items.map((t) => (
                <Row
                  key={t.id}
                  icon={t.icon || "📄"}
                  title={t.title?.trim() || "Untitled"}
                  busy={busy === `t:${t.id}`}
                  disabled={!!busy}
                  onOpen={() => open(t)}
                  onUse={() => void run(`t:${t.id}`, () => startFrom(t.id))}
                  useLabel={g.databaseId ? "New row" : "Use"}
                />
              ))}
            </ul>
          </section>
        ))}
        {starters.length ? (
          <section aria-label="Starters">
            <Heading>Starters</Heading>
            <ul>
              {starters.map((s) => (
                <Row
                  key={s.id}
                  icon={s.icon}
                  title={s.name}
                  hint={s.hint}
                  busy={busy === `s:${s.id}`}
                  disabled={!!busy}
                  onOpen={() => void startFromStarter(s.id)}
                  onUse={() => void startFromStarter(s.id)}
                  useLabel="Use"
                />
              ))}
            </ul>
          </section>
        ) : null}
        {query && groups.length === 0 && starters.length === 0 ? (
          <p className="px-3 py-2 text-meta text-muted">No template matches "{query}".</p>
        ) : null}
      </div>
    </div>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <div className="text-label uppercase text-faint" style={{ padding: "10px 12px 4px" }}>
      {children}
    </div>
  );
}

function Row({
  icon,
  title,
  hint,
  busy,
  disabled,
  onOpen,
  onUse,
  useLabel,
}: {
  icon: string;
  title: string;
  hint?: string;
  busy: boolean;
  disabled: boolean;
  onOpen: () => void;
  onUse: () => void;
  useLabel: string;
}) {
  return (
    <li className="group/tpl flex items-center rounded-md hover:bg-rail" style={{ margin: "0 4px", paddingRight: 6 }}>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center text-left disabled:opacity-60"
        style={{ gap: 9, padding: "6px 8px" }}
      >
        <Ico icon={icon} size={16} />
        <span className="min-w-0 truncate text-row text-body">{title}</span>
        {hint ? <span className="ml-auto shrink-0 truncate text-caption text-faint">{hint}</span> : null}
      </button>
      <button
        type="button"
        onClick={onUse}
        disabled={disabled}
        aria-label={`${useLabel} from ${title}`}
        className={`shrink-0 rounded-md border border-line bg-surface px-2 text-meta text-body hover:bg-sunken disabled:opacity-60 ${busy ? "" : "opacity-0 focus-visible:opacity-100 group-hover/tpl:opacity-100"}`}
        style={{ height: 24, transition: "opacity var(--dur-hover) ease" }}
      >
        {busy ? "Starting…" : useLabel}
      </button>
    </li>
  );
}
