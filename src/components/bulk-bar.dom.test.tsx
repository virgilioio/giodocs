// @vitest-environment happy-dom
/* The bulk bar's delete and archive come with one Undo for every page
 * (2026-10-30; bulk delete had none before). Drives the real BulkBar:
 * Actions ⌄ → Delete N pages → confirm, then the toast's Undo. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { BulkBar, type BulkActions } from "./bulk-bar";
import type { PageListItem } from "@/lib/types";

vi.mock("@/lib/workspace-context", () => ({ useWorkspaceId: () => "ws1" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const page = (id: string, title: string) =>
  ({
    id,
    title,
    icon: "",
    props: {},
    verified_at: "2026-10-01T00:00:00Z",
    verified_by: null,
    edited_at: "2026-10-01T00:00:00Z",
    edited_by: null,
    access_type: "workspace",
  }) as unknown as PageListItem;

const pages = [page("a", "Alpha"), page("b", "Bravo"), page("c", "Charlie")];

let host: HTMLDivElement;
let root: Root;
let undo: (() => void) | undefined;
let actions: BulkActions;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  undo = undefined;
  actions = {
    staleDays: 90,
    meId: "me",
    verify: vi.fn(),
    setValue: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    deletePages: vi.fn(),
    restorePages: vi.fn(),
    toast: vi.fn((_m: string, u?: () => void) => {
      undo = u;
    }),
  };
  root = createRoot(host);
  act(() =>
    root.render(
      <BulkBar
        pages={pages}
        selectedIds={["a", "c"]}
        propDefs={[]}
        members={[]}
        views={[]}
        actions={actions}
        onClear={() => {}}
      />,
    ),
  );
});

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("not found");
  act(() => (el as HTMLElement).click());
};
const byText = (t: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t));

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("BulkBar", () => {
  it("Delete takes one Undo that restores every deleted row as it was", async () => {
    click(byText("Actions"));
    click(byText("Delete 2 pages"));
    click([...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Delete 2 pages").pop());
    await flush();
    expect(actions.deletePages).toHaveBeenCalledWith(["a", "c"]);
    expect(undo).toBeTypeOf("function");
    undo!();
    expect(actions.restorePages).toHaveBeenCalledWith([pages[0], pages[2]]);
  });

  it("Archive takes an Undo that unarchives them", async () => {
    click(byText("Actions"));
    click(byText("Archive"));
    await flush();
    expect(actions.archive).toHaveBeenCalledWith(["a", "c"]);
    undo!();
    expect(actions.unarchive).toHaveBeenCalledWith(["a", "c"]);
  });
});
