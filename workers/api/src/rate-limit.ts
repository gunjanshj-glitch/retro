/**
 * Fixed-window rate limiting on D1.
 *
 * D1 rather than KV on purpose: KV's free tier allows ~1,000 writes a day, which
 * a login counter would burn in minutes, and KV is eventually consistent, which
 * is the wrong property for a counter. One atomic upsert per check.
 *
 * Fails open: if the counter cannot be read or written, the request goes
 * through. A limiter outage must never become a site outage.
 */
import type { Env } from "./http";
import { json } from "./http";

async function digest(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The caller's address, or null when the platform did not supply one (local dev, tests). */
export function clientIp(request: Request): string | null {
  return request.headers.get("CF-Connecting-IP");
}

/**
 * Counts one hit against `bucket` for `id` and reports whether the caller is over `limit`
 * within the current `windowSeconds`. Identifiers are hashed before storage, so no email
 * address or IP is kept in the table.
 */
export async function overLimit(env: Env, bucket: string, id: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const window = Math.floor(now / windowSeconds);
    const row = await env.DB.prepare(
      `INSERT INTO rate_limit (k, w, n, exp) VALUES (?, ?, 1, ?) ON CONFLICT (k, w) DO UPDATE SET n = n + 1 RETURNING n`,
    )
      .bind(`${bucket}:${await digest(id)}`, window, (window + 1) * windowSeconds + 60)
      .first<{ n: number }>();
    return (row?.n ?? 0) > limit;
  } catch (error) {
    console.error("Rate limiter unavailable; allowing request", error);
    return false;
  }
}

/** Applies the per-IP limit when an address is known. Returns a 429 response, or null to continue. */
export async function limitByIp(request: Request, env: Env, bucket: string, limit: number, windowSeconds: number): Promise<Response | null> {
  const ip = clientIp(request);
  if (!ip) return null;
  return (await overLimit(env, bucket, ip, limit, windowSeconds)) ? tooManyRequests(windowSeconds) : null;
}

export function tooManyRequests(retryAfterSeconds: number, message = "Too many attempts. Please wait a little and try again."): Response {
  return json({ error: message, code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
}
