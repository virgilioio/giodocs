/**
 * Chunk 5 skeletons: view (table/list), page, board. See spec for geometry.
 * Widths are hand-authored — never Math.random(), never per-render jitter.
 * Every container is role="status" aria-busy with one sr-only announcement.
 *
 * Chunk 5b: geometry reconciled with the loaded surfaces so the two align
 * to zero delta on mount. Notes:
 *  - Table has 7 columns in the loaded view (Page/Area/Owner/Status/Tags/
 *    Verified/Edited). Dropping to 5 (the earlier draft geometry) was a
 *    real UX regression, so the skeleton now renders the same 7 columns.
 *  - Table row padding follows the density preference (`--gio-cell-py`)
 *    via the `.gio-cell-pad` utility, matching the loaded `Cell`.
 *  - Column-header row uses padding 12px 11px 6px and lineHeight 11px,
 *    matching the loaded HeaderCell.
 */
import { Sk } from "./sk";

const SR = <span className="sr-only">Loading…</span>;

const SK_ROWS: Array<{
  w: string;
  area: number;
  status: number;
  tags: number;
  ver: number;
  edited: number;
}> = [
  { w: "64%", area: 58, status: 72, tags: 92, ver: 42, edited: 52 },
  { w: "46%", area: 64, status: 64, tags: 74, ver: 46, edited: 44 },
  { w: "78%", area: 52, status: 78, tags: 108, ver: 40, edited: 56 },
  { w: "54%", area: 60, status: 68, tags: 62, ver: 44, edited: 48 },
  { w: "69%", area: 56, status: 74, tags: 82, ver: 48, edited: 52 },
  { w: "41%", area: 62, status: 60, tags: 70, ver: 38, edited: 46 },
  { w: "73%", area: 54, status: 80, tags: 96, ver: 42, edited: 54 },
  { w: "58%", area: 58, status: 66, tags: 84, ver: 44, edited: 50 },
];

/* Property strip: 5 rows at min-height 32, label track 132px, ZERO gap
 * between rows. Value bars share one width (they align) — only the
 * label bar widths vary per row. The last row (row 5) stands in for
 * "Last verified" and uses a plain 11px text bar (no pill). A 6th
 * quieter row stands in for "+ Add a property". */
const SK_PROPS: Array<{ l: number; v: number; h: number; r: number }> = [
  { l: 34, v: 132, h: 19, r: 999 },
  { l: 46, v: 132, h: 19, r: 999 },
  { l: 44, v: 132, h: 19, r: 999 },
  { l: 32, v: 132, h: 19, r: 999 },
  { l: 78, v: 132, h: 11, r: 5 },
];

/* Matches the loaded table (see MainView TableBody). */
const ROW_GRID =
  "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) minmax(0,0.9fr) minmax(0,0.9fr)";

/* ─────────────────────────── View skeleton ─────────────────────────── */

export function ViewSkeleton({ layout = "table" }: { layout?: "table" | "list" }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto"
      style={{ maxWidth: "var(--container-view)", padding: "34px 40px" }}
    >
      {SR}
      {/* Header: scope label 14/14, view title 34/34. */}
      <Sk tone="soft" w={70} h={14} r={5} />
      <Sk w={232} h={34} r={6} style={{ marginTop: 2 }} />

      {/* Toolbar row — height 22 to match QueryToolbar. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginTop: 14,
          height: 22,
        }}
      >
        <Sk tone="soft" w={78} h={11} r={5} />
        <Sk w={112} h={22} r={7} />
        <Sk w={96} h={22} r={7} />
        <Sk tone="soft" w={64} h={22} r={7} />
      </div>

      {/* Column header — matches loaded HeaderCell padding 12/11/6 & lh 11. */}
      {layout === "table" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: ROW_GRID,
            alignItems: "center",
          }}
        >
          {[38, 32, 40, 40, 32, 46, 40].map((w, i) => (
            <div
              key={i}
              style={{
                padding: "12px 11px 6px",
                lineHeight: "11px",
                borderBottom: "1px solid var(--color-line)",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Sk tone="soft" w={w} h={11} r={5} />
            </div>
          ))}
        </div>
      )}

      {/* Eight rows. Table rows use gio-cell-pad → density-aware padding
       * (comfortable 10/10, compact 4/4), same as the loaded Cell. */}
      {SK_ROWS.map((r, i) =>
        layout === "table" ? (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: ROW_GRID,
              alignItems: "center",
            }}
          >
            <div className="gio-cell-pad flex items-center border-b border-lineSoft px-[11px]" style={{ gap: 9 }}>
              <Sk w={15} h={15} r={5} />
              <Sk h={11} w={r.w} r={5} />
            </div>
            <div className="gio-cell-pad flex items-center border-b border-lineSoft px-[11px]">
              <Sk tone="soft" h={11} w={r.area} r={5} />
            </div>
            <div className="gio-cell-pad flex items-center border-b border-lineSoft px-[11px]">
              <Sk w={21} h={21} r={999} />
            </div>
            <div className="gio-cell-pad flex items-center border-b border-lineSoft px-[11px]">
              <Sk h={19} w={r.status} r={999} />
            </div>
            <div className="gio-cell-pad flex items-center border-b border-lineSoft px-[11px]" style={{ gap: 6 }}>
              <Sk h={17} w={Math.max(28, r.tags / 2)} r={4} />
              <Sk h={17} w={Math.max(24, r.tags / 3)} r={4} />
            </div>
            <div className="gio-cell-pad flex items-center border-b border-lineSoft px-[11px]">
              <Sk tone="soft" h={10} w={r.ver} r={5} />
            </div>
            <div className="gio-cell-pad flex items-center border-b border-lineSoft px-[11px]">
              <Sk tone="soft" h={10} w={r.edited} r={5} />
            </div>
          </div>
        ) : (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "8px 0",
              borderBottom: "1px solid var(--color-sunken)",
            }}
          >
            <Sk w={15} h={15} r={5} />
            <Sk h={11} w={r.w} r={5} />
          </div>
        ),
      )}
    </div>
  );
}

