import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { closePeek, PeekScopeCtx, usePeek } from "@/lib/peek";
import { exitOnly, exitRef } from "@/lib/exit-motion";
import { qk } from "@/lib/query-keys";
import { useWorkspaceId } from "@/lib/workspace-context";
import { useWorkspaceShell } from "@/hooks/use-workspace-data";
import { useDeletePage, useSetPageParent } from "@/hooks/use-page-mutations";
import { useIsFavorite, useToggleFavorite } from "@/hooks/use-home";
import { useToast } from "@/lib/toast";
import { toClipboard } from "@/lib/clipboard";
import { pageUrl } from "@/lib/slug";
import { isBlankPage } from "@/lib/template-copy";
import { IC } from "@/lib/menu-icons";
import type { PageFull, PageListItem } from "@/lib/types";
import { PageEditor } from "./page-view";
import { Popover } from "./popover";
import { PlacePicker } from "./page-block";
import { RowMenu, type MenuSpec } from "./row-menu";
import { Ico } from "./emoji-icon";

/* A page in a dialog over the current one (2026-10-11, Notion's centre
 * peek). New pages and database rows open here. The header says where the
 * page lives ("Add to ▾" moves it), ⤡ opens the page itself, and the page
 * is edited exactly as on its own (the same editor). Esc or a click
 * outside closes it; a page made for the dialog and left blank is thrown
 * away on close. */

const P = {
  expand: "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7",
  link: IC.link,
  star: "M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  chevron: "m6 9 6 6 6-6",
};

