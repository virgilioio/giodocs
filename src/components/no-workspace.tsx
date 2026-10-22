import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * What a signed-in person sees when they aren't in a workspace yet, or when
 * their membership couldn't be read: never an empty screen (Allan,
 * 2026-10-22). Same card as the invite page.
 */
export function NoWorkspace({
  email,
  failed,
  checking,
  onCheckAgain,
}: {
  email: string | null;
  failed: boolean;
  checking: boolean;
  onCheckAgain: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-login">
        <div
          role={failed ? "alert" : undefined}
          className="animate-cardIn rounded-card border border-line bg-surface shadow-card text-center"
          style={{
            padding: "30px 32px 26px",
            boxShadow: "var(--shadow-card), var(--shadow-popover)",
          }}
        >
          <img src="/gio-docs-logo.svg" alt="Gio Docs" className="h-[58px] w-auto block mx-auto" />
          <h1 className="mt-5 font-display text-title text-noir">
            {failed ? "Couldn't open your workspace" : "You're not in Gio Docs yet"}
          </h1>
          {failed ? (
            <p className="mt-2 text-meta text-secondary">Check your connection and try again.</p>
          ) : (
            <p className="mt-2 text-meta text-secondary">
              You're signed in as <span className="text-strong">{email ?? "this account"}</span>,
              which isn't part of a Gio Docs workspace. If you were invited, open the link in your
              invitation email. Otherwise, ask an admin to give you access.
            </p>
          )}
          <button
            type="button"
            disabled={checking}
            onClick={onCheckAgain}
            className="mt-5 flex w-full items-center justify-center rounded-lg bg-btn font-bold text-ui text-btnFg disabled:opacity-60"
            style={{ height: 44 }}
          >
            {failed ? "Try again" : "Check again"}
          </button>
          <button
            type="button"
            disabled={leaving}
            onClick={async () => {
              setLeaving(true);
              await supabase.auth.signOut();
            }}
            className="mt-2 flex w-full items-center justify-center rounded-lg border border-line bg-surface font-bold text-ui text-noir"
            style={{ height: 44 }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
