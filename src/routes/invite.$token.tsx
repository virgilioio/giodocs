import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  copyForState,
  canSubmitSignup,
  humanizeAcceptError,
  MIN_PASSWORD_LENGTH,
  type InviteState,
} from "@/lib/invite-copy";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { title: "Accept invite — Gio Docs" },
      { name: "description", content: "Accept your Gio Docs workspace invitation." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InvitePage,
});

type Preview = {
  workspace_name: string;
  workspace_icon: string;
  invited_email: string;
  inviter_name: string;
  role: string;
  state: InviteState;
};

function InvitePage() {
  const { token } = useParams({ from: "/invite/$token" });
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<Preview | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("invite_preview", { p_token: token });
      if (cancelled) return;
      if (error || !data || !data.length) {
        setPreview({
          workspace_name: "",
          workspace_icon: "",
          invited_email: "",
          inviter_name: "",
          role: "member",
          state: "not_found",
        });
        return;
      }
      setPreview(data[0] as Preview);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (preview === "loading" || loading) {
    return <Shell><Loading /></Shell>;
  }

  return (
    <Shell>
      <InviteCard
        preview={preview}
        session={session}
        onAccepted={() => navigate({ to: "/", replace: true })}
        onGoLogin={() =>
          navigate({
            to: "/login",
            search: { next: `/invite/${token}` } as never,
            replace: true,
          })
        }
        token={token}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-login">
        <div
          className="animate-cardIn rounded-card border border-line bg-surface shadow-card"
          style={{ padding: "30px 32px 26px", boxShadow: "var(--shadow-card), var(--shadow-popover)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="text-center">
      <img src="/gio-docs-logo.svg" alt="Gio Docs" className="h-[58px] w-auto block mx-auto" />
      <p className="mt-6 text-ui text-secondary">Loading your invite…</p>
    </div>
  );
}

function InviteCard({
  preview,
  session,
  onAccepted,
  onGoLogin,
  token,
}: {
  preview: Preview;
  session: ReturnType<typeof useAuth>["session"];
  onAccepted: () => void;
  onGoLogin: () => void;
  token: string;
}) {
  const state = preview.state;

  if (state === "not_found" || state === "expired") {
    const c = copyForState(state, { inviterName: preview.inviter_name });
    return (
      <div className="text-center">
        <img src="/gio-docs-logo.svg" alt="Gio Docs" className="h-[58px] w-auto block mx-auto" />
        <h1 className="mt-5 font-display text-title text-noir">{c.heading}</h1>
        <p className="mt-2 text-meta text-secondary">{c.body}</p>
      </div>
    );
  }

  if (state === "accepted") {
    const c = copyForState("accepted");
    return (
      <div className="text-center">
        <img src="/gio-docs-logo.svg" alt="Gio Docs" className="h-[58px] w-auto block mx-auto" />
        <h1 className="mt-5 font-display text-title text-noir">{c.heading}</h1>
        <p className="mt-2 text-meta text-secondary">{c.body}</p>
        <button
          type="button"
          onClick={onGoLogin}
          className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-noir px-5 font-bold text-ui text-track"
        >
          Go to sign in
        </button>
      </div>
    );
  }

  // valid
  const sessionEmail = session?.user.email?.toLowerCase() ?? null;
  const invitedEmail = preview.invited_email.toLowerCase();

  return (
    <ValidInvite
      preview={preview}
      sessionEmail={sessionEmail}
      invitedEmail={invitedEmail}
      onAccepted={onAccepted}
      onGoLogin={onGoLogin}
      token={token}
    />
  );
}

function Header({ preview }: { preview: Preview }) {
  return (
    <div className="text-center">
      <div className="mx-auto" style={{ fontSize: 32, lineHeight: 1 }} aria-hidden>
        {preview.workspace_icon || "🧭"}
      </div>
      <h1 className="mt-3 font-display text-title text-noir">
        {preview.inviter_name || "Someone"} invited you to {preview.workspace_name}
      </h1>
      <p className="mt-1 text-meta text-muted">{preview.invited_email}</p>
    </div>
  );
}

function ValidInvite({
  preview,
  sessionEmail,
  invitedEmail,
  onAccepted,
  onGoLogin,
  token,
}: {
  preview: Preview;
  sessionEmail: string | null;
  invitedEmail: string;
  onAccepted: () => void;
  onGoLogin: () => void;
  token: string;
}) {
  // Case: signed in as someone else.
  if (sessionEmail && sessionEmail !== invitedEmail) {
    return (
      <MismatchCase
        preview={preview}
        sessionEmail={sessionEmail}
        invitedEmail={invitedEmail}
      />
    );
  }

  // Case: signed in as the invited email — one-tap join.
  if (sessionEmail === invitedEmail) {
    return <JoinCase preview={preview} token={token} onAccepted={onAccepted} />;
  }

  // Case: no session — set a password to create the account.
  return (
    <SignupCase
      preview={preview}
      invitedEmail={invitedEmail}
      token={token}
      onAccepted={onAccepted}
      onSwitchToLogin={onGoLogin}
    />
  );
}

function MismatchCase({
  preview,
  sessionEmail,
  invitedEmail,
}: {
  preview: Preview;
  sessionEmail: string;
  invitedEmail: string;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Header preview={preview} />
      <p className="mt-5 text-meta text-secondary text-center">
        You're signed in as <span className="text-strong">{sessionEmail}</span>, but this invite is for{" "}
        <span className="text-strong">{invitedEmail}</span>.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await supabase.auth.signOut();
          // Component will re-render into SignupCase once session flips to null.
        }}
        className="mt-5 flex w-full items-center justify-center rounded-lg bg-noir font-bold text-ui text-track"
        style={{ height: 44 }}
      >
        Sign out and continue
      </button>
      <button
        type="button"
        onClick={() => navigate({ to: "/", replace: true })}
        className="mt-2 flex w-full items-center justify-center rounded-lg border border-line bg-surface font-bold text-ui text-noir"
        style={{ height: 44 }}
      >
        Stay signed in
      </button>
    </div>
  );
}

