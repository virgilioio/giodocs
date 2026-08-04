// @vitest-environment happy-dom
/* Rendering tests for the file block.
 *
 * The two states (dashed empty target, filled card) and the ONE judgement
 * that carries product meaning: Open appears for a .pdf and does not
 * appear for a .docx, because clicking Open on a .docx would silently
 * become a download.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { FileBlock } from "./file-block";
import { PageImageCtx } from "./image-block";
import type { Blk } from "@/lib/block-ops";

vi.mock("@/lib/images", () => ({
  signPath: vi.fn(async (p: string) => `https://signed.example/${p}`),
  uploadFile: vi.fn(async () => "ws/pg/files/u.pdf"),
  gcImagePaths: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ profile: { full_name: "Priya" } }) }));
vi.mock("@/lib/format", () => ({ useFormatDate: () => () => "4d ago" }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

const mount = (block: Blk) => {
  root = createRoot(host);
  act(() => {
    root.render(
      <FileBlock block={block} locked={false} onChange={() => {}} onDelete={() => {}} />,
    );
  });
};

const titles = () =>
  Array.from(host.querySelectorAll("button")).map((b) => b.getAttribute("title"));

describe("file block", () => {
  it("renders the dashed empty target with both lines", () => {
    mount({ id: "a", type: "file" } as Blk);
    expect(host.textContent).toContain("Attach a file");
    expect(host.textContent).toContain("Drop it here, or click to browse.");
    expect(host.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("renders a filled card with name, badge and meta line", () => {
    mount({
      id: "a",
      type: "file",
      path: "ws/pg/files/u.pdf",
      fname: "Dash concepts — round 2.pdf",
      fsize: 2.3 * 1024 * 1024,
      fmime: "application/pdf",
      fby: "Priya",
      fat: "2026-08-01T00:00:00.000Z",
    } as unknown as Blk);
    expect(host.textContent).toContain("Dash concepts — round 2.pdf");
    expect(host.textContent).toContain("PDF");
    expect(host.textContent).toContain("2.3 MB · added by Priya · 4d ago");
  });

  it("offers Open for a pdf and withholds it for a docx", () => {
    mount({
      id: "a",
      type: "file",
      path: "ws/pg/files/u.pdf",
      fname: "a.pdf",
      fsize: 10,
    } as unknown as Blk);
    expect(titles()).toContain("Open");
    act(() => root.unmount());

    mount({
      id: "b",
      type: "file",
      path: "ws/pg/files/u.docx",
      fname: "a.docx",
      fsize: 10,
    } as unknown as Blk);
    expect(titles()).not.toContain("Open");
    expect(titles()).toContain("Download");
  });
});

/* The regression that showed as "0 bites": the patch that lands when the
 * upload finishes must carry the metadata itself, because it merges into
 * whatever the block list is a network round-trip later. */
describe("upload completion patch", () => {
  it("repeats name, size and type alongside the path", async () => {
    const patches: Partial<Blk>[] = [];
    root = createRoot(host);
    act(() => {
      root.render(
        <PageImageCtx.Provider value={{ workspaceId: "ws", pageId: "pg" }}>
          <FileBlock
            block={{ id: "a", type: "file" } as Blk}
            locked={false}
            onChange={(p) => patches.push(p)}
            onDelete={() => {}}
          />
        </PageImageCtx.Provider>,
      );
    });
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello there"], "notes.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(patches.length).toBe(2);
    const final = patches[1] as Record<string, unknown>;
    expect(final.path).toBe("ws/pg/files/u.pdf");
    expect(final.fname).toBe("notes.pdf");
    expect(final.fsize).toBe(file.size);
    expect(final.fmime).toBe("application/pdf");
  });
});
