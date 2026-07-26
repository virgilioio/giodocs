import type { Database } from "@/integrations/supabase/types";

type PageRow = Database["public"]["Tables"]["pages"]["Row"];

export type PageListItem = Pick<
  PageRow,
  | "id"
  | "title"
  | "icon"
  | "props"
  | "verified_at"
  | "verified_by"
  | "edited_at"
  | "edited_by"
  | "access_type"
> & { archived_at: string | null };

export type PageFull = Omit<PageRow, "search_tsv"> & {
  archived_at: string | null;
};

export type Block = {
  id?: string;
  type?: string;
  text?: string;
  body?: string;
  [k: string]: unknown;
};

export type PageAccessRow = {
  page_id: string;
  user_id: string | null;
  guest_email: string | null;
  capability: string;
};
