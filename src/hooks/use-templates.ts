import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useToast } from "@/lib/toast";
import { useWorkspaceId } from "@/lib/workspace-context";
import { cloneBlocksFresh, mergeTemplateProps } from "@/lib/template-copy";
import { useCreatePageAndOpen } from "./use-page-mutations";
import type { Block, PageFull } from "@/lib/types";

/* Templates: making a page one (or not), and starting pages from them.
 * A template is an ordinary page with template_at set; see the
 * page_templates migration. */

type TemplateContent = { title: string; icon: string | null; props: unknown; blocks: unknown };

async function fetchTemplateContent(templateId: string): Promise<TemplateContent> {
  const { data, error } = await supabase
    .from("pages")
    .select("title, icon, props, blocks")
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That template is no longer there.");
  return data as TemplateContent;
}

export function useSetTemplate() {
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const toast = useToast();
  const m = useMutation({
    mutationFn: async (v: { pageId: string; title: string; on: boolean; quiet?: boolean }) => {
      const at = v.on ? new Date().toISOString() : null;
      const { error } = await supabase.from("pages").update({ template_at: at }).eq("id", v.pageId);
      if (error) throw error;
      return { ...v, at };
    },
    onSuccess: (v) => {
      qc.setQueryData<PageFull | null>(qk.page(v.pageId), (prev) => (prev ? { ...prev, template_at: v.at } : prev));
      void qc.invalidateQueries({ queryKey: qk.pages(ws) });
      void qc.invalidateQueries({ queryKey: qk.templates(ws) });
      if (v.quiet) return;
      const name = v.title.trim() || "Untitled";
      toast.push({
        message: v.on
          ? `“${name}” is a template now. New pages can start from it.`
          : `“${name}” is an ordinary page again.`,
        action: { label: "Undo", onClick: () => m.mutate({ ...v, on: !v.on, quiet: true }) },
      });
    },
    onError: (err) => {
      const msg = (err as { message?: string })?.message ?? "";
      toast.push(
        /row-level security|permission|42501/i.test(msg)
          ? "Only people who can edit this page can change that."
          : "Couldn't change that. Try again.",
      );
    },
  });
  return m;
}

export type AppliedPage = {
  title: string;
  icon: string | null;
  props: PageFull["props"];
  blocks: Block[];
  edited_at: string;
  edited_by: string | null;
};

/** Fill a blank page from a template: its blocks (with new ids), icon and
 *  title, and its properties under the ones the page already has. */
export async function applyTemplate(
  pageId: string,
  templateId: string,
  current: { title: string; props: unknown },
): Promise<AppliedPage> {
  const tpl = await fetchTemplateContent(templateId);
  const patch = {
    blocks: cloneBlocksFresh(tpl.blocks) as never,
    icon: tpl.icon || "📄",
    title: current.title.trim() ? current.title : tpl.title,
    props: mergeTemplateProps(current.props, tpl.props) as never,
  };
  const { error } = await supabase.from("pages").update(patch).eq("id", pageId);
  if (error) throw error;
  const { data, error: e2 } = await supabase
    .from("pages")
    .select("title, icon, props, blocks, edited_at, edited_by")
    .eq("id", pageId)
    .single();
  if (e2) throw e2;
  return {
    ...(data as Omit<AppliedPage, "blocks">),
    blocks: (Array.isArray(data.blocks) ? data.blocks : []) as unknown as Block[],
  };
}

/** Start a new page from a template and open it. */
export function useNewPageFromTemplate() {
  const createAndOpen = useCreatePageAndOpen();
  const toast = useToast();
  return async (templateId: string) => {
    try {
      const tpl = await fetchTemplateContent(templateId);
      await createAndOpen({
        seedProps: mergeTemplateProps({}, tpl.props),
        blocks: cloneBlocksFresh(tpl.blocks),
        title: tpl.title,
        icon: tpl.icon || "📄",
      });
    } catch {
      toast.push("Couldn't start a page from that template. Try again.");
    }
  };
}
