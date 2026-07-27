/**
 * Share panel — the popover the on-page permissions chip opens (and the
 * page ⋯ "Who can see this" row). 388px wide, portalled.
 *
 * All writes go through the ONE atomic RPC public.set_page_access. The
 * client never inserts/deletes page_access rows directly — RLS makes the
 * intermediate state unsafe, and §6.1/§6.3 invariants live inside the RPC.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { usePageAccess } from "@/hooks/use-workspace-data";
import { useToast } from "@/lib/toast";
import { useAuth } from "@/lib/auth-context";
import type { PageAccessRow, PageFull } from "@/lib/types";
import {
  normAccess,
  panelCopy,
  isCompleteEmail,
  guestNameFromEmail,
  type NormAccess,
  type MemberInfo,
} from "@/lib/share-panel";

/* ────────────── Store ────────────── */

type AnchorRect = { top: number; left: number; right: number; bottom: number };

let state: AnchorRect | null = null;
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function getSnapshot() {
  return state;
}

export function openPermissionsPopover(anchor: DOMRect | AnchorRect) {
  state = {
    top: anchor.top,
    left: anchor.left,
    right: anchor.right,
    bottom: anchor.bottom,
  };
  emit();
}
export function closePermissionsPopover() {
  if (state !== null) {
    state = null;
    emit();
  }
}

/* ────────────── Public: derived chip copy ────────────── */

export { panelCopy } from "@/lib/share-panel";

/* ────────────── Types ────────────── */

type Member = {
  user_id: string;
  role: string;
  profiles: {
    full_name: string | null;
    email: string | null;
    avatar_tint: string | null;
    avatar_ink: string | null;
  } | null;
};

/* ────────────── Icons ────────────── */

function Ic({
  path,
  size = 14,
  color = "currentColor",
  strokeWidth = 1.9,
}: {
  path: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}
const GLOBE =
  "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18";
const LOCK = "M6 10V8a6 6 0 1112 0v2M5 10h14v10H5z";
const CHECK = "M4 12l5 5L20 6";
const CHEVRON_DOWN = "M6 9l6 6 6-6";
const LINK =
  "M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1";
const SEARCH = "M11 4a7 7 0 105 12 7 7 0 000-12zM20 20l-4-4";
const ENVELOPE = "M4 6h16v12H4zM4 6l8 7 8-7";

/* ────────────── Avatars ────────────── */

function MemberAvatar({
  name,
  email,
  tint,
  ink,
  size = 24,
}: {
  name: string;
  email: string | null;
  tint: string | null;
  ink: string | null;
  size?: number;
}) {
  const initials = (name || email || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: tint ?? "var(--color-sunken)",
        color: ink ?? "var(--color-noir)",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {initials || "?"}
    </span>
  );
}

function GuestAvatar({ email, size = 24 }: { email: string; size?: number }) {
  const initials = guestNameFromEmail(email).slice(0, 2).toUpperCase();
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: "var(--color-sunken)",
        color: "var(--color-muted)",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {initials || "?"}
    </span>
  );
}

function IconTile({
  path,
  bg,
  color,
  size = 26,
  iconSize = 14,
}: {
  path: string;
  bg: string;
  color: string;
  size?: number;
  iconSize?: number;
}) {
  return (
    <span
      className="grid shrink-0 place-items-center"
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: bg,
      }}
    >
      <Ic path={path} size={iconSize} color={color} />
    </span>
  );
}

/* ────────────── Positioning ────────────── */

const WIDTH = 388;

function usePosition(open: boolean, anchor: AnchorRect | null) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPos(null);
      return;
    }
    const place = () => {
      const margin = 8;
      const gap = 6;
      const panelH = panelRef.current?.offsetHeight ?? 360;
      let left = anchor.right - WIDTH;
      if (left < margin) left = margin;
      const maxLeft = window.innerWidth - WIDTH - margin;
      if (left > maxLeft) left = Math.max(margin, maxLeft);
      let top = anchor.bottom + gap;
      if (
        top + panelH + margin > window.innerHeight &&
        anchor.top - gap - panelH > margin
      ) {
        top = anchor.top - gap - panelH;
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor]);
  return { panelRef, pos };
}

