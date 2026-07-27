import { useMemo, useState } from "react";
import { firstGrapheme } from "@/lib/area-icon";

/**
 * Shared emoji picker — one component, three sites (page icon, view icon,
 * area emoji). Rendered inside a portalled Popover; the caller passes the
 * Popover children close() to `onPick` so the panel dismisses on select.
 *
 * A curated compact grid (spanning objects/symbols/activities and including
 * every emoji already in use across the app) plus a free-form text input for
 * "any" emoji, using Intl.Segmenter to preserve multi-codepoint sequences.
 * A "Remove" row is only rendered when the caller passes `removable`.
 */

const CURATED: readonly string[] = [
  // Objects — documents & tools
  "📄", "🗂", "📓", "📚", "📁", "📦", "📎", "📌",
  "📝", "📊", "📈", "📉", "🔖", "🔍", "🔧", "🔨",
  "⚙️", "🧰", "🖥", "⌨️", "🖨", "💾", "📇", "🗃",
  // Symbols — energy & wayfinding
  "⭐", "✨", "🎯", "🚀", "🧭", "💡", "🔥", "⚡",
  "🎉", "🎨", "🛠", "🧩", "🔒", "🗺", "❤️", "🌱",
  // Activities / roles
  "🤝", "🏛", "🏦", "🏥", "🎓", "💼", "📣", "🧠",
];

export function EmojiPicker({
  onPick,
  removable = false,
}: {
  onPick: (emoji: string | null) => void;
  removable?: boolean;
}) {
  const [text, setText] = useState("");
  const items = useMemo(() => CURATED, []);

  const submitText = () => {
    const g = firstGrapheme(text);
    if (g) {
      onPick(g);
      setText("");
    }
  };

  return (
    <div className="p-2" style={{ width: 264 }}>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submitText();
          }
        }}
        placeholder="Or paste any emoji…"
        className="mb-2 w-full rounded-sm border border-line bg-surface px-2 py-1 text-meta"
      />
      <div
        role="listbox"
        aria-label="Emoji"
        className="grid"
        style={{ gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}
      >
        {items.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={`Set emoji ${e}`}
            onClick={() => onPick(e)}
            className="grid place-items-center rounded-sm hover:bg-sunken"
            style={{ width: 28, height: 28, fontSize: 18, lineHeight: 1 }}
          >
            {e}
          </button>
        ))}
      </div>
      {removable ? (
        <>
          <div className="my-1 border-t border-lineSoft" />
          <button
            type="button"
            onClick={() => onPick(null)}
            className="w-full rounded-sm px-2 py-1 text-left text-meta text-muted hover:bg-rail"
          >
            Remove
          </button>
        </>
      ) : null}
    </div>
  );
}
