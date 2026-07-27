import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/accept-invite/$token")({
  head: () => ({
    meta: [
      { title: "Accept invite — Gio Docs" },
      { name: "description", content: "Accept your Gio Docs workspace invitation." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AcceptInvitePage,
});

type State =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "accepting" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

function AcceptInvitePage() {
  const { token } = useParams({ from: "/accept-invite/$token" });
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (loading) return;

    // Not signed in — bounce to /login carrying the invite path so login
    // returns here after a successful sign-in.
    if (!session) {
      const next = `/accept-invite/${token}`;
      navigate({
        to: "/login",
        search: { next } as never,
        replace: true,
      });
      setState({ kind: "signed_out" });
      return;
    }

    let cancelled = false;
    (async () => {
      setState({ kind: "accepting" });
      const { error } = await supabase.rpc("accept_workspace_invite", { p_token: token });
      if (cancelled) return;
      if (error) {
        setState({ kind: "error", message: humanize(error.message) });
        return;
      }
      setState({ kind: "ok" });
      // Small hold so the user reads "You're in".
      setTimeout(() => {
        if (!cancelled) navigate({ to: "/", replace: true });
      }, 900);
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, session, token, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div
        className="w-full max-w-login rounded-card border border-line bg-surface p-8 text-center"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="font-display text-heading font-bold text-noir">Gio Docs</div>
        <div className="mt-6">
          {state.kind === "loading" || state.kind === "accepting" || state.kind === "signed_out" ? (
            <>
              <h1 className="font-display text-title text-noir">Accepting your invite…</h1>
              <p className="mt-2 text-ui text-secondary">One moment.</p>
            </>
          ) : state.kind === "ok" ? (
            <>
              <h1 className="font-display text-title text-noir">You're in</h1>
              <p className="mt-2 text-ui text-secondary">Taking you to the workspace…</p>
            </>
          ) : (
            <>
              <h1 className="font-display text-title text-noir">This invite didn't work</h1>
              <p className="mt-2 text-ui text-secondary">{state.message}</p>
              <button
                type="button"
                onClick={() => navigate({ to: "/", replace: true })}
                className="mt-5 rounded-lg bg-noir px-4 py-2 text-ui font-bold text-track"
              >
                Go home
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function humanize(msg: string): string {
  if (/expired/i.test(msg)) return "This invite has expired. Ask an owner to send a new one.";
  if (/different email/i.test(msg))
    return "This invite is for a different email address. Sign in with that address to accept.";
  if (/not found/i.test(msg)) return "This invite link is not valid.";
  return msg;
}
