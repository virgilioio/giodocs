import { useCallback, useEffect, useState } from "react";

/**
 * Is a newer Gio Docs deployed than the one running in this tab? Gio ATS's
 * check (2026-10-12), unchanged (Allan, 2026-10-19).
 *
 * The running version is the hashed entry script this page loaded
 * (`/assets/index-<hash>.js`, the root route's script in the TanStack Start
 * manifest); the deployed one is the entry script named in a fresh copy of
 * the page. They differ only after a deploy, so a manual reload never shows
 * a stale "new version", and a deploy that lands in the first seconds after
 * load isn't missed.
 *
 * Checks 30s after load, every 5 minutes while the tab is visible, and right
 * away when the tab comes back into view or back online. Never in dev (no
 * hashed entry). "Later" hides the toast for that version only; a newer
 * deploy shows it again.
 */

const FIRST_CHECK_MS = 30_000;
const CHECK_INTERVAL_MS = 5 * 60_000;
const DISMISSED_KEY = "gio.update.dismissed";

const ENTRY_RE = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+\.js)"/;

function runningEntry(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  if (!el) return null;
  try {
    return new URL(el.src, location.href).pathname;
  } catch {
    return null;
  }
}

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function useAppVersionCheck() {
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  const check = useCallback(async () => {
    const running = runningEntry();
    if (!running || document.visibilityState === "hidden") return;
    try {
      const res = await fetch(`/?_v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const match = (await res.text()).match(ENTRY_RE);
      if (!match) return;
      const deployed = new URL(match[1], location.href).pathname;
      setLatest(deployed !== running ? deployed : null);
    } catch {
      // Offline or a blip: try again on the next tick.
    }
  }, []);

  useEffect(() => {
    if (!runningEntry()) return;
    const first = window.setTimeout(check, FIRST_CHECK_MS);
    const every = window.setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [check]);

  const refresh = useCallback(() => {
    window.location.reload();
  }, []);

  const dismiss = useCallback(() => {
    if (!latest) return;
    try {
      sessionStorage.setItem(DISMISSED_KEY, latest);
    } catch {
      // Private mode: it just stays dismissed for this page view.
    }
    setDismissed(latest);
  }, [latest]);

  return { updateAvailable: !!latest && latest !== dismissed, version: latest, refresh, dismiss };
}

let staleChunkReloadInstalled = false;

/**
 * After a deploy, the old version's lazily loaded screens no longer exist on
 * the server, so opening one would fail. Vite reports that as
 * `vite:preloadError`; load the new version instead (at most once a minute, so
 * a real outage can't loop).
 */
export function installStaleChunkReload() {
  if (staleChunkReloadInstalled) return;
  staleChunkReloadInstalled = true;
  const KEY = "gio.update.chunkReloadAt";
  window.addEventListener("vite:preloadError", (event) => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY) ?? 0);
    } catch {
      // ignore
    }
    if (Date.now() - last < 60_000) return; // let the error surface normally
    event.preventDefault();
    try {
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      // ignore
    }
    window.location.reload();
  });
}
