import { DEFAULT_INK, DEFAULT_TINT, PALETTE, TINT_LIT } from "./avatar";
import { monthGrid, shiftMonth, todayKey, WEEKDAYS } from "./calendar-grid";
import { daysOfSpan, formatDue } from "./due-date";
import { readFileList } from "./file-values";
import { defaultInlineView, readInlineView, type InlineView } from "./inline-view";
import { formatNumber, readNumberFormat } from "./number-format";
import { arrangeStrip, readPageLayout } from "./page-layout";
import { personIds } from "./person-value";
import { formulaText, type FormulaValue } from "./property-formula";
import {
  buildRelationIndex,
  readValueWith,
  relationConfig,
  rollupText,
  uniqueIdText,
  valueWords,
  type RelationIndex,
} from "./relations";
import {
  dayKey,
  groupRows,
  isEmptyValue,
  runView,
  spanOfValue,
  type PropInfo,
  type RunViewCtx,
} from "./run-view";
import type { PageListItem } from "./types";
import { calculate, CALC_SHORT, isCalcId } from "./view-calc";
import {
  labelOfProp,
  shownProps,
  tableGroupChoices,
  typeOfProp,
  widthOf,
  TITLE_KEY,
  type ConfigPropDef,
} from "./view-config";

/* Databases on public pages (Allan, 2026-11-05, the second step of public
 * links). What get_published_page returns for each database the page shows
 * is drawn here as plain HTML for the visitor's sandboxed document: the
 * view a page placed (table, board, list or calendar), a database page's
 * shared views as tabs, and a row's properties on its own page. Rows are
 * filtered and sorted by run-view, exactly as members see them; values
 * read as the app writes them. Pure: no React, no network.
 *
 * Visitors are nobody: a filter on "me" matches nothing. People show by
 * name only. Relations show the pages the visitor may see (others read
 * "Private page"), and rollups count only those. */

export type PublicDef = ConfigPropDef & {
  id?: string;
  label: string;
  options?: unknown;
  config?: unknown;
  description?: string | null;
  database_id?: string | null;
};

export type PublicRow = {
  id: string;
  title: string | null;
  icon: string | null;
  props: unknown;
  row_number?: number | null;
  position?: number | null;
  created_at?: string | null;
  created_by?: string | null;
  edited_at?: string | null;
  edited_by?: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
  parent_id?: string | null;
  database_id?: string | null;
  is_database?: boolean;
};

export type PublicDatabase = {
  id: string;
  title: string | null;
  icon: string | null;
  /** "here": this link shows it; "elsewhere": public through another
   *  link (a linked view); "related": a relation's public target. */
  mode: "here" | "elsewhere" | "related";
  /** Its rows open as pages from this link. */
  rows_open: boolean;
  page_layout: unknown;
  properties: PublicDef[];
  rows: PublicRow[];
  row_count: number;
  /** Shared views, for a database opened as a page. */
  views: Array<{
    id: string;
    name: string;
    icon?: string | null;
    layout: string;
    filter: unknown;
    sort: unknown;
    config: unknown;
    group_by: string | null;
  }>;
};

export type PublicPerson = {
  id: string;
  name: string | null;
  tint?: string | null;
  ink?: string | null;
};

/** Not a member id, so "me" filters match nothing. */
export const VISITOR = "visitor";

const NOT_PUBLIC = "This database isn’t public.";

export type PublicDbCtx = {
  token: string;
  root: string;
  /** The page being read, for its own links (tabs, months). */
  pageId: string;
  viewId: string | null;
  /** "YYYY-MM", or null for this month. */
  month: string | null;
  now: Date;
  dbs: ReadonlyMap<string, PublicDatabase>;
  idx: RelationIndex;
  run: RunViewCtx & {
    nameOf: (id: string) => string;
    titleOf: (id: string) => string;
    readValue: (page: PageListItem, key: string) => unknown;
  };
  words: (value: unknown, key: string) => string[];
  people: ReadonlyMap<string, PublicPerson>;
  /** Pages that open from this link: rows of databases it shows. */
  openable: ReadonlySet<string>;
  /** Signed links for files (storage path → URL). */
  fileUrl: (path: string) => string | undefined;
};

