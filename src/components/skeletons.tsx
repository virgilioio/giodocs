/**
 * Chunk 5 skeletons: view (table/list), page, board. See spec for geometry.
 * Widths are hand-authored — never Math.random(), never per-render jitter.
 * Every container is role="status" aria-busy with one sr-only announcement.
 */
import { Sk } from "./sk";

const SR = <span className="sr-only">Loading…</span>;

const SK_ROWS: Array<{ w: string; a: number; s: number; e: number }> = [
  { w: "64%", a: 58, s: 72, e: 52 },
  { w: "46%", a: 64, s: 64, e: 44 },
  { w: "78%", a: 52, s: 78, e: 56 },
  { w: "54%", a: 60, s: 68, e: 48 },
  { w: "69%", a: 56, s: 74, e: 52 },
  { w: "41%", a: 62, s: 60, e: 46 },
  { w: "73%", a: 54, s: 80, e: 54 },
  { w: "58%", a: 58, s: 66, e: 50 },
];

const SK_PROPS: Array<{ l: number; v: number; h: number; r: number }> = [
  { l: 34, v: 132, h: 19, r: 999 },
  { l: 46, v: 132, h: 19, r: 999 },
  { l: 44, v: 132, h: 19, r: 999 },
  { l: 32, v: 132, h: 19, r: 999 },
  { l: 78, v: 132, h: 11, r: 5 },
];

const ROW_GRID = "1fr 92px 30px 96px 88px";

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
      {/* Header: scope label + view title. */}
      <Sk tone="soft" w={70} h={14} r={5} />
      <Sk w={232} h={34} r={6} style={{ marginTop: 2 }} />

      {/* Toolbar row — height 22. */}
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

      {/* Column header. */}
      {layout === "table" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: ROW_GRID,
            gap: 11,
            alignItems: "center",
            padding: "12px 0 6px",
            borderBottom: "1px solid var(--color-line)",
            lineHeight: "11px",
          }}
        >
          <Sk tone="soft" w={38} h={11} r={5} />
          <Sk tone="soft" w={32} h={11} r={5} />
          <Sk tone="soft" w={26} h={11} r={5} />
          <Sk tone="soft" w={42} h={11} r={5} />
          <Sk tone="soft" w={40} h={11} r={5} />
        </div>
      )}

      {/* Eight rows. */}
      {SK_ROWS.map((r, i) => (
        <div
          key={i}
          style={
            layout === "table"
              ? {
                  display: "grid",
                  gridTemplateColumns: ROW_GRID,
                  gap: 11,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--color-sunken)",
                  alignItems: "center",
                }
              : {
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--color-sunken)",
                }
          }
        >
          {/* Page cell: icon + title. */}
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Sk w={15} h={15} r={5} />
            <Sk h={11} w={r.w} r={5} />
          </div>
          {layout === "table" && (
            <>
              <Sk tone="soft" h={11} w={r.a} r={5} />
              <Sk w={21} h={21} r={999} />
              <Sk h={19} w={r.s} r={999} />
              <Sk tone="soft" h={10} w={r.e} r={5} />
            </>
          )}
        </div>
      ))}
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
      {/* Title row — explicit 51px. */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, height: 51 }}>
        <Sk tone="block" w={42} h={42} r={10} />
        <Sk h={36} r={6} className="flex-1" style={{ maxWidth: 360 }} />
      </div>

      {/* Permissions chip. */}
      <Sk tone="soft" w={250} h={27} r={999} style={{ marginTop: 15 }} />

      {/* Freshness row — real bordered container, skeletons inside. */}
      <div
        style={{
          marginTop: 11,
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

      {/* Properties strip. */}
      <div
        style={{
          marginTop: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {SK_PROPS.map((p, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 14, height: 20 }}
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
          margin: "18px 0",
        }}
      />

      {/* Body. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <Sk w={238} h={19} r={5} />
        <Sk tone="soft" w="96%" h={11} r={5} />
        <Sk tone="soft" w="88%" h={11} r={5} />
        <Sk tone="soft" w="72%" h={11} r={5} />
        {[
          { w: "64%" },
          { w: "58%" },
          { w: "69%" },
        ].map((b, i) => (
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

      {/* Columns. */}
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
