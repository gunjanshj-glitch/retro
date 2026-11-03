/**
 * Where the mobile app may be sent back to (sign-in return, payment return).
 *
 * An unchecked redirect target is an open redirect that also carries a one-time code, so the allow-list is
 * exact, not a prefix: production accepts only the app's own scheme and its https app link. Expo Go cannot
 * use `retro://` (its scheme is `exp`), so `exp://` and `exp+retro://` are honoured only where
 * `ALLOW_EXPO_GO_REDIRECTS` is set, which is development and preview and never production.
 */
import type { Env } from "./http";

export const APP_REDIRECT = "retro://auth";
export const APP_PAY_REDIRECT = "retro://pay-result";

function origin(env: Env): string {
  return (env.PUBLIC_SITE_URL || "https://retroholidays.in").replace(/\/$/, "");
}

/** `raw` with no query or fragment; the caller appends its own parameters. Null if not allowed. */
export function allowedAppRedirect(raw: string | null | undefined, env: Env, kind: "auth" | "pay" = "auth"): string | null {
  if (!raw || raw.length > 300 || /[\u0000-\u001f\s]/.test(raw)) return null;
  const exact = kind === "auth" ? [APP_REDIRECT, `${origin(env)}/app/auth`] : [APP_PAY_REDIRECT, `${origin(env)}/app/pay-result`];
  if (exact.includes(raw)) return raw;
  if (env.ALLOW_EXPO_GO_REDIRECTS === "1" && /^exp(\+retro)?:\/\/[A-Za-z0-9.:_-]+(\/--\/[A-Za-z0-9/_-]*)?$/.test(raw)) return raw;
  return null;
}

/** `base` plus query parameters, correct whether or not `base` already has a query. */
export function withParams(base: string, params: Record<string, string>): string {
  const sep = base.includes("?") ? "&" : "?";
  return base + sep + new URLSearchParams(params).toString();
}
