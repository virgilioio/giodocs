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

/** A new option for a select / status property, coloured from its label. */
export function newOption(label: string, existing: SelectOption[]): SelectOption {
  const clean = label.trim();
  const taken = new Set(existing.map((o) => o.value));
  let value = clean
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "option";
  if (taken.has(value)) {
    let i = 2;
    while (taken.has(`${value}_${i}`)) i++;
    value = `${value}_${i}`;
  }
  const pair = hashTag(clean);
  return { value, label: clean, tint: pair.tint, ink: pair.ink };
}

export function useCreateProperty() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const { user } = useAuth();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { label: string; type: PropertyType }) => {
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
      const key = keyForLabel(label, rows.map((r) => r.key));
      const position = rows.reduce((m, r) => Math.max(m, r.position ?? 0), 0) + 1;
      const { data, error } = await supabase
        .from("property_defs")
        .insert({
          workspace_id: ws,
          key,
          label,
          type: v.type,
          options: [],
          position,
          created_by: user!.id,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as PropDef;
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
      patch: { label?: string; options?: SelectOption[]; type?: PropertyType };
    }) => {
      const patch: Database["public"]["Tables"]["property_defs"]["Update"] = {};
      if (v.patch.label !== undefined) {
        const label = v.patch.label.trim();
        if (!label) throw new Error("A property needs a name.");
        patch.label = label;
      }
      if (v.patch.options !== undefined) patch.options = v.patch.options as never;
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
                ...(v.patch.options !== undefined ? { options: v.patch.options as never } : null),
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
 *  caller can pick it right away. */
export function useAddPropertyOption() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { id: string; label: string }) => {
      // Read the stored list so two people adding options don't erase each
      // other's.
      const { data, error: e1 } = await supabase
        .from("property_defs")
        .select("options")
        .eq("id", v.id)
        .single();
      if (e1) throw e1;
      const current = (Array.isArray(data?.options) ? data!.options : []) as SelectOption[];
      const hit = current.find((o) => o.label.toLowerCase() === v.label.trim().toLowerCase());
      if (hit) return { value: hit.value, options: current };
      const opt = newOption(v.label, current);
      const options = [...current, opt];
      const { error } = await supabase
        .from("property_defs")
        .update({ options: options as never })
        .eq("id", v.id);
      if (error) throw error;
      return { value: opt.value, options };
    },
    onSuccess: (r, v) => {
      const apply = (list?: PropDef[]) =>
        list?.map((d) => (d.id === v.id ? { ...d, options: r.options as never } : d));
      qc.setQueryData<PropDef[]>(qk.propDefs(ws), (prev) => apply(prev));
      qc.setQueryData<PropDef[]>(qk.propDefsAll(ws), (prev) => apply(prev));
    },
    onError: (err) => {
      toast.push(`Couldn't add the option: ${message(err)}`);
    },
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