export function toListItem(r: PublicRow): PageListItem {
  return {
    id: r.id,
    title: r.title ?? "",
    icon: r.icon ?? "",
    props: (r.props ?? {}) as PageListItem["props"],
    verified_at: r.verified_at ?? "",
    verified_by: r.verified_by ?? null,
    edited_at: r.edited_at ?? "",
    edited_by: r.edited_by ?? null,
    access_type: "workspace",
    created_at: r.created_at ?? null,
    created_by: r.created_by ?? null,
    parent_id: r.parent_id ?? null,
    database_id: r.database_id ?? null,
    is_database: !!r.is_database,
    position: r.position ?? null,
    row_number: r.row_number ?? null,
  } as PageListItem;
}

/** Everything the views need, from what the link returned. `extra` is the
 *  page being read when it's a row (its own values). */
export function makePublicDbCtx(opts: {
  token: string;
  root: string;
  pageId: string;
  viewId?: string | null;
  month?: string | null;
  databases: readonly PublicDatabase[];
  people: readonly PublicPerson[];
  staleDays: number;
  extra?: PublicRow | null;
  fileUrls?: ReadonlyMap<string, string>;
  now?: Date;
}): PublicDbCtx {
  const dbs = new Map(opts.databases.map((d) => [d.id, d]));
  const byId = new Map<string, PageListItem>();
  for (const d of opts.databases) for (const r of d.rows) byId.set(r.id, toListItem(r));
  if (opts.extra && !byId.has(opts.extra.id)) byId.set(opts.extra.id, toListItem(opts.extra));
  const pages = [...byId.values()];
  const defs = opts.databases.flatMap((d) => d.properties);
  const idx = buildRelationIndex(pages, defs as never);
  const people = new Map(opts.people.map((p) => [p.id, p]));
  const nameOf = (id: string) => people.get(id)?.name || "Someone";
  const titleOf = (id: string) => {
    const p = idx.byId.get(id);
    return p ? p.title || "Untitled" : "Private page";
  };
  const words = valueWords({ defs: idx.defs, nameOf, titleOf });
  const props = new Map<string, PropInfo>(
    defs.map((d) => [
      d.key,
      {
        type: d.type,
        options: Array.isArray(d.options) ? (d.options as PropInfo["options"]) : [],
      },
    ]),
  );
  const openable = new Set<string>();
  for (const d of opts.databases)
    if (d.mode === "here" && d.rows_open) for (const r of d.rows) openable.add(r.id);
  return {
    token: opts.token,
    root: opts.root,
    pageId: opts.pageId,
    viewId: opts.viewId ?? null,
    month: opts.month ?? null,
    now: opts.now ?? new Date(),
    dbs,
    idx,
    run: {
      me: VISITOR,
      staleDays: opts.staleDays,
      props,
      nameOf,
      titleOf,
      readValue: readValueWith(idx, words),
    },
    words,
    people,
    openable,
    fileUrl: (p) => opts.fileUrls?.get(p),
  };
}

/* ─────────────────────────── Links ─────────────────────────── */

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The public address of a page this link shows, with its view and month. */
export function publicHref(
  token: string,
  pageId: string | null,
  root: string,
  extra: { v?: string | null; m?: string | null } = {},
): string {
  const q = new URLSearchParams();
  if (pageId && pageId !== root) q.set("p", pageId);
  if (extra.v) q.set("v", extra.v);
  if (extra.m) q.set("m", extra.m);
  const s = q.toString();
  return `/s/${token}${s ? `?${s}` : ""}`;
}

const here = (ctx: PublicDbCtx, extra: { v?: string | null; m?: string | null }) =>
  publicHref(ctx.token, ctx.pageId, ctx.root, { v: ctx.viewId, m: ctx.month, ...extra });

/* ─────────────────────────── Values ─────────────────────────── */

// Colour names come from the database (option_palette, profiles); only a
// plain token name or a hex reaches a style.
const TOKEN_NAME = /^[A-Za-z][A-Za-z0-9]{0,30}$/;
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const tokenVar = (name: unknown, fallback: string) =>
  typeof name === "string" && TOKEN_NAME.test(name)
    ? `var(--color-${name})`
    : `var(--color-${fallback})`;