/* ────────────── Mutation — the ONLY write path ────────────── */

function useSaveAccess(pageId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (payload: {
      type: "workspace" | "restricted";
      wsRole: "edit" | "view";
      people: { id: string; role: "edit" | "view" }[];
      guests: { email: string; role: "edit" | "view" }[];
    }) => {
      const { error } = await supabase.rpc("set_page_access", {
        p_page: pageId,
        p_type: payload.type,
        p_ws_role: payload.wsRole,
        p_people: payload.people,
        p_guests: payload.guests,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.pageAccess(pageId) });
      qc.invalidateQueries({ queryKey: qk.page(pageId) });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Couldn't update access.";
      toast.push(msg);
    },
  });
}

/* ────────────── Host ────────────── */

export function PermissionsPopoverHost({
  page,
  workspaceName,
  members,
  isOwner,
}: {
  page: PageFull;
  workspaceName: string;
  members: Member[];
  isOwner: boolean;
}) {
  const anchor = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const open = anchor !== null;
  const accessQ = usePageAccess(page.id);
  const access = (accessQ.data ?? []) as PageAccessRow[];
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const toast = useToast();

  const memberInfo: MemberInfo[] = useMemo(
    () =>
      members.map((m) => ({
        user_id: m.user_id,
        full_name: m.profiles?.full_name ?? null,
        email: m.profiles?.email ?? null,
        avatar_tint: m.profiles?.avatar_tint ?? null,
        avatar_ink: m.profiles?.avatar_ink ?? null,
      })),
    [members],
  );

  const canManage = useMemo(() => {
    if (isOwner) return true;
    if (page.access_type === "workspace") return true;
    if (page.access_type === "restricted") {
      return access.some(
        (a) => a.user_id === meId && a.capability === "write",
      );
    }
    return false;
  }, [isOwner, page.access_type, access, meId]);

  const norm = useMemo<NormAccess>(
    () => normAccess(page as never, access, memberInfo),
    [page, access, memberInfo],
  );

  const areaLabel = useMemo(() => {
    const p = page.props as Record<string, unknown> | null;
    const v = p && typeof p === "object" ? (p as Record<string, unknown>)["area"] : null;
    return typeof v === "string" && v.trim() ? v : null;
  }, [page.props]);

  const pageOwnerId = useMemo(() => {
    const p = page.props as Record<string, unknown> | null;
    const v = p && typeof p === "object" ? p["owner"] : null;
    if (typeof v === "string" && v) return v;
    return page.created_by ?? null;
  }, [page.props, page.created_by]);

  const copy = useMemo(
    () => panelCopy(norm, workspaceName, members.length, areaLabel),
    [norm, workspaceName, members.length, areaLabel],
  );

  const { panelRef, pos } = usePosition(open, anchor);
  const save = useSaveAccess(page.id);

  // Escape / outside-click close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closePermissionsPopover();
        e.stopPropagation();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (anchor) {
        const x = e.clientX;
        const y = e.clientY;
        if (
          x >= anchor.left &&
          x <= anchor.right &&
          y >= anchor.top &&
          y <= anchor.bottom
        )
          return;
      }
      closePermissionsPopover();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, anchor, panelRef]);

  // Search state.
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const focusedOnceRef = useRef(false);
  useEffect(() => {
    if (open && !focusedOnceRef.current) {
      focusedOnceRef.current = true;
      // Defer so layout settles before the caret is claimed.
      requestAnimationFrame(() => searchRef.current?.focus());
    }
    if (!open) {
      focusedOnceRef.current = false;
      setQuery("");
      setOpenRoleFor(null);
    }
  }, [open]);

  // Which row's inline role list is open. Never a nested popover.
  const [openRoleFor, setOpenRoleFor] = useState<string | null>(null);

  /* ── Save helpers ── */

  const commit = useCallback(
    (next: NormAccess) => {
      save.mutate({
        type: next.type,
        wsRole: next.wsRole,
        people: next.people.map((p) => ({ id: p.id, role: p.role })),
        guests: next.guests.map((g) => ({ email: g.email, role: g.role })),
      });
      setOpenRoleFor(null);
    },
    [save],
  );

  const addPerson = useCallback(
    (id: string, role: "edit" | "view" = "edit") => {
      // §6.2 — adding a person to an OPEN page flips type to 'restricted'
      // in the same call. The owner floor is set server-side.
      if (norm.people.some((p) => p.id === id)) return;
      const nextPeople = [...norm.people, {
        id,
        name: memberInfo.find((m) => m.user_id === id)?.full_name || "",
        email: memberInfo.find((m) => m.user_id === id)?.email ?? null,
        role,
        tint: memberInfo.find((m) => m.user_id === id)?.avatar_tint ?? null,
        ink: memberInfo.find((m) => m.user_id === id)?.avatar_ink ?? null,
      }];
      commit({ ...norm, type: "restricted", people: nextPeople });
    },
    [norm, memberInfo, commit],
  );

  const addGuest = useCallback(
    (email: string) => {
      const clean = email.trim().toLowerCase();
      if (!isCompleteEmail(clean)) return;
      if (norm.guests.some((g) => g.email === clean)) return;
      const nextGuests = [
        ...norm.guests,
        { email: clean, name: guestNameFromEmail(clean), role: "view" as const },
      ];
      commit({ ...norm, guests: nextGuests });
    },
    [norm, commit],
  );

  const changePersonRole = useCallback(
    (id: string, role: "edit" | "view") => {
      commit({
        ...norm,
        people: norm.people.map((p) => (p.id === id ? { ...p, role } : p)),
      });
    },
    [norm, commit],
  );
  const removePerson = useCallback(
    (id: string) => {
      // §6.3 UI half — refuse to drop below one workspace member.
      if (norm.type === "restricted" && norm.people.length < 2) {
        toast.push(
          `Someone at ${workspaceName || "the workspace"} has to keep access — add another person first`,
        );
        return;
      }
      commit({
        ...norm,
        people: norm.people.filter((p) => p.id !== id),
      });
    },
    [norm, commit, toast, workspaceName],
  );
  const changeGuestRole = useCallback(
    (email: string, role: "edit" | "view") => {
      commit({
        ...norm,
        guests: norm.guests.map((g) => (g.email === email ? { ...g, role } : g)),
      });
    },
    [norm, commit],
  );
  const removeGuest = useCallback(
    (email: string) => {
      commit({
        ...norm,
        guests: norm.guests.filter((g) => g.email !== email),
      });
    },
    [norm, commit],
  );
  const changeWsRole = useCallback(
    (role: "edit" | "view") => commit({ ...norm, wsRole: role }),
    [norm, commit],
  );
  const setType = useCallback(
    (type: "workspace" | "restricted") => {
      if (type === norm.type) return;
      commit({ ...norm, type });
    },
    [norm, commit],
  );

  /* ── Autocomplete matches ── */

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as MemberInfo[];
    const takenIds = new Set(norm.people.map((p) => p.id));
    return memberInfo
      .filter((m) => !takenIds.has(m.user_id))
      .filter((m) => {
        const n = (m.full_name ?? "").toLowerCase();
        const e = (m.email ?? "").toLowerCase();
        return n.includes(q) || e.includes(q);
      })
      .slice(0, 5);
  }, [query, memberInfo, norm.people]);

  const takenGuestSet = useMemo(
    () => new Set(norm.guests.map((g) => g.email)),
    [norm.guests],
  );
  const emailReady =
    isCompleteEmail(query) &&
    !matches.some((m) => (m.email ?? "").toLowerCase() === query.trim().toLowerCase()) &&
    !takenGuestSet.has(query.trim().toLowerCase());

  const onSearchKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (matches.length > 0) {
          addPerson(matches[0].user_id);
          setQuery("");
        } else if (emailReady) {
          addGuest(query);
          setQuery("");
        }
        return;
      }
      if (e.key === "Escape") {
        if (query) {
          e.preventDefault();
          e.stopPropagation();
          setQuery("");
        }
        // else fall through to the global handler
      }
    },
    [matches, emailReady, addPerson, addGuest, query],
  );

  /* ── Copy link ── */
  const copyLink = useCallback(async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.push("Link copied");
    } catch {
      toast.push("Couldn't copy link");
    }
  }, [toast]);

  if (!open) return null;

  /* ── Render ── */

  const ws = workspaceName || "this workspace";
  const restricted = norm.type === "restricted";

  return createPortal(
    <>
      {/* Transparent scrim for outside clicks */}
      <div
        onMouseDown={() => closePermissionsPopover()}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 94,
          background: "transparent",
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Who can see this page"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          width: WIDTH,
          maxHeight: "calc(100vh - 28px)",
          overflowY: "auto",
          zIndex: 95,
          visibility: pos ? "visible" : "hidden",
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          borderRadius: 12,
          boxShadow: "0 18px 48px rgba(13,13,9,.16)",
        }}
        className="animate-popIn"
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 15px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span
            className="font-display"
            style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}
          >
            Who can see this page
          </span>
          <button
            type="button"
            onClick={copyLink}
            aria-label="Copy link"
            title="Copy link"
            className="grid place-items-center"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              color: "var(--color-faint)",
              background: "transparent",
              cursor: "pointer",
              transition: "background .1s, color .1s",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.background = "var(--color-sunken)";
              el.style.color = "var(--color-strong)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.background = "transparent";
              el.style.color = "var(--color-faint)";
            }}
          >
            <Ic path={LINK} size={14} />
          </button>
        </div>

        {/* Search + autocomplete */}
        <div style={{ padding: "10px 15px 0", position: "relative" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 9px",
              borderRadius: 9,
              background: "var(--color-track)",
              border: `1px solid ${
                query.length > 0
                  ? "var(--color-lineStrong)"
                  : "var(--color-line)"
              }`,
              transition: "border-color .1s",
            }}
          >
            <Ic path={SEARCH} size={14} color="var(--color-whisper)" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Add people by name or email…"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 14,
                color: "var(--color-body)",
                minWidth: 0,
              }}
            />
          </div>

          {query.trim().length > 0 && (
            <div
              className="animate-popIn"
              style={{
                position: "absolute",
                left: 15,
                right: 15,
                marginTop: 7,
                border: "1px solid var(--color-line)",
                borderRadius: 9,
                background: "var(--color-surface)",
                boxShadow: "0 3px 10px rgba(13,13,9,.06)",
                maxHeight: 196,
                overflowY: "auto",
                padding: 4,
                zIndex: 5,
              }}
            >
              {matches.length === 0 && !emailReady && (
                <div
                  style={{
                    padding: "8px 8px",
                    fontSize: 12.5,
                    color: "var(--color-whisper)",
                    lineHeight: 1.35,
                  }}
                >
                  Nobody by that name. Type a full email address to invite a guest.
                </div>
              )}

              {matches.map((m) => (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => {
                    addPerson(m.user_id);
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  className="flex w-full items-center gap-2 text-left"
                  style={{
                    padding: "6px 6px",
                    borderRadius: 7,
                    background: "transparent",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      "var(--color-rail)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      "transparent")
                  }
                >
                  <MemberAvatar
                    name={m.full_name ?? ""}
                    email={m.email}
                    tint={m.avatar_tint}
                    ink={m.avatar_ink}
                  />
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={{ fontSize: 14, fontWeight: 700, color: "var(--color-body)" }}
                    title={m.full_name ?? m.email ?? ""}
                  >
                    {m.full_name || m.email || "Unnamed"}
                  </span>
                  <span
                    className="truncate"
                    style={{
                      fontSize: 12.5,
                      color: "var(--color-faint)",
                      maxWidth: 160,
                    }}
                  >
                    {m.email ?? ""}
                  </span>
                </button>
              ))}

              {emailReady && (
                <button
                  type="button"
                  onClick={() => {
                    addGuest(query);
                    setQuery("");
                    searchRef.current?.focus();
                  }}
                  className="flex w-full items-center gap-2 text-left"
                  style={{
                    padding: "6px 6px",
                    borderRadius: 7,
                    background: "transparent",
                    cursor: "pointer",
                    marginTop: matches.length > 0 ? 2 : 0,
                    borderTop:
                      matches.length > 0
                        ? "1px solid var(--color-lineSoft)"
                        : "none",
                    paddingTop: matches.length > 0 ? 8 : 6,
                  }}
                  onMouseEnter={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      "var(--color-rail)")
                  }
                  onMouseLeave={(e) =>
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      "transparent")
                  }
                >
                  <IconTile
                    path={ENVELOPE}
                    bg="var(--color-amberTint)"
                    color="var(--color-amber)"
                    size={24}
                    iconSize={13}
                  />
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={{ fontSize: 14, fontWeight: 700, color: "var(--color-body)" }}
                  >
                    Invite {query.trim().toLowerCase()}
                  </span>
                  <span
                    className="font-display"
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      background: "var(--color-amberTint)",
                      color: "var(--color-amberInk)",
                      borderRadius: 5,
                      padding: "2px 5px",
                      textTransform: "uppercase",
                    }}
                  >
                    Guest
                  </span>
                </button>
              )}
              {emailReady && (
                <div
                  style={{
                    padding: "3px 8px 4px 34px",
                    fontSize: 12,
                    color: "var(--color-faint)",
                    lineHeight: 1.35,
                  }}
                >
                  Outside {ws} — joins as a guest, view only
                </div>
              )}
            </div>
          )}
        </div>

        {/* General access */}
        <div style={{ padding: "12px 15px 0" }}>
          <div
            className="font-display"
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.085em",
              color: "var(--color-faint)",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            General access
          </div>

          <AccessCard
            selected={!restricted}
            onClick={() => canManage && setType("workspace")}
            disabled={!canManage}
            icon={GLOBE}
            title={`Everyone at ${ws}`}
            sub={`All ${members.length} ${members.length === 1 ? "person" : "people"} can find and open it`}
          />
          <AccessCard
            selected={restricted}
            onClick={() => canManage && setType("restricted")}
            disabled={!canManage}
            icon={LOCK}
            title="Only invited people"
            sub="Nobody else can find it, open it, or search it"
          />
        </div>

        {/* People with access */}
        <div style={{ padding: "6px 15px 0" }}>
          <div
            className="font-display"
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.085em",
              color: "var(--color-faint)",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            People with access{copy.peopleCountSuffix}
          </div>

          <div style={{ maxHeight: 212, overflowY: "auto" }}>
            {!restricted && (
              <PermRow
                key="__everyone"
                avatar={
                  <IconTile
                    path={GLOBE}
                    bg="var(--color-accentTint)"
                    color="var(--color-accent)"
                    size={24}
                    iconSize={13}
                  />
                }
                name={`Everyone at ${ws}`}
                sub={`${members.length} ${members.length === 1 ? "person" : "people"}`}
                role={norm.wsRole}
                showRemove={false}
                canManage={canManage}
                openMenu={openRoleFor === "__everyone"}
                setOpenMenu={(v) => setOpenRoleFor(v ? "__everyone" : null)}
                onChangeRole={(r) => changeWsRole(r)}
              />
            )}

            {norm.people.map((p) => {
              const isPageOwner = pageOwnerId && p.id === pageOwnerId;
              const key = `p:${p.id}`;
              return (
                <PermRow
                  key={key}
                  avatar={
                    <MemberAvatar
                      name={p.name}
                      email={p.email}
                      tint={p.tint}
                      ink={p.ink}
                    />
                  }
                  name={p.name}
                  sub={p.email ?? ""}
                  role={p.role}
                  fixedLabel={isPageOwner ? "Owner" : undefined}
                  showRemove={true}
                  canManage={canManage && !isPageOwner}
                  openMenu={openRoleFor === key}
                  setOpenMenu={(v) => setOpenRoleFor(v ? key : null)}
                  onChangeRole={(r) => changePersonRole(p.id, r)}
                  onRemove={() => removePerson(p.id)}
                  removeDisabled={
                    restricted && norm.people.length < 2
                  }
                />
              );
            })}

            {norm.guests.map((g) => {
              const key = `g:${g.email}`;
              return (
                <PermRow
                  key={key}
                  avatar={<GuestAvatar email={g.email} />}
                  name={g.name}
                  sub={g.email}
                  role={g.role}
                  guestBadge
                  showRemove={true}
                  canManage={canManage}
                  openMenu={openRoleFor === key}
                  setOpenMenu={(v) => setOpenRoleFor(v ? key : null)}
                  onChangeRole={(r) => changeGuestRole(g.email, r)}
                  onRemove={() => removeGuest(g.email)}
                />
              );
            })}
          </div>
        </div>

        {/* Warnings */}
        {copy.warnings.length > 0 && (
          <div style={{ padding: "10px 15px 0" }}>
            {copy.warnings.map((w, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  marginTop: i === 0 ? 0 : 7,
                  padding: "8px 9px",
                  background: "var(--color-amberTint)",
                  borderRadius: 8,
                  color: "var(--color-amberInk)",
                  fontSize: 12.5,
                  lineHeight: 1.4,
                }}
              >
                <Ic
                  path={i === 1 ? GLOBE : "M12 3l10 18H2L12 3zM12 10v5M12 18v.5"}
                  size={13}
                  color="var(--color-amber)"
                  strokeWidth={2}
                />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            marginTop: 10,
            borderTop: "1px solid var(--color-lineSoft)",
            padding: "9px 15px 12px",
            fontSize: 12.5,
            color: "var(--color-whisper)",
            lineHeight: 1.4,
          }}
        >
          Access is set per page. Nothing is inherited — this list is the whole story.
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ────────────── Access card ────────────── */

function AccessCard({
  selected,
  onClick,
  disabled,
  icon,
  title,
  sub,
}: {
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
  icon: string;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 9px",
        borderRadius: 9,
        marginBottom: 6,
        cursor: disabled ? "default" : "pointer",
        background: selected ? "var(--color-accentTint)" : "var(--color-surface)",
        border: `1px solid ${selected ? "var(--color-accentRing)" : "var(--color-line)"}`,
        textAlign: "left",
        transition: "border-color .1s, background .1s",
        opacity: disabled && !selected ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (selected || disabled) return;
        (e.currentTarget as HTMLButtonElement).style.borderColor =
          "var(--color-rule)";
      }}
      onMouseLeave={(e) => {
        if (selected || disabled) return;
        (e.currentTarget as HTMLButtonElement).style.borderColor =
          "var(--color-line)";
      }}
    >
      <IconTile
        path={icon}
        bg={selected ? "var(--color-surface)" : "var(--color-sunken)"}
        color={selected ? "var(--color-accent)" : "var(--color-secondary)"}
      />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "block",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--color-body)",
          }}
        >
          {title}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            color: "var(--color-secondary)",
            marginTop: 1,
          }}
        >
          {sub}
        </span>
      </span>
      {selected && (
        <Ic
          path={CHECK}
          size={15}
          color="var(--color-accent)"
          strokeWidth={2.2}
        />
      )}
    </button>
  );
}

