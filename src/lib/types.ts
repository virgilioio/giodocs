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
>;

export type PageFull = PageRow;
