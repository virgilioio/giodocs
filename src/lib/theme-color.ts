/* The browser's own chrome (status bar, address bar tint) matches the page
 * (2026-10-11). theme-color follows the body's background, which is surface
 * on phones and canvas on larger screens, in light and dark. It is read from
 * the computed style, so the colour lives only in the tokens. */

const PHONE = "(max-width: 767.98px)";

export function installThemeColor(): () => void {
  if (typeof document === "undefined") return () => {};
  // The router redraws <head> on navigation and can drop a tag it didn't
  // make, so the tag is found (or made again) on every sync.
  const sync = () => {
    const bg = getComputedStyle(document.body).backgroundColor;
    if (!bg || bg === "rgba(0, 0, 0, 0)") return;
    let el = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!el) {
      el = document.createElement("meta");
      el.name = "theme-color";
      document.head.appendChild(el);
    }
    if (el.content !== bg) el.content = bg;
  };
  sync();
  const obs = new MutationObserver(sync);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  obs.observe(document.head, { childList: true });
  const mq = window.matchMedia(PHONE);
  mq.addEventListener("change", sync);
  return () => {
    obs.disconnect();
    mq.removeEventListener("change", sync);
  };
}
