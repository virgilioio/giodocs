import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useToast } from "@/lib/toast";
import { useAuth } from "@/lib/auth-context";
import { useWorkspaceId } from "@/lib/workspace-context";
import { keyForLabel, type PropertyType } from "@/lib/property-kinds";
import { hashTag, type SelectOption } from "@/components/property-pickers";
import type { Database } from "@/integrations/supabase/types";

/* Creating, editing and archiving properties.
 *
 * The rules live in the database (RLS + guard_property_def): any member
 * creates and edits; only owners archive or restore; keys never change; a
 * type changes only while no page uses it. These hooks are optimistic on the
 * live list (qk.propDefs) and refresh the full list (qk.propDefsAll). */

type PropDef = Database["public"]["Tables"]["property_defs"]["Row"];

function refresh(qc: ReturnType<typeof useQueryClient>, ws: string) {
  void qc.invalidateQueries({ queryKey: qk.propDefs(ws) });
  void qc.invalidateQueries({ queryKey: qk.propDefsAll(ws) });
}

function message(err: unknown): string {
  const m = (err as { message?: string })?.message ?? "";
  if (/row-level security|permission|42501/i.test(m)) {
    return "You don't have permission to do that.";
  }
  return m || "Something went wrong.";
}

export function useCreateProperty() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: {
      /** The database the property belongs to. */
      databaseId: string;
      label: string;
      type: PropertyType;
      /** A relation's or rollup's settings (property_defs.config). */
      config?: Record<string, unknown>;
      /** A two-way relation: its far side, named for the linked pages. It
       *  lives in the database the relation links to. */
      backLabel?: string;
    }) => {
      const label = v.label.trim();
      if (!label) throw new Error("Give the property a name.");
      // Keys are workspace-wide and include archived properties.
      const { data: all, error: e1 } = await supabase
        .from("property_defs")
        .select("key, position")
        .eq("workspace_id", ws)
        // Keys and positions only: small rows, and every database's
        // properties count (keys are unique across the workspace).
        .limit(10000);
      if (e1) throw e1;
      const rows = all ?? [];
      const taken = rows.map((r) => r.key);
      const position = rows.reduce((m, r) => Math.max(m, r.position ?? 0), 0) + 1;
      // Two people naming a property the same at the same moment: the second
      // takes the next key instead of failing.
      for (let attempt = 0; attempt < 3; attempt++) {
        const key = keyForLabel(label, taken);
        const backLabel = v.backLabel?.trim();
        const backKey = backLabel ? keyForLabel(backLabel, [...taken, key]) : null;
        const row = {
          workspace_id: ws,
          database_id: v.databaseId,
          key,
          label,
          type: v.type,
          options: [],
          position,
          created_by: user!.id,
          config: (backKey ? { ...(v.config ?? {}), back: backKey } : (v.config ?? {})) as never,
        };
        const farDatabase =
          typeof v.config?.database_id === "string" ? v.config.database_id : v.databaseId;
        // A two-way relation's two sides are made in one statement, so
        // neither exists without the other.
        const rows = backKey
          ? [
              row,
              {
                ...row,
                database_id: farDatabase,
                key: backKey,
                label: backLabel!,
                position: position + 1,
                config: { of: key } as never,
              },
            ]
          : [row];
        const { data, error } = await supabase.from("property_defs").insert(rows).select("*");
        if (!error) {
          const made = (data ?? []) as PropDef[];
          for (const d of made.slice(1)) {
            qc.setQueryData<PropDef[]>(qk.propDefs(ws), (prev) =>
              prev ? [...prev.filter((x) => x.key !== d.key), d] : [d],
            );
          }
          return made.find((d) => d.key === key) ?? made[0];
        }
        if ((error as { code?: string }).code !== "23505") throw error;
        // Either side's key may be the one taken.
        taken.push(key);
        if (backKey) taken.push(backKey);
      }
      throw new Error("Someone just made a property with that name. Try again.");
    },
    onSuccess: (def) => {
      qc.setQueryData<PropDef[]>(qk.propDefs(ws), (prev) =>
        prev ? [...prev.filter((d) => d.key !== def.key), def] : [def],
      );
      refresh(qc, ws);
    },
    onError: (err) => {
      toast.push(`Couldn't create the property: ${message(err)}`);
    },
  });
}

