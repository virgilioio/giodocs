/**
 * Skeleton primitive — one shimmer, three tones. No pulse.
 * See chunk 5 spec. Callers wrap groups in a role="status" aria-busy container.
 */
import { useEffect, useState, type CSSProperties } from "react";

/* Skeletons on screen right now, and when the last one left. A skeleton
 * that replaces another (the boot frame, then the shell's, then the
 * page's) shows at once instead of waiting its 200ms again, so the screen
 * never blinks empty between two of them. */
let onScreen = 0;
let lastLeft = 0;
function skeletonJustShown(): boolean {
  return onScreen > 0 || Date.now() - lastLeft < 120;
}

const TONE = {
  bar:
    "linear-gradient(90deg, var(--color-railHover) 26%, var(--color-rail) 46%, var(--color-railHover) 66%)",
  soft:
    "linear-gradient(90deg, var(--color-sunken) 26%, var(--color-track) 46%, var(--color-sunken) 66%)",
  block:
    "linear-gradient(90deg, var(--color-railHover) 26%, var(--color-rail) 46%, var(--color-railHover) 66%)",
} as const;

export type SkTone = keyof typeof TONE;

export function Sk({
  w,
  h,
  r = 5,
  tone = "bar",
  className = "",
  style,
}: {
  w?: number | string;
  h?: number | string;
  r?: number | string;
  tone?: SkTone;
  className?: string;
  style?: CSSProperties;
}) {
  useEffect(() => {
    onScreen++;
    return () => {
      onScreen--;
      lastLeft = Date.now();
    };
  }, []);
  // A bar told to stretch (flex-1) mustn't also be told not to.
  const flex = /\bflex-1\b/.test(className) ? "" : "flex-none";
  return (
    <span
      aria-hidden="true"
      className={`block ${flex} animate-skShimmer ${className}`}
      style={{
        width: w,
        height: h,
        borderRadius: r,
        backgroundImage: TONE[tone],
        backgroundSize: "280% 100%",
        ...style,
      }}
    />
  );
}

/**
 * Show `true` only after `isPending` has been continuously true for `delay` ms.
 * Under 200ms the load feels instant and a flash of skeleton is worse than none.
 */
export function useDelayedPending(isPending: boolean, delay = 200) {
  const [show, setShow] = useState(() => isPending && skeletonJustShown());
  useEffect(() => {
    if (!isPending) {
      setShow(false);
      return;
    }
    if (skeletonJustShown()) {
      setShow(true);
      return;
    }
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [isPending, delay]);
  return show;
}
