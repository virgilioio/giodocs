import type { MenuRow, MenuSpec } from "./row-menu";
import { useCreateProperty } from "@/hooks/use-property-mutations";
import { PROPERTY_KINDS, kindLabel, type PropertyType } from "@/lib/property-kinds";
import { BUILT_IN_LABELS, BUILT_IN_TYPES } from "@/lib/view-config";
import { CALC_LABELS, calcsFor } from "@/lib/view-calc";
import { relationTargetDatabase, type RelDefLike } from "@/lib/relations";

/* Making a new property for a database, step by step: pick a type, name
 * it, and for a relation pick the database and one way or both, for a
 * rollup the relation, the property of the linked rows and the
 * calculation. One flow for every place a property is added (a row's
 * property panel, a database table's header), so they can't drift. */

type Def = RelDefLike & { label: string; position?: number | null };

/** The value a fresh property starts with on a row. */
export function seedFor(t: string): unknown {
  switch (t) {
    case "multi_select":
    case "links":
    case "relation":
      return [];
    case "checkbox":
      return false;
    case "text":
      return "";
    default:
      return null;
  }
}

export function useNewPropertyFlow(opts: {
  databaseId: string;
  /** Every property in the workspace: a rollup reads the properties of
   *  the database its relation points at. */
  allPropDefs: Def[];
  /** Databases a relation can link to. */
  databases: Array<{ id: string; title: string | null; icon: string | null }>;
  /** Swap the menu panel in place. */
  setSub: (s: MenuSpec | null) => void;
  /** Where Back from the type list goes (null: the caller's root list). */
  rootBack: MenuSpec | null;
  onCreated: (def: { key: string; type: string }) => void;
}): { typeSpec: MenuSpec } {
  const { databaseId, allPropDefs, databases, setSub, rootBack, onCreated } = opts;
  const createProperty = useCreateProperty();
  const propDefs = allPropDefs.filter((d) => d.database_id === databaseId);
  const defsByKey = new Map(allPropDefs.map((d) => [d.key, d]));

  const create = (
    label: string,
    type: PropertyType,
    config?: Record<string, unknown>,
    backLabel?: string,
  ) =>
    createProperty.mutate(
      { databaseId, label, type, config, backLabel },
      { onSuccess: (def) => onCreated(def) },
    );

  // Step 2: name it.
  const nameSpec = (
    type: PropertyType,
    then?: (label: string) => void,
    back: MenuSpec = typeSpec,
  ): MenuSpec => ({
    title: `New ${kindLabel(type).toLowerCase()} property`,
    rows: [],
    onBack: () => setSub(back),
    footer: "Every row of this database gets it. Only owners can archive it.",
    input: {
      placeholder: "Name it, then press Enter",
      onCommit: (label) => (then ? then(label) : create(label, type)),
      // A relation's name leads to "one way or both".
      keepOpen: type === "relation",
    },
  });

  /* Relation: which database it links to, its name, then one way or both. */
  const relationScopeSpec = (): MenuSpec => ({
    title: "Link to rows of",
    onBack: () => setSub(typeSpec),
    footer: "A relation links to the rows of one database.",
    rows: databases.map<MenuRow>((d) => ({
      kind: "row",
      label: d.title?.trim() || "Untitled",
      icon: d.id === databaseId ? "M4 5h16v14H4zM4 10h16M10 5v14" : "M4 5h16v14H4zM4 10h16",
      hint: d.id === databaseId ? { text: "this database" } : undefined,
      onPick: () => setSub(relationName(d.id)),
    })),
  });
  const relationName = (targetId: string): MenuSpec =>
    nameSpec("relation", (label) => setSub(relationSides(label, targetId)), relationScopeSpec());
  const relationSides = (label: string, targetId: string): MenuSpec => ({
    title: label,
    onBack: () => setSub(relationName(targetId)),
    rows: [
      {
        kind: "row",
        label: "Only here",
        hint: { text: "One way" },
        onPick: () => create(label, "relation", { database_id: targetId }),
      },
      {
        kind: "row",
        label: "Also on the linked rows…",
        hint: { text: "Two way" },
        onPick: () =>
          setSub({
            title: "On the linked rows",
            rows: [],
            onBack: () => setSub(relationSides(label, targetId)),
            footer: `A row this one links to with ${label} shows it under this name, and links can be made from either side.`,
            input: {
              placeholder: "Name it there, then press Enter",
              onCommit: (back) => create(label, "relation", { database_id: targetId }, back),
            },
          }),
      },
    ],
  });

  /* Rollup: a relation, a property of the rows it links to, a calculation. */
  const relationDefs = propDefs.filter((d) => d.type === "relation");
  const rollupRelationSpec = (): MenuSpec => ({
    title: "Roll up through",
    onBack: () => setSub(typeSpec),
    footer: relationDefs.length
      ? undefined
      : "Make a relation first: a rollup works across the pages it links to.",
    rows: relationDefs.map<MenuRow>((d) => ({
      kind: "row",
      label: d.label,
      icon: PROPERTY_KINDS.find((k) => k.type === "relation")?.icon,
      onPick: () => setSub(rollupTargetSpec(d.key)),
    })),
  });
  const rollupTargetSpec = (relation: string): MenuSpec => {
    // The properties of the database the relation links to — not this
    // database's own.
    const rel = defsByKey.get(relation);
    const target = rel ? relationTargetDatabase(rel, defsByKey) : null;
    const targetDefs = allPropDefs.filter(
      (d) => d.database_id === target && !(d as { archived_at?: string | null }).archived_at,
    );
    return {
      title: "Of their",
      onBack: () => setSub(rollupRelationSpec()),
      rows: [
        {
          kind: "row",
          label: "Pages (title)",
          onPick: () => setSub(rollupCalcSpec(relation, "title", "title")),
        },
        ...targetDefs
          .filter((d) => d.type !== "rollup" && d.type !== "links")
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map<MenuRow>((d) => ({
            kind: "row",
            label: d.label,
            hint: { text: kindLabel(d.type) },
            onPick: () => setSub(rollupCalcSpec(relation, d.key, d.type)),
          })),
        ...Object.entries(BUILT_IN_LABELS).map<MenuRow>(([k, l]) => ({
          kind: "row",
          label: l,
          onPick: () => setSub(rollupCalcSpec(relation, k, BUILT_IN_TYPES[k])),
        })),
      ],
    };
  };
  const rollupCalcSpec = (relation: string, target: string, type: string): MenuSpec => ({
    title: "Show",
    onBack: () => setSub(rollupTargetSpec(relation)),
    rows: [
      ...(["title", "select", "status", "person", "text", "multi_select", "relation"].includes(type)
        ? [
            {
              kind: "row" as const,
              label: "Their values",
              onPick: () => setSub(rollupName(relation, target, "show", type)),
            },
          ]
        : []),
      ...calcsFor(type === "title" ? "text" : type).map<MenuRow>((c) => ({
        kind: "row",
        label: CALC_LABELS[c],
        onPick: () => setSub(rollupName(relation, target, c, type)),
      })),
    ],
  });
  const rollupName = (relation: string, target: string, calc: string, type: string): MenuSpec =>
    nameSpec(
      "rollup",
      (label) => create(label, "rollup", { relation, target, calc }),
      rollupCalcSpec(relation, target, type),
    );

  // Step 1: pick a type.
  const typeSpec: MenuSpec = {
    title: "New property",
    onBack: rootBack ? () => setSub(rootBack) : () => setSub(null),
    rows: PROPERTY_KINDS.map((k) => ({
      kind: "row" as const,
      label: k.label,
      icon: k.icon,
      hint: { text: k.hint },
      onPick: () =>
        setSub(
          k.type === "relation"
            ? relationScopeSpec()
            : k.type === "rollup"
              ? rollupRelationSpec()
              : nameSpec(k.type),
        ),
    })),
  };

  return { typeSpec };
}
