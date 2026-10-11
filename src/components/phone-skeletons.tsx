/**
 * Phone skeletons (2026-10-11). Each one is drawn on the geometry of the
 * phone screen it stands in for (phone-shell.tsx, the phone Home tab, a
 * page under the floating buttons, a database), so the swap to content
 * moves nothing. Widths are hand-authored, never random. Every container
 * is role="status" aria-busy with one sr-only announcement.
 *
 * The desktop skeletons (skeletons.tsx) hand over to these below 768px.
 */
import { useRouterState } from "@tanstack/react-router";
import { G } from "@/lib/phone-glyphs";
import { Sk, useDelayedPending } from "./sk";

const SR = <span className="sr-only">Loading…</span>;

/* The frame's glyph (phone-shell's Glyph; drawn here so the boot gates
 * don't pull in the shell). */
function Glyph({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/* ─────────────── Home tab: Recents, Workspace, Private ─────────────── */

/** A section header of the phone's Home tab (SectionHeader phone). */
function HeaderSk({ w }: { w: number }) {
  return (
    <div className="mt-5 flex items-center px-1.5 pb-1" style={{ minHeight: 44 }}>
      <Sk tone="soft" w={w} h={13} r={5} />
    </div>
  );
}

/** A 48px touch row: a 22px icon and the title (PhoneRecents, Favorites). */
function RowSk({ w, h = 48, indent = 6 }: { w: string; h?: number; indent?: number }) {
  return (
    <div className="flex items-center" style={{ gap: 14, minHeight: h, padding: `0 6px 0 ${indent}px` }}>
      <Sk w={22} h={22} r={6} />
      <Sk h={13} w={w} r={5} />
    </div>
  );
}

const RECENT_W = ["58%", "44%", "66%"];
const TREE_W = ["38%", "52%", "30%", "46%"];

/** Rows under the Recents header while the visits load (PhoneRecents). */
export function PhoneRecentRowsSkeleton() {
  return (
    <div role="status" aria-busy="true">
      {SR}
      {RECENT_W.map((w, i) => (
        <RowSk key={i} w={w} />
      ))}
    </div>
  );
}

/** The phone's Home tab before the page list arrives. `inner`: inside the
 *  tab's own list, under its Recents (no padding, no Recents of its own). */
export function PhoneHomeSkeleton({ inner = false }: { inner?: boolean }) {
  return (
    <div role="status" aria-busy="true" className={inner ? undefined : "px-3 pb-4"}>
      {SR}
      {inner ? null : (
        <>
          <HeaderSk w={64} />
          {RECENT_W.map((w, i) => (
            <RowSk key={i} w={w} />
          ))}
        </>
      )}
      <HeaderSk w={84} />
      {/* Tree rows: 46px, the ▸ toggle's 28px before the icon. */}
      {TREE_W.map((w, i) => (
        <RowSk key={i} w={w} h={46} indent={34} />
      ))}
      <HeaderSk w={58} />
      {TREE_W.slice(0, 2).map((w, i) => (
        <RowSk key={i} w={w} h={46} indent={34} />
      ))}
    </div>
  );
}

/* ─────────────── Inbox and Templates tabs ─────────────── */

const INBOX_ROWS = [
  { a: "82%", b: "46%" },
  { a: "64%", b: "38%" },
  { a: "74%", b: "52%" },
  { a: "58%", b: "34%" },
];

/** Notification rows while the inbox loads (InboxPanel). `page`: the
 *  phone tab's roomier rows. */
export function InboxRowsSkeleton({ page = false }: { page?: boolean }) {
  return (
    <div role="status" aria-busy="true">
      {SR}
      {INBOX_ROWS.map((r, i) => (
        <div key={i} className="flex items-start" style={{ gap: 10, padding: page ? "12px 10px" : "8px 10px" }}>
          <Sk w={26} h={26} r={999} style={{ marginTop: 1 }} />
          <div className="min-w-0 flex-1" style={{ paddingTop: 4 }}>
            <Sk h={11} w={r.a} r={5} />
            <Sk tone="soft" h={9} w={r.b} r={5} style={{ marginTop: page ? 11 : 9 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const TPL_ROWS = ["46%", "58%", "38%", "52%"];

/** Template rows while the list loads (TemplatesPanel), on the 30px rows. */
export function TemplateRowsSkeleton() {
  return (
    <div role="status" aria-busy="true" style={{ padding: "4px 0" }}>
      {SR}
      <div className="px-3" style={{ padding: "8px 12px 6px" }}>
        <Sk tone="soft" w={54} h={9} r={4} />
      </div>
      {TPL_ROWS.map((w, i) => (
        <div key={i} className="flex items-center" style={{ height: 30, gap: 9, padding: "0 12px" }}>
          <Sk w={16} h={16} r={4} />
          <Sk h={11} w={w} r={5} />
          <span className="flex-1" />
          <Sk tone="soft" w={40} h={22} r={6} />
        </div>
      ))}
    </div>
  );
}

/* ─────────────── A page ─────────────── */

/* Property rows: label track 132px (the strip's), one value width. */
const PROP_ROWS: Array<{ l: number; v: number; h: number; r: number }> = [
  { l: 40, v: 64, h: 20, r: 999 },
  { l: 58, v: 96, h: 20, r: 999 },
  { l: 44, v: 52, h: 20, r: 6 },
  { l: 62, v: 74, h: 22, r: 6 },
];

const BODY_W = ["94%", "82%", "88%", "60%"];

/** A page under the phone's floating buttons (PageEditor while it loads):
 *  icon and a two-line title, who can see it, the properties, the body. */
export function PhonePageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="mx-auto" style={{ maxWidth: 780, padding: "42px 44px" }}>
      {SR}
      {/* Title: the 42px icon beside two lines of the 40px title (97px). */}
      <div className="flex" style={{ gap: 13, height: 97 }}>
        <Sk tone="block" w={42} h={42} r={10} style={{ marginTop: 5 }} />
        <div className="min-w-0 flex-1" style={{ paddingTop: 9 }}>
          <Sk h={30} w="100%" r={7} />
          <Sk h={30} w="58%" r={7} style={{ marginTop: 18 }} />
        </div>
      </div>
      {/* Who can see it · Edited — the 27px chip row. */}
      <div className="flex items-center" style={{ marginTop: 16, height: 27, gap: 8 }}>
        <Sk tone="soft" w={150} h={27} r={999} />
        <Sk tone="soft" w={110} h={10} r={5} />
      </div>
      {/* Properties: the 30px Hide properties / Customize row, then 32px rows. */}
      <div className="flex items-center justify-between" style={{ marginTop: 25, height: 30 }}>
        <Sk tone="soft" w={100} h={10} r={5} />
        <Sk tone="soft" w={66} h={10} r={5} />
      </div>
      {PROP_ROWS.map((p, i) => (
        <div key={i} className="grid items-center" style={{ gridTemplateColumns: "132px 1fr", minHeight: 32, padding: "0 6px" }}>
          <Sk tone="soft" w={p.l} h={10} r={5} />
          <Sk w={p.v} h={p.h} r={p.r} />
        </div>
      ))}
      {/* Verified: its date and the Still accurate button (68px). */}
      <div className="grid items-center" style={{ gridTemplateColumns: "125px 1fr", minHeight: 68, padding: "0 6px" }}>
        <Sk tone="soft" w={50} h={10} r={5} />
        <div>
          <Sk tone="soft" w={110} h={10} r={5} />
          <Sk w={88} h={22} r={6} style={{ marginTop: 10 }} />
        </div>
      </div>
      <div className="flex items-center" style={{ height: 32, gap: 6, padding: "0 6px" }}>
        <Sk tone="soft" w={11} h={11} r={3} />
        <Sk tone="soft" w={88} h={10} r={5} />
      </div>
      {/* Body, after the strip's rule. */}
      <div className="border-t border-line" style={{ marginTop: 22, paddingTop: 18 }}>
        <Sk w="62%" h={24} r={6} />
        <div className="flex flex-col" style={{ gap: 15, marginTop: 20 }}>
          {BODY_W.map((w, i) => (
            <Sk key={i} tone="soft" w={w} h={11} r={5} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── A database ─────────────── */

const DB_ROWS = ["72%", "52%", "80%", "60%", "68%", "46%"];

/** A database page on a phone (DatabaseView while it loads): the title
 *  row, New, the view tabs with the toolbar, then the table's first
 *  columns, a list, or the board's first columns. */
export function PhoneDatabaseSkeleton({ layout = "table" }: { layout?: "table" | "list" | "board" }) {
  return (
    <div role="status" aria-busy="true" className="mx-auto overflow-hidden" style={{ maxWidth: "var(--container-view)", padding: "34px 40px" }}>
      {SR}
      {/* Title row (34px) and New (30px), as they wrap at phone width. */}
      <div className="flex items-center" style={{ height: 34, gap: 10 }}>
        <Sk tone="block" w={30} h={30} r={7} />
        <Sk w={128} h={26} r={6} />
        <span className="flex-1" />
        <Sk tone="soft" w={44} h={10} r={5} />
      </div>
      <Sk w={96} h={30} r={8} style={{ marginTop: 8 }} />
      {/* View tabs and the toolbar's four icons (41px). */}
      <div className="flex items-center border-b border-lineSoft" style={{ marginTop: 12, height: 41, gap: 8 }}>
        <Sk w={48} h={22} r={6} />
        <Sk tone="soft" w={60} h={22} r={6} />
        <span className="flex-1" />
        {[0, 1, 2, 3].map((i) => (
          <Sk key={i} tone="soft" w={18} h={18} r={5} style={{ marginLeft: 10 }} />
        ))}
      </div>
      {layout === "board" ? (
        <>
          <div className="flex items-center" style={{ height: 29, gap: 8, marginTop: 4 }}>
            <Sk tone="soft" w={52} h={22} r={999} />
            <Sk tone="soft" w={92} h={22} r={999} />
            <Sk tone="soft" w={60} h={22} r={999} />
          </div>
          <div className="flex" style={{ gap: 14, marginTop: 8 }}>
            {[3, 2].map((cards, ci) => (
              <div key={ci} className="shrink-0 rounded-xl bg-rail" style={{ width: 264, padding: 10 }}>
                <div className="flex items-center px-1" style={{ gap: 8, height: 18, marginBottom: 8 }}>
                  <Sk w={6} h={6} r={999} />
                  <Sk tone="soft" w={ci ? 70 : 44} h={10} r={5} />
                </div>
                <div className="flex flex-col" style={{ gap: 8 }}>
                  {Array.from({ length: cards }, (_, i) => (
                    <div key={i} className="rounded-[9px] border border-line bg-surface" style={{ height: 68, padding: 10 }}>
                      <Sk h={11} w={DB_ROWS[(ci * 2 + i) % DB_ROWS.length]} r={5} />
                      <div className="flex items-center justify-between" style={{ marginTop: 20 }}>
                        <Sk w={18} h={18} r={999} />
                        <Sk tone="soft" w={30} h={9} r={5} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : layout === "list" ? (
        DB_ROWS.map((w, i) => (
          <div key={i} className="flex items-center border-b border-lineSoft" style={{ gap: 9, height: 42 }}>
            <Sk w={16} h={16} r={4} />
            <Sk h={11} w={w} r={5} />
          </div>
        ))
      ) : (
        <>
          {/* The heading row (32px) and 42px rows: the title column
           * (16px checkbox gutter + 200px), then the next column cut by
           * the screen's edge, as the table scrolls sideways. */}
          <div className="grid items-center border-b border-line" style={{ gridTemplateColumns: "16px 200px 1fr", height: 32 }}>
            <span />
            <div className="flex items-center px-2" style={{ gap: 6 }}>
              <Sk tone="soft" w={13} h={13} r={3} />
              <Sk tone="soft" w={36} h={10} r={5} />
            </div>
            <div className="px-2">
              <Sk tone="soft" w={40} h={10} r={5} />
            </div>
          </div>
          {DB_ROWS.map((w, i) => (
            <div key={i} className="grid items-center border-b border-lineSoft" style={{ gridTemplateColumns: "16px 200px 1fr", height: 42 }}>
              <span />
              <div className="flex min-w-0 items-center px-2" style={{ gap: 8 }}>
                <Sk w={16} h={16} r={4} />
                <Sk h={11} w={w} r={5} />
              </div>
              <div className="px-2">
                <Sk w={i % 2 ? 54 : 70} h={19} r={999} />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ─────────────── The frame, before the app has its data ─────────────── */

/** The phone frame drawn while the session and workspace load: the top
 *  tabs (Home, Inbox, Templates) or a page's floating buttons, the bottom
 *  bar, and the skeleton of the screen the address points at. The chrome
 *  looks as it will (so nothing changes colour when it turns real) but is
 *  inert until the real frame replaces it. */
export function PhoneBootSkeleton() {
  const show = useDelayedPending(true);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tabParam = useRouterState({
    select: (s) => (s.location.search as { tab?: unknown }).tab,
  }) as unknown;
  if (!show) return <div className="min-h-screen bg-surface" aria-hidden />;
  const onPage = pathname.startsWith("/p/") || pathname.startsWith("/v/");
  const tab = tabParam === "inbox" || tabParam === "templates" ? tabParam : "home";
  return (
    <div className="flex h-dvh flex-col bg-surface" data-phone-boot>
      {onPage ? <PhonePageButtonsSkeleton /> : <PhoneTabsSkeleton tab={tab} />}
      <div className={`gio-phone-main min-w-0 flex-1 overflow-hidden ${onPage ? "gio-phone-page" : ""}`}>
        {onPage ? (
          <PhonePageSkeleton />
        ) : tab === "inbox" ? (
          <div className="gio-phone-panel px-3 pt-1">
            <PanelHeadSkeleton w={48} />
            <InboxRowsSkeleton page />
          </div>
        ) : tab === "templates" ? (
          <div className="gio-phone-panel px-3 pt-1">
            <PanelHeadSkeleton w={78} />
            {/* The search field's place (30px). */}
            <div style={{ padding: "0 10px 6px" }}>
              <div className="rounded-md border border-line bg-surface" style={{ height: 30 }} />
            </div>
            <TemplateRowsSkeleton />
          </div>
        ) : (
          <PhoneHomeSkeleton />
        )}
      </div>
      <PhoneBottomBarSkeleton withMenu={onPage} />
    </div>
  );
}

function PanelHeadSkeleton({ w }: { w: number }) {
  return (
    <div className="flex items-center" style={{ height: 36, padding: "6px 8px 6px 10px" }}>
      <Sk w={w} h={13} r={5} />
    </div>
  );
}

/** The top tabs (PhoneTopTabs), as they look, inert. */
function PhoneTabsSkeleton({ tab }: { tab: "home" | "inbox" | "templates" }) {
  const tabs = [
    { id: "home", label: "Home", d: G.home },
    { id: "inbox", label: "Inbox", d: G.inbox },
    { id: "templates", label: "Templates", d: G.templates },
  ] as const;
  return (
    <div aria-hidden className="gio-phone-tabs flex items-center">
      <span className="gio-phone-circle grid shrink-0 place-items-center rounded-full bg-surface" style={{ width: 52, height: 52 }}>
        <Sk w={28} h={28} r={8} />
      </span>
      {tabs.map((t) => {
        const active = t.id === tab;
        return (
          <span
            key={t.id}
            className={`flex items-center justify-center rounded-full ${active ? "bg-selected text-strong" : "bg-sunken text-muted"}`}
            style={{ height: 52, flex: active ? "2 1 0" : "1 1 0", gap: 10, minWidth: 0 }}
          >
            <Glyph d={t.d} size={22} />
            {active ? <span className="truncate" style={{ fontSize: 17, fontWeight: 700 }}>{t.label}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

/** A page's floating Back, Share and ⋯ (PhonePageButtons), inert. */
export function PhonePageButtonsSkeleton() {
  return (
    <div aria-hidden className="gio-phone-top pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center">
      {[G.back, null, G.share, G.more].map((d, i) =>
        d === null ? (
          <span key={i} className="flex-1" />
        ) : (
          <span key={i} className="gio-phone-float grid shrink-0 place-items-center rounded-full text-strong" style={{ width: 48, height: 48 }}>
            <Glyph d={d} />
          </span>
        ),
      )}
    </div>
  );
}

/** The bottom bar (PhoneBottomBar), inert. */
function PhoneBottomBarSkeleton({ withMenu }: { withMenu: boolean }) {
  return (
    <div aria-hidden className="gio-phone-bottom pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-center">
      {withMenu ? (
        <span className="gio-phone-float grid shrink-0 place-items-center rounded-full text-strong" style={{ width: 56, height: 56 }}>
          <Glyph d={G.menu} />
        </span>
      ) : null}
      <span className="gio-phone-float flex min-w-0 flex-1 items-center rounded-full text-muted" style={{ height: 56, gap: 10, padding: "0 20px", fontSize: 17 }}>
        <Glyph d={G.search} />
        <span className="truncate">Search</span>
      </span>
      <span className="gio-phone-float grid shrink-0 place-items-center rounded-full text-strong" style={{ width: 56, height: 56 }}>
        <Glyph d={G.compose} />
      </span>
    </div>
  );
}