type Opt = { value?: unknown; label?: unknown; tint?: unknown; ink?: unknown };
const optionsOf = (d: PublicDef | undefined): Opt[] =>
  Array.isArray(d?.options) ? (d!.options as Opt[]).filter((o) => o && typeof o === "object") : [];

function chip(label: string, o?: Opt): string {
  return `<span class="pub-chip" style="background:${tokenVar(o?.tint, "sunken")};color:${tokenVar(o?.ink, "secondary")}">${esc(label)}</span>`;
}

function optionChip(def: PublicDef | undefined, v: unknown): string {
  const o = optionsOf(def).find((x) => x.value === v);
  const label = typeof o?.label === "string" && o.label ? o.label : String(v);
  return chip(label, o);
}

function personChip(ctx: PublicDbCtx, id: string): string {
  const p = ctx.people.get(id);
  const name = p?.name || "Someone";
  const tintRaw = p?.tint ?? "";
  const tint = HEX.test(tintRaw) ? tintRaw : (TINT_LIT[tintRaw] ?? DEFAULT_TINT);
  const inkRaw = p?.ink ?? "";
  const ink = HEX.test(inkRaw)
    ? inkRaw
    : (PALETTE.find((x) => x.name === tintRaw || x.tint === tint)?.ink ?? DEFAULT_INK);
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  return `<span class="pub-person"><span class="pub-av" aria-hidden="true" style="background:${tint};color:${ink}">${esc(initial)}</span>${esc(name)}</span>`;
}

const SAFE_URL = /^(https?:|mailto:|tel:)/i;
function link(href: string, text: string): string {
  return SAFE_URL.test(href)
    ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`
    : esc(text);
}

function pageLink(ctx: PublicDbCtx, id: string, inner: string): string {
  return ctx.openable.has(id)
    ? `<a class="pub-page-link" target="_top" href="${esc(publicHref(ctx.token, id, ctx.root))}">${inner}</a>`
    : inner;
}

function titleHtml(ctx: PublicDbCtx, page: PageListItem): string {
  const icon = page.icon ? `<span class="pub-ico">${esc(page.icon)}</span>` : "";
  return pageLink(
    ctx,
    page.id,
    `${icon}<span class="pub-title-text">${esc(page.title || "Untitled")}</span>`,
  );
}

const localDay = (iso: unknown) => (typeof iso === "string" && iso ? dayKey(iso) : null);

function defOf(ctx: PublicDbCtx, key: string): PublicDef | undefined {
  return ctx.idx.defs.get(key) as PublicDef | undefined;
}

/** A value as its cell shows it, as HTML ("" when empty). */
export function valueHtml(ctx: PublicDbCtx, page: PageListItem, key: string): string {
  if (key === TITLE_KEY) return titleHtml(ctx, page);
  if (key === "@created" || key === "@edited" || key === "@verified") {
    const iso =
      key === "@created" ? page.created_at : key === "@edited" ? page.edited_at : page.verified_at;
    const d = localDay(iso);
    return d ? esc(formatDue(d, ctx.now)) : "";
  }
  if (key === "@created_by" || key === "@edited_by") {
    const id = key === "@created_by" ? page.created_by : page.edited_by;
    return id ? personChip(ctx, id) : "";
  }
  const def = defOf(ctx, key);
  const v = ctx.run.readValue(page, key);
  switch (def?.type) {
    case "select":
    case "status":
      return isEmptyValue(v) ? "" : optionChip(def, v);
    case "multi_select":
      return (Array.isArray(v) ? v : isEmptyValue(v) ? [] : [v])
        .map((x) => optionChip(def, x))
        .join(" ");
    case "person":
      return personIds(v)
        .map((id) => personChip(ctx, id))
        .join(" ");
    case "checkbox": {
      const on = v === true || v === "true";
      return `<span class="pub-check${on ? " on" : ""}" role="img" aria-label="${on ? "Checked" : "Not checked"}">${on ? "✓" : ""}</span>`;
    }
    case "date":
      return isEmptyValue(v) ? "" : esc(formatDue(v, ctx.now) || String(v));
    case "number":
      return typeof v === "number"
        ? esc(formatNumber(v, readNumberFormat(def.config)))
        : isEmptyValue(v)
          ? ""
          : esc(v);
    case "url":
      return typeof v === "string" && v ? link(/^[a-z]+:/i.test(v) ? v : `https://${v}`, v) : "";
    case "email":
      return typeof v === "string" && v ? link(`mailto:${v}`, v) : "";
    case "phone":
      return typeof v === "string" && v ? link(`tel:${v.replace(/[^\d+]/g, "")}`, v) : "";
    case "relation": {
      const shown = (Array.isArray(v) ? v : []).map(String);
      const parts = shown.map((id) => {
        const p = ctx.idx.byId.get(id);
        const icon = p?.icon ? `<span class="pub-ico">${esc(p.icon)}</span>` : "";
        return `<span class="pub-rel">${pageLink(ctx, id, `${icon}${esc(p?.title || "Untitled")}`)}</span>`;
      });
      // A link stored here to a page the visitor can't see reads "Private page".
      if (!relationConfig(def).of) {
        const stored =
          page.props && typeof page.props === "object"
            ? (page.props as Record<string, unknown>)[key]
            : null;
        const hidden = (Array.isArray(stored) ? stored : [])
          .map(String)
          .filter((id) => !shown.includes(id));
        for (let i = 0; i < new Set(hidden).size; i++)
          parts.push(`<span class="pub-rel pub-private">Private page</span>`);
      }
      return parts.join(" ");
    }
    case "rollup":
      return esc(rollupText(page, def as never, ctx.idx, ctx.words, ctx.now));
    case "formula":
      return isEmptyValue(v) ? "" : esc(formulaText(v as FormulaValue));
    case "unique_id":
      return esc(uniqueIdText(page, def as never));
    case "files":
      return readFileList(
        page.props && typeof page.props === "object"
          ? (page.props as Record<string, unknown>)[key]
          : null,
      )
        .map((f) => {
          const url = ctx.fileUrl(f.path);
          return url
            ? `<a class="pub-file" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a>`
            : `<span class="pub-file">${esc(f.name)}</span>`;
        })
        .join(" ");
    default:
      return isEmptyValue(v) ? "" : esc(ctx.words(v, key).join(", "));
  }
}

