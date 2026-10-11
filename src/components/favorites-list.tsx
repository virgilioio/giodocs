import { useNavigate } from "@tanstack/react-router";
import { useToggleFavorite } from "@/hooks/use-home";
import { STAR_GLYPH, useFavoritePages } from "@/hooks/use-favorites";
import { setPageOrigin } from "@/lib/page-origin";
import type { PageListItem } from "@/lib/types";
import { Ico } from "./emoji-icon";

/* Favorites (2026-10-11): the pages a person starred, in the order they
 * starred them, among the pages they can open. One list, three places: the
 * sidebar, Home and the phone's Home tab. */

/** Rows of starred pages. `phone`: taller rows and bigger type. */
export function FavoritesList({
  activeId,
  phone = false,
}: {
  activeId?: string;
  phone?: boolean;
}) {
  const favs = useFavoritePages();
  const navigate = useNavigate();
  const toggle = useToggleFavorite();
  return (
    <ul aria-label="Favorites">
      {favs.map((p) => {
        const title = p.title?.trim() || "Untitled";
        const active = p.id === activeId;
        return (
          <li key={p.id} className="group relative" data-favorite={p.id}>
            <button
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => {
                setPageOrigin(p.id, { kind: "search" });
                void navigate({ to: "/p/$pageId", params: { pageId: p.id } });
              }}
              className={`flex w-full items-center rounded-md text-left ${
                phone ? "gio-phone-row" : "hover:bg-railHover"
              } ${active ? "bg-selected text-strong" : phone ? "text-strong" : "text-secondary"}`}
              style={
                phone
                  ? { gap: 14, minHeight: 48, padding: "0 6px", fontSize: 17 }
                  : { gap: 8, height: 28, padding: "0 30px 0 10px", fontSize: 14 }
              }
            >
              <Ico icon={p.icon || (p.is_database ? "🗂️" : "📄")} size={phone ? 22 : 16} />
              <span className="min-w-0 flex-1 truncate">{title}</span>
            </button>
            {phone ? null : (
              <button
                type="button"
                aria-label={`Remove “${title}” from Favorites`}
                title="Remove from Favorites"
                onClick={() => toggle(p.id, title)}
                className="absolute right-1 top-1/2 grid -translate-y-1/2 place-items-center rounded-md text-amberInk opacity-0 hover:bg-sunken focus:opacity-100 group-hover:opacity-100"
                style={{ width: 22, height: 22 }}
              >
                <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor" aria-hidden>
                  <path d={STAR_GLYPH} />
                </svg>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