/* ─────────────────────────── Page skeleton ─────────────────────────── */

export function PageSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto"
      style={{ maxWidth: 780, padding: "42px 44px" }}
    >
      {SR}
      {/* Title row — explicit 51px, emoji 42x42, gap 13. */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, height: 51 }}>
        <Sk tone="block" w={42} h={42} r={10} />
        <Sk h={36} r={6} className="flex-1" style={{ maxWidth: 360 }} />
      </div>

      {/* Permissions chip — height 27, box-sizing:border-box, padding 0 11. */}
      <Sk tone="soft" w={250} h={27} r={999} style={{ marginTop: 16 }} />

      {/* Freshness row — real bordered container, skeletons inside. */}
      <div
        style={{
          marginTop: 14,
          border: "1px solid var(--color-line)",
          borderRadius: 10,
          background: "var(--color-track)",
          padding: "12px 13px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Sk w={16} h={16} r={5} />
        <Sk h={11} r={5} className="flex-1" style={{ maxWidth: 238 }} />
        <Sk tone="soft" w={104} h={24} r={8} />
      </div>

      {/* Properties strip — rows height 20, gap 10, label column 118. */}
      <div
        style={{
          marginTop: 18,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {SK_PROPS.map((p, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              height: 20,
              padding: "0 4px",
            }}
          >
            <div style={{ width: 118, flex: "none" }}>
              <Sk tone="soft" w={p.l} h={11} r={5} />
            </div>
            <Sk w={p.v} h={p.h} r={p.r} />
          </div>
        ))}
      </div>

      {/* Divider. */}
      <div
        style={{
          height: 1,
          background: "var(--color-sunken)",
          margin: "20px 0 26px",
        }}
      />

      {/* Body. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <Sk w={238} h={19} r={5} />
        <Sk tone="soft" w="96%" h={11} r={5} />
        <Sk tone="soft" w="88%" h={11} r={5} />
        <Sk tone="soft" w="72%" h={11} r={5} />
        {[{ w: "64%" }, { w: "58%" }, { w: "69%" }].map((b, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <Sk w={5} h={5} r={999} />
            <Sk tone="soft" w={b.w} h={11} r={5} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── Board skeleton ─────────────────────────── */

const BOARD_COLS: Array<{ cards: number[]; title: string; count: number }> = [
  { cards: [54, 68, 46, 54], title: "64px", count: 22 },
  { cards: [54, 68, 46], title: "48px", count: 18 },
  { cards: [54, 68, 46, 54, 46], title: "72px", count: 26 },
];

const CARD_TITLE_W = ["72%", "58%", "66%", "62%", "70%"];

export function BoardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="mx-auto"
      style={{ maxWidth: "var(--container-view)", padding: "34px 40px" }}
    >
      {SR}
      {/* Header. */}
      <Sk tone="soft" w={70} h={14} r={5} />
      <Sk w={232} h={34} r={6} style={{ marginTop: 2 }} />

      {/* Toolbar. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginTop: 14,
          height: 22,
        }}
      >
        <Sk tone="soft" w={78} h={11} r={5} />
        <Sk w={112} h={22} r={7} />
        <Sk w={96} h={22} r={7} />
        <Sk tone="soft" w={64} h={22} r={7} />
      </div>

      {/* Columns — 264 wide, gap 14, radius 12, padding 10, bg rail. */}
      <div
        style={{
          position: "relative",
          marginTop: 14,
          overflowX: "auto",
        }}
      >
        <div style={{ display: "flex", gap: 14 }}>
          {BOARD_COLS.map((col, ci) => (
            <div
              key={ci}
              style={{
                flex: "none",
                width: 264,
                background: "var(--color-rail)",
                borderRadius: 12,
                padding: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "2px 4px 6px",
                }}
              >
                <Sk w={8} h={8} r={999} />
                <Sk tone="soft" w={parseInt(col.title, 10)} h={11} r={5} />
                <div style={{ flex: 1 }} />
                <Sk tone="soft" w={col.count} h={11} r={5} />
              </div>
              {col.cards.map((h, i) => (
                <div
                  key={i}
                  style={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-line)",
                    borderRadius: 9,
                    height: h,
                    padding: 10,
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                  }}
                >
                  <Sk
                    h={11}
                    w={CARD_TITLE_W[(ci * 3 + i) % CARD_TITLE_W.length]}
                    r={5}
                    className="flex-1"
                  />
                  <Sk w={21} h={21} r={999} />
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Right-edge fade — "scroll for more". */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 4,
            width: 56,
            pointerEvents: "none",
            background:
              "linear-gradient(90deg, rgba(255,255,255,0), var(--color-surface) 78%)",
          }}
        />
      </div>
    </div>
  );
}
