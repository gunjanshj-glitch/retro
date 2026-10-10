"use client";

/**
 * Sign-in/register modal.
 *
 * Opened on demand (by `useAuth().requireAuth`/`openLogin`) rather than
 * living on its own route, since the only place the site ever needs an
 * account is the last step of the planner — interrupting that flow with a
 * full navigation would lose the traveller's place.
 */
import { useEffect, useState, type FormEvent } from "react";
import {
  fetchOAuthProviders,
  login,
  registerAccount,
  startOAuth,
  type AuthUser,
  type OAuthProviderAvailability,
} from "@/lib/auth-client";

type Mode = "login" | "register";

type Props = {
  open: boolean;
  onClose: () => void;
  onAuthenticated: (user: AuthUser) => void;
  /** Where Google/Facebook sign-in returns to. Defaults to the current page. */
  redirectTo?: string;
};

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-[rgba(7,26,31,0.72)] px-4 py-2.5 text-sm text-[var(--text)] outline-none transition placeholder:text-[rgba(155,179,180,0.55)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[rgba(253,191,0,0.12)]";

export function AuthModal({ open, onClose, onAuthenticated, redirectTo: redirectOverride }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<OAuthProviderAvailability>({ google: false, facebook: false });

  useEffect(() => {
    if (open) fetchOAuthProviders().then(setProviders);
  }, [open]);

  // Reset to a clean login form each time the modal is reopened, so a
  // previous attempt's error never lingers into an unrelated one. Done during
  // render (React's documented pattern for "adjusting state when a prop
  // changes") rather than in an effect, which would set state synchronously
  // on every open and cause an extra render pass.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode("login");
      setError(null);
      setSubmitting(false);
    }
  }

  if (!open) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    const result =
      mode === "login"
        ? await login({ email, password })
        : await registerAccount({ name: String(data.get("name") ?? "").trim(), email, password });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onAuthenticated(result.data.user);
  }

  const redirectTo =
    redirectOverride ?? (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/plan");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "login" ? "Sign in" : "Create an account"}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        className="relative w-full max-w-sm rounded-3xl border border-white/10 p-7 shadow-2xl"
        style={{ background: "linear-gradient(160deg, rgba(14,36,42,0.98), rgba(9,24,28,0.96))" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-5 top-5 text-lg leading-none"
          style={{ color: "var(--muted)" }}
        >
          ×
        </button>

        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--accent)" }}>
          {mode === "login" ? "Welcome back" : "Create your account"}
        </p>
        <h2 className="mt-2 font-display text-2xl">
          {mode === "login" ? "Sign in to continue" : "Sign up to continue"}
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Needed to send your request and keep track of the quotes we send back.
        </p>

        {(providers.google || providers.facebook) && (
          <div className="mt-6 flex flex-col gap-2.5">
            {providers.google && (
              <button
                type="button"
                onClick={() => startOAuth("google", redirectTo)}
                className="flex items-center justify-center gap-2.5 rounded-full border px-4 py-2.5 text-sm font-medium transition hover:bg-white/5"
                style={{ borderColor: "var(--hairline)" }}
              >
                <GoogleMark /> Continue with Google
              </button>
            )}
            {providers.facebook && (
              <button
                type="button"
                onClick={() => startOAuth("facebook", redirectTo)}
                className="flex items-center justify-center gap-2.5 rounded-full border px-4 py-2.5 text-sm font-medium transition hover:bg-white/5"
                style={{ borderColor: "var(--hairline)" }}
              >
                <FacebookMark /> Continue with Facebook
              </button>
            )}
            <div className="my-1 flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
              <span className="h-px flex-1 bg-white/10" />
              or
              <span className="h-px flex-1 bg-white/10" />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3.5">
          {mode === "register" && (
            <label className="text-sm font-medium">
              Your name
              <input name="name" required autoComplete="name" placeholder="How should we address you?" className={fieldClassName} />
            </label>
          )}
          <label className="text-sm font-medium">
            Email address
            <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" className={fieldClassName} />
          </label>
          <label className="text-sm font-medium">
            Password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="At least 8 characters"
              className={fieldClassName}
            />
          </label>

          {error && (
            <p className="text-xs" style={{ color: "#f28b82" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-[var(--deep)] transition hover:-translate-y-0.5 disabled:opacity-60"
          >
            {submitting ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs" style={{ color: "var(--muted)" }}>
          {mode === "login" ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
            className="font-semibold underline-offset-2 hover:underline"
            style={{ color: "var(--accent)" }}
          >
            {mode === "login" ? "Create an account" : "Sign in instead"}
          </button>
        </p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.25h3.32l-.53 3.49h-2.79V24C19.61 23.09 24 18.1 24 12.07z"
      />
    </svg>
  );
}
