/**
 * The ONE builder for the page ⋯ menu. Used from:
 *   - the sidebar page row (app-shell.tsx)
 *   - the three view layouts: table / board / list (main-view.tsx)
 *
 * Kept UI-free (returns a `MenuSpec` for `SpecMenuTrigger`) so both surfaces
 * render exactly the same items, submenus and footer. Do NOT branch this
 * into per-surface variants.
 */
import type { MenuSpec } from "@/components/row-menu";
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

  const listSpec: MenuSpec = {
    title,
    footer: footer || undefined,
    rows: [
      {
        kind: "row",
        label: "Open page",
        icon: "open",
        hint: { text: "↵", mono: true },
        onPick: () => {
          onOpen();
          mctx.close();
        },
      },
      { kind: "sep" },
      {
        kind: "row",
        label: isStale ? "Mark verified now" : "Re-verify",
        icon: "shield",
        hint: { text: p.verified_at ? relTime(p.verified_at) : "never" },
        onPick: () => {
          onVerify();
          mctx.close();
        },
      },
      ...actionableDefs(propDefs).map((def) => ({
        kind: "row" as const,
        label: actionLabel(def),
        icon: actionIcon(def),
        hint: { text: def.type === "multi_select" ? "›" : valueLabel(def, props[def.key], members) },
        onPick: () =>
          mctx.setSpec({
            title: actionLabel(def),
            onBack: () => mctx.setSpec(listSpec),
            rows: valueRows(def, props[def.key], members, (value) => {
              onSetValue(def.key, nextValue(def, props[def.key], value));
              mctx.close();
            }),
          }),
      })),
      { kind: "sep" },
      {
        kind: "row",
        label: "Delete page",
        icon: "trash",
        danger: true,
        onPick: () =>
          mctx.setSpec({
            title,
            rows: [],
            confirm: {
              title: `Delete "${title}"?`,
              body: "It disappears from every view at once — there is no folder it stays in.",
              cta: "Delete page",
              danger: true,
              onConfirm: onDelete,
            },
          }),
      },
    ],
  };
  return listSpec;
}
