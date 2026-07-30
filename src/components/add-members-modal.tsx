import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/lib/toast";
import { useSendInvites } from "@/hooks/use-invites";

export type InviteRole = "Member" | "Owner";

export type PendingInvite = {
  email: string;
  name: string;
  role: InviteRole;
  tint: string;
  ink: string;
};

const AVATAR_TINTS = [
  "var(--color-accentTint)",
  "var(--color-amberRing)",
  "var(--color-blueWash)",
  "var(--color-purpleTint)",
  "var(--color-pinkTint)",
  "var(--color-yellowTint)",
];
const AVATAR_INKS = [
  "var(--color-accent)",
  "var(--color-amberInk)",
  "var(--color-blueInk)",
  "var(--color-purple)",
  "var(--color-pinkInk)",
  "var(--color-yellowInk)",
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const SPLIT_RE = /[,;\s]+/;

function hashIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1).toLowerCase())
    .join(" ") || email;
}

function domainOf(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase();
}

function joinWith(items: string[], sep: string): string {
  if (items.length <= 1) return items.map((d) => `@${d}`).join("");
  const withAt = items.map((d) => `@${d}`);
  return withAt.slice(0, -1).join(", ") + ` ${sep} ` + withAt[withAt.length - 1];
}

function Icon({ d, size = 15, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const ICON_PERSON_PLUS =
  "M10 3.6a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zM2.5 20.4v-1.6a4 4 0 0 1 4-4h7a4 4 0 0 1 4 4v1.6M19 6.5v6M22 9.5h-6";
const ICON_INFO =
  "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8h.01M11 12h1v5h1";
const ICON_SHIELD_CHECK =
  "M12 2.6l7.6 3.6v5.6c0 4.8-3.3 8.1-7.6 9.6-4.3-1.5-7.6-4.8-7.6-9.6V6.2zM9 11.8l2 2 4-4";
const ICON_ALERT =
  "M12 3.5 22 20H2Zm0 6v4m0 3h.01";
const ICON_MEMBER =
  "M12 3.4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20.6v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2";
const ICON_OWNER =
  "M12 2.6l7.6 3.6v5.6c0 4.8-3.3 8.1-7.6 9.6-4.3-1.5-7.6-4.8-7.6-9.6V6.2zM9 11.8l2 2 4-4";
const ICON_CHECK = "M5 12l5 5 9-11";

export function AddMembersModal({
  open,
  onClose,
  workspaceName,
  allowedDomains,
}: {
  open: boolean;
  onClose: () => void;
  workspaceName: string;
  allowedDomains: string[];
}) {
  const toast = useToast();
  const sendInvites = useSendInvites();
  const [emails, setEmails] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [role, setRole] = useState<InviteRole>("Member");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setEmails([]);
      setInput("");
      setRole("Member");
      setMessage("");
      // focus after paint
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const allowedLower = useMemo(
    () => allowedDomains.map((d) => d.toLowerCase()),
    [allowedDomains],
  );

  const isAllowed = (email: string) => allowedLower.includes(domainOf(email));

  const outside = emails.filter((e) => !isAllowed(e));
  const inside = emails.filter((e) => isAllowed(e));

  function commit(raw: string): { added: number; leftover: string } {
    const parts = raw.split(SPLIT_RE).filter(Boolean);
    let added = 0;
    let leftover = "";
    const next = [...emails];
    for (const part of parts) {
      const p = part.trim().toLowerCase();
      if (!p) continue;
      if (EMAIL_RE.test(p)) {
        if (!next.includes(p)) {
          next.push(p);
          added++;
        }
      } else {
        leftover = leftover ? `${leftover} ${part}` : part;
      }
    }
    if (added > 0) setEmails(next);
    return { added, leftover };
  }

  function handleCommit() {
    if (!input.trim()) return;
    const { added, leftover } = commit(input);
    if (added === 0 && leftover) {
      toast.push("That does not look like an email address.");
    }
    setInput(leftover);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " " || e.key === "Tab") {
      if (input.trim()) {
        e.preventDefault();
        handleCommit();
      }
      return;
    }
    if (e.key === "Backspace" && input === "" && emails.length > 0) {
      e.preventDefault();
      setEmails(emails.slice(0, -1));
    }
    // Escape intentionally NOT handled here — global handler owns it.
  }

  async function handleSend() {
    if (emails.length === 0 || sendInvites.isPending) return;
    try {
      const result = await sendInvites.mutateAsync({
        invites: emails.map((email) => ({
          email,
          role: role === "Owner" ? "owner" : "member",
        })),
        message: message.trim() || undefined,
      });
      const withNote = message.trim() ? " with your note" : "";
      const failed = result.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.push(
          result.sent === 1
            ? `Invite sent to ${result.results[0].email}${withNote}`
            : `${result.sent} invites sent${withNote}`,
        );
      } else if (result.sent > 0) {
        toast.push(
          `${result.sent} of ${result.total} invites sent · ${failed.length} failed`,
        );
      } else {
        toast.push(`Couldn't send: ${failed[0].error ?? "unknown error"}`);
        return; // keep modal open so the user can fix and retry
      }
      onClose();
    } catch (err) {
      toast.push(`Couldn't send: ${(err as Error).message}`);
    }
  }

  if (!open) return null;

  const domainsSentence = allowedDomains.length
    ? joinWith(allowedDomains, "or")
    : "the allowed domain";
  const domainsAnd = allowedDomains.length
    ? joinWith(allowedDomains, "and")
    : "the allowed domain";
  const primaryDomain = allowedDomains[0] ?? "example.com";
  const roleWord = role === "Owner" ? "an owner" : "a member";
  const personWord = (n: number) => (n === 1 ? "1 person" : `${n} people`);

  let hintState: "neutral" | "good" | "warn";
  let hintText: string;
  let hintIcon: string;
  let hintColor: React.CSSProperties;
  if (emails.length === 0) {
    hintState = "neutral";
    hintText = `Type an email and press Enter. Anyone at ${domainsSentence} joins as a member.`;
    hintIcon = ICON_INFO;
    hintColor = { color: "var(--color-secondary)" };
  } else if (outside.length === 0) {
    hintState = "good";
    const n = inside.length;
    hintText =
      n === 1
        ? `1 person joins as ${roleWord} with access to every page the team can see.`
        : `${n} people join as ${roleWord} with access to every page the team can see.`;
    hintIcon = ICON_SHIELD_CHECK;
    hintColor = { color: "var(--color-accent)" };
  } else {
    hintState = "warn";
    const n = outside.length;
    hintText =
      n === 1
        ? `1 address is outside ${domainsAnd}. They join as a guest and see nothing until someone shares a page with them.`
        : `${n} addresses are outside ${domainsAnd}. They each join as a guest and see nothing until someone shares a page with them.`;
    hintIcon = ICON_ALERT;
    hintColor = { color: "var(--color-amberInk)" };
  }

  const sendReady = emails.length > 0 && !sendInvites.isPending;
  const sendLabel = sendInvites.isPending
    ? "Sending…"
    : emails.length === 0
      ? "Send invites"
      : emails.length === 1
        ? "Send 1 invite"
        : `Send ${emails.length} invites`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add members"
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: "calc(var(--z-modal) + 5)",
        background: "rgba(13,13,9,.32)",
        backdropFilter: "blur(3px)",
        padding: "5vh 4vw",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-surface shadow-modal animate-palIn"
        style={{
          width: 460,
          maxWidth: "100%",
          maxHeight: "100%",
          overflowY: "auto",
          borderRadius: 14,
          padding: "26px 26px 20px",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-col items-center" style={{ gap: 9 }}>
          <div
            className="grid place-items-center bg-sunken text-strong"
            style={{ width: 42, height: 42, borderRadius: 12 }}
          >
            <Icon d={ICON_PERSON_PLUS} size={21} />
          </div>
          <h2
            className="font-display text-noir"
            style={{ fontSize: 21.5, fontWeight: 700, letterSpacing: "-0.04em" }}
          >
            Add members
          </h2>
          <p
            className="text-center text-secondary"
            style={{ fontSize: 14, maxWidth: 340, textWrap: "pretty" }}
          >
            Type or paste emails, separated by commas. They join{" "}
            {workspaceName || "the workspace"} and see every page the team can see.
          </p>
        </div>

        {/* PEOPLE */}
        <div style={{ marginTop: 22 }}>
          <div
            className="font-display text-faint"
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.085em",
              paddingBottom: 7,
            }}
          >
            PEOPLE
          </div>
          <div
            className="border border-line bg-track"
            style={{
              borderRadius: 9,
              padding: 8,
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
              cursor: "text",
            }}
            onClick={() => inputRef.current?.focus()}
          >
            {emails.map((email) => {
              const ok = isAllowed(email);
              return (
                <span
                  key={email}
                  className={
                    ok
                      ? "bg-accentTint text-accent"
                      : "bg-amberTint text-amberInk"
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    border: `1px solid ${ok ? "var(--color-accentRing)" : "var(--color-amberRing)"}`,
                    borderRadius: 7,
                    padding: "3px 6px 3px 9px",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {email}
                  <button
                    type="button"
                    aria-label={`Remove ${email}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEmails(emails.filter((x) => x !== email));
                    }}
                    style={{ opacity: 0.6, fontSize: 11, lineHeight: 1, padding: "0 2px" }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                const v = e.target.value;
                // handle paste with commas: split immediately
                if (/[,;\n]/.test(v)) {
                  const { leftover } = commit(v);
                  setInput(leftover);
                  return;
                }
                setInput(v);
              }}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (input.trim()) handleCommit();
              }}
              placeholder={
                emails.length === 0
                  ? `name@${primaryDomain}`
                  : "Add another…"
              }
              className="flex-1 bg-transparent text-body focus:outline-none"
              style={{ minWidth: 170, fontSize: 14, border: "none" }}
            />
          </div>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 12.5,
              lineHeight: 1.45,
              ...hintColor,
            }}
          >
            <Icon d={hintIcon} size={14} />
            <span>{hintText}</span>
          </div>
        </div>

        {/* ROLE */}
        <div style={{ marginTop: 18 }}>
          <div
            className="font-display text-faint"
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.085em",
              paddingBottom: 7,
            }}
          >
            ROLE
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <RoleCard
              selected={role === "Member"}
              onClick={() => setRole("Member")}
              icon={ICON_MEMBER}
              label="Member"
              description="Can read and edit every page, create views, and verify pages. Cannot publish team views or change workspace settings."
            />
            <RoleCard
              selected={role === "Owner"}
              onClick={() => setRole("Owner")}
              icon={ICON_OWNER}
              label="Owner"
              description="Everything a member can do, plus publishing team views, inviting people, and changing workspace settings."
            />
          </div>
        </div>

        {/* MESSAGE */}
        <div style={{ marginTop: 18 }}>
          <div style={{ paddingBottom: 7, display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              className="font-display text-faint"
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.085em",
              }}
            >
              MESSAGE
            </span>
            <span className="text-faint" style={{ fontSize: 12.5, fontWeight: 400 }}>
              optional
            </span>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a note to your invite…"
            className="border border-line bg-track"
            style={{
              width: "100%",
              boxSizing: "border-box",
              minHeight: 64,
              resize: "vertical",
              borderRadius: 9,
              padding: "9px 10px",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          />
        </div>

        {/* Inline failures — visible even if the toast is obscured */}
        {(() => {
          const failures = sendInvites.data?.results.filter((r) => !r.ok) ?? [];
          if (failures.length === 0) return null;
          return (
            <div
              role="alert"
              className="border border-amberRing bg-amberTint text-amberInk"
              style={{
                marginTop: 16,
                borderRadius: 9,
                padding: "10px 12px",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {failures.length === 1
                  ? "1 invite didn't send"
                  : `${failures.length} invites didn't send`}
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, listStyle: "disc" }}>
                {failures.map((f) => (
                  <li key={f.email}>
                    <span style={{ fontWeight: 700 }}>{f.email}</span>
                    {f.error ? <> — {f.error}</> : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })()}

        {/* Actions */}
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={!sendReady}
            className={sendReady ? "bg-btn text-btnFg" : "bg-sunken text-whisper"}
            style={{
              height: 42,
              borderRadius: 10,
              fontSize: 14.5,
              fontWeight: 700,
              cursor: sendReady ? "pointer" : "default",
            }}
          >
            {sendLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-secondary hover:bg-sunken"
            style={{ height: 38, borderRadius: 10, fontSize: 14, width: "100%" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleCard({
  selected,
  onClick,
  icon,
  label,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-start gap-3 text-left " +
        (selected
          ? "bg-accentTint"
          : "bg-surface hover:border-rule")
      }
      style={{
        border: `1px solid ${selected ? "var(--color-accentRing)" : "var(--color-line)"}`,
        borderRadius: 9,
        padding: "10px 12px",
        cursor: "pointer",
      }}
    >
      <Icon
        d={icon}
        size={16}
        className={selected ? "text-accent" : "text-faint"}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="text-noir" style={{ fontSize: 14, fontWeight: 700 }}>
          {label}
        </div>
        <div
          className="text-secondary"
          style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 2, textWrap: "pretty" }}
        >
          {description}
        </div>
      </div>
      {selected && <Icon d={ICON_CHECK} size={15} className="text-accent" />}
    </button>
  );
}
