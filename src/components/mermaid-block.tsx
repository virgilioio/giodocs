import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/* A diagram block: a code block whose language is "mermaid", drawn as a
 * picture. The Mermaid library is loaded only when a page has a diagram,
 * so pages without one never pay for it.
 *
 * Readers see the picture. Editors see it too, with "Edit" to open the
 * source under it; the picture follows the source as they type. The source
 * textarea stays mounted while closed (out of sight), so moving the caret
 * into the block with the arrow keys opens it like any other block. */

type MermaidApi = typeof import("mermaid").default;
let loading: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!loading) {
    loading = import("mermaid").then((m) => {
      const api = m.default;
      api.initialize({
        startOnLoad: false,
        // Strict: no scripts, click handlers or raw HTML in labels.
        securityLevel: "strict",
        theme: "neutral",
        fontFamily: "Lato, sans-serif",
      });
      return api;
    });
  }
  return loading;
}

let renderSeq = 0;

type Drawn = { svg: string } | { error: string } | null;

/** Draws `source`; the last good picture stays while a new one renders. */
function useMermaid(source: string, baseId: string): { drawn: Drawn; busy: boolean } {
  const [drawn, setDrawn] = useState<Drawn>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const src = source.trim();
    if (!src) {
      setDrawn(null);
      return;
    }
    let live = true;
    setBusy(true);
    const t = window.setTimeout(async () => {
      try {
        const api = await loadMermaid();
        await api.parse(src);
        const { svg } = await api.render(`${baseId}-${++renderSeq}`, src);
        if (live) setDrawn({ svg });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (live) setDrawn({ error: firstLines(msg) });
      } finally {
        if (live) setBusy(false);
      }
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [source, baseId]);
  return { drawn, busy };
}

function firstLines(msg: string): string {
  return msg.split("\n").slice(0, 4).join("\n").slice(0, 400);
}

export const MERMAID_STARTER = "flowchart TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Skip it]";

export function MermaidBlock({
  source,
  locked,
  editor,
  startOpen,
  picker,
}: {
  source: string;
  locked: boolean;
  /** The source textarea, rendered by the editor so focus and keys work
   *  like every other block. */
  editor: ReactNode;
  startOpen?: boolean;
  /** The code block's language picker, in the top-left corner. */
  picker?: ReactNode;
}) {
  const baseId = "mmd-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const { drawn, busy } = useMermaid(source, baseId);
  const [open, setOpen] = useState(!!startOpen || !source.trim());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const editing = open && !locked;

  return (
    <div
      ref={wrapRef}
      data-mermaid-block
      className="group/mmd relative rounded-md border border-line bg-surface"
      onFocusCapture={(e) => {
        if (!locked && (e.target as HTMLElement).tagName === "TEXTAREA") setOpen(true);
      }}
    >
      <div className="flex min-h-12 items-center justify-center overflow-x-auto px-4 pb-4 pt-10" aria-busy={busy}>
        {drawn && "svg" in drawn ? (
          <div
            role="img"
            aria-label="Diagram"
            className="gio-mermaid max-w-full"
            // Mermaid's strict mode sanitises its own output.
            dangerouslySetInnerHTML={{ __html: drawn.svg }}
          />
        ) : drawn && "error" in drawn ? (
          <div className="w-full text-meta" data-mermaid-error>
            <div className="font-bold text-amberInk">This diagram has a mistake, so it can&apos;t be drawn.</div>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-caption text-muted">{drawn.error}</pre>
          </div>
        ) : (
          <div className="text-meta text-faint">
            {source.trim() ? "Drawing the diagram…" : "An empty diagram. Write its Mermaid source below."}
          </div>
        )}
      </div>

      {picker ? <div className="absolute left-2 top-2">{picker}</div> : null}

      {!locked ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={editing}
          className="absolute right-2 top-2 rounded-md border border-line bg-surface px-2 text-caption text-secondary opacity-0 hover:bg-sunken focus-visible:opacity-100 group-hover/mmd:opacity-100"
          style={{ height: 24, opacity: editing ? 1 : undefined }}
        >
          {editing ? "Done" : "Edit diagram"}
        </button>
      ) : null}

      {/* The source: shown while editing; otherwise kept mounted out of
          sight so focus can still arrive here and open it. */}
      <div
        className={editing ? "border-t border-line bg-sunken p-3" : "pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"}
        aria-hidden={editing ? undefined : true}
      >
        {editing ? (
          <div className="mb-1 flex items-center justify-between text-caption text-faint">
            <span>Mermaid source</span>
            <a
              href="https://mermaid.js.org/intro/syntax-reference.html"
              target="_blank"
              rel="noreferrer"
              className="hover:text-secondary"
            >
              Syntax help
            </a>
          </div>
        ) : null}
        {editor}
      </div>
    </div>
  );
}
