/**
 * The `sheet` block — READ-ONLY rendering (chunk 2).
 *
 * There is deliberately NO editor element here: no <input>, no selection,
 * no keyboard handling, no toolbar, no clipboard, no row/column ops. Those
 * are chunks 3–7 and their architecture is deliberate. This file renders a
 * sheet you can see and export, and nothing else.
 *
 * Geometry is CONSTANT, not dynamic: later chunks position overlays
 * arithmetically against these numbers.
 *   ROW_NUM_W 34  ·  HEAD_H 26  ·  ROW_H 29
 *
 * Every visible value is EVALUATED on read through the chunk-1 engine.
 * Nothing is cached — a cached result is how a sheet ends up showing a
 * number that no longer follows from its inputs.
 */

import { useMemo } from "react";
import {
  colName,
  evaluateCell,
  format,
  isSheetError,
  type CellValue,
  type SheetError,
} from "@/lib/sheet-engine";
import { normalizeSheet, type Cell, type SheetBlock } from "@/lib/sheet-model";
import { fillToken, inkToken } from "@/lib/sheet-palette";

export const SHEET_ROW_NUM_W = 34;
export const SHEET_HEAD_H = 26;
export const SHEET_ROW_H = 29;

/** Past this many rows a sheet has usually stopped being a calculation. */
export const SHEET_NUDGE_ROWS = 50;

export const SHEET_NUDGE_TEXT =
  "Past 50 rows a sheet is usually a page collection wearing a grid. If each row is a thing someone owns, make them pages.";

const LINE = "1px solid var(--color-lineSoft)";

function cellAlign(cell: Cell | null, value: CellValue | SheetError): "left" | "center" | "right" {
  if (cell?.a) return cell.a;
  // Default: numbers right, everything else left — the convention every
  // financial document already uses.
  if (typeof value === "number") return "right";
  return "left";
}

export function SheetBlockView({
  block,
  pageScope = true,
}: {
  block: { [k: string]: unknown };
  /** Whether this block sits at PAGE scope. Inside a column or a callout
   *  it does not, and the block-resize width (`bw`, chunk 7) is ignored —
   *  a sheet cannot bleed into page gutters it does not have. */
  pageScope?: boolean;
}) {
  const sheet: SheetBlock = useMemo(
    () => normalizeSheet(block as Partial<SheetBlock>),
    [block],
  );
  const rows = sheet.cells.length;
  const cols = sheet.cw.length;
  const freeze = sheet.freeze === true;

  const width = pageScope && typeof sheet.bw === "number" ? sheet.bw : undefined;

  const template = `${SHEET_ROW_NUM_W}px ${sheet.cw.map((w) => `${w}px`).join(" ")}`;

  return (
    <div className="py-1" aria-label="Sheet block">
      <div
        className="overflow-auto rounded-lg border border-line bg-surface"
        style={{ width, maxWidth: "100%", maxHeight: 520 }}
      >
        <div
          role="table"
          className="grid text-meta text-body"
          style={{ gridTemplateColumns: template, width: "max-content" }}
        >
          {/* ── Corner ── */}
          <div
            className="bg-rail"
            style={{
              position: "sticky",
              top: 0,
              left: 0,
              zIndex: 3,
              height: SHEET_HEAD_H,
              borderRight: LINE,
              borderBottom: LINE,
            }}
          />
          {/* ── Column letters ── */}
          {sheet.cw.map((_, c) => (
            <div
              key={`h${c}`}
              role="columnheader"
              className="grid place-items-center bg-rail text-caption text-muted"
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                height: SHEET_HEAD_H,
                borderRight: LINE,
                borderBottom: LINE,
              }}
            >
              {colName(c)}
            </div>
          ))}

          {/* ── Rows ── */}
          {sheet.cells.map((row, r) => {
            // With `freeze`, the first DATA row pins directly beneath the
            // column letters — otherwise a viewport is useless.
            const pinRow = freeze && r === 0;
            return (
              <div key={`r${r}`} role="row" className="col-span-full grid" style={{ gridTemplateColumns: template, ...(pinRow ? { position: "sticky", top: SHEET_HEAD_H, zIndex: 2 } : null) }}>
                <div
                  role="rowheader"
                  className="grid place-items-center bg-rail text-caption text-muted"
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 1,
                    height: SHEET_ROW_H,
                    borderRight: LINE,
                    borderBottom: LINE,
                  }}
                >
                  {r + 1}
                </div>
                {row.map((cell, c) => {
                  const value = evaluateCell(sheet.cells, r, c);
                  const shown = format(value, cell?.f ?? "text", cell?.d);
                  const err = isSheetError(value);
                  const bg = fillToken(cell?.bg);
                  const fg = err ? "var(--color-danger)" : inkToken(cell?.fg);
                  return (
                    <div
                      key={`c${c}`}
                      role="cell"
                      className="overflow-hidden whitespace-nowrap px-1.5"
                      style={{
                        height: SHEET_ROW_H,
                        lineHeight: `${SHEET_ROW_H}px`,
                        borderRight: LINE,
                        borderBottom: LINE,
                        // A rule above a figure is how a total row has been
                        // read in every printed financial document — a real
                        // border, never a background trick.
                        borderTop: cell?.rt ? "2px solid var(--color-body)" : undefined,
                        background: bg,
                        color: fg,
                        fontWeight: cell?.b ? 700 : undefined,
                        fontStyle: cell?.i ? "italic" : undefined,
                        textAlign: cellAlign(cell, value),
                        textOverflow: "ellipsis",
                      }}
                      title={shown || undefined}
                    >
                      {shown}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {rows > SHEET_NUDGE_ROWS && (
        <p className="mt-1.5 text-caption text-amberInk">{SHEET_NUDGE_TEXT}</p>
      )}
      <span className="sr-only">{`${rows} rows, ${cols} columns`}</span>
    </div>
  );
}

export default SheetBlockView;
