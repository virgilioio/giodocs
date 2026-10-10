import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useSetPageOrigin } from "@/lib/page-origin";
import { Ico } from "./emoji-icon";

/* "Linked from" — the pages that mention, link to, embed or relate to this
 * one, under its last block. The database works it out (page_backlinks)
 * as the reader, so a page they can't open is never listed. Nothing shows
 * while it loads or when nothing links here: it sits below the content,
 * so arriving late moves nothing above it. */

type Backlink = { id: string; title: string; icon: string | null; edited_at: string };

const SHOWN = 5;

async function fetchBacklinks(pageId: string): Promise<Backlink[]> {
  const { data, error } = await supabase.rpc("page_backlinks", { p_page: pageId });
  if (error) throw error;
  return (data ?? []) as Backlink[];
}

export function LinkedFrom({ pageId }: { pageId: string }) {
  const q = useQuery({
    queryKey: qk.backlinks(pageId),
    queryFn: () => fetchBacklinks(pageId),
    staleTime: 30_000,
  });
  const navigate = useNavigate();
  const setOrigin = useSetPageOrigin();
  const [all, setAll] = useState(false);
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);

  return (
    <section aria-label="Linked from" className="animate-fadeIn" style={{ marginTop: 40 }}>
      <div
        className="text-label uppercase text-faint"
        style={{ borderTop: "1px solid var(--color-lineSoft)", paddingTop: 14, marginBottom: 6 }}
      >
        Linked from · <span className="tnum">{rows.length}</span>
      </div>
      <ul>
        {shown.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => {
                setOrigin(r.id);
                navigate({ to: "/p/$pageId", params: { pageId: r.id } });
              }}
              className="flex w-full min-w-0 items-center rounded-md text-left hover:bg-sunken"
              style={{ gap: 9, padding: "5px 6px", marginLeft: -6 }}
            >
              <Ico icon={r.icon || "📄"} size={16} />
              <span className="min-w-0 truncate text-row text-body">{r.title || "Untitled"}</span>
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