export function useUpdateProperty() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: {
      id: string;
      /** Options change one at a time: useAddPropertyOption /
       *  useRenamePropertyOption. */
      patch: { label?: string; type?: PropertyType; description?: string };
    }) => {
      const patch: Database["public"]["Tables"]["property_defs"]["Update"] = {};
      if (v.patch.label !== undefined) {
        const label = v.patch.label.trim();
        if (!label) throw new Error("A property needs a name.");
        patch.label = label;
      }
      if (v.patch.type !== undefined) patch.type = v.patch.type;
      if (v.patch.description !== undefined) patch.description = v.patch.description.trim().slice(0, 280);
      const { error } = await supabase.from("property_defs").update(patch).eq("id", v.id);
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.propDefs(ws) });
      const snap = qc.getQueryData<PropDef[]>(qk.propDefs(ws));
      const snapAll = qc.getQueryData<PropDef[]>(qk.propDefsAll(ws));
      const apply = (list?: PropDef[]) =>
        list?.map((d) =>
          d.id === v.id
            ? {
                ...d,
                ...(v.patch.label !== undefined ? { label: v.patch.label.trim() } : null),
                ...(v.patch.type !== undefined ? { type: v.patch.type } : null),
                ...(v.patch.description !== undefined ? { description: v.patch.description.trim().slice(0, 280) } : null),
              }
            : d,
        );
      if (snap) qc.setQueryData(qk.propDefs(ws), apply(snap));
      if (snapAll) qc.setQueryData(qk.propDefsAll(ws), apply(snapAll));
      return { snap, snapAll };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snap) qc.setQueryData(qk.propDefs(ws), ctx.snap);
      if (ctx?.snapAll) qc.setQueryData(qk.propDefsAll(ws), ctx.snapAll);
      toast.push(`Couldn't change the property: ${message(err)}`);
    },
    onSettled: () => refresh(qc, ws),
  });
}

/** Add an option to a select / status property and return its value, so the
 *  caller can pick it right away. One option at a time, under a row lock in
 *  the database (add_property_option), so two people adding at once both
 *  keep theirs. The same name again returns the existing option. */
export function useAddPropertyOption() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { id: string; label: string }) => {
      const { data, error } = await supabase.rpc("add_property_option", {
        p_def: v.id,
        p_label: v.label,
      });
      if (error) throw error;
      return { value: data as string };
    },
    onSuccess: async (r, v) => {
      await qc.cancelQueries({ queryKey: qk.propDefs(ws) });
      await qc.cancelQueries({ queryKey: qk.propDefsAll(ws) });
      // Show it at once; the refetch below brings the stored colours.
      const apply = (list?: PropDef[]) =>
        list?.map((d) => {
          if (d.id !== v.id) return d;
          const cur = (Array.isArray(d.options) ? d.options : []) as unknown as SelectOption[];
          if (cur.some((o) => o.value === r.value)) return d;
          const pair = hashTag(v.label.trim());
          return {
            ...d,
            options: [...cur, { value: r.value, label: v.label.trim(), ...pair }] as never,
          };
        });
      qc.setQueryData<PropDef[]>(qk.propDefs(ws), (prev) => apply(prev));
      qc.setQueryData<PropDef[]>(qk.propDefsAll(ws), (prev) => apply(prev));
      refresh(qc, ws);
    },
    onError: (err) => {
      toast.push(`Couldn't add the option: ${message(err)}`);
    },
  });
}

/** Rename one option (its value, and so every page using it, stays). */
export function useRenamePropertyOption() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { id: string; value: string; label: string }) => {
      const { error } = await supabase.rpc("rename_property_option", {
        p_def: v.id,
        p_value: v.value,
        p_label: v.label,
      });
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.propDefs(ws) });
      await qc.cancelQueries({ queryKey: qk.propDefsAll(ws) });
      const snap = qc.getQueryData<PropDef[]>(qk.propDefs(ws));
      const snapAll = qc.getQueryData<PropDef[]>(qk.propDefsAll(ws));
      const apply = (list?: PropDef[]) =>
        list?.map((d) =>
          d.id !== v.id
            ? d
            : {
                ...d,
                options: ((Array.isArray(d.options) ? d.options : []) as unknown as SelectOption[]).map(
                  (o) => (o.value === v.value ? { ...o, label: v.label.trim() } : o),
                ) as never,
              },
        );
      if (snap) qc.setQueryData(qk.propDefs(ws), apply(snap));
      if (snapAll) qc.setQueryData(qk.propDefsAll(ws), apply(snapAll));
      return { snap, snapAll };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snap) qc.setQueryData(qk.propDefs(ws), ctx.snap);
      if (ctx?.snapAll) qc.setQueryData(qk.propDefsAll(ws), ctx.snapAll);
      toast.push(`Couldn't rename the option: ${message(err)}`);
    },
    onSettled: () => refresh(qc, ws),
  });
}

