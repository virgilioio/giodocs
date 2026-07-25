import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Gio Docs" },
      { name: "description", content: "Sign in to Gio Docs." },
      { property: "og:title", content: "Sign in — Gio Docs" },
      { property: "og:description", content: "Sign in to Gio Docs." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

type DomainState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "member"; domain: string }
  | { kind: "invite_only"; domain: string };

function LoginPage() {
  const { session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (session) navigate({ to: "/", replace: true });
  }, [session, navigate]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorNonce, setErrorNonce] = useState(0);
  const [domain, setDomain] = useState<DomainState>({ kind: "idle" });
  const passwordRef = useRef<HTMLInputElement>(null);

  // Debounced domain recognition (350ms) once value contains a dot after '@'.
  useEffect(() => {
    const at = email.indexOf("@");
    const rest = at >= 0 ? email.slice(at + 1) : "";
    if (at < 0 || !rest.includes(".")) {
      setDomain({ kind: "idle" });
      return;
    }
    setDomain({ kind: "checking" });
    const handle = setTimeout(async () => {
      const { data, error: rpcError } = await supabase.rpc("domain_status", { p_email: email });
      if (rpcError) {
        setDomain({ kind: "idle" });
        return;
      }
      const d = rest.toLowerCase();
      if (data === "member") setDomain({ kind: "member", domain: d });
      else setDomain({ kind: "invite_only", domain: d });
    }, 350);
    return () => clearTimeout(handle);
  }, [email]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError("That sign-in didn't work. Check your email and password and try again.");
      setErrorNonce((n) => n + 1);
      setPassword("");
      passwordRef.current?.focus();
      return;
    }
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-login">
        <form
          onSubmit={handleSubmit}
          className="animate-cardIn rounded-card border border-line bg-surface shadow-card"
          style={{ padding: "30px 32px 26px", boxShadow: "var(--shadow-card), var(--shadow-popover)" }}
        >
          <div className="flex items-center" style={{ height: 24 }}>
            <span className="font-display font-bold text-noir" style={{ fontSize: 20, letterSpacing: "-0.03em" }}>
              Gio Docs
            </span>
          </div>

          <h1 className="mt-5 font-display text-title text-noir">Welcome back</h1>
          <p className="mt-1 text-ui text-secondary">
            Sign in to Virgilio LLC — your pages are where you left them.
          </p>

          <div className="mt-5">
            <label htmlFor="email" className="block text-meta font-bold text-strong">
              Work email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-line bg-track px-3 py-2 text-ui text-body outline-none transition-colors focus:border-accent"
            />
            <DomainHint state={domain} />
          </div>

          <div className="mt-4">
            <label htmlFor="password" className="block text-meta font-bold text-strong">
              Password
            </label>
            <div className="relative mt-1.5">
              <input
                id="password"
                ref={passwordRef}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
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
          </div>

          <div className="mt-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-meta text-secondary">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={(e) => setKeepSignedIn(e.target.checked)}
                style={{ accentColor: "var(--color-accent)" }}
                className="h-4 w-4"
              />
              Keep me signed in
            </label>
            <a href="#" className="text-meta font-bold text-accent hover:text-accentHover">
              Forgot password?
            </a>
          </div>

          {error && (
            <div
              key={errorNonce}
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-lg border border-dangerRing bg-dangerTint px-3 py-2 animate-shake"
            >
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <span className="text-meta text-danger">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-noir font-bold text-ui"
            style={{ height: 44, color: submitting ? "var(--color-secondary)" : "var(--color-track)" }}
          >
            {submitting ? (
              <>
                <Spinner className="h-4 w-4" />
                Checking…
              </>
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        <p className="mt-5 text-center text-caption text-secondary">
          By continuing you accept the Virgilio workspace terms.
        </p>
        <p className="mt-1 text-center text-label uppercase text-secondary">
          One object · many views
        </p>
      </div>
    </div>
  );
}

function DomainHint({ state }: { state: DomainState }) {
  if (state.kind === "idle" || state.kind === "checking") return null;
  if (state.kind === "member") {
    return (
      <div className="mt-2 flex items-start gap-1.5">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-accentDot" />
        <span className="text-meta text-accent">
          {state.domain} — you'll join Virgilio LLC as a member, with everything the team can see.
        </span>
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-start gap-1.5">
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-amberDot" />
      <span className="text-meta text-amberInk">
        We don't recognise {state.domain}. Ask an owner to invite you to the pages you need.
      </span>
    </div>
  );
}

// 24x24 viewBox, single <path>, fill none, stroke currentColor.
function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 3l8 3v6c0 4.5-3.2 8.4-8 9-4.8-.6-8-4.5-8-9V6l8-3zm-3.5 9.5l2.5 2.5 5-5" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 21a9 9 0 100-18 9 9 0 000 18zm0-13v.01M12 11v6" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 3l10 18H2L12 3zm0 6v5m0 3v.01" />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${className ?? ""} animate-spin`} aria-hidden>
      <path d="M12 3a9 9 0 019 9" />
    </svg>
  );
}
