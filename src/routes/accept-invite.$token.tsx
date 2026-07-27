import { useEffect } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";

// Legacy URL — previous emails linked here. Redirect to the new /invite/$token
// route so old links keep working.
export const Route = createFileRoute("/accept-invite/$token")({
  head: () => ({
    meta: [
      { title: "Accept invite — Gio Docs" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LegacyRedirect,
});

function LegacyRedirect() {
  const { token } = useParams({ from: "/accept-invite/$token" });
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/invite/$token", params: { token }, replace: true });
  }, [token, navigate]);
  return <div className="min-h-screen bg-canvas" aria-hidden />;
}
