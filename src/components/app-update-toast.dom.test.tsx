// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableJavaScriptFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
/* The new-version toast's contract (Gio ATS's, Allan 2026-10-19): it shows
 * only when the page served now names a different entry script than the one
 * this tab loaded, Later hides it for that version only, and a newer deploy
 * brings it back. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { AppUpdateToast } from "./app-update-toast";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let deployed = "/assets/index-OLD.js";

const page = (entry: string) =>
  `<!doctype html><html><head></head><body><script type="module" async="" src="${entry}"></script></body></html>`;

const toast = () => document.querySelector("[data-update-toast]");

async function check() {
  // The first check runs 30s after load; a visible tab checks again at once.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  const s = document.createElement("script");
  s.type = "module";
  s.src = "/assets/index-OLD.js";
  document.head.appendChild(s);
  deployed = "/assets/index-OLD.js";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(page(deployed), { status: 200 })),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<AppUpdateToast />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AppUpdateToast", () => {
  it("stays away while the deployed entry is the one this tab runs", async () => {
    await check();
    expect(toast()).toBeNull();
  });

  it("shows Gio ATS's copy and buttons after a deploy", async () => {
    deployed = "/assets/index-NEW.js";
    await check();
    const el = toast();
    expect(el?.textContent).toContain("A new version of Gio Docs");
    expect(el?.textContent).toContain("Refresh to load it. Save what you’re typing first.");
    const labels = [...(el?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
    expect(labels).toEqual(["Later", "Refresh"]);
  });

  it("Later hides it for that version only; a newer deploy shows it again", async () => {
    deployed = "/assets/index-NEW.js";
    await check();
    const later = [...document.querySelectorAll("[data-update-toast] button")].find(
      (b) => b.textContent === "Later",
    ) as HTMLButtonElement;
    act(() => later.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(toast()).toBeNull();
    expect(sessionStorage.getItem("gio.update.dismissed")).toBe("/assets/index-NEW.js");

    // The same version on the next check stays hidden …
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(toast()).toBeNull();

    // … a newer one comes back.
    deployed = "/assets/index-NEWER.js";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(toast()?.textContent).toContain("A new version of Gio Docs");
  });
});
