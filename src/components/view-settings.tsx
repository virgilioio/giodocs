import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useSetPageLayout } from "@/hooks/use-page-layout";
import { IC } from "@/lib/menu-icons";
import { PROPERTY_KINDS } from "@/lib/property-kinds";
import { readPageLayout, ruleOf, withRule, SHOW_LABELS, type ShowRule } from "@/lib/page-layout";
import { usePropertyEditing } from "./property-menu";
import { TaskDatabaseDialog } from "./task-database-dialog";
import type { MenuBuildCtx, MenuRow, MenuSpec } from "./row-menu";
import type { PageListItem } from "@/lib/types";

/* View settings (2026-10-11, Notion's): one panel for a database page and
 * for a database inside a page. The view's part first — its name, Layout,
 * Property visibility, Filter, Sort, Group, Copy link — then the
 * database's — Edit properties, Row page layout, Task database. Each item
 * opens in place, with Back. */

export type ViewLayoutName = "table" | "board" | "list" | "calendar";

const LAYOUTS: Array<{ layout: ViewLayoutName; label: string; icon: string }> = [
  { layout: "table", label: "Table", icon: IC.bTable },
  { layout: "board", label: "Board", icon: IC.board },
  { layout: "list", label: "List", icon: IC.list },
  { layout: "calendar", label: "Calendar", icon: IC.calendar },
];

type Def = { key: string; label: string; type: string; database_id?: string | null; archived_at?: string | null; position?: number | null; is_system?: boolean | null };

export type ViewSettingsArgs = {
  databaseId: string | null;
  /** The view's own name, and how to change it (none: it can't be). */
  name: string;
  onRename?: (name: string) => void;
  layout: ViewLayoutName;
  onLayout?: (l: ViewLayoutName) => void;
  /** Property visibility (a table's shown properties). */
  visibility?: {
    shown: string[];
    allKeys: string[];
    labelOf: (k: string) => string;
    onChange: (next: string[]) => void;
  };
  onFilter?: () => void;
  onSort?: () => void;
  /** Group (a table's grouping, a board's columns or a calendar's dates). */
  group?: {
    title: string;
    value: string | null;
    choices: Array<{ key: string; label: string }>;
    onChange: (key: string | null) => void;
    /** A table can be ungrouped; a board and a calendar can't. */
    allowNone: boolean;
  };
  onCopyLink?: () => void;
  /** People who can change the database itself (properties, row pages). */
  canEditDatabase: boolean;
  /** Further view actions (a database page's saved-view actions). */
  more?: (mctx: MenuBuildCtx) => MenuSpec;
};