/* ────────────── Row ────────────── */

function PermRow({
  avatar,
  name,
  sub,
  role,
  fixedLabel,
  guestBadge,
  showRemove,
  canManage,
  openMenu,
  setOpenMenu,
  onChangeRole,
  onRemove,
  removeDisabled,
}: {
  avatar: React.ReactNode;
  name: string;
  sub: string;
  role: "edit" | "view";
  fixedLabel?: string;
  guestBadge?: boolean;
  showRemove: boolean;
  canManage: boolean;
  openMenu: boolean;
  setOpenMenu: (v: boolean) => void;
  onChangeRole: (r: "edit" | "view") => void;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 4px",
          borderRadius: 7,
          background: hover ? "var(--color-track)" : "transparent",
        }}
      >
        {avatar}
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            className="truncate"
            style={{
              display: "block",
              fontSize: 14,
              fontWeight: 700,
              color: "var(--color-body)",
            }}
            title={name}
          >
            {name}
            {guestBadge && (
              <span
                className="font-display"
                style={{
                  marginLeft: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  background: "var(--color-amberTint)",
                  color: "var(--color-amberInk)",
                  borderRadius: 5,
                  padding: "1px 5px",
                  textTransform: "uppercase",
                  verticalAlign: 2,
                }}
              >
                Guest
              </span>
            )}
          </span>
          {sub && (
            <span
              className="truncate"
              style={{
                display: "block",
                fontSize: 12.5,
                color: "var(--color-faint)",
              }}
            >
              {sub}
            </span>
          )}
        </span>

        {fixedLabel ? (
          <span
            style={{
              fontSize: 13,
              color: "var(--color-whisper)",
              padding: "3px 6px",
            }}
          >
            {fixedLabel}
          </span>
        ) : canManage ? (
          <button
            type="button"
            onClick={() => setOpenMenu(!openMenu)}
            className="inline-flex items-center gap-1"
            style={{
              fontSize: 13,
              color: "var(--color-secondary)",
              padding: "3px 6px",
              borderRadius: 6,
              background: openMenu ? "var(--color-sunken)" : "transparent",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.background = "var(--color-sunken)";
              el.style.color = "var(--color-noir)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.background = openMenu
                ? "var(--color-sunken)"
                : "transparent";
              el.style.color = "var(--color-secondary)";
            }}
          >
            {role === "edit" ? "Can edit" : "Can view"}
            <Ic path={CHEVRON_DOWN} size={10} />
          </button>
        ) : (
          <span
            style={{
              fontSize: 13,
              color: "var(--color-whisper)",
              padding: "3px 6px",
            }}
          >
            {role === "edit" ? "Can edit" : "Can view"}
          </span>
        )}
      </div>

      {openMenu && (
        <div
          className="animate-popIn"
          style={{
            marginLeft: 37,
            marginTop: 2,
            marginBottom: 4,
            border: "1px solid var(--color-line)",
            borderRadius: 8,
            background: "var(--color-surface)",
            boxShadow: "0 3px 10px rgba(13,13,9,.06)",
            padding: 4,
          }}
        >
          <InlineRoleItem
            label="Can edit"
            active={role === "edit"}
            onClick={() => onChangeRole("edit")}
          />
          <InlineRoleItem
            label="Can view"
            active={role === "view"}
            onClick={() => onChangeRole("view")}
          />
          {showRemove && onRemove && (
            <InlineRoleItem
              label="Remove from page"
              danger
              disabled={!!removeDisabled}
              onClick={onRemove}
            />
          )}
        </div>
      )}
    </div>
  );
}

function InlineRoleItem({
  label,
  active,
  danger,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2"
      style={{
        padding: "5px 8px",
        borderRadius: 6,
        fontSize: 13.5,
        color: disabled
          ? "var(--color-whisper)"
          : danger
            ? "var(--color-amber)"
            : "var(--color-body)",
        background: "transparent",
        cursor: disabled ? "default" : "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--color-rail)";
      }}
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLButtonElement).style.background =
          "transparent")
      }
    >
      <span style={{ width: 14, display: "inline-grid", placeItems: "center" }}>
        {active && (
          <Ic
            path={CHECK}
            size={12}
            color="var(--color-accent)"
            strokeWidth={2.2}
          />
        )}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}