function Glyph({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden style={{ flex: "none" }}>
      <path d={d} fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HeadButton({ label, d, onClick, fill, active }: { label: string; d: string; onClick: (el: HTMLButtonElement) => void; fill?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => onClick(e.currentTarget)}
      className={`grid place-items-center rounded-md hover:bg-sunken hover:text-strong ${active ? "text-amberInk" : "text-muted"}`}
      style={{ width: 28, height: 28 }}
    >
      <Glyph d={d} fill={fill} />
    </button>
  );
}

export function PagePeek() {
  const peek = usePeek();
  if (!peek) return null;
  return <PeekDialog key={peek.id} id={peek.id} fresh={peek.fresh} />;
}

function PeekDialog({ id, fresh }: { id: string; fresh: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ws = useWorkspaceId();
  const shell = useWorkspaceShell(ws);
  const pages = (shell.pages.data ?? []) as PageListItem[];
  const row = pages.find((p) => p.id === id);
  const parent = row?.parent_id ? pages.find((p) => p.id === row.parent_id) : undefined;
  const del = useDeletePage();
  const setParent = useSetPageParent();
  const favorite = useIsFavorite(id);
  const toggleFavorite = useToggleFavorite();
  const toast = useToast();
  const [menu, setMenu] = useState<{ anchor: HTMLElement; spec: MenuSpec } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // A page made for the dialog and still blank leaves with it.
  const discardIfBlank = () => {
    if (!fresh) return;
    const full = qc.getQueryData<PageFull | null>(qk.page(id));
    const listed = (qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? []).find((p) => p.id === id);
    const title = full?.title ?? listed?.title ?? "";
    const props = (full?.props ?? listed?.props ?? {}) as Record<string, unknown>;
    const hasValues = Object.values(props).some((v) => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0) && v !== false);
    const hasChildren = (qc.getQueryData<PageListItem[]>(qk.pages(ws)) ?? []).some((p) => p.parent_id === id);
    if (!title.trim() && isBlankPage(title, full?.blocks ?? []) && !hasValues && !hasChildren && !full?.is_database) {
      del.mutate(id);
    }
  };
  const close = () => {
    discardIfBlank();
    closePeek();
  };
  const openFull = () => {
    closePeek();
    void navigate({ to: "/p/$pageId", params: { pageId: id } });
  };

  // Esc closes, unless something inside used it (a menu, a selection).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="menu"], [data-slash-menu], [data-menu-sheet], .shadow-popover')) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // Going somewhere else (a link inside the page) closes it.
  const path = useRouterState({ select: (s) => s.location.pathname });
  const firstPath = useRef(path);
  useEffect(() => {
    if (path !== firstPath.current) closePeek();
  }, [path]);

  const placeLabel = parent ? parent.title?.trim() || "Untitled" : row?.access_type === "workspace" ? "Workspace" : "Private";

  return createPortal(
    <>
      <div
        ref={exitOnly("fade")}
        aria-hidden
        className="fixed inset-0 animate-fadeIn"
        style={{ zIndex: 80, background: "rgba(13,13,9,.32)" }}
        onMouseDown={close}
      />
      <div
        ref={exitRef("dialog", panelRef)}
        role="dialog"
        aria-modal
        aria-label={row?.title?.trim() || "New page"}
        data-page-peek
        className="fixed flex animate-dialogIn flex-col overflow-hidden rounded-xl bg-surface"
        style={{
          zIndex: 81,
          top: 40,
          left: "50%",
          translate: "-50% 0",
          width: "min(1080px, calc(100vw - 64px))",
          height: "calc(100vh - 80px)",
          boxShadow: "0 24px 64px rgba(13,13,9,.26)",
        }}
      >
        <div className="flex shrink-0 items-center border-b border-lineSoft" style={{ gap: 6, height: 46, padding: "0 12px" }}>
          <HeadButton label="Open as full page" d={P.expand} onClick={openFull} />
          <span aria-hidden className="bg-line" style={{ width: 1, height: 16, margin: "0 4px" }} />
          <span className="text-ui text-muted">Add to</span>
          <Popover
            width={300}
            trigger={({ onClick, ref, open }) => (
              <button
                ref={ref}
                type="button"
                onClick={onClick}
                aria-expanded={open}
                title="Change where this page lives"
                className="flex min-w-0 items-center rounded-md text-ui font-bold text-strong hover:bg-sunken"
                style={{ gap: 6, height: 28, padding: "0 6px", maxWidth: 320 }}
              >
                {parent ? <Ico icon={parent.icon || "📄"} size={15} /> : null}
                <span className="truncate">{placeLabel}</span>
                <span className="text-faint">
                  <Glyph d={P.chevron} />
                </span>
              </button>
            )}
          >
            {(closeMenu) => (
              <div>
                {row?.parent_id ? (
                  <button
                    type="button"
                    className="w-full rounded-md text-left text-row text-body hover:bg-rail"
                    style={{ padding: "6px 10px" }}
                    onClick={() => {
                      closeMenu();
                      setParent.mutate({ pageId: id, parentId: null, title: row?.title ?? "" });
                    }}
                  >
                    Top level (on its own)
                  </button>
                ) : null}
                <PlacePicker
                  pages={pages}
                  thisPageId={id}
                  onPick={(p) => {
                    closeMenu();
                    setParent.mutate({ pageId: id, parentId: p.id, title: row?.title ?? "", oldParentTitle: parent?.title ?? null });
                  }}
                  onCreate={() => closeMenu()}
                />
              </div>
            )}
          </Popover>
          <span className="flex-1" />
          <HeadButton
            label="Copy link"
            d={P.link}
            onClick={() => {
              toClipboard(pageUrl(id, row?.title ?? null));
              toast.push("Link copied");
            }}
          />
          <HeadButton
            label={favorite ? "Remove from Favorites" : "Add to Favorites"}
            d={P.star}
            fill={favorite}
            active={favorite}
            onClick={() => toggleFavorite(id, row?.title ?? "")}
          />
          <HeadButton
            label="More"
            d={P.more}
            onClick={(el) =>
              setMenu({
                anchor: el,
                spec: {
                  title: row?.title?.trim() || "This page",
                  rows: [
                    { kind: "row", label: "Open as full page", icon: P.expand, onPick: () => { setMenu(null); openFull(); } },
                    { kind: "row", label: "Copy link", icon: IC.link, onPick: () => { setMenu(null); toClipboard(pageUrl(id, row?.title ?? null)); toast.push("Link copied"); } },
                    { kind: "sep" },
                    {
                      kind: "row",
                      label: "Delete page",
                      icon: IC.trash,
                      danger: true,
                      onPick: () =>
                        setMenu((m) =>
                          m
                            ? {
                                anchor: m.anchor,
                                spec: {
                                  title: row?.title?.trim() || "This page",
                                  rows: [],
                                  confirm: {
                                    title: `Delete "${row?.title?.trim() || "Untitled"}"?`,
                                    body: "The pages inside it are deleted with it.",
                                    cta: "Delete",
                                    danger: true,
                                    onConfirm: () => {
                                      del.mutate(id);
                                      closePeek();
                                    },
                                  },
                                },
                              }
                            : m,
                        ),
                    },
                  ],
                },
              })
            }
          />
          <RowMenu spec={menu?.spec ?? null} anchor={menu?.anchor ?? null} onClose={() => setMenu(null)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" data-peek-body>
          <PeekScopeCtx.Provider value={true}>
            <PageEditor key={id} pageId={id} />
          </PeekScopeCtx.Provider>
        </div>
      </div>
    </>,
    document.body,
  );
}
