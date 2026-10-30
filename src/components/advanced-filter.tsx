import { useEffect, useRef, useState, type ReactNode } from "react";
import { MenuFoot, MenuHead, MenuSep } from "./menu-parts";
import { groupFilters, isFilterGroup, type Filter } from "@/lib/run-view";
import {
  appendTo,
  canNestAt,
  duplicateAt,
  getAt,
  newGroup,
  removeAt,
  setAt,
  setMode,
  turnIntoGroup,
  type FilterPath,
} from "@/lib/filter-tree";

/** The panel's width: rules read in one line beside their word. */
export const ADVANCED_FILTER_WIDTH = 520;

type EditorArgs = {
  /** The rule being changed; absent for a new one. */
  startAt?: Filter;
  onPick: (f: Filter) => void;
  onBack: () => void;
};

type Step = { kind: "list" } | { kind: "edit"; path: FilterPath | null; groupPath: FilterPath };

/**
 * Notion's advanced filter (2026-10-30): rules that combine with And or Or,
 * and groups of rules with their own And or Or, three levels deep. Each
 * rule reads as its chip would ("status is “Done”"); clicking it changes
 * it in place with the same picker as a plain filter (renderEditor), so a
 * rule offers exactly what a filter chip offers. Every change saves at once
 * (onChange); Delete filter takes it away (onChange(null)).
 */
export function AdvancedFilterPanel({
  group,
  onChange,
  labelOf,
  renderEditor,
}: {
  group: Filter;
  onChange: (next: Filter | null) => void;
  labelOf: (f: Filter) => string;
  renderEditor: (args: EditorArgs) => ReactNode;
}) {
  const [step, setStep] = useState<Step>({ kind: "list" });

  if (step.kind === "edit") {
    const current = step.path ? getAt(group, step.path) : null;
    return (
      <>
        {renderEditor({
          startAt: current && !isFilterGroup(current) ? current : undefined,
          onBack: () => setStep({ kind: "list" }),
          onPick: (f) => {
            onChange(step.path ? setAt(group, step.path, f) : appendTo(group, step.groupPath, f));
            setStep({ kind: "list" });
          },
        })}
      </>
    );
  }

  const addRule = (groupPath: FilterPath) => setStep({ kind: "edit", path: null, groupPath });

  return (
    <div data-advanced-filter>
      <MenuHead>Advanced filter</MenuHead>
      <div style={{ padding: "2px 8px 4px" }}>
        <RuleList
          group={group}
          groupPath={[]}
          root={group}
          onChange={(g) => onChange(g)}
          labelOf={labelOf}
          onEdit={(path) => setStep({ kind: "edit", path, groupPath: path.slice(0, -1) })}
          onAddRule={addRule}
        />
      </div>
      <MenuSep />
      <button type="button" className="gio-mrow" data-danger onClick={() => onChange(null)}>
        <span className="truncate">Delete filter</span>
      </button>
      <MenuFoot>
        Rules combine with the word on their left. Other filters beside this one still combine with
        and.
      </MenuFoot>
    </div>
  );
}

function RuleList({
  group,
  groupPath,
  root,
  onChange,
  labelOf,
  onEdit,
  onAddRule,
}: {
  group: Filter;
  groupPath: FilterPath;
  root: Filter;
  onChange: (next: Filter) => void;
  labelOf: (f: Filter) => string;
  onEdit: (path: FilterPath) => void;
  onAddRule: (groupPath: FilterPath) => void;
}) {
  const list = groupFilters(group);
  const mode = group.mode === "or" ? "or" : "and";
  const word = mode === "or" ? "Or" : "And";
  const canAddGroup = canNestAt([...groupPath, 0]);
  return (
    <div className="flex flex-col" style={{ gap: 4 }}>
      {list.length === 0 ? (
        <div className="text-meta text-faint" style={{ padding: "4px 2px" }}>
          No rules yet. Add one below.
        </div>
      ) : null}
      {list.map((f, i) => {
        const path = [...groupPath, i];
        return (
          <div
            key={i}
            data-filter-rule={path.join(".")}
            className="grid items-start"
            style={{ gridTemplateColumns: "64px minmax(0, 1fr) 26px", gap: 6 }}
          >
            <div className="text-meta text-muted" style={{ paddingTop: 5 }}>
              {i === 0 ? (
                "Where"
              ) : i === 1 ? (
                <button
                  type="button"
                  data-filter-mode
                  aria-label={`Rules combine with ${word.toLowerCase()}. Switch to ${mode === "or" ? "and" : "or"}`}
                  onClick={() => onChange(setMode(root, groupPath, mode === "or" ? "and" : "or"))}
                  className="inline-flex items-center rounded-md border border-line text-meta text-body hover:bg-rail"
                  style={{ padding: "1px 6px", gap: 3 }}
                >
                  {word}
                  <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden>
                    <path
                      d="m7 10 5 5 5-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : (
                <span style={{ paddingLeft: 7 }}>{word}</span>
              )}
            </div>
            {isFilterGroup(f) ? (
              <div className="rounded-lg border border-lineSoft bg-sunken" style={{ padding: 6 }}>
                <RuleList
                  group={f}
                  groupPath={path}
                  root={root}
                  onChange={onChange}
                  labelOf={labelOf}
                  onEdit={onEdit}
                  onAddRule={onAddRule}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onEdit(path)}
                className="min-w-0 truncate rounded-md border border-line bg-surface text-left text-meta text-body hover:bg-rail"
                style={{ padding: "4px 8px" }}
              >
                {sentence(labelOf(f))}
              </button>
            )}
            <RuleMenu
              items={[
                { label: "Duplicate", onPick: () => onChange(duplicateAt(root, path)) },
                ...(!isFilterGroup(f) && canNestAt(path)
                  ? [
                      {
                        label: "Turn into group",
                        onPick: () => onChange(turnIntoGroup(root, path)),
                      },
                    ]
                  : []),
                {
                  label: isFilterGroup(f) ? "Delete group" : "Delete rule",
                  danger: true,
                  onPick: () => onChange(removeAt(root, path)),
                },
              ]}
            />
          </div>
        );
      })}
      <div className="flex flex-wrap" style={{ gap: 2, marginTop: 2 }}>
        <AddButton onClick={() => onAddRule(groupPath)}>Add filter rule</AddButton>
        {canAddGroup ? (
          <AddButton onClick={() => onChange(appendTo(root, groupPath, newGroup("and")))}>
            Add filter group
          </AddButton>
        ) : null}
      </div>
    </div>
  );
}

function sentence(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded-md text-meta text-muted hover:bg-rail hover:text-strong"
      style={{ padding: "3px 7px", gap: 5 }}
    >
      <svg viewBox="0 0 10 10" width={10} height={10} aria-hidden>
        <path
          d="M5 1v8 M1 5h8"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>
      {children}
    </button>
  );
}

/** A rule's ⋯: a small menu inside the panel (a second popover would close
 *  the panel it opens from). */
function RuleMenu({
  items,
}: {
  items: Array<{ label: string; onPick: () => void; danger?: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Rule actions"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid place-items-center rounded-md text-faint hover:bg-rail hover:text-strong"
        style={{ width: 26, height: 26 }}
      >
        <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden>
          <path
            d="M6 12h.01M12 12h.01M18 12h.01"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="gio-menu absolute right-0 animate-popIn"
          style={{ top: 28, width: 180, zIndex: 2, transformOrigin: "top right" }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="gio-mrow"
              data-danger={it.danger || undefined}
              onClick={() => {
                setOpen(false);
                it.onPick();
              }}
            >
              <span className="truncate">{it.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
