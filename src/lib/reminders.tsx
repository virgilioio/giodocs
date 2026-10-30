import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { qk } from "@/lib/query-keys";
import { useToast } from "@/lib/toast";

/* Date reminders (C5, Allan 2026-10-30). A reminder belongs to whoever set
 * it and names a page's date property and when to remind, relative to the
 * date: date_reminders holds it, set_date_reminder sets or clears it, and
 * deliver_date_reminders (every minute, pg_cron) files due ones in the
 * Inbox of the person who set it and, in a task database, the row's
 * assignee. Moving the date moves its reminder; a finished row doesn't
 * remind. */

export const REMIND_CODES = [
  "at",
  "m5",
  "m10",
  "m15",
  "m30",
  "h1",
  "h2",
  "d0",
  "d1",
  "d2",
  "w1",
] as const;
export type RemindCode = (typeof REMIND_CODES)[number];

const TIMED_CHOICES: Array<{ code: RemindCode; label: string }> = [
  { code: "at", label: "At time of event" },
  { code: "m5", label: "5 minutes before" },
  { code: "m10", label: "10 minutes before" },
  { code: "m15", label: "15 minutes before" },
  { code: "m30", label: "30 minutes before" },
  { code: "h1", label: "1 hour before" },
  { code: "h2", label: "2 hours before" },
  { code: "d1", label: "1 day before" },
  { code: "d2", label: "2 days before" },
];
const DAY_CHOICES: Array<{ code: RemindCode; label: string }> = [
  { code: "d0", label: "On the day (9:00 AM)" },
  { code: "d1", label: "1 day before (9:00 AM)" },
  { code: "d2", label: "2 days before (9:00 AM)" },
  { code: "w1", label: "1 week before (9:00 AM)" },
];

/** The choices for a date with a time, or for a day. */
export function remindChoices(timed: boolean): Array<{ code: RemindCode; label: string }> {
  return timed ? TIMED_CHOICES : DAY_CHOICES;
}

export function remindLabel(code: RemindCode, timed: boolean): string {
  return (
    remindChoices(timed).find((c) => c.code === code)?.label ??
    [...TIMED_CHOICES, ...DAY_CHOICES].find((c) => c.code === code)?.label ??
    code
  );
}

type Row = { page_id: string; prop_key: string; remind: RemindCode | null };
type Result<T> = { data: T | null; error: { message: string } | null };
// date_reminders and set_date_reminder join the generated types when the
// migration is applied; until then this is their shape.
const db = supabase as unknown as {
  from: (table: "date_reminders") => {
    select: (cols: string) => {
      not: (col: string, op: "is", v: null) => PromiseLike<Result<Row[]>>;
    };
  };
  rpc: (
    fn: "set_date_reminder",
    args: Record<string, unknown>,
  ) => PromiseLike<Result<string | null>>;
};

const keyOf = (pageId: string, propKey: string) => `${pageId}\u0000${propKey}`;

/** My reminders, by page and property. Empty until they load, or if they
 *  can't be read. */
export function useMyReminders(): ReadonlyMap<string, RemindCode> {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: qk.dateReminders(user?.id ?? ""),
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await db
        .from("date_reminders")
        .select("page_id,prop_key,remind")
        .not("remind", "is", null);
      return error ? [] : (data ?? []);
    },
  });
  return useMemo(
    () =>
      new Map(
        (q.data ?? [])
          .filter((r) => r.remind)
          .map((r) => [keyOf(r.page_id, r.prop_key), r.remind!]),
      ),
    [q.data],
  );
}

/** One date's reminder: mine, and how to change it. */
export function useDateReminder(pageId: string, propKey: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const mine = useMyReminders();
  const key = qk.dateReminders(user?.id ?? "");
  const set = useMutation({
    mutationFn: async (remind: RemindCode | null) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const { error } = await db.rpc("set_date_reminder", {
        p_page: pageId,
        p_key: propKey,
        p_remind: remind,
        p_tz: tz,
      });
      if (error) throw new Error(error.message);
    },
    onMutate: async (remind) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<Row[]>(key);
      const rest = (before ?? []).filter((r) => !(r.page_id === pageId && r.prop_key === propKey));
      qc.setQueryData<Row[]>(
        key,
        remind ? [...rest, { page_id: pageId, prop_key: propKey, remind }] : rest,
      );
      return { before };
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(key, ctx?.before);
      toast.push("Couldn’t set the reminder. Try again in a moment.");
    },
    onSuccess: (_d, remind) => {
      if (remind) toast.push("Reminder set. It arrives in your Inbox.");
    },
  });
  return {
    value: mine.get(keyOf(pageId, propKey)) ?? null,
    onChange: (r: RemindCode | null) => set.mutate(r),
  };
}