/* ─────────────────────────── Views ─────────────────────────── */

const note = (text: string) => `<div class="pub-db-note">${esc(text)}</div>`;

function headerHtml(db: PublicDatabase, name: string): string {
  const icon = db.icon ? `<span class="pub-ico">${esc(db.icon)}</span>` : "";
  const label = name || db.title || "Untitled";
  return `<div class="pub-db-head">${icon}<span>${esc(label)}</span></div>`;
}

function defsOf(db: PublicDatabase): PublicDef[] {
  return db.properties;
}

function tableHtml(
  ctx: PublicDbCtx,
  db: PublicDatabase,
  view: InlineView,
  rows: PageListItem[],
): string {
  const defs = defsOf(db);
  const used = new Set<string>();
  for (const r of db.rows)
    for (const [k, v] of Object.entries((r.props ?? {}) as Record<string, unknown>))
      if (!isEmptyValue(v)) used.add(k);
  const cols = [TITLE_KEY, ...shownProps(view.config, defs, used)];
  const widths = cols.map((k) =>
    widthOf(view.config, k, typeOfProp(k, defs) ?? (k === TITLE_KEY ? "text" : undefined)),
  );
  const freezeAt = view.config.freeze ? cols.indexOf(view.config.freeze) : -1;
  const lefts: number[] = [];
  widths.reduce((acc, w, i) => ((lefts[i] = acc), acc + w), 0);
  const wrap = new Set(view.config.wrap ?? []);
  const cell = (tag: "td" | "th", i: number, inner: string, cls = "") => {
    const frozen = i <= freezeAt;
    const classes = [cls, frozen ? "pub-frozen" : "", wrap.has(cols[i]) ? "pub-wrap" : ""]
      .filter(Boolean)
      .join(" ");
    return `<${tag}${classes ? ` class="${classes}"` : ""}${frozen ? ` style="left:${lefts[i]}px"` : ""}>${inner}</${tag}>`;
  };
  const head = `<tr>${cols.map((k, i) => cell("th", i, esc(labelOfProp(k, defs) || (k === TITLE_KEY ? "Name" : k)))).join("")}</tr>`;
  const rowHtml = (p: PageListItem) =>
    `<tr>${cols.map((k, i) => cell("td", i, valueHtml(ctx, p, k), k === TITLE_KEY ? "pub-title" : "")).join("")}</tr>`;

  const groupKey =
    view.config.group && tableGroupChoices(defs).some((c) => c.key === view.config.group)
      ? view.config.group
      : null;
  let body: string;
  if (groupKey) {
    const label = labelOfProp(groupKey, defs);
    body = groupRows(rows, groupKey, ctx.run)
      .map(
        (g) =>
          `<tr class="pub-group"><td colspan="${cols.length}">${g.value === null ? esc(`No ${label}`) : groupLabel(ctx, groupKey, g.value, g.label)} <span class="pub-count">${g.pages.length}</span></td></tr>${g.pages.map(rowHtml).join("")}`,
      )
      .join("");
  } else body = rows.map(rowHtml).join("");

  const calcs = view.config.calcs ?? {};
  const anyCalc = cols.some((k) => isCalcId(calcs[k]));
  const foot = anyCalc
    ? `<tfoot><tr>${cols
        .map((k, i) => {
          const c = calcs[k];
          if (!isCalcId(c)) return cell("td", i, "");
          const fmt =
            typeOfProp(k, defs) === "number" ? readNumberFormat(defOf(ctx, k)?.config) : undefined;
          const value = calculate(c, rows, k, ctx.now, ctx.run.readValue, fmt);
          return cell(
            "td",
            i,
            `<span class="pub-calc-label">${esc(CALC_SHORT[c])}</span> ${esc(value)}`,
            "pub-calc",
          );
        })
        .join("")}</tr></tfoot>`
    : "";
  const total = widths.reduce((a, b) => a + b, 0);
  return `<div class="pub-scroll"><table class="pub-table" style="width:${total}px"><colgroup>${widths
    .map((w) => `<col style="width:${w}px"/>`)
    .join("")}</colgroup><thead>${head}</thead><tbody>${body}</tbody>${foot}</table></div>`;
}

