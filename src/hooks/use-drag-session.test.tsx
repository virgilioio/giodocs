// @vitest-environment happy-dom
/* Behavioural tests for the shared drag primitive.
 *
 * happy-dom measures nothing, so geometry (ghost position, autoscroll ramp)
 * is not assertable here — that is what drag-scroll.test.ts covers as pure
 * arithmetic and what the browser retest covers for feel. What IS observable
 * is the session's contract: when a press becomes a drag, whether commit
 * fires, and that nothing is left behind. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { useDragSession } from "./use-drag-session";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

type Opts = Parameters<typeof useDragSession<number, string>>[0];

const Harness = (props: { opts: Opts; onState?: (s: { active: boolean }) => void }) => {
  const drag = useDragSession<number, string>(props.opts);
  props.onState?.({ active: drag.active });
  return (
    <button type="button" data-testid="h" onPointerDown={(e) => drag.begin(e, "p")}>
      handle
    </button>
  );
};

const mount = (opts: Opts, onState?: (s: { active: boolean }) => void) => {
  root = createRoot(host);
  act(() => {
    root.render(<Harness opts={opts} onState={onState} />);
  });
  return document.querySelector('[data-testid="h"]')! as HTMLElement;
};

const pointer = (el: EventTarget, type: string, x = 0, y = 0) => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  act(() => {
    el.dispatchEvent(ev);
  });
};

const key = (k: string) => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
};

const base = (over: Partial<Opts> = {}): Opts => ({
  hitTest: (pt) => Math.round(pt.x / 10),
  commit: vi.fn(),
  ...over,
});

describe("useDragSession", () => {
  it("a sub-threshold press commits nothing and never goes active", () => {
    const commit = vi.fn();
    const states: boolean[] = [];
    const el = mount(base({ commit }), (s) => states.push(s.active));
    pointer(el, "pointerdown", 0, 0);
    pointer(el, "pointermove", 2, 1);
    pointer(el, "pointerup", 2, 1);
    expect(commit).not.toHaveBeenCalled();
    expect(states.every((a) => a === false)).toBe(true);
  });

  it("a past-threshold move reports active and commits exactly once on drop", () => {
    const commit = vi.fn();
    let active = false;
    const el = mount(base({ commit }), (s) => {
      active = s.active;
    });
    pointer(el, "pointerdown", 0, 0);
    pointer(el, "pointermove", 50, 0);
    expect(active).toBe(true);
    pointer(el, "pointerup", 50, 0);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(5, "p");
  });

  it("Escape mid-drag commits nothing", () => {
    const commit = vi.fn();
    const el = mount(base({ commit }));
    pointer(el, "pointerdown", 0, 0);
    pointer(el, "pointermove", 50, 0);
    key("Escape");
    pointer(el, "pointerup", 50, 0);
    expect(commit).not.toHaveBeenCalled();
  });

  it("pointercancel commits nothing", () => {
    const commit = vi.fn();
    const el = mount(base({ commit }));
    pointer(el, "pointerdown", 0, 0);
    pointer(el, "pointermove", 50, 0);
    pointer(el, "pointercancel", 50, 0);
    pointer(el, "pointerup", 50, 0);
    expect(commit).not.toHaveBeenCalled();
  });

  it("swallows exactly one click after a real drag, then stops", () => {
    const onClick = vi.fn();
    const el = mount(base());
    el.addEventListener("click", onClick);
    pointer(el, "pointerdown", 0, 0);
    pointer(el, "pointermove", 50, 0);
    pointer(el, "pointerup", 50, 0);
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClick).not.toHaveBeenCalled();
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("mounts a ghost clone and removes it on unmount mid-drag", () => {
    const el = mount(
      base({
        makeGhost: () => {
          const g = document.createElement("div");
          g.setAttribute("data-ghost", "1");
          return g;
        },
      }),
    );
    pointer(el, "pointerdown", 0, 0);
    pointer(el, "pointermove", 50, 0);
    expect(document.querySelectorAll("[data-ghost]").length).toBe(1);
    act(() => {
      root.unmount();
    });
    expect(document.querySelectorAll("[data-ghost]").length).toBe(0);
    expect(document.body.style.userSelect).toBe("");
  });
});
