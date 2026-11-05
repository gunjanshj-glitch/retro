"use client";

/**
 * Landing form for the emailed link (`/reset-password?token=…`). Reads the
 * token from the URL in an effect (static export — no server-side params),
 * then strips it from the address bar so it isn't left in history.
 */
import { useEffect, useState, type FormEvent } from "react";
import { resetPassword } from "@/lib/auth-client";

const fieldClassName =
  "mt-1.5 w-full min-h-11 rounded-xl border border-[var(--line-strong)] bg-[var(--card)] px-4 py-2.5 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[#6b7c8d] focus:border-[var(--accent)] focus:ring-4 focus:ring-[rgba(198,61,23,0.12)]";

export function ResetPasswordForm() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    queueMicrotask(() => setToken(t));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirm") ?? "")) {
      setError("The two passwords don't match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const res = await resetPassword({ token, password });
    if (!res.ok) {
      setSubmitting(false);
      setError(res.error);
      return;
    }
    // Full navigation so the app re-reads the new session cookie.
    window.location.assign(res.data.admin ? "/admin" : "/my-requests");
  }

  if (token === undefined) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!token) {
    return (
      <p style={{ color: "var(--muted)" }}>
        This link is missing its token. Open &ldquo;Forgot password?&rdquo; on the sign-in form to get a new one.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <label className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
        New password
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={fieldClassName}
        />
      </label>
      <label className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
        Confirm password
        <input
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={fieldClassName}
        />
      </label>
      {error && (
        <p
          role="alert"
          className="rounded-xl px-3.5 py-2.5 text-xs"
          style={{ color: "var(--danger)", background: "var(--danger-soft)" }}
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="mt-1 inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--sun)] px-6 py-2.5 text-sm font-bold text-[var(--on-sun)] shadow-[0_6px_18px_rgba(242,169,0,0.32)] transition hover:brightness-[0.97] disabled:opacity-60"
      >
        {submitting ? "Please wait…" : "Save password and sign in"}
      </button>
    </form>
  );
}
