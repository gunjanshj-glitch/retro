"use client";

/**
 * "Request a quote" on a package page.
 *
 * Signed in: opens the request form straight away. Signed out: opens the
 * sign-in modal first and then the form — for email/password that happens in
 * place; for Google/Facebook the browser leaves the site, so the return
 * address carries `?requestQuote=1` and the form opens on arrival.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { PackageRequestModal, type PackageRequestPackage } from "./PackageRequestModal";

const RESUME_PARAM = "requestQuote";

export function PackageRequestButton({ pkg }: { pkg: PackageRequestPackage }) {
  const { user, loading, requireAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Back from an OAuth round trip: reopen the form once the session is known.
  useEffect(() => {
    if (loading) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(RESUME_PARAM)) return;
    url.searchParams.delete(RESUME_PARAM);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    // Deferred a tick: opening is a reaction to the URL, not a render input.
    if (user) queueMicrotask(() => setOpen(true));
  }, [loading, user]);

  function handleClick() {
    requireAuth(() => setOpen(true), {
      redirectTo: `${window.location.pathname}?${RESUME_PARAM}=1`,
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-2 rounded-full px-6 py-3 font-medium transition-transform hover:scale-[1.02]"
        style={{ background: "var(--accent)", color: "var(--deep)" }}
      >
        Request a quote
        <span aria-hidden="true">→</span>
      </button>
      <PackageRequestModal pkg={pkg} open={open} onClose={close} />
    </>
  );
}
