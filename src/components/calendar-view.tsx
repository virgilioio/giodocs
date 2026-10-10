import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSetPageOrigin } from "@/lib/page-origin";
import {
  addDaysKey,
  dateSpan,
  daysBetweenKeys,
  daysOfSpan,
  formatDue,
  moveDateValue,
  toDueString,
} from "@/lib/due-date";
import { monthGrid, shiftMonth, todayKey, WEEKDAYS } from "@/lib/calendar-grid";
import { Ico } from "./emoji-icon";
import type { PageListItem } from "@/lib/types";

/* Calendar layout for a view: the view's pages placed on a month grid by a
 * date property (stored in views.group_by). Drag a page to another day to
 * change its date; pages without a date wait in a tray underneath and can
 * be dragged onto a day too. The grid is always six weeks, so paging months
 * never changes its height. */

const MAX_CHIPS = 3;

function propsOf(p: PageListItem): Record<string, unknown> {
  return (p.props ?? {}) as Record<string, unknown>;
}

/** "Saturday, October 10" for a "YYYY-MM-DD" key, read in local time. */
function dayName(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function monthTitle(year: number, month0: number): string {
  return new Date(year, month0, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function CalendarViewBody({
  rows,
  dateKey,
  dateLabel,
  onMove,
}: {
  rows: PageListItem[];
  /** The date property pages are placed by; null when the workspace has none. */
  dateKey: string | null;
  dateLabel: string;
  /** null clears the date (dropped on the "no date" tray). */
  onMove: (pageId: string, date: string | null) => void;
}) {
  const navigate = useNavigate();
  const setOrigin = useSetPageOrigin();
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month0: now.getMonth() });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const today = todayKey(now);

  const grid = useMemo(() => monthGrid(ym.year, ym.month0), [ym]);

  const { byDay, undated } = useMemo(() => {
    const byDay = new Map<string, PageListItem[]>();
    const undated: PageListItem[] = [];
    if (!dateKey) return { byDay, undated };
    for (const p of rows) {
      const span = dateSpan(propsOf(p)[dateKey]);
      if (!span) {
        undated.push(p);
        continue;
      }
      // A range shows on every day it covers that's on this grid (a long
      // range is clipped to the grid, not to its first weeks).
      const first = grid[0].key;
      const last = grid[grid.length - 1].key;
      if (span.end < first || span.start > last) continue;
      const clipped = {
        start: span.start < first ? first : span.start,
        end: span.end > last ? last : span.end,
      };
      for (const k of daysOfSpan(clipped, 42)) {
        const list = byDay.get(k);
        if (list) list.push(p);
        else byDay.set(k, [p]);
      }
    }
    return { byDay, undated };
  }, [rows, dateKey, grid]);

  const open = (id: string) => {
    setOrigin(id);
    navigate({ to: "/p/$pageId", params: { pageId: id } });
  };

  if (!dateKey) {
    return (
      <div
        className="rounded-xl border border-line bg-surface text-meta text-muted"
        style={{ padding: "28px 24px", textAlign: "center" }}
      >
        A calendar places pages by a date. Add a date property to a page (for example Due), and this
        view will show them by day.
      </div>
    );
  }

  // `day` is the day this copy of the card sits on (a range has one per
  // day), so a drag moves the range by how far that copy travelled.
  const chip = (p: PageListItem, day?: string) => (
    <button
      key={p.id}
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/pageId", p.id);
        if (day) e.dataTransfer.setData("text/fromDay", day);
        e.dataTransfer.effectAllowed = "move";
        setDragId(p.id);
      }}
      onDragEnd={() => {
        setDragId(null);
        setOverDay(null);
      }}
      onClick={() => open(p.id)}
      title={
        (p.title || "Untitled") +
        (dateSpan(propsOf(p)[dateKey!])?.end !== dateSpan(propsOf(p)[dateKey!])?.start
          ? ` · ${formatDue(propsOf(p)[dateKey!])}`
          : "")
      }
      className="flex w-full min-w-0 items-center rounded-md border border-line bg-surface text-left shadow-card hover:shadow-cardHover"
      style={{
        gap: 5,
        padding: "2px 6px",
        fontSize: 12.5,
        lineHeight: "18px",
        opacity: dragId === p.id ? 0.45 : undefined,
        cursor: "pointer",
      }}
    >
      <Ico icon={p.icon ?? "📄"} size={13} />
      <span className="min-w-0 flex-1 truncate text-body">{p.title || "Untitled"}</span>
    </button>
  );

  const dropProps = (key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (overDay !== key) setOverDay(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        setOverDay((cur) => (cur === key ? null : cur));
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/pageId");
      setOverDay(null);
      setDragId(null);
      if (!id) return;
      const page = rows.find((r) => r.id === id);
      if (!page) return;
      // A range moves whole, by as many days as the card that was dragged;
      // dropping a card back on its own day does nothing.
      const value = propsOf(page)[dateKey];
      if (!key) return onMove(id, null);
      const from = e.dataTransfer.getData("text/fromDay");
      const span = dateSpan(value);
      if (span && from) {
        const delta = daysBetweenKeys(from, key);
        if (delta === 0) return;
        onMove(id, moveDateValue(value, addDaysKey(span.start, delta)));
        return;
      }
      if ((toDueString(value) ?? "") === key) return;
      onMove(id, moveDateValue(value, key));
    },
  });

  return (
    <div>
      <div className="mb-3 flex items-center" style={{ gap: 8 }}>
        <h2 className="font-display text-subhead text-noir" style={{ minWidth: 0 }}>
          {monthTitle(ym.year, ym.month0)}
        </h2>
        <span className="text-meta text-faint">by {dateLabel.toLowerCase()}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setYm({ year: now.getFullYear(), month0: now.getMonth() })}
          className="rounded-md border border-line bg-surface px-3 text-meta text-body hover:bg-rail"
          style={{ height: 28 }}
        >
          Today
        </button>
        <button
          type="button"
          aria-label="Previous month"
          title="Previous month"
          onClick={() => setYm((c) => shiftMonth(c.year, c.month0, -1))}
          className="grid place-items-center rounded-md text-muted hover:bg-sunken hover:text-strong"
          style={{ width: 28, height: 28 }}
        >
          <svg
            viewBox="0 0 24 24"
            width={15}
            height={15}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Next month"
          title="Next month"
          onClick={() => setYm((c) => shiftMonth(c.year, c.month0, 1))}
          className="grid place-items-center rounded-md text-muted hover:bg-sunken hover:text-strong"
          style={{ width: 28, height: 28 }}
        >
          <svg
            viewBox="0 0 24 24"
            width={15}
            height={15}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      <div
        role="region"
        aria-label={`${monthTitle(ym.year, ym.month0)}, pages by ${dateLabel.toLowerCase()}`}
        className="overflow-hidden rounded-xl border border-line bg-line"
        style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 1 }}
      >
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            aria-hidden
            className="bg-rail text-label uppercase text-faint"
            style={{ padding: "7px 8px" }}
          >
            {d}
          </div>
        ))}
        {grid.map((d) => {
          const pages = byDay.get(d.key) ?? [];
          const isOpen = expanded === d.key;
          const shown = isOpen ? pages : pages.slice(0, MAX_CHIPS);
          const more = pages.length - shown.length;
          const isToday = d.key === today;
          const isOver = overDay === d.key && dragId !== null;
          return (
            <div
              key={d.key}
              role="group"
              data-day={d.key}
              aria-label={`${dayName(d.key)}${pages.length ? `, ${pages.length} page${pages.length === 1 ? "" : "s"}` : ""}`}
              {...dropProps(d.key)}
              className={d.inMonth ? "bg-surface" : "bg-track"}
              style={{
                minHeight: 108,
                padding: 6,
                display: "flex",
                flexDirection: "column",
                gap: 3,
                boxShadow: isOver ? "inset 0 0 0 2px var(--color-accentRing)" : undefined,
                background: isOver ? "var(--color-accentTint)" : undefined,
                transition:
                  "box-shadow 150ms var(--ease-out), background-color 150ms var(--ease-out)",
              }}
            >
              <span
                className="tnum"
                style={{
                  alignSelf: "flex-start",
                  fontSize: 12.5,
                  lineHeight: "20px",
                  minWidth: 20,
                  padding: "0 5px",
                  borderRadius: 999,
                  textAlign: "center",
                  fontWeight: isToday ? 700 : 400,
                  color: isToday
                    ? "var(--color-btnFg)"
                    : d.inMonth
                      ? "var(--color-secondary)"
                      : "var(--color-whisper)",
                  background: isToday ? "var(--color-btn)" : undefined,
                }}
              >
                {d.day}
              </span>
              {shown.map((p) => chip(p, d.key))}
              {more > 0 || (isOpen && pages.length > MAX_CHIPS) ? (
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : d.key)}
                  className="self-start rounded-md px-1 text-caption text-muted hover:bg-sunken hover:text-strong"
                >
                  {isOpen ? "Show less" : `${more} more`}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {undated.length > 0 || dragId !== null ? (
        <div
          {...dropProps("")}
          className="mt-4 rounded-xl border border-line bg-rail"
          style={{
            padding: 10,
            boxShadow:
              overDay === "" && dragId !== null
                ? "inset 0 0 0 2px var(--color-accentRing)"
                : undefined,
          }}
        >
          <div className="mb-2 text-meta text-muted">
            {undated.length === 0
              ? `Drop a page here to clear its ${dateLabel.toLowerCase()}.`
              : `${undated.length === 1 ? "1 page has" : `${undated.length} pages have`} no ${dateLabel.toLowerCase()}. Drag one onto a day to give it one.`}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
              gap: 6,
            }}
          >
            {undated.map((p) => chip(p))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