export function useViewSettings(args: ViewSettingsArgs) {
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const shell = useWorkspaceShell(ws);
  const members = (shell.members.data ?? []) as Array<{ user_id: string; role?: string }>;
  const isOwner = members.some((m) => m.user_id === user?.id && m.role === "owner");
  const editing = usePropertyEditing({ databaseId: args.databaseId ?? "", isOwner });
  const setLayout = useSetPageLayout();
  const [taskDialog, setTaskDialog] = useState(false);
  const pages = (shell.pages.data ?? []) as PageListItem[];
  const database = pages.find((p) => p.id === args.databaseId);
  const defs = ((shell.propDefs.data ?? []) as Def[])
    .filter((d) => d.database_id === args.databaseId && !d.archived_at)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const iconOf = (type: string) => PROPERTY_KINDS.find((k) => k.type === type)?.icon;

  const build = (mctx: MenuBuildCtx): MenuSpec => {
    const root = () => build(mctx);
    const back = () => mctx.setSpec(root());
    const rows: MenuRow[] = [];
    const layoutLabel = LAYOUTS.find((l) => l.layout === args.layout)?.label ?? "Table";
    if (args.onLayout)
      rows.push({
        kind: "row",
        label: "Layout",
        icon: LAYOUTS.find((l) => l.layout === args.layout)?.icon ?? IC.bTable,
        hint: { text: `${layoutLabel} ›` },
        onPick: () =>
          mctx.setSpec({
            title: "Layout",
            onBack: back,
            rows: LAYOUTS.map((l) => ({
              kind: "row" as const,
              label: l.label,
              icon: l.icon,
              checked: l.layout === args.layout,
              onPick: () => {
                args.onLayout!(l.layout);
                mctx.close();
              },
            })),
          }),
      });
    const vis = args.visibility;
    if (vis)
      rows.push({
        kind: "row",
        label: "Property visibility",
        icon: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z",
        hint: { text: `${vis.shown.length} ›` },
        onPick: () => {
          const visSpec = (shown: string[]): MenuSpec => ({
            title: "Property visibility",
            onBack: back,
            rows: vis.allKeys.map((k) => ({
              kind: "row" as const,
              label: vis.labelOf(k),
              checked: shown.includes(k),
              onPick: () => {
                const next = shown.includes(k) ? shown.filter((x) => x !== k) : [...shown, k];
                vis.onChange(next);
                mctx.setSpec(visSpec(next));
              },
            })),
            footer: "Ticked properties show in this view.",
          });
          mctx.setSpec(visSpec(vis.shown));
        },
      });
    if (args.onFilter)
      rows.push({
        kind: "row",
        label: "Filter",
        icon: "M4 6h16M7 12h10M10 18h4",
        onPick: () => {
          mctx.close();
          args.onFilter!();
        },
      });
    if (args.onSort)
      rows.push({
        kind: "row",
        label: "Sort",
        icon: "M7 4v12m0 0-3-3m3 3 3-3M17 20V8m0 0-3 3m3-3 3 3",
        onPick: () => {
          mctx.close();
          args.onSort!();
        },
      });
    const g = args.group;
    if (g)
      rows.push({
        kind: "row",
        label: g.title,
        icon: "M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z",
        hint: { text: `${g.choices.find((c) => c.key === g.value)?.label ?? "None"} ›` },
        onPick: () =>
          mctx.setSpec({
            title: g.title,
            onBack: back,
            rows: [
              ...(g.allowNone
                ? [{ kind: "row" as const, label: "None", checked: !g.value, onPick: () => { g.onChange(null); mctx.close(); } }]
                : []),
              ...g.choices.map((c) => ({
                kind: "row" as const,
                label: c.label,
                checked: c.key === g.value,
                onPick: () => {
                  g.onChange(c.key);
                  mctx.close();
                },
              })),
            ],
            footer: g.choices.length ? undefined : "No property here can group this layout yet.",
          }),
      });
    if (args.onCopyLink)
      rows.push({
        kind: "row",
        label: "Copy link to view",
        icon: IC.link,
        onPick: () => {
          args.onCopyLink!();
          mctx.close();
        },
      });

    if (args.databaseId && args.canEditDatabase) {
      rows.push({ kind: "sep" });
      rows.push({
        kind: "row",
        label: "Edit properties",
        icon: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
        hint: { text: `${defs.length} ›` },
        onPick: () => {
          const list = (): MenuSpec => ({
            title: "Edit properties",
            onBack: back,
            rows: defs.map((d) => ({
              kind: "row" as const,
              label: d.label,
              icon: iconOf(d.type),
              hint: { text: "›" },
              onPick: () => {
                const one = (): MenuSpec => ({
                  title: d.label,
                  onBack: () => mctx.setSpec(list()),
                  input: editing.renameInput(d.key, mctx, one),
                  inputFirst: true,
                  maxHeight: 420,
                  rows: [
                    ...editing.editRows(d.key, mctx, one),
                    ...(editing.tailRows(d.key, mctx, one).length ? [{ kind: "sep" as const }] : []),
                    ...editing.tailRows(d.key, mctx, one),
                  ],
                  footer: editing.ownerNote(d.key),
                });
                mctx.setSpec(one());
              },
            })),
            footer: defs.length ? undefined : "No properties yet. Add one from the table's Add property.",
          });
          mctx.setSpec(list());
        },
      });
      if (database) {
        const pl = readPageLayout(database.page_layout);
        rows.push({
          kind: "row",
          label: "Row page layout",
          icon: "M5 4h14v16H5zM8 8h8M8 12h5M8 16h6",
          hint: { text: "›" },
          onPick: () => {
            const list = (layout = pl): MenuSpec => ({
              title: "Row page layout",
              onBack: back,
              rows: defs.map((d) => {
                const rule = ruleOf(d.key, defs, layout);
                return {
                  kind: "row" as const,
                  label: d.label,
                  icon: iconOf(d.type),
                  hint: { text: SHOW_LABELS[rule] },
                  onPick: () =>
                    mctx.setSpec({
                      title: d.label,
                      onBack: () => mctx.setSpec(list(layout)),
                      rows: (Object.keys(SHOW_LABELS) as ShowRule[]).map((r) => ({
                        kind: "row" as const,
                        label: SHOW_LABELS[r],
                        checked: r === rule,
                        onPick: () => {
                          const next = withRule(layout, d.key, r);
                          setLayout.mutate({ databaseId: database.id, layout: next });
                          mctx.setSpec(list(next));
                        },
                      })),
                    }),
                };
              }),
              footer: "How each property shows when a row is opened as a page.",
            });
            mctx.setSpec(list());
          },
        });
        rows.push({
          kind: "row",
          label: database.task_config ? "Task database settings" : "Turn into task database",
          icon: IC.bTodo,
          onPick: () => {
            mctx.close();
            setTaskDialog(true);
          },
        });
      }
    }
    if (args.more) {
      rows.push({ kind: "sep" });
      rows.push({
        kind: "row",
        label: "More view actions",
        icon: "M5 12h.01M12 12h.01M19 12h.01",
        hint: { text: "›" },
        onPick: () => {
          const m = args.more!(mctx);
          mctx.setSpec({ ...m, onBack: m.onBack ?? back });
        },
      });
    }
    return {
      title: "View settings",
      width: 300,
      maxHeight: 460,
      rows,
      ...(args.onRename
        ? {
            inputFirst: true,
            input: {
              placeholder: "View name",
              initial: args.name,
              onCommit: (v: string) => args.onRename!(v),
            },
          }
        : {}),
    };
  };

  const dialog =
    taskDialog && database ? (
      <TaskDatabaseDialog databaseId={database.id} title={database.title || "Untitled"} onClose={() => setTaskDialog(false)} />
    ) : null;

  return { build, dialog };
}
