/**
 * Permissions popover.
 *
 * One component with two entry points:
 *   1. the on-page permissions chip (opens anchored below the chip);
 *   2. the "Who can see this" row in the page ⋯ menu (opens anchored
 *      top-right below the menu — the menu stays mounted behind it).
 *
 * Both entry points call `openPermissionsPopover(rect)` — a tiny module-
 * level store — and this file's <PermissionsPopoverHost /> renders the
 * panel through a portal. Escape closes the popover only; outside click
 * (outside both panel AND anchor rect) also closes.
 *
 * This phase is display + remove-only. Adding people is out of scope.
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
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/query-keys";
import { usePageAccess } from "@/hooks/use-workspace-data";
import { useToast } from "@/lib/toast";
import { useAuth } from "@/lib/auth-context";
import type { PageAccessRow, PageFull } from "@/lib/types";

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
}: {
  path: string;
  size?: number;
  color?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={1.9}
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
const XMARK = "M6 6l12 12M18 6L6 18";

/* ────────────── Avatar ────────────── */

function Avatar({
  name,
  email,
  tint,
  ink,
}: {
  name: string | null;
  email: string | null;
  tint: string | null;
  ink: string | null;
}) {
  const initial = (name || email || "?").slice(0, 1).toUpperCase();
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: 20,
        height: 20,
        background: tint ?? "var(--color-sunken)",
        color: ink ?? "var(--color-noir)",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {initial}
    </span>
  );
}

/* ────────────── Remove mutation (inline) ────────────── */

function useRemovePageAccess(pageId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return {
    remove: async (row: PageAccessRow) => {
      const key = qk.pageAccess(pageId);
      const prev = qc.getQueryData<PageAccessRow[]>(key);
      // Optimistic patch.
      qc.setQueryData<PageAccessRow[]>(key, (cur) =>
        (cur ?? []).filter(
          (r) =>
            !(
              r.page_id === row.page_id &&
              (r.user_id ?? "") === (row.user_id ?? "") &&
              (r.guest_email ?? "") === (row.guest_email ?? "")
            ),
        ),
      );
      let q = supabase
        .from("page_access")
        .delete()
        .eq("page_id", row.page_id);
      if (row.user_id) q = q.eq("user_id", row.user_id);
      else q = q.is("user_id", null);
      if (row.guest_email) q = q.eq("guest_email", row.guest_email);
      else q = q.is("guest_email", null);
      const { error } = await q;
      if (error) {
        qc.setQueryData(key, prev);
        toast.push("Couldn't remove — you don't have permission here.");
        return;
      }
      toast.push("Access removed");
    },
  };
}

/* ────────────── Positioning ────────────── */

