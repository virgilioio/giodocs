import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useToast } from "@/lib/toast";
import { useWorkspaceId } from "@/lib/workspace-context";

type WorkspacePatch = {
  name?: string;
  icon?: string;
  stale_days?: number;
};

type WorkspaceRow = {
  id: string;
  name: string;
  icon: string;
  slug: string;
  stale_days: number;
  created_at: string;
};

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (patch: WorkspacePatch) => {
      const { error } = await supabase
        .from("workspaces")
        .update(patch as never)
        .eq("id", ws);
      if (error) throw error;
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.workspace(ws) });
      const snap = qc.getQueryData<WorkspaceRow | null>(qk.workspace(ws));
      if (snap) qc.setQueryData(qk.workspace(ws), { ...snap, ...patch });
      return { snap };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.snap) qc.setQueryData(qk.workspace(ws), ctx.snap);
      toast.push(`Couldn't save: ${(err as Error).message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.workspace(ws) }),
  });
}

export function useAddAllowedDomain() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (domain: string) => {
      const clean = domain.trim().toLowerCase().replace(/^@/, "");
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) {
        throw new Error(`"${domain}" doesn't look like a domain.`);
      }
      const { error } = await supabase
        .from("allowed_domains")
        .insert({ workspace_id: ws, domain: clean });
      if (error) throw error;
      return clean;
    },
    onSuccess: (domain) => {
      toast.push(`Added @${domain}`);
      qc.invalidateQueries({ queryKey: ["allowed_domains", ws] });
    },
    onError: (err) => toast.push(`Couldn't add: ${(err as Error).message}`),
  });
}

export function useRemoveAllowedDomain() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (domain: string) => {
      const { error } = await supabase
        .from("allowed_domains")
        .delete()
        .eq("workspace_id", ws)
        .eq("domain", domain);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["allowed_domains", ws] }),
    onError: (err) => toast.push(`Couldn't remove: ${(err as Error).message}`),
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (v: { userId: string; role: "owner" | "member" }) => {
      const { error } = await supabase
        .from("workspace_members")
        .update({ role: v.role } as never)
        .eq("workspace_id", ws)
        .eq("user_id", v.userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.push("Role updated");
      qc.invalidateQueries({ queryKey: qk.members(ws) });
    },
    onError: (err) => toast.push(`Couldn't update role: ${(err as Error).message}`),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("workspace_members")
        .delete()
        .eq("workspace_id", ws)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.push("Removed from workspace");
      qc.invalidateQueries({ queryKey: qk.members(ws) });
    },
    onError: (err) => toast.push(`Couldn't remove: ${(err as Error).message}`),
  });
}
