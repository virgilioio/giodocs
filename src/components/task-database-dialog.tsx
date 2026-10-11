/**
 * "Turn into task database": which of a database's properties says a task
 * is done, who it's assigned to and when it's due. Its open rows then show
 * in My tasks on Home for the people they're assigned to. A missing kind
 * can be added from the picker; the rules live in guard_task_config.
 */

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { exitOnly } from "@/lib/exit-motion";
import { useRowMenu, RowMenuList, type RowMenuItem } from "./row-menu";
import { useToast } from "@/lib/toast";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useAddPropertyOption, useCreateProperty } from "@/hooks/use-property-mutations";
import { useSetTaskConfig } from "@/hooks/use-tasks";
import {
  DONE_TYPES,
  optionList,
  readTaskConfig,
  suggestDoneValues,
  suggestTaskConfig,
  type TaskConfig,
  type TaskDefLike,
} from "@/lib/tasks";
import { kindLabel, type PropertyType } from "@/lib/property-kinds";

type Slot = "done" | "assignee" | "due";
const NEW = "__new__";

const SLOTS: Record<Slot, { label: string; types: readonly string[]; newLabel: string; newType: PropertyType; help: string }> = {
  done: {
    label: "Done when",
    types: DONE_TYPES,
    newLabel: "Status",
    newType: "status",
    help: "A status, select or checkbox.",
  },
  assignee: {
    label: "Assigned to",
    types: ["person"],
    newLabel: "Assignee",
    newType: "person",
    help: "A person property.",
  },
  due: {
    label: "Due",
    types: ["date"],
    newLabel: "Due date",
    newType: "date",
    help: "A date property.",
  },
};

/** The options a new Status starts with; the last one means done. */
const NEW_STATUS_OPTIONS = ["Not started", "In progress", "Done"];

type Def = TaskDefLike & { id: string; position?: number | null };

