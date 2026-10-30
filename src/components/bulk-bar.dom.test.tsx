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
    duplicate: vi.fn(),
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
        propDefs={[
          {
            id: "d1",
            key: "due",
            label: "Due",
            type: "date",
            options: [],
            position: 0,
            archived_at: null,
          } as never,
        ]}
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

  it("Duplicate copies every selected row", async () => {
    click(byText("Actions"));
    click(byText("Duplicate 2 pages"));
    await flush();
    expect(actions.duplicate).toHaveBeenCalledWith(["a", "c"]);
  });

  it("Edit property › a date takes a typed value, refuses one it can't read", async () => {
    click(byText("Actions"));
    click(byText("Edit property"));
    click(byText("Due"));
    const input = document.querySelector<HTMLInputElement>('[role="menu"] input')!;
    const type = (v: string) => {
      act(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        set.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      });
    };
    type("someday");
    await flush();
    expect(actions.setValue).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("Try a date like");
    type("2026-11-03");
    await flush();
    expect(actions.setValue).toHaveBeenCalledWith(
      ["a", "c"],
      expect.objectContaining({ key: "due" }),
      "2026-11-03",
    );
  });
});