function JoinCase({
  preview,
  token,
  onAccepted,
}: {
  preview: Preview;
  token: string;
  onAccepted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  return (
    <div>
      <Header preview={preview} />
      {error && <ErrorPanel key={nonce} message={error} />}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const { error: rpcError } = await supabase.rpc("accept_workspace_invite", { p_token: token });
          if (rpcError) {
            setBusy(false);
            setError(humanizeAcceptError(rpcError.message));
            setNonce((n) => n + 1);
            return;
          }
          onAccepted();
        }}
        className="mt-6 flex w-full items-center justify-center rounded-lg bg-noir font-bold text-ui text-track"
        style={{ height: 44, color: busy ? "var(--color-secondary)" : "var(--color-track)" }}
      >
        {busy ? "Joining…" : `Join ${preview.workspace_name}`}
      </button>
    </div>
  );
}

function SignupCase({
  preview,
  invitedEmail,
  token,
  onAccepted,
  onSwitchToLogin,
}: {
  preview: Preview;
  invitedEmail: string;
  token: string;
  onAccepted: () => void;
  onSwitchToLogin: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const canSubmit = useMemo(() => canSubmitSignup(fullName, password), [fullName, password]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);

    const { error: signUpError } = await supabase.auth.signUp({
      email: invitedEmail,
      password,
      options: { data: { full_name: fullName.trim() } },
    });

    if (signUpError) {
      const msg = signUpError.message || "";
      if (/already registered|already exists|already been registered/i.test(msg)) {
        setAlreadyRegistered(true);
        setBusy(false);
        return;
      }
      setBusy(false);
      setError(msg || "Couldn't create your account. Try again.");
      setNonce((n) => n + 1);
      return;
    }

    // Session exists now (email confirmation disabled). Accept the invite.
    const { error: acceptError } = await supabase.rpc("accept_workspace_invite", { p_token: token });
    if (acceptError) {
      setBusy(false);
      setError(humanizeAcceptError(acceptError.message));
      setNonce((n) => n + 1);
      return;
    }
    onAccepted();
  }

  if (alreadyRegistered) {
    return (
      <div>
        <Header preview={preview} />
        <p className="mt-5 text-meta text-secondary text-center">
          You already have a Gio Docs account with this email. Sign in to accept the invite.
        </p>
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="mt-5 flex w-full items-center justify-center rounded-lg bg-noir font-bold text-ui text-track"
          style={{ height: 44 }}
        >
          Go to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <Header preview={preview} />
      <h2 className="mt-5 text-subhead font-bold text-noir">Set a password to join</h2>

      <div className="mt-4">
        <label htmlFor="full_name" className="block text-meta font-bold text-strong">
          Your name
        </label>
        <input
          id="full_name"
          ref={nameRef}
          type="text"
          autoComplete="name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="mt-1.5 block w-full rounded-lg border border-line bg-track px-3 py-2 text-ui text-body outline-none transition-colors focus:border-accent"
        />
      </div>

      <div className="mt-4">
        <label className="block text-meta font-bold text-strong">Email</label>
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-rail px-3 py-2 text-ui text-secondary">
          <LockIcon className="h-4 w-4 shrink-0 text-muted" />
          <span className="truncate">{invitedEmail}</span>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="password" className="block text-meta font-bold text-strong">
          Password
        </label>
        <div className="relative mt-1.5">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="block w-full rounded-lg border border-line bg-track px-3 py-2 pr-16 text-ui text-body outline-none transition-colors focus:border-accent"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-2 my-auto h-6 px-1 text-meta font-bold text-secondary hover:text-strong"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-1.5 text-caption text-faint">
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
      </div>

      {error && <ErrorPanel key={nonce} message={error} />}

      <button
        type="submit"
        disabled={!canSubmit || busy}
        className="mt-5 flex w-full items-center justify-center rounded-lg bg-noir font-bold text-ui text-track disabled:opacity-60"
        style={{ height: 44, color: busy || !canSubmit ? "var(--color-secondary)" : "var(--color-track)" }}
      >
        {busy ? "Creating your account…" : `Join ${preview.workspace_name}`}
      </button>
    </form>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-lg border border-dangerRing bg-dangerTint px-3 py-2 animate-shake"
    >
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
      <span className="text-meta text-danger">{message}</span>
    </div>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 3l10 18H2L12 3zm0 6v5m0 3v.01" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 118 0v3" />
    </svg>
  );
}