function groupLabel(ctx: PublicDbCtx, key: string, value: string, label: string): string {
  const def = defOf(ctx, key);
  if (def?.type === "select" || def?.type === "status") return optionChip(def, value);
  if (def?.type === "person" || key === "@created_by" || key === "@edited_by")
    return personChip(ctx, value);
  return esc(label);
}

/** Small values under a card or beside a list row: the view's shown
 *  properties that have a value. */
function propsLine(ctx: PublicDbCtx, view: InlineView, page: PageListItem): string {
  const parts = (view.config.props ?? [])
    .map((k) => valueHtml(ctx, page, k))
    .filter((h) => h !== "");
  return parts.length ? `<div class="pub-props-line">${parts.join(" ")}</div>` : "";
}

function boardHtml(
  ctx: PublicDbCtx,
  db: PublicDatabase,
  view: InlineView,
  rows: PageListItem[],
): string {
  const groupable = defsOf(db).filter((d) => d.type === "select" || d.type === "status");
  const def =
    groupable.find((d) => d.key === view.group_by) ??
    groupable.find((d) => d.key === "status") ??
    groupable[0];
  if (!def) return note("This board has no status or select property to group by.");
  const opts = optionsOf(def);
  const values = opts.map((o) => String(o.value));
  const cols: Array<{ label: string; head: string; pages: PageListItem[] }> = opts.map((o) => ({
    label: String(o.label ?? o.value),
    head: optionChip(def, o.value),
    pages: [],
  }));
  const none: PageListItem[] = [];
  for (const p of rows) {
    const v = ctx.run.readValue(p, def.key);
    const i = isEmptyValue(v) ? -1 : values.indexOf(String(v));
    if (i >= 0) cols[i].pages.push(p);
    else none.push(p);
  }
  if (none.length)
    cols.push({ label: `No ${def.label}`, head: esc(`No ${def.label}`), pages: none });
  return `<div class="pub-scroll"><div class="pub-board">${cols
    .map(
      (c) =>
        `<section class="pub-col" aria-label="${esc(c.label)}"><header>${c.head} <span class="pub-count">${c.pages.length}</span></header>${c.pages
          .map((p) => `<div class="pub-card">${titleHtml(ctx, p)}${propsLine(ctx, view, p)}</div>`)
          .join("")}</section>`,
    )
    .join("")}</div></div>`;
}

