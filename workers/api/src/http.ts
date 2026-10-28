/**
 * The backend Worker's environment contract.
 *
 * Everything except `DB` is optional, and the Worker degrades rather than
 * failing when one is absent: with no upstream API keys the live-rate endpoint
 * returns an empty result and the quotation falls back to its compiled
 * baseline, exactly as it does today.
 */
export type Env = {
  /** D1: enquiries, saved quotes, accounts and final-approval requests. The
   *  only genuinely stateful dependency. */
  DB: D1Database;

  /** Travelpayouts Aviasales Data API token. Optional. */
  TRAVELPAYOUTS_TOKEN?: string;
  /** LiteAPI sandbox or production key. Optional. */
  LITEAPI_KEY?: string;
  /** Optional KV namespace for cross-request rate caching. */
  RATE_CACHE?: KVNamespace;

  /**
   * Comma-separated origins allowed to call this Worker directly.
   *
   * In production the frontend Worker forwards `/api/*` over a service
   * binding, so the browser never makes a cross-origin call and this is only
   * needed for local development against `next dev`.
   */
  ALLOWED_ORIGINS?: string;

  /** Deployment environment name, surfaced by `/api/health`. */
  ENVIRONMENT?: string;

  /**
   * The site's own public origin (e.g. `https://retroholidays.in`), used to
   * build the OAuth `redirect_uri` and the links in review-request emails.
   * Falls back to the request's own origin when unset, which is fine for
   * local development but should always be set in production so an OAuth
   * provider's registered redirect URI never silently drifts.
   */
  PUBLIC_SITE_URL?: string;

  /** Google OAuth 2.0 web client. Both unset disables the "Continue with
   *  Google" button rather than erroring. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  /** Facebook Login app. Both unset disables the "Continue with Facebook"
   *  button rather than erroring. */
  FACEBOOK_CLIENT_ID?: string;
  FACEBOOK_CLIENT_SECRET?: string;

  /** X (Twitter) OAuth 2.0 app. Both unset hides the "Continue with X" button. */
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;

  /** Mailbox a final-approval request's full JSON is sent to for manual
   *  review. Defaults to info@retroholidays.in when unset. */
  REVIEW_INBOX?: string;
  /** From-address for outgoing mail. MailChannels requires the sending
   *  domain to carry an SPF record authorising it; see email.ts. */
  MAIL_FROM?: string;
  /** MailChannels API key, sent as `X-Api-Key` when set. */
  MAILCHANNELS_API_KEY?: string;
  /** Comma-separated emails allowed into /admin. Defaults to
   *  info@retroholidays.in. Must also be a Google-signed-in account with no
   *  password — see admin.ts. */
  ADMIN_EMAILS?: string;

  /** Razorpay API key id (public; also handed to Checkout in the browser).
   *  Unset disables online payment: the pay endpoints answer 503 and the UI
   *  tells the traveller the agency will send payment details. */
  RAZORPAY_KEY_ID?: string;
  /** Razorpay API key secret. Signs order creation and verifies checkout
   *  signatures. Never leaves the Worker. */
  RAZORPAY_KEY_SECRET?: string;
  /** Secret configured on the Razorpay webhook; verifies `X-Razorpay-Signature`. */
  RAZORPAY_WEBHOOK_SECRET?: string;
};


export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

export function badRequest(message: string): Response {
  return json({ error: message }, { status: 400 });
}

export function notFound(message = "Not found"): Response {
  return json({ error: message }, { status: 404 });
}

/**
 * CORS for direct browser calls.
 *
 * Only origins named in `ALLOWED_ORIGINS` are echoed back — never `*` — because
 * these endpoints write to the database. Requests arriving over the service
 * binding from the frontend Worker are same-origin and never reach this.
 */
export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin) return {};

  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Reads and validates a JSON body, with a size ceiling. */
export async function readJson<T>(request: Request, maxBytes = 64 * 1024): Promise<T | null> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > maxBytes) return null;
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Trims a free-text field and caps its length, returning null when empty. */
export function field(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "atlas_session";

/** Parses the `Cookie` header into a name -> value map. */
export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie");
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

/**
 * Builds a `Set-Cookie` header value for the session cookie.
 *
 * `secure` is left on by default — this Worker is only ever reached over
 * HTTPS in production (via the frontend's service binding or Cloudflare's own
 * edge), and the one place that would matter, local `next dev`, talks to the
 * Worker over plain HTTP on `localhost`, where browsers accept `Secure`
 * cookies on `localhost` as a special case.
 */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/** Clears the session cookie on logout. */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
