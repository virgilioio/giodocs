/**
 * ONE composer for Add AND Edit. The title is the only structural
 * difference — two composers would drift.
 *
 * Geometry is the share panel's treatment: position: fixed, anchored
 * under the button that opened it, CLAMPED into the viewport, plus a
 * max-height backstop. A fixed popover behind a full-screen scrim has no
 * scrollable ancestor, so without the max-height a short viewport puts
 * Save past the bottom edge with no way to reach it.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { squareEmojiPng } from "@/lib/images";
import {
  composerHint,
  nameFromFilename,
  sanitizeEmojiName,
  type CustomEmoji,
} from "@/lib/custom-emoji";
import { isImageMime } from "@/lib/image-ops";
import { useToast } from "@/lib/toast";

const W = 344;
const EST_H = 470;

/** Both grounds are LITERAL hexes and must not theme — they show what the
 *  emoji looks like on a light page AND a dark page at the same time. If
 *  the tiles followed the current theme, half the preview would be a lie:
 *  a transparent PNG that reads perfectly on white can vanish against
 *  #1B1A17, and the uploader would never find out. */
const LIGHT_GROUND = "#FFFFFF";
const DARK_GROUND = "#1B1A17";

function clampPos(anchor: DOMRect | null) {
  if (typeof window === "undefined" || !anchor) return { top: 12, left: 12 };
  const h = Math.min(EST_H, window.innerHeight - 24);
  const top = Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - 12 - h));
  const left = Math.max(12, Math.min(anchor.right - W, window.innerWidth - W - 12));
  return { top, left };
}

const ICON_IMAGE =
  "M4 5.5h16v13H4zM4 15l4.5-4.5 4 4 3-3L20 15";
const ICON_REFRESH =
  "M20 12a8 8 0 1 1-2.6-5.9M20 4v4h-4";

export function CustomEmojiComposer({
  anchor,
  editing,
  existing,
  workspaceName,
  onClose,
  onSave,
}: {
  anchor: DOMRect | null;
  editing: CustomEmoji | null;
  existing: readonly CustomEmoji[];
  workspaceName: string;
  onClose: () => void;
  onSave: (v: { name: string; description: string; blob: Blob | null }) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(editing?.name ?? "");
  const [desc, setDesc] = useState(editing?.description ?? "");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [localUrl, setLocalUrl] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pos, setPos] = useState(() => clampPos(anchor));

  useLayoutEffect(() => {
    const place = () => setPos(clampPos(anchor));
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl); }, [localUrl]);

  const previewUrl = localUrl || editing?.url || "";
  const hasImage = !!previewUrl;

  const taken = useMemo(
    () => existing.some((e) => e.name === name && e.name !== editing?.name),
    [existing, name, editing],
  );
  const hint = composerHint({
    hasImage,
    name,
    taken,
    editing: !!editing,
    originalName: editing?.name,
  });
  const ready = hasImage && !!name && !taken && !busy;

  const accept = async (file: File) => {
    if (!isImageMime(file.type)) {
      toast.push("That file is not an image.");
      return;
    }
    try {
      const out = await squareEmojiPng(file);
      setBlob(out);
      setLocalUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(out);
      });
      if (!name) setName(nameFromFilename(file.name));
    } catch {
      toast.push("Could not read that image.");
    }
  };

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await onSave({ name, description: desc, blob });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Topmost layer: Escape closes the composer BEFORE Settings.
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && !(e.target as HTMLElement).matches("textarea")) {
      e.preventDefault();
      void save();
    }
  };

  const hintColor =
    hint.tone === "danger"
      ? "var(--color-danger)"
      : hint.tone === "accent"
        ? "var(--color-accent)"
        : "var(--color-secondary)";

  return (
    <div
      role="dialog"
      aria-label={editing ? "Edit custom emoji" : "Add custom emoji"}
      className="fixed bg-surface border border-line shadow-popover animate-popIn"
      style={{
        zIndex: "calc(var(--z-menu) + 3)",
        top: pos.top,
        left: pos.left,
        width: W,
        borderRadius: 12,
        padding: "15px 16px 13px",
        maxHeight: "calc(100vh - 24px)",
        overflowY: "auto",
      }}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="font-display text-strong" style={{ fontSize: 15.5, fontWeight: 700 }}>
        {editing ? "Edit custom emoji" : "Add custom emoji"}
      </div>
      <div className="text-secondary" style={{ fontSize: 12.5, marginTop: 3 }}>
        Anyone at {workspaceName} can use it. Name it once — that name is how it is
        typed and searched.
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void accept(f);
          e.target.value = "";
        }}
      />

      {!hasImage ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void accept(f);
          }}
          className="w-full border border-line bg-track grid place-items-center"
          style={{ height: 62, borderRadius: 11, marginTop: 12 }}
        >
          <span className="flex items-center gap-2">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-secondary" aria-hidden>
              <path d={ICON_IMAGE} />
            </svg>
            <span className="text-secondary" style={{ fontSize: 13.5, fontWeight: 700 }}>
              Upload an image
            </span>
          </span>
        </button>
      ) : (
        <div
          className="bg-track border border-line"
          style={{ borderRadius: 11, padding: "11px 0 0", marginTop: 12 }}
        >
          <div
            className="font-display text-faint text-center"
            style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.075em", textTransform: "uppercase" }}
          >
            Preview
          </div>
          <div className="flex justify-center" style={{ gap: 20, margin: "10px 0 4px" }}>
            {[
              { bg: LIGHT_GROUND, shadow: "0 1px 3px rgba(13,13,9,.10), 0 0 0 1px rgba(13,13,9,.07)" },
              { bg: DARK_GROUND, shadow: "0 1px 3px rgba(0,0,0,.35)" },
            ].map((t) => (
              <span
                key={t.bg}
                className="grid place-items-center"
                style={{ width: 46, height: 46, borderRadius: 11, background: t.bg, boxShadow: t.shadow }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 28,
                    height: 28,
                    lineHeight: "28px",
                    backgroundImage: `url("${previewUrl}")`,
                    backgroundSize: "contain",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                  }}
                />
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-1.5 text-secondary hover:bg-sunken"
            style={{ borderTop: "1px solid var(--color-line)", fontSize: 12.5, padding: "7px 0", borderRadius: "0 0 10px 10px" }}
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={ICON_REFRESH} />
            </svg>
            Replace
          </button>
        </div>
      )}

      <input
        value={name}
        autoFocus
        onChange={(e) => setName(sanitizeEmojiName(e.target.value))}
        placeholder="ship-it"
        aria-label="Emoji name"
        className="w-full border border-line bg-surface font-mono focus:outline-none"
        style={{ marginTop: 11, padding: "6px 9px", fontSize: 12.5, borderRadius: 8 }}
      />
      <input
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Description (optional)"
        aria-label="Description"
        className="w-full border border-line bg-surface focus:outline-none"
        style={{ marginTop: 7, padding: "6px 9px", fontSize: 12.5, borderRadius: 8 }}
      />

      <div style={{ fontSize: 12.5, marginTop: 9, color: hintColor }}>{hint.text}</div>

      <div className="flex items-center justify-between" style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={onClose}
          className="text-secondary hover:bg-sunken"
          style={{ fontSize: 13, padding: "5px 10px", borderRadius: 8 }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!ready}
          className="bg-btn text-btnFg disabled:opacity-40"
          style={{ fontSize: 13, fontWeight: 700, padding: "6px 13px", borderRadius: 8 }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