function listHtml(ctx: PublicDbCtx, view: InlineView, rows: PageListItem[]): string {
  return `<ul class="pub-list">${rows
    .map((p) => `<li>${titleHtml(ctx, p)}${propsLine(ctx, view, p)}</li>`)
    .join("")}</ul>`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function calendarHtml(
  ctx: PublicDbCtx,
  db: PublicDatabase,
  view: InlineView,
  rows: PageListItem[],
): string {
  const dates = defsOf(db).filter((d) => d.type === "date");
  const def = dates.find((d) => d.key === view.group_by) ?? dates[0];
  if (!def) return note("This calendar has no date property.");
  const m = /^(\d{4})-(\d{2})$/.exec(ctx.month ?? "");
  const year = m ? Number(m[1]) : ctx.now.getFullYear();
  const month0 = m ? Math.min(11, Math.max(0, Number(m[2]) - 1)) : ctx.now.getMonth();
  const byDay = new Map<string, PageListItem[]>();
  for (const p of rows) {
    const span = spanOfValue(ctx.run.readValue(p, def.key), def.key);
    if (!span) continue;
    for (const d of daysOfSpan(span)) {
      const list = byDay.get(d);
      if (list) list.push(p);
      else byDay.set(d, [p]);
    }
  }
  const key = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, "0")}`;
  const prev = shiftMonth(year, month0, -1);
  const next = shiftMonth(year, month0, 1);
  const today = todayKey(ctx.now);
  const grid = monthGrid(year, month0);
  const weeks: string[] = [];
  for (let w = 0; w < 6; w++) {
    weeks.push(
      `<tr>${grid
        .slice(w * 7, w * 7 + 7)
        .map(
          (d) =>
            `<td class="${[d.inMonth ? "" : "out", d.key === today ? "today" : ""].filter(Boolean).join(" ")}"><div class="pub-day">${d.day}</div>${(
              byDay.get(d.key) ?? []
            )
              .map((p) => `<div class="pub-event">${titleHtml(ctx, p)}</div>`)
              .join("")}</td>`,
        )
        .join("")}</tr>`,
    );
  }
  return `<div class="pub-cal-bar"><span class="pub-cal-month">${MONTH_NAMES[month0]} ${year}</span><span class="pub-cal-nav"><a target="_top" href="${esc(
    here(ctx, { m: key(prev.year, prev.month0) }),
  )}" aria-label="Previous month">‹</a><a target="_top" href="${esc(here(ctx, { m: null }))}">Today</a><a target="_top" href="${esc(
    here(ctx, { m: key(next.year, next.month0) }),
  )}" aria-label="Next month">›</a></span></div><div class="pub-scroll"><table class="pub-cal"><thead><tr>${WEEKDAYS.map(
    (d) => `<th>${d}</th>`,
  ).join("")}</tr></thead><tbody>${weeks.join("")}</tbody></table></div>`;
}

/** One view of a database, as its block or tab shows it. */
function viewBody(ctx: PublicDbCtx, db: PublicDatabase, view: InlineView): string {
  const pages = db.rows.map((r) => ctx.idx.byId.get(r.id) ?? toListItem(r));
  const rows = runView(pages, { filter: view.filter, sort: view.sort }, ctx.run);
  let body: string;
  if (view.layout === "calendar") body = calendarHtml(ctx, db, view, rows);
  else if (view.layout === "board")
    body =
      rows.length || !view.filter.length
        ? boardHtml(ctx, db, view, rows)
        : note("No rows match this view.");
  else if (rows.length === 0)
    body = note(db.rows.length ? "No rows match this view." : "No rows yet.");
  else if (view.layout === "list") body = listHtml(ctx, view, rows);
  else body = tableHtml(ctx, db, view, rows);
  const more =
    db.row_count > db.rows.length
      ? `<div class="pub-db-foot">Showing the first ${db.rows.length.toLocaleString("en-US")} of ${db.row_count.toLocaleString("en-US")} rows.</div>`
      : "";
  return body + more;
}

/** A view placed on a page (a "view" block's stored view). */
export function inlineDatabaseHtml(ctx: PublicDbCtx, raw: unknown): string {
  const view = readInlineView(raw);
  const db = view?.database_id ? ctx.dbs.get(view.database_id) : undefined;
  if (!view || !db || db.mode === "related") return `<div class="pub-db">${note(NOT_PUBLIC)}</div>`;
  return `<div class="pub-db">${headerHtml(db, view.name)}${viewBody(ctx, db, view)}</div>`;
}

/** A database opened as a page: its shared views as tabs. */
export function databasePageHtml(ctx: PublicDbCtx, dbId: string): string {
  const db = ctx.dbs.get(dbId);
  if (!db) return `<div class="pub-db">${note(NOT_PUBLIC)}</div>`;
  const views = db.views.length
    ? db.views.map((v) => ({
        id: v.id,
        icon: v.icon ?? "",
        view: readInlineView({ ...v, database_id: db.id })!,
      }))
    : [
        {
          id: "",
          icon: "",
          view: { ...defaultInlineView(db.id), name: "Table", sort: [] } as InlineView,
        },
      ];
  const current = views.find((v) => v.id === ctx.viewId) ?? views[0];
  const tabs =
    views.length > 1
      ? `<nav class="pub-tabs" aria-label="Views">${views
          .map(
            (v) =>
              `<a target="_top" href="${esc(here(ctx, { v: v.id === views[0].id ? null : v.id, m: null }))}"${v === current ? ' class="on" aria-current="page"' : ""}>${v.icon ? `<span class="pub-ico">${esc(v.icon)}</span>` : ""}${esc(v.view.name || "Untitled view")}</a>`,
          )
          .join("")}</nav>`
      : "";
  return `<div class="pub-db pub-db-page">${tabs}${viewBody(ctx, db, current.view)}</div>`;
}

/** A row's properties on its own page: the strip the database's row-page
 *  layout shows, then the rest folded ("N more properties"). Every
 *  property shows somewhere: hiding one in a view isn't a secret. */
export function rowPropertiesHtml(ctx: PublicDbCtx, page: PageListItem): string {
  const db = page.database_id ? ctx.dbs.get(page.database_id) : undefined;
  if (!db) return "";
  const defs = defsOf(db);
  const filled = new Set(
    defs
      .map((d) => d.key)
      .filter(
        (k) => !isEmptyValue(ctx.run.readValue(page, k)) || defOf(ctx, k)?.type === "unique_id",
      ),
  );
  const { shown, folded } = arrangeStrip(defs, readPageLayout(db.page_layout), filled);
  const item = (k: string) => {
    const v = valueHtml(ctx, page, k);
    return `<dt>${esc(labelOfProp(k, defs))}</dt><dd>${v || '<span class="pub-empty">Empty</span>'}</dd>`;
  };
  const strip = shown.length ? `<dl class="pub-props">${shown.map(item).join("")}</dl>` : "";
  const fold = folded.length
    ? `<details class="pub-fold"><summary>${folded.length === 1 ? "1 more property" : `${folded.length} more properties`}</summary><dl class="pub-props">${folded
        .map(item)
        .join("")}</dl></details>`
    : "";
  return strip || fold ? `<section class="pub-row-props">${strip}${fold}</section>` : "";
}

/** The files a visitor's views show (storage paths), to sign before drawing. */
export function publicFilePaths(
  databases: readonly PublicDatabase[],
  extra?: PublicRow | null,
): string[] {
  const out = new Set<string>();
  const add = (props: unknown, defs: PublicDef[]) => {
    if (!props || typeof props !== "object") return;
    for (const d of defs)
      if (d.type === "files")
        for (const f of readFileList((props as Record<string, unknown>)[d.key])) out.add(f.path);
  };
  for (const db of databases) {
    if (db.mode === "related") continue;
    for (const r of db.rows) add(r.props, db.properties);
  }
  if (extra?.database_id) {
    const db = databases.find((d) => d.id === extra.database_id);
    if (db) add(extra.props, db.properties);
  }
  return [...out];
}
