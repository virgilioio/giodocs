import { supabase } from "@/integrations/supabase/client";
import { keepStoredProps } from "@/lib/template-copy";

/** A row's values that its database can still hold (see keepStoredProps),
 *  read against the database's properties as they are now. */
export async function storedPropsFor(props: unknown, databaseId: string | null | undefined) {
  if (!databaseId) return {};
  const { data, error } = await supabase
    .from("property_defs")
    .select("key, type, config, archived_at")
    .eq("database_id", databaseId);
  if (error) throw error;
  return keepStoredProps(props, data ?? []);
}
