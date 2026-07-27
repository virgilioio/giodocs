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
  propDefs: Array<{ key: string; label: string; options: unknown }>;
  members: MemberLite[];
  editedByFirstName: string;
  onOpen: () => void;
  onVerify: () => void;
  onSetStatus: (v: string) => void;
  onSetOwner: (uid: string) => void;
  onMoveArea: (area: string | null) => void;
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
    onSetStatus,
    onSetOwner,
    onMoveArea,
    onDelete,
  } = args;

  const props =
    p.props && typeof p.props === "object" && !Array.isArray(p.props)
      ? (p.props as Record<string, unknown>)
      : {};
  const currentStatus = typeof props.status === "string" ? props.status : "";
  const currentOwner = typeof props.owner === "string" ? props.owner : "";
  const currentArea = typeof props.area === "string" ? props.area : "";

  const statusDef = propDefs.find((d) => d.key === "status");
  const statusOptions = (
    (statusDef?.options as Array<{ value: string; color?: string }>) ?? []
  ).filter(Boolean);
  const areaDef = propDefs.find((d) => d.key === "area");
  const areaOptions = ((areaDef?.options as Array<{ value: string }>) ?? [])
    .map((o) => o.value)
    .filter(Boolean);

  const ownerMember = members.find((m) => m.user_id === currentOwner);
  const ownerFirst = firstNameOf(ownerMember);
  const currentStatusColor =
    statusOptions.find((o) => o.value === currentStatus)?.color ??
    "var(--color-muted)";
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
      {
        kind: "row",
        label: "Set status",
        dot: currentStatusColor,
        hint: { text: currentStatus || "empty" },
        onPick: () =>
          mctx.setSpec({
            title: "Set status",
            rows: statusOptions.map((o) => ({
              kind: "row" as const,
              label: o.value,
              dot: o.color || "var(--color-muted)",
              checked: o.value === currentStatus,
              onPick: () => {
                onSetStatus(o.value);
                mctx.close();
              },
            })),
          }),
      },
      {
        kind: "row",
        label: "Set owner",
        icon: "person",
        hint: { text: ownerFirst || "none" },
        onPick: () =>
          mctx.setSpec({
            title: "Set owner",
            rows: members.map((m) => ({
              kind: "row" as const,
              label:
                m.profiles?.full_name || m.profiles?.email || "Unknown",
              person: {
                tint: m.profiles?.avatar_tint || "var(--color-sunken)",
                ink: m.profiles?.avatar_ink || "var(--color-noir)",
                initials: initialsOf(m),
              },
              checked: m.user_id === currentOwner,
              onPick: () => {
                onSetOwner(m.user_id);
                mctx.close();
              },
            })),
          }),
      },
      {
        kind: "row",
        label: "Move to area",
        icon: "arrow",
        hint: { text: currentArea || "none" },
        onPick: () =>
          mctx.setSpec({
            title: "Move to area",
            rows: [
              {
                kind: "row" as const,
                label: "No area",
                checked: !currentArea,
                onPick: () => {
                  onMoveArea(null);
                  mctx.close();
                },
              },
              { kind: "sep" as const },
              ...areaOptions.map((a) => ({
                kind: "row" as const,
                label: a,
                checked: a === currentArea,
                onPick: () => {
                  onMoveArea(a);
                  mctx.close();
                },
              })),
            ],
          }),
      },
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
