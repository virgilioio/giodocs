import { toClipboard } from "@/lib/clipboard";
import { useToast } from "@/lib/toast";
import { publicPageUrl, usePagePublicLink, useSetPagePublic } from "@/lib/public-links";

/**
 * Share › Publish to web (Allan, 2026-11-05), at the end of the Share
 * panel: a switch that publishes the page for anyone with the link, the
 * link with Copy, whether the pages inside it come along, and Reset link.
 * Read-only for people who can't edit the page.
 */
export function PublishSection({
  pageId,
  workspaceId,
  canManage,
}: {
  pageId: string;
  workspaceId: string;
  canManage: boolean;
}) {
  const toast = useToast();
  const linkQ = usePagePublicLink(pageId);
  const set = useSetPagePublic(pageId, workspaceId);
  const link = linkQ.data ?? null;
  const on = !!link;
  const url = link ? publicPageUrl(link.token) : "";
  const busy = set.isPending || linkQ.isLoading;

  return (
    <div style={{ padding: "12px 15px 0" }} data-publish-section>
      <div
        className="font-display"
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: "0.085em",
          color: "var(--color-faint)",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Publish to web
      </div>
      <div className="flex items-start" style={{ gap: 10 }}>
        <div className="min-w-0 flex-1">
          <div className="text-row text-strong" style={{ fontWeight: 700 }}>
            {on ? "Anyone with the link can view" : "Not published"}
          </div>
          <div className="text-meta text-muted" style={{ lineHeight: 1.4 }}>
            {on
              ? "Read only, without signing in. Search engines aren't invited in."
              : "Make a link that anyone can open, without a Gio Docs account."}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Publish to web"
          disabled={!canManage || busy}
          onClick={() => set.mutate({ on: !on, includeChildren: link?.include_children ?? true })}
          className="relative mt-1 shrink-0 rounded-full disabled:opacity-60"
          style={{
            width: 30,
            height: 17,
            background: on ? "var(--color-accent)" : "var(--color-lineStrong)",
            transition: "background-color var(--dur-hover) var(--ease-out)",
          }}
        >
          <span
            className="absolute rounded-full bg-surface"
            style={{
              top: 2,
              left: 2,
              width: 13,
              height: 13,
              transform: on ? "translateX(13px)" : "none",
              transition: "transform var(--dur-switch) var(--ease-out)",
            }}
          />
        </button>
      </div>
      {link ? (
        <>
          <div className="mt-2 flex items-center" style={{ gap: 6 }}>
            <input
              readOnly
              value={url}
              aria-label="Public link"
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-line bg-track text-meta text-body"
              style={{ padding: "5px 8px" }}
            />
            <button
              type="button"
              onClick={() => {
                toClipboard(url);
                toast.push("Public link copied");
              }}
              className="shrink-0 rounded-md bg-btn text-meta text-btnFg"
              style={{ padding: "5px 10px", fontWeight: 700 }}
            >
              Copy
            </button>
          </div>
          <label
            className="mt-2 flex items-center text-meta text-body"
            style={{ gap: 7, cursor: canManage ? "pointer" : "default" }}
          >
            <input
              type="checkbox"
              checked={link.include_children}
              disabled={!canManage || busy}
              onChange={(e) => set.mutate({ on: true, includeChildren: e.target.checked })}
            />
            Include the pages inside it
          </label>
          <div className="text-caption text-faint" style={{ marginLeft: 21, lineHeight: 1.4 }}>
            Only those shared with the whole workspace. Private pages stay private.
          </div>
          <div className="mt-2 text-caption text-faint" style={{ lineHeight: 1.4 }}>
            Databases on the page are public with it. A property hidden in a view still shows on its
            row’s page.
          </div>
          {canManage ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                set.mutate(
                  { on: true, includeChildren: link.include_children, reset: true },
                  { onSuccess: () => toast.push("New link made. The old one no longer works.") },
                );
              }}
              className="mt-2 rounded-md text-meta text-muted hover:bg-rail hover:text-strong"
              style={{ padding: "3px 6px", marginLeft: -6 }}
            >
              Reset link
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