const WIDTH = 300;

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
      const panelH = panelRef.current?.offsetHeight ?? 320;
      // Right-align to the anchor's right edge.
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

  // Rules of can_manage_page_access, mirrored client-side:
  //  - workspace owner, always
  //  - members on 'workspace' pages, always
  //  - on 'restricted' pages, only holders of write in page_access
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

  const isWorkspace = page.access_type === "workspace";
  const { panelRef, pos } = usePosition(open, anchor);
  const { remove } = useRemovePageAccess(page.id);

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
      // Anchor rect click-through — a second click on the chip toggles.
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

  // Rows to render.
  type Row = {
    key: string;
    kind: "member" | "grant-user" | "grant-guest";
    name: string;
    tint: string | null;
    ink: string | null;
    hint: string;
    access?: PageAccessRow;
  };

  const rows: Row[] = useMemo(() => {
    const byId = new Map(members.map((m) => [m.user_id, m]));

    if (isWorkspace) {
      const memberRows: Row[] = members.map((m) => ({
        key: `m:${m.user_id}`,
        kind: "member" as const,
        name:
          m.profiles?.full_name ||
          m.profiles?.email ||
          "Unnamed",
        tint: m.profiles?.avatar_tint ?? null,
        ink: m.profiles?.avatar_ink ?? null,
        hint: m.role,
      }));

      const grantRows: Row[] = access.map((a) => {
        if (a.user_id) {
          const m = byId.get(a.user_id);
          return {
            key: `g:u:${a.user_id}`,
            kind: "grant-user" as const,
            name:
              m?.profiles?.full_name ||
              m?.profiles?.email ||
              "Unnamed",
            tint: m?.profiles?.avatar_tint ?? null,
            ink: m?.profiles?.avatar_ink ?? null,
            hint: a.capability,
            access: a,
          };
        }
        return {
          key: `g:e:${a.guest_email ?? ""}`,
          kind: "grant-guest" as const,
          name: a.guest_email ?? "guest",
          tint: null,
          ink: null,
          hint: "guest",
          access: a,
        };
      });

      return [...memberRows, ...grantRows];
    }

    // access_type === 'restricted'
    // Workspace owners always read; explicit grantees; deduped by user_id.
    const owners = members.filter((m) => m.role === "owner");
    const ownerRows: Row[] = owners.map((m) => ({
      key: `o:${m.user_id}`,
      kind: "member" as const,
      name: m.profiles?.full_name || m.profiles?.email || "Unnamed",
      tint: m.profiles?.avatar_tint ?? null,
      ink: m.profiles?.avatar_ink ?? null,
      hint: m.role,
    }));
    const ownerIds = new Set(owners.map((o) => o.user_id));
    const grantRows: Row[] = access
      .filter((a) => !(a.user_id && ownerIds.has(a.user_id)))
      .map((a) => {
        if (a.user_id) {
          const m = byId.get(a.user_id);
          return {
            key: `g:u:${a.user_id}`,
            kind: "grant-user" as const,
            name:
              m?.profiles?.full_name ||
              m?.profiles?.email ||
              "Unnamed",
            tint: m?.profiles?.avatar_tint ?? null,
            ink: m?.profiles?.avatar_ink ?? null,
            hint: a.capability,
            access: a,
          };
        }
        return {
          key: `g:e:${a.guest_email ?? ""}`,
          kind: "grant-guest" as const,
          name: a.guest_email ?? "guest",
          tint: null,
          ink: null,
          hint: `${a.capability} · guest`,
          access: a,
        };
      });
    return [...ownerRows, ...grantRows];
  }, [members, access, isWorkspace]);

  // Find where explicit grants start, for the separator.
  const firstGrantIdx = rows.findIndex(
    (r) => r.kind === "grant-user" || r.kind === "grant-guest",
  );

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Who can see this"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: WIDTH,
        zIndex: 95,
        visibility: pos ? "visible" : "hidden",
        background: "var(--color-surface)",
        border: "1px solid var(--color-line)",
        borderRadius: 12,
        boxShadow: "var(--shadow-popover)",
        animation: "popIn .12s ease-out",
      }}
      className="animate-popIn"
    >
      {/* Title */}
      <div
        className="font-display uppercase text-faint"
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: "0.07em",
          padding: "7px 10px 3px",
        }}
      >
        Who can see this
      </div>

      {/* Access line */}
      <div
        className="flex items-center gap-2 text-row text-body"
        style={{ padding: "4px 10px 8px" }}
      >
        <Ic
          path={isWorkspace ? GLOBE : LOCK}
          size={14}
          color="var(--color-muted)"
        />
        <span>
          {isWorkspace
            ? `Everyone at ${workspaceName || "this workspace"}`
            : "Only the people below"}
        </span>
      </div>

      {/* List */}
      <div style={{ borderTop: "1px solid var(--color-lineSoft)" }} />
      <div style={{ padding: "4px 4px" }}>
        {rows.map((r, i) => (
          <div key={r.key}>
            {i === firstGrantIdx && firstGrantIdx > 0 ? (
              <div
                style={{
                  borderTop: "1px solid var(--color-lineSoft)",
                  margin: "4px 6px",
                }}
              />
            ) : null}
            <PermRow
              row={r}
              canManage={canManage && !!r.access}
              onRemove={r.access ? () => void remove(r.access!) : undefined}
            />
          </div>
        ))}
        {rows.length === 0 && (
          <div
            className="text-meta text-muted"
            style={{ padding: "8px 10px" }}
          >
            No one has explicit access yet.
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid var(--color-lineSoft)",
          padding: "8px 7px 4px 10px",
          fontSize: 12.5,
          color: "var(--color-whisper)",
          lineHeight: 1.4,
        }}
      >
        Access is set per page. Nothing is inherited — this list is the whole
        story.
      </div>
    </div>,
    document.body,
  );
}

/* ────────────── Row ────────────── */

function PermRow({
  row,
  canManage,
  onRemove,
}: {
  row: {
    kind: "member" | "grant-user" | "grant-guest";
    name: string;
    tint: string | null;
    ink: string | null;
    hint: string;
  };
  canManage: boolean;
  onRemove?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 6px",
        borderRadius: 7,
        background: hover ? "var(--color-rail)" : "transparent",
      }}
    >
      {row.kind === "grant-guest" ? (
        <span
          className="grid shrink-0 place-items-center rounded-full"
          style={{
            width: 20,
            height: 20,
            background: "var(--color-sunken)",
            color: "var(--color-muted)",
            fontSize: 11,
          }}
        >
          @
        </span>
      ) : (
        <Avatar
          name={row.name}
          email={null}
          tint={row.tint}
          ink={row.ink}
        />
      )}
      <span
        className="min-w-0 flex-1 truncate text-row text-body"
        title={row.name}
      >
        {row.name}
      </span>
      <span
        style={{
          fontFamily: "'Lato', system-ui, sans-serif",
          fontSize: 12,
          color: "var(--color-whisper)",
          whiteSpace: "nowrap",
        }}
      >
        {row.hint}
      </span>
      {canManage && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${row.name}`}
          title="Remove"
          style={{
            width: 20,
            height: 20,
            display: "grid",
            placeItems: "center",
            borderRadius: 5,
            color: "var(--color-muted)",
            background: "transparent",
            opacity: hover ? 1 : 0,
            transition: "opacity .1s",
            cursor: "pointer",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              "var(--color-sunken)")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background =
              "transparent")
          }
        >
          <Ic path={XMARK} size={12} />
        </button>
      )}
    </div>
  );
}
