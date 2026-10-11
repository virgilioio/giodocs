/* A property's column menu (Notion's, 2026-10-11): the name field with the
 * type's icon (Change type) and ⓘ (Description) beside it; Edit property
 * (what the type has to set: options, number format, ID prefix, formula, a
 * person's limit, default and notifications); Property access; Change type
 * (values convert, with Undo); Insert left / right; Duplicate; Delete. The
 * database decides who may do each (guard_property_def,
 * guard_property_config, guard_property_access, change_property_type);
 * this only offers what the person can do and explains what they can't. */

import { useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import {
  OPTION_COLORS,
  OPTION_PALETTE,
  colorOfOption,
  useAddPropertyOption,
  useDuplicateProperty,
  useMoveOption,
  useRemoveOption,
  useRenamePropertyOption,
  useSetOptionColor,
  useSetOptionGroup,
  useSetPropertyArchived,
  useChangePropertyType,
  useSetPropertyConfig,
  useUndoPropertyTypeChange,
  useUpdateProperty,
  type OptionColor,
} from "@/hooks/use-property-mutations";
import { useToast } from "@/lib/toast";
import { onePersonOnly } from "@/lib/person-value";
import { PROPERTY_KINDS, kindLabel, type PropertyType } from "@/lib/property-kinds";
import { GROUP_LABELS, groupOf, type StatusGroup } from "@/lib/status-groups";
import {
  CURRENCIES,
  CURRENCY_LABELS,
  FORMAT_LABELS,
  formatNumber,
  readNumberFormat,
  type NumberFormat,
  type NumberFormatKind,
} from "@/lib/number-format";
import { IC } from "@/lib/menu-icons";
import type { PageListItem } from "@/lib/types";
import type { Database } from "@/integrations/supabase/types";
import type { MenuBuildCtx, MenuRow, MenuSpec } from "./row-menu";
import { useNewPropertyFlow } from "./new-property-flow";

type PropDef = Database["public"]["Tables"]["property_defs"]["Row"];
type Opt = { value: string; label: string; tint?: string; ink?: string; dot?: string };

const COLOR_NAMES: Record<OptionColor, string> = {
  gray: "Gray",
  green: "Green",
  amber: "Orange",
  yellow: "Yellow",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  red: "Red",
};

/** Types a property can be changed to from its menu, values and all
 *  (change_property_type). Relations, rollups, formulas and IDs need
 *  settings or numbering: make those as new properties. */
const RETYPE_TO = PROPERTY_KINDS.filter((k) =>
  ["text", "number", "select", "multi_select", "status", "date", "person", "files", "checkbox", "url", "email", "phone"].includes(k.type),
);
/** Types whose values only they can hold: they keep their type. */
const FIXED_TYPES = new Set(["relation", "rollup", "formula", "unique_id", "links"]);

const ICON_INFO = "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 11v5M12 7.6v.4";
const ICON_LOCK = "M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9h-13z";
const ICON_SETTINGS = "M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5";
const ICON_RETYPE = "M4 8h13l-3-3M20 16H7l3 3";

function optionsOf(d: PropDef | undefined): Opt[] {
  return Array.isArray(d?.options) ? (d!.options as unknown as Opt[]).filter((o) => o && o.value) : [];
}

export function usePropertyEditing({
  databaseId,
  isOwner,
}: {
  /** Set only when the person can edit the database's properties. */
  databaseId?: string;
  isOwner: boolean;
}) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const shell = useWorkspaceShell(ws);
  const update = useUpdateProperty();
  const archive = useSetPropertyArchived();
  const duplicate = useDuplicateProperty();
  const addOption = useAddPropertyOption();
  const renameOption = useRenamePropertyOption();
  const setColor = useSetOptionColor();
  const moveOption = useMoveOption();
  const removeOption = useRemoveOption();
  const setGroup = useSetOptionGroup();
  const setConfig = useSetPropertyConfig();
  const changeType = useChangePropertyType();
  const undoType = useUndoPropertyTypeChange();
  const toast = useToast();
  const shellDefs = () => (qc.getQueryData<PropDef[]>(qk.propDefs(ws)) ?? allPropDefs) as PropDef[];

  const pages = useMemo(() => (shell.pages.data ?? []) as PageListItem[], [shell.pages.data]);
  const allPropDefs = useMemo(() => (shell.propDefs.data ?? []) as PropDef[], [shell.propDefs.data]);
  const databases = useMemo(
    () =>
      pages
        .filter((p) => p.is_database && !p.archived_at)
        .map((p) => ({ id: p.id, title: p.title, icon: p.icon }))
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "")),
    [pages],
  );

  // Always the freshest property (the cache is patched before a re-render).
  const defOf = useCallback(
    (key: string) =>
      ((qc.getQueryData<PropDef[]>(qk.propDefs(ws)) ?? allPropDefs) as PropDef[]).find(
        (d) => d.key === key && d.database_id === databaseId,
      ),
    [qc, ws, allPropDefs, databaseId],
  );
  const rowsUsing = useCallback(
    (key: string, value?: string) =>
      pages.filter((p) => {
        if (p.database_id !== databaseId) return false;
        const v = (p.props as Record<string, unknown> | null)?.[key];
        if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return false;
        return value === undefined ? true : v === value || (Array.isArray(v) && v.includes(value));
      }).length,
    [pages, databaseId],
  );

  const editable = !!databaseId;

  /** Settings kept through a config change: who may change the values. */
  const withAccess = (d: PropDef, cfg: Record<string, unknown>): Record<string, unknown> => {
    const access = (d.config as { access?: unknown } | null)?.access;
    return access ? { ...cfg, access } : cfg;
  };

  /** The rename field for the top of the menu, or undefined. With `back`,
   *  the type's icon (Change type) and ⓘ (Description) sit beside it. */
  const renameInput = (key: string, mctx: MenuBuildCtx, back?: () => MenuSpec): MenuSpec["input"] => {
    const d = defOf(key);
    if (!editable || !d || d.is_system) return undefined;
    const icon = PROPERTY_KINDS.find((k) => k.type === d.type)?.icon ?? IC.dot;
    const described = !!(d as { description?: string }).description;
    return {
      placeholder: "Property name",
      initial: d.label,
      selectOnFocus: true,
      onCommit: (v) => {
        const label = v.trim();
        if (label && label !== d.label) update.mutate({ id: d.id, patch: { label } });
        mctx.close();
      },
      ...(back
        ? {
            lead: {
              icon,
              label: `${kindLabel(d.type)}: change type`,
              onClick: () => mctx.setSpec(typeSpec(key, mctx, back)),
            },
            trail: {
              icon: ICON_INFO,
              label: described ? "Edit description" : "Add a description",
              active: described,
              onClick: () => mctx.setSpec(describeSpec(key, mctx, back)),
            },
          }
        : null),
    };
  };

  const describeSpec = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuSpec => {
    const d = defOf(key)!;
    const current = String((d as { description?: string }).description ?? "");
    return {
      title: "Description",
      onBack: () => mctx.setSpec(back()),
      inputFirst: true,
      width: 300,
      rows: current
        ? [
            {
              kind: "row",
              label: "Remove the description",
              icon: IC.trash,
              onPick: () => {
                update.mutate({ id: d.id, patch: { description: "" } });
                mctx.setSpec(back());
              },
            },
          ]
        : [],
      input: {
        placeholder: "What this property is for",
        initial: current,
        selectOnFocus: true,
        keepOpen: true,
        onCommit: (v) => {
          update.mutate({ id: d.id, patch: { description: v } });
          mctx.setSpec(back());
        },
      },
      footer: "Shown when someone points at the property's heading. Up to 280 characters; Enter saves.",
    };
  };

  const retype = (d: PropDef, type: PropertyType) => {
    const from = kindLabel(d.type);
    const to = kindLabel(type);
    changeType.mutate(
      { id: d.id, type },
      {
        onSuccess: (r) => {
          const kept = r.converted ?? 0;
          const cleared = r.cleared ?? 0;
          const words =
            kept + cleared === 0
              ? `"${d.label}" is ${to} now.`
              : `"${d.label}" is ${to} now: ${kept} ${kept === 1 ? "value" : "values"} kept` +
                (cleared ? `, ${cleared} cleared (they didn't read as ${to.toLowerCase()}).` : ".");
          toast.push({
            message: words,
            action: r.change_id
              ? {
                  label: "Undo",
                  onClick: () =>
                    undoType.mutate(r.change_id!, {
                      onSuccess: () => toast.push(`"${d.label}" is ${from} again, with its values.`),
                    }),
                }
              : undefined,
            durationMs: 10000,
          });
        },
        onError: (e) => toast.push(`Couldn't change the type: ${(e as Error).message}`),
      },
    );
  };

  const typeSpec = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuSpec => {
    const d = defOf(key)!;
    const fixed = FIXED_TYPES.has(d.type) || !!(d.config as { of?: string } | null)?.of;
    if (fixed) {
      return {
        title: "Change type",
        rows: [{ kind: "row", label: kindLabel(d.type), checked: true, icon: PROPERTY_KINDS.find((k) => k.type === d.type)?.icon ?? IC.dot, onPick: () => mctx.setSpec(back()) }],
        onBack: () => mctx.setSpec(back()),
        footer: `A ${kindLabel(d.type).toLowerCase()} property keeps its type. Add a new property of the type you need.`,
      };
    }
    const used = rowsUsing(key);
    return {
      title: "Change type",
      onBack: () => mctx.setSpec(back()),
      maxHeight: 460,
      rows: RETYPE_TO.map((k) => ({
        kind: "row" as const,
        label: k.label,
        icon: k.icon,
        checked: k.type === d.type,
        onPick: () => {
          if (k.type === d.type) {
            mctx.setSpec(back());
            return;
          }
          if (used === 0) {
            retype(d, k.type as PropertyType);
            mctx.close();
            return;
          }
          mctx.setSpec({
            title: "Change type",
            rows: [],
            onBack: () => mctx.setSpec(typeSpec(key, mctx, back)),
            confirm: {
              title: `Change "${d.label}" to ${k.label}?`,
              body: `${used} ${used === 1 ? "row has a value" : "rows have values"}. Values that read as ${k.label.toLowerCase()} are kept; the others are cleared. Undo puts every value back.`,
              cta: "Change type",
              onConfirm: () => retype(d, k.type as PropertyType),
            },
          });
        },
      })),
      footer: used
        ? `${used} ${used === 1 ? "row has a value" : "rows have values"}: they're converted, and Undo puts them back.`
        : undefined,
    };
  };

  const optionSpec = (key: string, value: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuSpec => {
    const d = defOf(key)!;
    const opts = optionsOf(d);
    const i = opts.findIndex((o) => o.value === value);
    const o = opts[i];
    if (!o) return back();
    const here = () => optionSpec(key, value, mctx, back);
    const used = rowsUsing(key, value);
    const current = colorOfOption(o);
    const rows: MenuRow[] = OPTION_COLORS.map((c) => ({
      kind: "row" as const,
      label: COLOR_NAMES[c],
      swatch: `var(--color-${OPTION_PALETTE[c].tint})`,
      checked: current === c,
      onPick: () => {
        setColor.mutate({ id: d.id, value, color: c }, { onSettled: () => mctx.setSpec(here()) });
        mctx.setSpec(here());
      },
    }));
    if (d.type === "status") {
      const g = groupOf(o);
      rows.push({ kind: "sep" });
      for (const grp of ["todo", "doing", "done"] as StatusGroup[])
        rows.push({
          kind: "row",
          label: GROUP_LABELS[grp],
          icon: grp === "done" ? "M5 12.5l4.5 4.5L19 7.5" : grp === "doing" ? "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 3.5v17" : "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z",
          checked: g === grp,
          onPick: () => setGroup.mutate({ id: d.id, value, group: grp }, { onSettled: () => mctx.setSpec(here()) }),
        });
    }
    rows.push({ kind: "sep" });
    if (i > 0)
      rows.push({
        kind: "row",
        label: "Move up",
        icon: IC.chevUp,
        onPick: () => moveOption.mutate({ id: d.id, value, to: i - 1 }, { onSettled: () => mctx.setSpec(here()) }),
      });
    if (i < opts.length - 1)
      rows.push({
        kind: "row",
        label: "Move down",
        icon: IC.chevDown,
        onPick: () => moveOption.mutate({ id: d.id, value, to: i + 1 }, { onSettled: () => mctx.setSpec(here()) }),
      });
    if (used === 0)
      rows.push({
        kind: "row",
        label: "Remove option",
        icon: IC.trash,
        danger: true,
        onPick: () => {
          removeOption.mutate({ id: d.id, value });
          mctx.setSpec(back());
        },
      });
    return {
      title: o.label,
      onBack: () => mctx.setSpec(back()),
      inputFirst: true,
      maxHeight: 460,
      input: {
        placeholder: "Option name",
        initial: o.label,
        selectOnFocus: true,
        keepOpen: true,
        onCommit: (v) => {
          const label = v.trim();
          if (label && label !== o.label) {
            renameOption.mutate({ id: d.id, value, label }, { onSettled: () => mctx.setSpec(back()) });
          } else mctx.setSpec(back());
        },
      },
      rows,
      footer:
        used > 0
          ? `${used} ${used === 1 ? "row uses" : "rows use"} this option, so it can't be removed. Renaming keeps it on them.`
          : undefined,
    };
  };

  const optionsSpec = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuSpec => {
    const d = defOf(key)!;
    const opts = optionsOf(d);
    const here = () => optionsSpec(key, mctx, back);
    return {
      title: `Options of ${d.label}`,
      onBack: () => mctx.setSpec(back()),
      inputFirst: true,
      maxHeight: 460,
      input: {
        placeholder: "Add an option, then press Enter",
        keepOpen: true,
        onCommit: (v) => {
          if (!v.trim()) return;
          addOption.mutate({ id: d.id, label: v.trim() }, { onSettled: () => mctx.setSpec(here()) });
        },
      },
      rows: opts.map((o) => ({
        kind: "row" as const,
        label: o.label,
        swatch: `var(--color-${o.tint ?? "sunken"})`,
        hint: { text: String(rowsUsing(key, o.value) || "") },
        onPick: () => mctx.setSpec(optionSpec(key, o.value, mctx, here)),
      })),
      footer: opts.length
        ? "Pick an option to rename it, change its colour, move it or remove it. The number is how many rows use it."
        : "No options yet.",
    };
  };

  /** What a type has to set, inside Edit property. */
  const settingsRows = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuRow[] => {
    const d = defOf(key);
    if (!d) return [];
    const rows: MenuRow[] = [];
    if (d.type === "select" || d.type === "status")
      rows.push({
        kind: "row",
        label: "Edit options",
        icon: IC.tag,
        hint: { text: `${optionsOf(d).length} ›` },
        onPick: () => mctx.setSpec(optionsSpec(key, mctx, back)),
      });
    if (d.type === "number") {
      const f = readNumberFormat(d.config);
      rows.push({
        kind: "row",
        label: "Number format",
        icon: "M9 4 7 20M17 4l-2 16M4 9h16M3 15h16",
        hint: { text: (f.format === "currency" ? `${FORMAT_LABELS.currency} (${f.currency ?? "USD"})` : FORMAT_LABELS[f.format ?? "number"]) + " ›" },
        onPick: () => mctx.setSpec(numberSpec(key, mctx, back)),
      });
    }
    if (d.type === "unique_id") {
      const prefix = String((d.config as { prefix?: string } | null)?.prefix ?? "");
      rows.push({
        kind: "row",
        label: "ID prefix",
        icon: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
        hint: { text: (prefix ? `${prefix}-1` : "1, 2, 3…") + " ›" },
        onPick: () =>
          mctx.setSpec({
            title: "ID prefix",
            onBack: () => mctx.setSpec(back()),
            inputFirst: true,
            rows: [],
            input: {
              placeholder: "Letters and digits, like REQ",
              initial: prefix,
              selectOnFocus: true,
              onCommit: (v) => {
                const next = v.trim().toUpperCase();
                if (!/^[A-Z0-9]{0,10}$/.test(next)) return;
                setConfig.mutate({ id: d.id, config: withAccess(d, next ? { prefix: next } : {}) });
              },
            },
            footer: "Every row gets the next number when it's made: REQ-1, REQ-2… Up to 10 letters and digits; leave it empty for plain numbers.",
          }),
      });
    }
    if (d.type === "formula") {
      const expr = String((d.config as { expression?: string } | null)?.expression ?? "");
      rows.push({
        kind: "row",
        label: "Edit formula",
        icon: "M5 5h6M5 19c4 0 3-14 7-14M9 12h6M15 9l5 6M20 9l-5 6",
        hint: { text: (expr ? "set" : "empty") + " ›" },
        onPick: () => mctx.setSpec(formulaSpec(key, mctx, back)),
      });
    }
    if (d.type === "person") rows.push(...personRows(key, mctx, back));
    return rows;
  };

  /** A person property: Limit, Default and Notifications (Notion's). */
  const personRows = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuRow[] => {
    const d = defOf(key)!;
    const cfg = { ...((d.config as Record<string, unknown> | null) ?? {}) };
    const one = onePersonOnly(d);
    const def = typeof cfg.default === "string" ? cfg.default : null;
    const notify = cfg.notify !== false;
    const members = (shell.members.data ?? []) as Array<{ user_id: string; profiles?: { full_name?: string | null; email?: string | null } | null }>;
    const nameOfId = (id: string) => {
      const m = members.find((x) => x.user_id === id);
      return m?.profiles?.full_name || m?.profiles?.email || "Someone";
    };
    const save = (next: Record<string, unknown>, after: () => MenuSpec) =>
      setConfig.mutate({ id: d.id, config: next }, { onSettled: () => mctx.setSpec(after()) });
    const without = (k: string) => {
      const c = { ...cfg };
      delete c[k];
      return c;
    };
    const here = () => ({ title: "Edit property", onBack: () => mctx.setSpec(back()), rows: settingsRows(key, mctx, back) }) as MenuSpec;
    return [
      {
        kind: "row",
        label: "Limit",
        icon: "M5 7h2v10M11 9a2 2 0 1 1 4 0c0 2-4 3-4 8h4M19 7h-1",
        hint: { text: (one ? "1 person" : "No limit") + " ›" },
        onPick: () =>
          mctx.setSpec({
            title: "Limit",
            onBack: () => mctx.setSpec(here()),
            rows: [
              { kind: "row", label: "No limit", checked: !one, onPick: () => save(without("limit"), here) },
              { kind: "row", label: "1 person", checked: one, onPick: () => save({ ...cfg, limit: 1 }, here) },
            ],
            footer: "With a limit, picking someone replaces who was there. Rows that already have several people keep them until they're changed.",
          }),
      },
      {
        kind: "row",
        label: "Default",
        icon: "M12 3.4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20.6v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2",
        hint: { text: (def === "me" ? "Whoever adds it" : def ? nameOfId(def) : "No default") + " ›" },
        onPick: () =>
          mctx.setSpec({
            title: "Default",
            onBack: () => mctx.setSpec(here()),
            maxHeight: 420,
            rows: [
              { kind: "row", label: "No default", checked: !def, onPick: () => save(without("default"), here) },
              { kind: "row", label: "Whoever adds the row", checked: def === "me", onPick: () => save({ ...cfg, default: "me" }, here) },
              { kind: "sep" },
              ...members.map((m) => ({
                kind: "row" as const,
                label: nameOfId(m.user_id),
                checked: def === m.user_id,
                onPick: () => save({ ...cfg, default: m.user_id }, here),
              })),
            ],
            footer: "New rows start with this person.",
          }),
      },
      {
        kind: "row",
        label: "Notifications",
        icon: "M6 9a6 6 0 1 1 12 0c0 4.5 1.8 6 1.8 6H4.2S6 13.5 6 9zM10 19a2 2 0 0 0 4 0",
        hint: { text: (notify ? "People added" : "None") + " ›" },
        onPick: () =>
          mctx.setSpec({
            title: "Notifications",
            onBack: () => mctx.setSpec(here()),
            rows: [
              { kind: "row", label: "Notify people added", checked: notify, onPick: () => save(without("notify"), here) },
              { kind: "row", label: "No notifications", checked: !notify, onPick: () => save({ ...cfg, notify: false }, here) },
            ],
            footer: "Someone added to this property hears about it in their Inbox (never for adding yourself).",
          }),
      },
    ];
  };

  /** Who may change the values: anyone who can edit the row, or owners. */
  const accessSpec = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuSpec => {
    const d = defOf(key)!;
    const cfg = { ...((d.config as Record<string, unknown> | null) ?? {}) };
    const owners = cfg.access === "owners";
    const set = (toOwners: boolean) => {
      const next = { ...cfg };
      if (toOwners) next.access = "owners";
      else delete next.access;
      setConfig.mutate({ id: d.id, config: next }, { onSettled: () => mctx.setSpec(accessSpec(key, mctx, back)) });
    };
    return {
      title: "Property access",
      onBack: () => mctx.setSpec(back()),
      rows: [
        { kind: "row", label: "Anyone who can edit the row", checked: !owners, onPick: () => (isOwner ? set(false) : undefined) },
        { kind: "row", label: "Only workspace owners", checked: owners, onPick: () => (isOwner ? set(true) : undefined) },
      ],
      footer: isOwner
        ? `Who can change the values of "${d.label}". Everyone who can open a row still sees them.`
        : `Only workspace owners decide who can change "${d.label}".`,
    };
  };

  /** Rows that change the property itself: Edit property, Property access
   *  and Change type. */
  const editRows = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuRow[] => {
    const d = defOf(key);
    if (!editable || !d || d.is_system) return [];
    const rows: MenuRow[] = [];
    const settings = settingsRows(key, mctx, back);
    if (settings.length)
      rows.push({
        kind: "row",
        label: "Edit property",
        icon: ICON_SETTINGS,
        hint: { text: "›" },
        onPick: () =>
          mctx.setSpec({
            title: "Edit property",
            onBack: () => mctx.setSpec(back()),
            rows: settingsRows(key, mctx, back),
          }),
      });
    const owners = (d.config as { access?: string } | null)?.access === "owners";
    rows.push({
      kind: "row",
      label: "Property access",
      icon: ICON_LOCK,
      hint: { text: (owners ? "Owners" : "Everyone") + " ›" },
      onPick: () => mctx.setSpec(accessSpec(key, mctx, back)),
    });
    rows.push({
      kind: "row",
      label: "Change type",
      icon: ICON_RETYPE,
      hint: { text: `${kindLabel(d.type)} ›` },
      onPick: () => mctx.setSpec(typeSpec(key, mctx, back)),
    });
    return rows;
  };

  const numberSpec = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuSpec => {
    const d = defOf(key)!;
    const f = readNumberFormat(d.config);
    const here = () => numberSpec(key, mctx, back);
    const save = (next: NumberFormat) => {
      const cfg: Record<string, unknown> = {};
      if (next.format && next.format !== "number") cfg.format = next.format;
      if (next.format === "currency") cfg.currency = next.currency ?? "USD";
      if (next.decimals !== undefined) cfg.decimals = next.decimals;
      setConfig.mutate({ id: d.id, config: withAccess(d, cfg) }, { onSettled: () => mctx.setSpec(here()) });
    };
    const sample = formatNumber(1234.5, f);
    const rows: MenuRow[] = (Object.keys(FORMAT_LABELS) as NumberFormatKind[]).map((k) => ({
      kind: "row" as const,
      label: FORMAT_LABELS[k],
      checked: (f.format ?? "number") === k,
      onPick: () => save({ ...f, format: k }),
    }));
    if (f.format === "currency") {
      rows.push({ kind: "sep" });
      for (const c of CURRENCIES)
        rows.push({
          kind: "row",
          label: CURRENCY_LABELS[c],
          hint: { text: c },
          checked: (f.currency ?? "USD") === c,
          onPick: () => save({ ...f, currency: c }),
        });
    }
    rows.push({ kind: "sep" });
    for (const n of [undefined, 0, 1, 2, 3] as Array<number | undefined>)
      rows.push({
        kind: "row",
        label: n === undefined ? "Decimals as typed" : n === 1 ? "1 decimal" : `${n} decimals`,
        checked: f.decimals === n,
        onPick: () => save({ ...f, decimals: n }),
      });
    return {
      title: "Number format",
      onBack: () => mctx.setSpec(back()),
      maxHeight: 460,
      rows,
      footer: `1234.5 shows as ${sample}. Values stay as they are; only how they show changes.`,
    };
  };

  const formulaSpec = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuSpec => {
    const d = defOf(key)!;
    const expr = String((d.config as { expression?: string } | null)?.expression ?? "");
    const names = (shellDefs() as PropDef[])
      .filter((x) => x.database_id === databaseId && !x.archived_at && x.key !== key)
      .map((x) => x.label)
      .slice(0, 6);
    return {
      title: `Formula of ${d.label}`,
      onBack: () => mctx.setSpec(back()),
      inputFirst: true,
      width: 320,
      rows: [],
      input: {
        placeholder: 'prop("Effort") * 2',
        initial: expr,
        selectOnFocus: false,
        onCommit: (v) => {
          const next = v.trim().replace(/^=/, "");
          setConfig.mutate({ id: d.id, config: withAccess(d, next ? { expression: next } : {}) });
        },
      },
      footer:
        'Refer to a property as prop("Name")' +
        (names.length ? `, for example prop("${names[0]}")` : "") +
        ". Use + − × ÷, comparisons, and IF, CONCAT, ROUND, SUM, MIN, MAX, ABS, TODAY. Press Enter to save.",
    };
  };

  /** Insert left / right: a new property placed beside this one. */
  const insertRows = (
    index: number,
    mctx: MenuBuildCtx,
    back: () => MenuSpec,
    place: (newKey: string, at: number) => void,
  ): MenuRow[] => {
    if (!editable) return [];
    return ([["Insert left", index, "M10 12H4m0 0 4-4m-4 4 4 4M20 5v14"], ["Insert right", index + 1, "M14 12h6m0 0-4-4m4 4-4 4M4 5v14"]] as const).map(
      ([label, at, icon]) => ({
        kind: "row" as const,
        label,
        icon,
        onPick: () => mctx.setSpec(insertFlow(mctx, back, (key) => place(key, at))),
      }),
    );
  };

  /* The new-property flow, rebuilt for this menu so it can go Back. */
  const insertFlow = (mctx: MenuBuildCtx, back: () => MenuSpec, done: (key: string) => void): MenuSpec => {
    // One new-property flow serves every column: the menu that opened it
    // is remembered, Back returns there, and the new property lands where
    // it was asked for.
    pendingRef.current = { mctx, back, done };
    return { ...flow.typeSpec, onBack: () => mctx.setSpec(back()) };
  };
  const pendingRef = useRef<null | { mctx: MenuBuildCtx; back: () => MenuSpec; done: (k: string) => void }>(null);
  const flow = useNewPropertyFlow({
    databaseId: databaseId ?? "",
    allPropDefs,
    databases,
    setSub: (s) => {
      const p = pendingRef.current;
      if (!p) return;
      if (s) p.mctx.setSpec(s);
      else p.mctx.close();
    },
    rootBack: null,
    onCreated: (def) => {
      const p = pendingRef.current;
      pendingRef.current = null;
      p?.done(def.key);
      p?.mctx.close();
    },
  });

  /** Duplicate and Archive, at the end of the menu. */
  const tailRows = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuRow[] => {
    const d = defOf(key);
    if (!editable || !d || d.is_system) return [];
    const rows: MenuRow[] = [];
    if (!(d.config as { of?: string } | null)?.of)
      rows.push({
        kind: "row",
        label: "Duplicate property",
        icon: IC.dup,
        onPick: () => {
          duplicate.mutate({ id: d.id, label: d.label });
          mctx.close();
        },
      });
    if (isOwner)
      rows.push({
        kind: "row",
        label: "Delete property",
        icon: IC.trash,
        danger: true,
        onPick: () =>
          mctx.setSpec({
            title: d.label,
            rows: [],
            onBack: () => mctx.setSpec(back()),
            confirm: {
              title: `Delete "${d.label}"?`,
              body: "It leaves every view and page of this database. Its values are kept, so Undo or Settings › Properties brings it back.",
              cta: "Delete property",
              danger: true,
              onConfirm: () => archive.mutate({ id: d.id, label: d.label, archived: true }),
            },
          }),
      });
    return rows;
  };

  const ownerNote = (key: string): string | undefined => {
    const d = defOf(key);
    if (!d) return undefined;
    if (d.is_system) return "A built-in property: its name and type stay as they are.";
    if (editable && !isOwner) return "Only workspace owners can delete a property.";
    return undefined;
  };

  return { editable, renameInput, editRows, insertRows, tailRows, ownerNote };
}
