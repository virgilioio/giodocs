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
      label: string;
      type: PropertyType;
      /** A relation's or rollup's settings (property_defs.config). */
      config?: Record<string, unknown>;
      /** A two-way relation: its far side, named for the linked pages. */
      backLabel?: string;
    }) => {
      const label = v.label.trim();
      if (!label) throw new Error("Give the property a name.");
      // Keys are workspace-wide and include archived properties.
      const { data: all, error: e1 } = await supabase
        .from("property_defs")
        .select("key, position")
        .eq("workspace_id", ws)
        .limit(300);
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
          key,
          label,
          type: v.type,
          options: [],
          position,
          created_by: user!.id,
          config: (backKey ? { ...(v.config ?? {}), back: backKey } : (v.config ?? {})) as never,
        };
        // A two-way relation's two sides are made in one statement, so
        // neither exists without the other.
        const rows = backKey
          ? [
              row,
              {
                ...row,
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
        taken.push(key);
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
      patch: { label?: string; type?: PropertyType };
    }) => {
      const patch: Database["public"]["Tables"]["property_defs"]["Update"] = {};
      if (v.patch.label !== undefined) {
        const label = v.patch.label.trim();
        if (!label) throw new Error("A property needs a name.");
        patch.label = label;
      }
      if (v.patch.type !== undefined) patch.type = v.patch.type;
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
      const { error } = await supabase
        .from("property_defs")
        .update({ archived_at: v.archived ? new Date().toISOString() : null })
        .eq("id", v.id);
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
