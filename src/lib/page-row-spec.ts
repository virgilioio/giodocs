/**
 * The ONE builder for the page ⋯ menu. Used from:
 *   - the sidebar page row (app-shell.tsx)
 *   - the three view layouts: table / board / list (main-view.tsx)
 *
 * Kept UI-free (returns a `MenuSpec` for `SpecMenuTrigger`) so both surfaces
 * render exactly the same items, submenus and footer. Do NOT branch this
 * into per-surface variants.
 */
import type { ReactNode } from "react";
import type { MenuRow, MenuSpec } from "@/components/row-menu";
import { formatTimestamp } from "@/lib/format";
import { pageRowFooter } from "@/lib/page-row-footer";
import type { PageListItem } from "@/lib/types";
import {
  actionIcon,
  actionLabel,
  actionableDefs,
  nextValue,
  valueLabel,
  valueRows,
  type ActionDef,
} from "@/lib/prop-actions";

export type MemberLite = {
  user_id: string;
  role: string;
  profiles: {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_tint: string | null;
    avatar_ink: string | null;
  } | null;
};

export function initialsOf(m: MemberLite | undefined) {
  const name = m?.profiles?.full_name || m?.profiles?.email || "?";
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function firstNameOf(m: MemberLite | undefined) {
  const name = m?.profiles?.full_name || m?.profiles?.email || "";
  return name.split(/\s+/)[0] ?? "";
}

function relTime(iso: string) {
  return formatTimestamp(iso, "relative");
}

export type BuildPageRowSpecArgs = {
  p: PageListItem;
  isStale: boolean;
  /** The database's own properties (any database: never looked up by name). */
  propDefs: ActionDef[];
  members: MemberLite[];
  editedByFirstName: string;
  onOpen: () => void;
  onVerify: () => void;
  /** Write a property's new value (a multi-select arrives already merged). */
  onSetValue: (key: string, value: unknown) => void;
  onDelete: () => void;
  /** The rest of Notion's row menu (2026-10-30); each shows when given. */
  onOpenFull?: () => void;
  onOpenNewTab?: () => void;
  onCopyLink?: () => void;
  onDuplicate?: () => void;
  /** Move to…: a page picker shown in the menu. */
  renderMoveTo?: (close: () => void) => ReactNode;
};

export function buildPageRowSpec(
  args: BuildPageRowSpecArgs,
  mctx: { setSpec: (s: MenuSpec) => void; close: () => void },
): MenuSpec {
  const {
    p,
    isStale,
    propDefs,
    members,
    editedByFirstName,
    onOpen,
    onVerify,
    onSetValue,
    onDelete,
    onOpenFull,
    onOpenNewTab,
    onCopyLink,
    onDuplicate,
    renderMoveTo,
  } = args;

  const props =
    p.props && typeof p.props === "object" && !Array.isArray(p.props)
      ? (p.props as Record<string, unknown>)
      : {};
  const title = p.title || "Untitled";

  const footer = pageRowFooter({
    editedRel: p.edited_at ? relTime(p.edited_at) : null,
    firstName: editedByFirstName || null,
    verifiedRel: p.verified_at ? relTime(p.verified_at) : null,
  });

  const pick = (fn: () => void) => () => {
    fn();
    mctx.close();
  };
  const defs = actionableDefs(propDefs);

  // Edit property ›: each settable property, then its values (Notion's row
  // menu keeps them one level down; they were top-level until 2026-10-30).
  const editSpec = (): MenuSpec => ({
    title: "Edit property",
    onBack: () => mctx.setSpec(listSpec),
    rows: defs.map((def) => ({
      kind: "row" as const,
      label: actionLabel(def),
      icon: actionIcon(def),
      hint: { text: def.type === "multi_select" ? "›" : valueLabel(def, props[def.key], members) },
      onPick: () =>
        mctx.setSpec({
          title: actionLabel(def),
          onBack: () => mctx.setSpec(editSpec()),
          rows: valueRows(def, props[def.key], members, (value) => {
            onSetValue(def.key, nextValue(def, props[def.key], value));
            mctx.close();
          }),
        }),
    })),
  });

  const rows: MenuRow[] = [{ kind: "row", label: "Open", icon: "open", onPick: pick(onOpen) }];
  if (onOpenFull)
    rows.push({
      kind: "row",
      label: "Open as full page",
      icon: "layout",
      onPick: pick(onOpenFull),
    });
  if (onOpenNewTab)
    rows.push({
      kind: "row",
      label: "Open in new tab",
      icon: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
      onPick: pick(onOpenNewTab),
    });
  rows.push({ kind: "sep" });
  if (defs.length)
    rows.push({
      kind: "row",
      label: "Edit property",
      icon: "pencil",
      hint: { text: "›" },
      onPick: () => mctx.setSpec(editSpec()),
    });
  rows.push({
    kind: "row",
    label: isStale ? "Mark verified now" : "Re-verify",
    icon: "shield",
    hint: { text: p.verified_at ? relTime(p.verified_at) : "never" },
    onPick: pick(onVerify),
  });
  if (onCopyLink || onDuplicate || renderMoveTo) rows.push({ kind: "sep" });
  if (onCopyLink)
    rows.push({ kind: "row", label: "Copy link", icon: "link", onPick: pick(onCopyLink) });
  if (onDuplicate)
    rows.push({ kind: "row", label: "Duplicate", icon: "dup", onPick: pick(onDuplicate) });
  if (renderMoveTo)
    rows.push({
      kind: "row",
      label: "Move to",
      icon: "M5 12h14M13 6l6 6-6 6",
      hint: { text: "›" },
      onPick: () =>
        mctx.setSpec({
          title: "Move to",
          onBack: () => mctx.setSpec(listSpec),
          rows: [],
          width: 300,
          content: (close) => renderMoveTo(close),
        }),
    });
  rows.push({ kind: "sep" });
  rows.push({
    kind: "row",
    label: "Delete",
    icon: "trash",
    danger: true,
    onPick: () =>
      mctx.setSpec({
        title,
        rows: [],
        confirm: {
          title: `Delete "${title}"?`,
          body: "It leaves every view at once. You can undo for a moment afterwards.",
          cta: "Delete",
          danger: true,
          onConfirm: onDelete,
        },
      }),
  });

  // Tall enough for every item without scrolling (Delete sat below the fold).
  const listSpec: MenuSpec = { title, footer: footer || undefined, rows, maxHeight: 520 };
  return listSpec;
}
