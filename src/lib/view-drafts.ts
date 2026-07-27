import type { Filter, SortSpec } from "./run-view";

export type ViewLayout = "table" | "board" | "list";
export type ViewScope = "personal" | "team" | "area";

export type ViewBase = {
  id: string;
  name: string;
  scope: ViewScope;
  layout: ViewLayout;
  filter: Filter[];
  sort: SortSpec;
  group_by: string | null;
};

export type ViewDraft = Partial<Pick<ViewBase, "layout" | "filter" | "sort" | "group_by">>;

export type CurrentView = ViewBase & { _base: ViewBase; _modified: boolean };

export function currentView(
  base: ViewBase,
  drafts: Record<string, ViewDraft>,
): CurrentView {
  const d = drafts[base.id];
  return { ...base, ...(d ?? {}), _base: base, _modified: !!d };
}

export function areaBaseView(area: string): ViewBase {
  return {
    id: `area:${area}`,
    name: area,
    scope: "area",
    layout: "table",
    filter: [{ op: "eq", prop: "area", value: area }],
    sort: { prop: "edited", dir: "desc" },
    group_by: null,
  };
}
