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
> & {
  /** Built-in properties (Created time, Created by). Optional so older
   *  cache entries and hand-built items still type-check. */
  created_at?: string | null;
  created_by?: string | null;
  archived_at?: string | null;
  parent_id?: string | null;
  /** The database this page is a row of (its parent, when that's a
   *  database), or null for a plain page. Kept by the database. */
  database_id?: string | null;
  /** A database: its children are its rows. */
  is_database?: boolean;
  /** Order among siblings in the tree (pages.position). */
  position?: number | null;
  /** A task database's settings (src/lib/tasks.ts), or null. */
  task_config?: PageRow["task_config"];
  /** A database: how its rows show their properties (src/lib/page-layout.ts). */
  page_layout?: PageRow["page_layout"];
};

export type PageFull = Omit<PageRow, "search_tsv"> & {
  archived_at?: string | null;
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
