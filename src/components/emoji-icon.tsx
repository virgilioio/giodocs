/**
 * <Ico> — THE icon span. Every place a page/view/area icon renders goes
 * through this one component: sidebar rows, table rows, board cards, list
 * rows, the page header, ⌘K results, the picker, the settings table.
 *
 * It paints BOTH a background image and a text child (see
 * src/lib/custom-emoji.ts): a unicode icon shows the char with no
 * background, a custom one shows the image with an empty text node.
 *
 * ⚠ width, height AND line-height are always explicit. A text-only span
 * has no intrinsic box, so a background image on it renders invisibly —
 * which is exactly how this feature half-ships (right in the page header,
 * gone in table rows).
 *
 * The text node is KEPT deliberately: it is what a screen reader
 * announces and what a copy-paste picks up. Never swap it for an <img>.
 */

import { useEmojiSet } from "@/hooks/use-custom-emoji";
import { icoBg, icoCh, type CustomEmoji } from "@/lib/custom-emoji";

export function Ico({
  icon,
  size,
  className,
  pad = 0,
  style,
  set: setIn,
}: {
  icon: string | null | undefined;
  /** Font size AND box size in px. */
  size: number;
  className?: string;
  /** Padding inside the box; the image respects it (background-origin). */
  pad?: number;
  style?: React.CSSProperties;
  /** Pass a set explicitly to avoid a hook (used inside the picker grid). */
  set?: readonly CustomEmoji[];
}) {
  const hooked = useEmojiSet();
  const set = setIn ?? hooked;
  const box = size + pad * 2;
  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        width: box,
        height: box,
        lineHeight: `${box}px`,
        fontSize: size,
        padding: pad || undefined,
        textAlign: "center",
        flex: "none",
        backgroundImage: icoBg(icon, set),
        backgroundSize: "contain",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundOrigin: "content-box",
        ...style,
      }}
    >
      {icoCh(icon, set)}
    </span>
  );
}