/** Owners only: archive (hide, values kept) or restore a property. */
export function useSetPropertyArchived() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  const m = useMutation({
    mutationFn: async (v: { id: string; label: string; archived: boolean }) => {
      // A two-way relation's sides are archived and restored together:
      // one side alone would show links that can't be changed.
      const { data: row, error: e1 } = await supabase
        .from("property_defs")
        .select("key, type, config")
        .eq("id", v.id)
        .maybeSingle();
      if (e1) throw e1;
      const cfg = (row?.config ?? {}) as Record<string, unknown>;
      const partner =
        row?.type === "relation"
          ? typeof cfg.of === "string"
            ? cfg.of
            : typeof cfg.back === "string"
              ? cfg.back
              : null
          : null;
      const keys = [row?.key, partner].filter((k): k is string => !!k);
      const write = supabase
        .from("property_defs")
        .update({ archived_at: v.archived ? new Date().toISOString() : null });
      const { error } = await (keys.length
        ? write.eq("workspace_id", ws).in("key", keys)
        : write.eq("id", v.id));
      if (error) throw error;
      return v;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.propDefs(ws) });
      const snap = qc.getQueryData<PropDef[]>(qk.propDefs(ws));
      if (snap && v.archived) {
        qc.setQueryData(qk.propDefs(ws), snap.filter((d) => d.id !== v.id));
      }
      return { snap };
    },
    onSuccess: (v) => {
      if (v.archived) {
        // Reversible, so Undo instead of a confirmation.
        toast.push({
          message: `Archived ${v.label}. Its values stay on every page.`,
          action: { label: "Undo", onClick: () => m.mutate({ ...v, archived: false }) },
        });
      } else {
        toast.push(`Restored ${v.label}.`);
      }
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snap) qc.setQueryData(qk.propDefs(ws), ctx.snap);
      toast.push(`Couldn't change ${_v.label}: ${message(err)}`);
    },
    onSettled: () => refresh(qc, ws),
  });
  return m;
}

/* ─── Editing options and copying a property (property_editing migration) ───
 * One option at a time, under a row lock in the database; each change
 * shows at once on the cached property and is put back if it fails. */

type OptionRow = { value: string; label: string; tint?: string; ink?: string; dot?: string };

/** The palette an option colour comes from (option_palette in SQL). */
export const OPTION_COLORS = ["gray", "green", "amber", "yellow", "blue", "purple", "pink", "red"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];
export const OPTION_PALETTE: Record<OptionColor, { tint: string; ink: string; dot: string }> = {
  gray: { tint: "sunken", ink: "secondary", dot: "whisper" },
  green: { tint: "accentTint", ink: "accent", dot: "accentDot" },
  amber: { tint: "amberTint", ink: "amberInk", dot: "amberDot" },
  yellow: { tint: "yellowTint", ink: "yellowInk", dot: "yellowInk" },
  blue: { tint: "blueTint", ink: "blueInk", dot: "blue" },
  purple: { tint: "purpleTint", ink: "purple", dot: "purple" },
  pink: { tint: "pinkTint", ink: "pinkInk", dot: "pink" },
  red: { tint: "dangerTint", ink: "danger", dot: "dangerDot" },
};

/** Which palette colour an option shows, by its tint. */
export function colorOfOption(o: { tint?: string }): OptionColor | null {
  const hit = OPTION_COLORS.find((c) => OPTION_PALETTE[c].tint === o.tint);
  return hit ?? null;
}

function useOptionEdit<V extends { id: string }>(
  rpc: (v: V) => PromiseLike<{ error: unknown }>,
  apply: (opts: OptionRow[], v: V) => OptionRow[],
  failText: string,
) {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: V) => {
      const { error } = await rpc(v);
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.propDefs(ws) });
      const snap = qc.getQueryData<PropDef[]>(qk.propDefs(ws));
      if (snap) {
        qc.setQueryData<PropDef[]>(
          qk.propDefs(ws),
          snap.map((d) =>
            d.id === v.id
              ? { ...d, options: apply((Array.isArray(d.options) ? d.options : []) as unknown as OptionRow[], v) as never }
              : d,
          ),
        );
      }
      return { snap };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snap) qc.setQueryData(qk.propDefs(ws), ctx.snap);
      toast.push(`${failText}: ${message(err)}`);
    },
    onSettled: () => refresh(qc, ws),
  });
}