export function TaskDatabaseDialog({
  databaseId,
  title,
  onClose,
}: {
  databaseId: string;
  title: string;
  onClose: () => void;
}) {
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const menu = useRowMenu();
  const toast = useToast();
  const createProperty = useCreateProperty();
  const addOption = useAddPropertyOption();
  const setConfig = useSetTaskConfig();

  const defs = useMemo(
    () =>
      ((shell.propDefs.data ?? []) as unknown as Def[])
        .filter((d) => d.database_id === databaseId && !d.archived_at)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [shell.propDefs.data, databaseId],
  );
  const current = useMemo(() => {
    const p = (shell.pages.data ?? []).find((x) => x.id === databaseId);
    return readTaskConfig(p?.task_config);
  }, [shell.pages.data, databaseId]);

  const [pickedState, setPicked] = useState<Record<Slot, string> | null>(null);
  const [doneValuesState, setDoneValues] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Start from what's set, else a guess from the database's properties.
  const initial = useMemo(() => {
    if (current) {
      return {
        picked: { done: current.done, assignee: current.assignee, due: current.due },
        doneValues: current.done_values ?? [],
      };
    }
    const g = suggestTaskConfig(databaseId, defs);
    return {
      picked: { done: g.done ?? NEW, assignee: g.assignee ?? NEW, due: g.due ?? NEW },
      doneValues: g.done_values,
    };
  }, [current, databaseId, defs]);
  const picked = pickedState ?? initial.picked;
  const doneValues = doneValuesState ?? initial.doneValues;

  const doneDef = defs.find((d) => d.key === picked.done);
  const doneOptions = doneDef && doneDef.type !== "checkbox" ? optionList(doneDef) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || menu.isOpen || busy) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu.isOpen, busy, onClose]);

  const btns = {
    done: useRef<HTMLButtonElement>(null),
    assignee: useRef<HTMLButtonElement>(null),
    due: useRef<HTMLButtonElement>(null),
  };

  const choose = (slot: Slot, key: string) => {
    setErr(null);
    setPicked({ ...picked, [slot]: key });
    if (slot === "done") {
      const d = defs.find((x) => x.key === key);
      setDoneValues(d && d.type !== "checkbox" ? suggestDoneValues(d) : []);
    }
  };

  const openPicker = (slot: Slot) => {
    const el = btns[slot].current;
    if (!el) return;
    const spec = SLOTS[slot];
    const fit = defs.filter((d) => spec.types.includes(d.type));
    const items: RowMenuItem[] = [
      ...fit.map<RowMenuItem>((d) => ({
        id: d.key,
        label: d.label || d.key,
        hint: kindLabel(d.type as PropertyType),
        check: picked[slot] === d.key,
        onSelect: () => choose(slot, d.key),
      })),
      ...(fit.length ? [{ kind: "divider" as const }] : []),
      {
        id: NEW,
        label: `New property: ${spec.newLabel}`,
        check: picked[slot] === NEW,
        onSelect: () => choose(slot, NEW),
      },
    ];
    menu.open(el, <RowMenuList title={spec.label} items={items} />, { width: 260 });
  };

  const nameOf = (slot: Slot) => {
    const k = picked[slot];
    if (k === NEW) return `New: ${SLOTS[slot].newLabel}`;
    return defs.find((d) => d.key === k)?.label || "Choose…";
  };

  const save = async () => {
    if (busy) return;
    if (doneDef && doneDef.type !== "checkbox" && doneOptions.length > 0 && doneValues.length === 0) {
      setErr("Pick at least one option that means done.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const keys = { ...picked };
      let values = doneValues;
      for (const slot of ["done", "assignee", "due"] as Slot[]) {
        if (keys[slot] !== NEW) continue;
        const spec = SLOTS[slot];
        const made = await createProperty.mutateAsync({
          databaseId,
          label: spec.newLabel,
          type: spec.newType,
        });
        keys[slot] = made.key;
        if (slot === "done") {
          let last = "";
          for (const label of NEW_STATUS_OPTIONS) {
            last = (await addOption.mutateAsync({ id: made.id, label })).value;
          }
          values = [last];
        }
      }
      const doneType = doneDef?.type ?? "status";
      const config: TaskConfig = {
        done: keys.done,
        assignee: keys.assignee,
        due: keys.due,
        ...(doneType === "checkbox" ? {} : { done_values: values }),
      };
      await setConfig.mutateAsync({ databaseId, config });
      toast.push(
        current
          ? `Saved the task settings of "${title}".`
          : `"${title}" is a task database. Its rows assigned to you show in My tasks on Home.`,
      );
      onClose();
    } catch (e) {
      setErr(
        (e as { message?: string })?.message?.replace(/^.*?:\s(?=[A-Z])/, "") ||
          "Couldn't save the task settings. Try again.",
      );
      setBusy(false);
    }
  };

  const stop = async () => {
    if (busy) return;
    setBusy(true);
    const before = current;
    try {
      await setConfig.mutateAsync({ databaseId, config: null });
      toast.push({
        message: `"${title}" is no longer a task database.`,
        action: before
          ? { label: "Undo", onClick: () => setConfig.mutate({ databaseId, config: before }) }
          : undefined,
      });
      onClose();
    } catch {
      setErr("Couldn't change it. Try again.");
      setBusy(false);
    }
  };

  return (
    <>
      <div
        ref={exitOnly("fade")}
        aria-hidden
        className="animate-fadeIn"
        onMouseDown={() => (busy ? undefined : onClose())}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: "var(--z-modal)",
          background: "rgba(13,13,9,.32)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-db-title"
        onMouseDown={(e) => e.stopPropagation()}
        ref={exitOnly("dialog")}
        className="animate-dialogIn"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          translate: "-50% -50%",
          width: 480,
          zIndex: "calc(var(--z-modal) + 1)",
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          borderRadius: 14,
          padding: "22px 24px 18px",
          boxShadow: "0 24px 64px rgba(13,13,9,.22)",
        }}
      >
        <div id="task-db-title" className="font-display text-strong" style={{ fontSize: 21.5, fontWeight: 700, letterSpacing: "-0.04em" }}>
          {current ? "Task database" : "Turn into task database"}
        </div>
        <p className="mt-1 text-meta text-muted">
          Rows of "{title || "Untitled"}" that are assigned to someone show in their My tasks on Home until
          they're done.
        </p>

        <div className="mt-3">
          {(["done", "assignee", "due"] as Slot[]).map((slot, i) => (
            <div key={slot}>
              <div
                className="flex items-center justify-between gap-3"
                style={{ padding: "9px 0", borderBottom: i === 2 ? "none" : "1px solid var(--color-lineSoft)" }}
              >
                <div className="min-w-0">
                  <div className="text-ui text-body">{SLOTS[slot].label}</div>
                  <div className="text-caption text-muted">{SLOTS[slot].help}</div>
                </div>
                <PickerButton
                  ref={btns[slot]}
                  value={nameOf(slot)}
                  ariaLabel={`${SLOTS[slot].label}: ${nameOf(slot)}`}
                  onClick={() => openPicker(slot)}
                />
              </div>
              {slot === "done" && doneOptions.length > 0 ? (
                <div className="pb-2.5" style={{ borderBottom: "1px solid var(--color-lineSoft)" }}>
                  <div className="mb-1.5 text-caption text-muted">Counts as done</div>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Options that count as done">
                    {doneOptions.map((o) => {
                      const on = doneValues.includes(o.value);
                      return (
                        <button
                          key={o.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            setErr(null);
                            setDoneValues(on ? doneValues.filter((v) => v !== o.value) : [...doneValues, o.value]);
                          }}
                          className={`rounded-md border px-2 text-meta ${on ? "border-accent bg-accentTint text-accent" : "border-line bg-surface text-secondary hover:bg-sunken"}`}
                          style={{ height: 26 }}
                        >
                          {on ? "✓ " : ""}
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {slot === "done" && picked.done === NEW ? (
                <p className="pb-2.5 text-caption text-muted" style={{ borderBottom: "1px solid var(--color-lineSoft)" }}>
                  A new Status with Not started, In progress and Done. Done counts as done.
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <p role="alert" className="text-meta text-danger" style={{ minHeight: 18, marginTop: 6 }}>
          {err ?? ""}
        </p>

        <div className="mt-2 flex items-center gap-2">
          {current ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void stop()}
              className="rounded-lg px-2.5 text-meta text-muted hover:bg-sunken hover:text-strong"
              style={{ height: 30 }}
            >
              Stop using as task database
            </button>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-line bg-surface px-3 text-meta font-bold text-body"
            style={{ height: 30 }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-lg bg-btn px-3 text-meta font-bold text-btnFg"
            style={{ height: 30, minWidth: 72, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "Saving…" : current ? "Save" : "Turn on"}
          </button>
        </div>
      </div>
    </>
  );
}

const PickerButton = forwardRef<HTMLButtonElement, { value: string; ariaLabel: string; onClick: () => void }>(
  function PickerButton({ value, ariaLabel, onClick }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        className="flex shrink-0 items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 text-ui text-body hover:bg-sunken"
        style={{ width: 190, height: 32 }}
      >
        <span className="min-w-0 truncate">{value}</span>
        <span aria-hidden className="text-whisper">
          ▾
        </span>
      </button>
    );
  },
);
