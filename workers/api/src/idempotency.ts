/**
 * Idempotency-Key support (mobile plan B7).
 *
 * A phone drops responses routinely: the request reached us and did its work,
 * but the reply never arrived, so the app retries. Without this a retried
 * "send quote" makes a second revision and a second email, and a retried
 * "submit request" is a second request (or is blocked by the hourly limit).
 *
 * Contract: for the create/send endpoints listed below, a client that sends an
 * `Idempotency-Key` header gets the original response replayed for 24 hours
 * instead of the work being done again.
 *   - same key + same body    -> stored response, header `Idempotency-Replayed: true`
 *   - same key + different body -> 422 IDEMPOTENCY_KEY_REUSED (a client bug)
 *   - same key while the first is still running -> 409 IDEMPOTENT_REQUEST_IN_PROGRESS, retry shortly
 * Only successful (2xx) responses are stored; a failure leaves the key free so
 * the retry actually re-runs. Keys are scoped to the caller's session, method
 * and path, so one user's key can never replay another's response.
 *
 * Storage is the existing KV namespace. Without a header, or without KV, requests
 * pass straight through, so the web is unaffected. KV is eventually consistent,
 * so two retries landing in the same instant from different regions can still
 * both run; the in-progress marker closes the common case, not every race.
 */
import type { Env } from "./http";
import { json } from "./http";
import { readSessionToken } from "./auth";

const TTL_SECONDS = 24 * 60 * 60;
const PENDING_TTL_SECONDS = 60; // KV's minimum
const MAX_STORED_BYTES = 256 * 1024;
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

const IDEMPOTENT: RegExp[] = [
  /^\/(requests|enquiries|package-requests)$/,
  /^\/requests\/[A-Za-z0-9-]{1,64}\/(accept|changes|decline|cancel|pay|messages)$/,
  /^\/admin\/requests\/[A-Za-z0-9-]{1,64}\/(review|send|note|close|messages)$/,
  /^\/admin\/package-requests\/[A-Za-z0-9-]{1,64}\/(quote|close)$/,
];

type Stored = { state: "pending" } | { state: "done"; bodyHash: string; status: number; body: string; contentType: string };

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function withIdempotency(request: Request, env: Env, run: () => Promise<Response>): Promise<Response> {
  const key = request.headers.get("Idempotency-Key");
  if (!key || request.method.toUpperCase() !== "POST" || !env.RATE_CACHE) return run();

  const path = new URL(request.url).pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  if (!IDEMPOTENT.some((re) => re.test(path))) return run();
  if (!KEY_RE.test(key)) {
    return json({ error: "Idempotency-Key must be 8 to 128 letters, digits, dashes or underscores.", code: "BAD_IDEMPOTENCY_KEY" }, { status: 400 });
  }

  const kv = env.RATE_CACHE;
  const caller = readSessionToken(request) ?? "anon";
  const slot = `idem:${await sha256(`${caller}|POST|${path}|${key}`)}`;
  const bodyHash = await sha256(await request.clone().text());

  const existing = (await kv.get(slot, "json")) as Stored | null;
  if (existing?.state === "pending") {
    return json({ error: "The first attempt is still being processed. Try again in a moment.", code: "IDEMPOTENT_REQUEST_IN_PROGRESS" }, { status: 409, headers: { "Retry-After": "2" } });
  }
  if (existing?.state === "done") {
    if (existing.bodyHash !== bodyHash) {
      return json({ error: "This Idempotency-Key was already used with different content.", code: "IDEMPOTENCY_KEY_REUSED" }, { status: 422 });
    }
    return new Response(existing.body, { status: existing.status, headers: { "Content-Type": existing.contentType, "Idempotency-Replayed": "true" } });
  }

  await kv.put(slot, JSON.stringify({ state: "pending" } satisfies Stored), { expirationTtl: PENDING_TTL_SECONDS });
  let response: Response;
  try {
    response = await run();
  } catch (error) {
    await kv.delete(slot);
    throw error;
  }

  if (response.status < 200 || response.status >= 300) {
    await kv.delete(slot);
    return response;
  }
  const body = await response.clone().text();
  if (body.length > MAX_STORED_BYTES) {
    await kv.delete(slot);
    return response;
  }
  const done: Stored = { state: "done", bodyHash, status: response.status, body, contentType: response.headers.get("Content-Type") ?? "application/json; charset=utf-8" };
  await kv.put(slot, JSON.stringify(done), { expirationTtl: TTL_SECONDS });
  return response;
}