export function useSetOptionColor() {
  return useOptionEdit<{ id: string; value: string; color: OptionColor }>(
    (v) => supabase.rpc("set_property_option_color", { p_def: v.id, p_value: v.value, p_color: v.color }),
    (opts, v) => opts.map((o) => (o.value === v.value ? { ...o, ...OPTION_PALETTE[v.color] } : o)),
    "Couldn't change the colour",
  );
}

export function useMoveOption() {
  return useOptionEdit<{ id: string; value: string; to: number }>(
    (v) => supabase.rpc("move_property_option", { p_def: v.id, p_value: v.value, p_to: v.to }),
    (opts, v) => {
      const moving = opts.find((o) => o.value === v.value);
      if (!moving) return opts;
      const rest = opts.filter((o) => o.value !== v.value);
      const at = Math.max(0, Math.min(v.to, rest.length));
      return [...rest.slice(0, at), moving, ...rest.slice(at)];
    },
    "Couldn't move the option",
  );
}

export function useRemoveOption() {
  return useOptionEdit<{ id: string; value: string }>(
    (v) => supabase.rpc("remove_property_option", { p_def: v.id, p_value: v.value }),
    (opts, v) => opts.filter((o) => o.value !== v.value),
    "Couldn't remove the option",
  );
}

/** A copy of a property in its database, with the values of the rows you
 *  can edit (duplicate_property). Resolves to the copy's key. */
export function useDuplicateProperty() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { id: string; label: string }) => {
      const { data, error } = await supabase.rpc("duplicate_property", { p_def: v.id });
      if (error) throw error;
      return data as { id: string; key: string; label: string; rows: number };
    },
    onSuccess: async (made) => {
      await qc.invalidateQueries({ queryKey: qk.propDefs(ws) });
      void qc.invalidateQueries({ queryKey: qk.propDefsAll(ws) });
      void qc.invalidateQueries({ queryKey: qk.pages(ws) });
      toast.push(
        made.rows > 0
          ? `Made "${made.label}" with the values of ${made.rows} ${made.rows === 1 ? "row" : "rows"}.`
          : `Made "${made.label}".`,
      );
    },
    onError: (err, v) => toast.push(`Couldn't copy ${v.label}: ${message(err)}`),
  });
}

/** A property's settings (number format, ID prefix, formula): the whole
 *  config, checked by guard_property_config. Shows at once. */
export function useSetPropertyConfig() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { id: string; config: Record<string, unknown> }) => {
      const { error } = await supabase.from("property_defs").update({ config: v.config as never }).eq("id", v.id);
      if (error) throw error;
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.propDefs(ws) });
      const snap = qc.getQueryData<PropDef[]>(qk.propDefs(ws));
      if (snap) {
        qc.setQueryData<PropDef[]>(
          qk.propDefs(ws),
          snap.map((d) => (d.id === v.id ? { ...d, config: v.config as never } : d)),
        );
      }
      return { snap };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snap) qc.setQueryData(qk.propDefs(ws), ctx.snap);
      toast.push(`Couldn't change the property: ${message(err)}`);
    },
    onSettled: () => refresh(qc, ws),
  });
}

export function useSetOptionGroup() {
  return useOptionEdit<{ id: string; value: string; group: "todo" | "doing" | "done" }>(
    (v) => supabase.rpc("set_property_option_group", { p_def: v.id, p_value: v.value, p_group: v.group }),
    (opts, v) => opts.map((o) => (o.value === v.value ? ({ ...o, group: v.group } as OptionRow) : o)),
    "Couldn't change the group",
  );
}

/** Change a property's type with its values (change_property_type): every
 *  value that reads in the new type is kept, the rest cleared; the old
 *  values are kept so the change can be undone for an hour. */
export function useChangePropertyType() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  return useMutation({
    mutationFn: async (v: { id: string; type: PropertyType }) => {
      const { data, error } = await supabase.rpc("change_property_type", { p_def: v.id, p_type: v.type });
      if (error) throw new Error(message(error));
      return (data ?? {}) as { change_id?: string | null; converted?: number; cleared?: number };
    },
    onSettled: () => {
      refresh(qc, ws);
      void qc.invalidateQueries({ queryKey: qk.pages(ws) });
    },
  });
}

export function useUndoPropertyTypeChange() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (changeId: string) => {
      const { error } = await supabase.rpc("undo_property_type_change", { p_change: changeId });
      if (error) throw error;
    },
    onError: (err) => toast.push(`Couldn't undo: ${message(err)}`),
    onSettled: () => {
      refresh(qc, ws);
      void qc.invalidateQueries({ queryKey: qk.pages(ws) });
    },
  });
}
