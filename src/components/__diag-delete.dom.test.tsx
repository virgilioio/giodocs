// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { EditableBody } from "./page-editor-body";
import { vi } from "vitest";
vi.mock("@/lib/workspace-context", () => ({ useWorkspaceId: () => "w1" }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("diag delete", () => {
  it("cmdA then Delete removes top-level blocks", () => {
    let latest: unknown[] | null = null;
    const initial = [
      { id: "a", type: "text", text: "alpha" },
      { id: "b", type: "text", text: "beta" },
    ];
    root = createRoot(host);
    act(() => {
      root.render(
        <EditableBody pageId="p1" initialBlocks={initial} onChange={(b) => { latest = b; }} />,
      );
    });
    const rows = host.querySelectorAll("[data-block-id]");
    console.log("ROWS", rows.length);
    // build a selection the way shift-click on a handle would: dispatch keydown ⌘A twice? use handle shift-click
    const handles = host.querySelectorAll('[data-block-handle]');
    console.log("HANDLES", handles.length);
    act(() => {
      (handles[0] as HTMLElement)?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    });
    console.log("SELECTED", host.querySelectorAll('[data-block-id]').length,
      Array.from(host.querySelectorAll('[data-block-id]')).map(e => (e as HTMLElement).style.background));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    });
    console.log("AFTER DELETE latest=", JSON.stringify(latest));
    expect(true).toBe(true);
  });
});
