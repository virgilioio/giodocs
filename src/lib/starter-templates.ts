/* Starter templates: a few ready page layouts that ship with Gio Docs, so
 * a new page has somewhere to start even before the team has made its own
 * templates. Built from plain block descriptions; every use gets new ids. */

import { nanoid } from "nanoid";
import type { Blk } from "./markdown-import";

type Spec =
  | [type: "h2" | "text" | "bullet" | "numbered" | "quote", text?: string]
  | [type: "todo", text?: string]
  | [type: "callout", text: string, icon: string]
  | [type: "table", rows: string[][]];

export type Starter = { id: string; name: string; icon: string; hint: string; blocks: Spec[] };

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].flatMap(
  (d): Spec[] => [["h2", d], ["todo"]],
);

export const STARTERS: readonly Starter[] = [
  {
    id: "todo",
    name: "To-do list",
    icon: "✅",
    hint: "Checkboxes for today",
    blocks: [["h2", "Today"], ["todo"], ["todo"], ["todo"], ["h2", "Later"], ["todo"]],
  },
  {
    id: "meeting",
    name: "Meeting notes",
    icon: "📝",
    hint: "Agenda, notes, next steps",
    blocks: [
      ["text", "**Date:** "],
      ["text", "**Attendees:** "],
      ["h2", "Agenda"],
      ["bullet"],
      ["h2", "Notes"],
      ["bullet"],
      ["h2", "Decisions"],
      ["bullet"],
      ["h2", "Next steps"],
      ["todo"],
    ],
  },
  {
    id: "weekly",
    name: "Weekly plan",
    icon: "📅",
    hint: "Priorities and days of the week",
    blocks: [
      ["h2", "This week's priorities"],
      ["numbered"],
      ["numbered"],
      ["numbered"],
      ...days,
      ["h2", "Wins and lessons"],
      ["bullet"],
    ],
  },
  {
    id: "brief",
    name: "Project brief",
    icon: "🎯",
    hint: "Goal, scope, owners, milestones",
    blocks: [
      ["callout", "One paragraph: what this project is and why it matters now.", "💡"],
      ["h2", "Goal"],
      ["text", "What does success look like, and how will we measure it?"],
      ["h2", "Scope"],
      ["bullet", "In: "],
      ["bullet", "Out: "],
      ["h2", "People"],
      ["bullet", "Owner: "],
      ["bullet", "Contributors: "],
      ["h2", "Milestones"],
      ["table", [["Milestone", "Date", "Status"], ["", "", ""], ["", "", ""]]],
      ["h2", "Risks and open questions"],
      ["bullet"],
    ],
  },
];

function build(spec: Spec): Blk {
  const id = nanoid(10);
  switch (spec[0]) {
    case "todo":
      return { id, type: "todo", text: spec[1] ?? "", checked: false } as Blk;
    case "callout":
      return { id, type: "callout", text: spec[1], icon: spec[2] } as Blk;
    case "table":
      return { id, type: "table", text: "", rows: spec[1] } as Blk;
    default:
      return { id, type: spec[0], text: spec[1] ?? "" } as Blk;
  }
}

/** A starter's blocks, with fresh ids every time. */
export function starterBlocks(id: string): Blk[] {
  const s = STARTERS.find((x) => x.id === id);
  return s ? s.blocks.map(build) : [];
}
