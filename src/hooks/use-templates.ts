import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { useToast } from "@/lib/toast";
import { useWorkspaceId } from "@/lib/workspace-context";
import { cloneBlocksFresh, mergeTemplateProps, pathForPage, retargetBlockPaths } from "@/lib/template-copy";
import { collectImagePaths } from "@/lib/image-ops";
import { IMAGE_BUCKET } from "@/lib/image-ops";
import { useNavigate } from "@tanstack/react-router";
import { useCreatePage } from "./use-page-mutations";
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

/** Copy the template's images and files into the new page's own folder,
 *  so everyone who can open the new page sees them (storage access follows
 *  the page a file sits under). A file that can't be copied keeps pointing
 *  at the template's: still visible to people who can open the template. */
async function copyTemplateFiles(blocks: unknown[], pageId: string): Promise<unknown[]> {
  const paths = [...new Set(collectImagePaths(blocks as never))];
  const map = new Map<string, string>();
  await Promise.all(
    paths.map(async (from) => {
      const to = pathForPage(from, pageId);
      if (!to) return;
      const { error } = await supabase.storage.from(IMAGE_BUCKET).copy(from, to);
      if (!error) map.set(from, to);
    }),
  );
  return map.size ? retargetBlockPaths(blocks, map) : blocks;
}

/** Fill a blank page from a template: its blocks (with new ids, and its
 *  images copied over), icon and title, and its properties under the ones
 *  the page already has. */
export async function applyTemplate(
  pageId: string,
  templateId: string,
  current: { title: string; props: unknown },
): Promise<AppliedPage> {
  const tpl = await fetchTemplateContent(templateId);
  const blocks = await copyTemplateFiles(cloneBlocksFresh(tpl.blocks), pageId);
  const patch = {
    blocks: blocks as never,
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

/** Start a new page from a template and open it. The page is made first
 *  (its images can only be copied under a page that exists), then filled. */
export function useNewPageFromTemplate() {
  const create = useCreatePage();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  return async (templateId: string) => {
    try {
      const tpl = await fetchTemplateContent(templateId);
      const created = await create.mutateAsync({
        seedProps: mergeTemplateProps({}, tpl.props),
        title: tpl.title,
        icon: tpl.icon || "📄",
      });
      const row = await applyTemplate(created.id, templateId, { title: tpl.title, props: created.props });
      qc.setQueryData<PageFull | null>(qk.page(created.id), (prev) =>
        prev
          ? ({
              ...prev,
              title: row.title,
              icon: row.icon ?? prev.icon,
              props: row.props,
              blocks: row.blocks as unknown as PageFull["blocks"],
              edited_at: row.edited_at,
              edited_by: row.edited_by,
            } as PageFull)
          : prev,
      );
      await navigate({ to: "/p/$pageId", params: { pageId: created.id } });
    } catch {
      toast.push("Couldn't start a page from that template. Try again.");
    }
  };
}
