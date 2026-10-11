/* A property's column menu (Notion's): rename it, change its type, edit
 * its options (name, colour, order, remove an unused one), insert a new
 * property beside it, filter, wrap, duplicate, archive. The database
 * decides who may do each (guard_property_def, RLS, the option functions);
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
  useSetPropertyConfig,
  useUpdateProperty,
  type OptionColor,
} from "@/hooks/use-property-mutations";
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

/** Types a property can be changed to from its menu (relations and
 *  rollups need settings: make those as new properties). */
const RETYPE_TO = PROPERTY_KINDS.filter(
  (k) => k.type !== "relation" && k.type !== "rollup" && k.type !== "formula",
);

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

  /** The rename field for the top of the menu, or undefined. */
  const renameInput = (key: string, mctx: MenuBuildCtx): MenuSpec["input"] => {
    const d = defOf(key);
    if (!editable || !d || d.is_system) return undefined;
    return {
      placeholder: "Property name",
      initial: d.label,
      selectOnFocus: true,
      onCommit: (v) => {
        const label = v.trim();
        if (label && label !== d.label) update.mutate({ id: d.id, patch: { label } });
        mctx.close();
      },
    };
  };

  const typeSpec = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuSpec => {
    const d = defOf(key)!;
    const used = rowsUsing(key);
    if (used > 0) {
      return {
        title: "Type",
        rows: [{ kind: "row", label: kindLabel(d.type), checked: true, icon: IC.dot, onPick: () => mctx.setSpec(back()) }],
        onBack: () => mctx.setSpec(back()),
        footer: `${used} ${used === 1 ? "row has" : "rows have"} a value for ${d.label}, so its type can't change. Duplicate it, or add a new property of the type you need.`,
      };
    }
    return {
      title: "Type",
      onBack: () => mctx.setSpec(back()),
      maxHeight: 460,
      rows: RETYPE_TO.map((k) => ({
        kind: "row" as const,
        label: k.label,
        icon: k.icon,
        checked: k.type === d.type,
        onPick: () => {
          if (k.type !== d.type) update.mutate({ id: d.id, patch: { type: k.type as PropertyType } });
          mctx.close();
        },
      })),
      footer: "The type can change while no row has a value.",
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

  /** Rows that change the property itself: Type and Edit options. */
  const editRows = (key: string, mctx: MenuBuildCtx, back: () => MenuSpec): MenuRow[] => {
    const d = defOf(key);
    if (!editable || !d || d.is_system) return [];
    const rows: MenuRow[] = [];
    if (d.type !== "relation" && d.type !== "rollup" && !(d.config as { of?: string } | null)?.of)
      rows.push({
        kind: "row",
        label: "Type",
        icon: PROPERTY_KINDS.find((k) => k.type === d.type)?.icon ?? IC.dot,
        hint: { text: kindLabel(d.type) },
        onPick: () => mctx.setSpec(typeSpec(key, mctx, back)),
      });
    if (d.type === "select" || d.type === "status")
      rows.push({
        kind: "row",
        label: "Edit options",
        icon: IC.tag,
        hint: { text: String(optionsOf(d).length) },
        onPick: () => mctx.setSpec(optionsSpec(key, mctx, back)),
      });
    if (d.type === "number") {
      const f = readNumberFormat(d.config);
      rows.push({
        kind: "row",
        label: "Number format",
        icon: "M9 4 7 20M17 4l-2 16M4 9h16M3 15h16",
        hint: { text: f.format === "currency" ? `${FORMAT_LABELS.currency} (${f.currency ?? "USD"})` : FORMAT_LABELS[f.format ?? "number"] },
        onPick: () => mctx.setSpec(numberSpec(key, mctx, back)),
      });
    }
    if (d.type === "unique_id") {
      const prefix = String((d.config as { prefix?: string } | null)?.prefix ?? "");
      rows.push({
        kind: "row",
        label: "ID prefix",
        icon: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
        hint: { text: prefix ? `${prefix}-1` : "1, 2, 3…" },
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
                setConfig.mutate({ id: d.id, config: next ? { prefix: next } : {} });
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
        hint: { text: expr ? "set" : "empty" },
        onPick: () => mctx.setSpec(formulaSpec(key, mctx, back)),
      });
    }
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
      setConfig.mutate({ id: d.id, config: cfg }, { onSettled: () => mctx.setSpec(here()) });
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
          setConfig.mutate({ id: d.id, config: next ? { expression: next } : {} });
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
        label: "Archive property",
        icon: IC.trash,
        danger: true,
        onPick: () =>
          mctx.setSpec({
            title: d.label,
            rows: [],
            onBack: () => mctx.setSpec(back()),
            confirm: {
              title: `Archive "${d.label}"?`,
              body: "It leaves every view and page of this database. Its values stay, and Undo or Settings › Properties brings it back.",
              cta: "Archive",
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
    if (editable && !isOwner) return "Only workspace owners can archive a property.";
    return undefined;
  };

  return { editable, renameInput, editRows, insertRows, tailRows, ownerNote };
}
