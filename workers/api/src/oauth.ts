/**
 * "Continue with Google" / "Continue with Facebook" / "Continue with X".
 *
 * Standard OAuth 2.0 authorization-code redirect flow, run entirely by this
 * Worker so the browser never sees a client secret. Either provider is
 * optional: with no client id/secret configured, the start route answers
 * plainly rather than sending the traveller into a redirect that can only
 * fail at the provider's end.
 *
 * Login merges into an existing password account by email when one matches,
 * so someone who registered with a password and later taps "Continue with
 * Google" using the same address gets one account, not two.
 */
import type { Env } from "./http";
import { badRequest, json, readCookie, readJson, sessionCookie } from "./http";
import { createSession, sessionTtlFor } from "./auth";
import { allowedAppRedirect, withParams } from "./app-links";
import { signInWithProfile, type ProviderProfile } from "./identity";
import { limitByIp, overLimit, tooManyRequests } from "./rate-limit";

const STATE_TTL_SECONDS = 60 * 10;

export type Provider = "google" | "facebook" | "x";

/** Facebook sign-in is switched off. Flip to true (and keep the secrets set) to restore it. */
const FACEBOOK_ENABLED = false;

const PROVIDER_LABEL: Record<Provider, string> = { google: "Google", facebook: "Facebook", x: "X" };


/** Binds a sign-in attempt to the browser that began it, so a link carrying someone else's code is useless. */
const STATE_COOKIE = "atlas_oauth_state";
const stateCookie = (value: string, maxAge: number) => `${STATE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

/**
 * Where to send the traveller after sign-in. Only a same-site path is honoured:
 * `new URL("https://evil.example", origin)` yields evil.example, so an unchecked
 * `?redirect=` turned our own sign-in link into an open redirect.
 */
export function safeRedirect(raw: string | null | undefined): string {
  if (!raw || raw.length > 500) return "/plan";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || /[\u0000-\u001f\\]/.test(raw)) return "/plan";
  return raw;
}

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

type ProviderConfig = {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
};

function configFor(provider: Provider, env: Env): ProviderConfig | null {
  if (provider === "google") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid email profile",
    };
  }
  if (provider === "x") {
    if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) return null;
    return {
      clientId: env.X_CLIENT_ID,
      clientSecret: env.X_CLIENT_SECRET,
      authorizeUrl: "https://x.com/i/oauth2/authorize",
      tokenUrl: "https://api.x.com/2/oauth2/token",
      userInfoUrl: "https://api.x.com/2/users/me?user.fields=profile_image_url,confirmed_email",
      scope: "users.read tweet.read users.email",
    };
  }
  if (!FACEBOOK_ENABLED || !env.FACEBOOK_CLIENT_ID || !env.FACEBOOK_CLIENT_SECRET) return null;
  return {
    clientId: env.FACEBOOK_CLIENT_ID,
    clientSecret: env.FACEBOOK_CLIENT_SECRET,
    authorizeUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    userInfoUrl: "https://graph.facebook.com/me?fields=id,name,email,picture",
    scope: "email public_profile",
  };
}

function siteOrigin(request: Request, env: Env): string {
  return env.PUBLIC_SITE_URL?.replace(/\/$/, "") || new URL(request.url).origin;
}

function redirectUri(provider: Provider, request: Request, env: Env): string {
  // Always `/api/...`, even though the Worker strips that prefix itself when
  // routing: this URL is dereferenced by the browser (and by Google/Facebook's
  // servers), which only ever see the frontend's public origin.
  return `${siteOrigin(request, env)}/api/auth/${provider}/callback`;
}

/** Redirects the browser to the provider's consent screen. */
export async function handleOAuthStart(
  provider: Provider,
  request: Request,
  env: Env,
): Promise<Response> {
  const limited = await limitByIp(request, env, "oauth-start", 60, 900);
  if (limited) return limited;
  const config = configFor(provider, env);
  if (!config) {
    return badRequest(
      `Sign-in with ${PROVIDER_LABEL[provider]} is not configured on this deployment.`,
    );
  }

  const url = new URL(request.url);
  const mobile = url.searchParams.get("client") === "mobile";
  let redirectTo = safeRedirect(url.searchParams.get("redirect"));
  let appChallenge: string | null = null;
  if (mobile) {
    // The app's return link is an exact allow-list entry (app-links.ts), and the app must commit to a PKCE
    // challenge now so that only it can redeem the one-time code later.
    const back = allowedAppRedirect(url.searchParams.get("redirect"), env);
    const challenge = url.searchParams.get("code_challenge") ?? "";
    if (!back) return badRequest("That return link is not allowed.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) return badRequest("A valid code_challenge (S256) is required.");
    redirectTo = back;
    appChallenge = challenge;
  }

  const state = crypto.randomUUID() + crypto.randomUUID();
  const pkce = provider === "x" ? await pkcePair() : null;
  await env.DB.prepare(
    `INSERT INTO oauth_state (state, provider, created_at, redirect_to, code_verifier, client, app_challenge) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(state, provider, new Date().toISOString(), redirectTo, pkce?.verifier ?? null, mobile ? "mobile" : "web", appChallenge)
    .run();

  const authorize = new URL(config.authorizeUrl);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", redirectUri(provider, request, env));
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", config.scope);
  authorize.searchParams.set("state", state);
  if (provider === "google") {
    // Re-asks consent only the first time; subsequent sign-ins are silent.
    authorize.searchParams.set("access_type", "online");
    authorize.searchParams.set("prompt", "select_account");
  }

  if (pkce) {
    authorize.searchParams.set("code_challenge", pkce.challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
  }

  return new Response(null, {
    status: 302,
    headers: { Location: authorize.toString(), "Set-Cookie": stateCookie(state, STATE_TTL_SECONDS) },
  });
}

type GoogleUserInfo = { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
type XUserInfo = {
  id: string;
  name?: string;
  username?: string;
  profile_image_url?: string;
  confirmed_email?: string;
};
type FacebookUserInfo = {
  id: string;
  email?: string;
  name?: string;
  picture?: { data?: { url?: string } };
};

async function exchangeCode(
  provider: Provider,
  config: ProviderConfig,
  code: string,
  codeVerifier: string | null,
  request: Request,
  env: Env,
): Promise<ProviderProfile | null> {
  const tokenBody = new URLSearchParams({
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri(provider, request, env),
    grant_type: "authorization_code",
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (provider === "x") {
    // X's confidential clients authenticate with HTTP Basic, and require PKCE.
    headers.Authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
    if (!codeVerifier) return null;
    tokenBody.set("code_verifier", codeVerifier);
  } else {
    tokenBody.set("client_secret", config.clientSecret);
  }

  let infoRes: Response;
  try {
    const tokenRes = await fetch(config.tokenUrl, { method: "POST", headers, body: tokenBody, signal: AbortSignal.timeout(8000) });
    if (!tokenRes.ok) return null;
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return null;
    infoRes = await fetch(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    // A provider outage or timeout is a failed sign-in, not a 500 and a stack trace.
    console.error("OAuth exchange failed", provider, error);
    return null;
  }
  if (!infoRes.ok) return null;

  if (provider === "google") {
    const info = (await infoRes.json()) as GoogleUserInfo;
    return {
      email: info.email ?? null,
      emailVerified: info.email_verified === true,
      name: info.name ?? null,
      providerId: info.sub,
      avatarUrl: info.picture ?? null,
    };
  }
  if (provider === "x") {
    const info = ((await infoRes.json()) as { data?: XUserInfo }).data;
    if (!info?.id) return null;
    return {
      email: info.confirmed_email ?? null,
      emailVerified: Boolean(info.confirmed_email),
      name: info.name ?? info.username ?? null,
      providerId: info.id,
      avatarUrl: info.profile_image_url ?? null,
    };
  }
  const info = (await infoRes.json()) as FacebookUserInfo;
  return {
    email: info.email ?? null,
    // Facebook does not say whether the address is verified, so it is never trusted to merge accounts.
    emailVerified: false,
    name: info.name ?? null,
    providerId: info.id,
    avatarUrl: info.picture?.data?.url ?? null,
  };
}

/** Handles the provider's redirect back, exchanges the code, and signs the
 *  traveller in — creating an account on first use. */
export async function handleOAuthCallback(
  provider: Provider,
  request: Request,
  env: Env,
): Promise<Response> {
  const config = configFor(provider, env);
  if (!config) return badRequest("This sign-in method is not configured.");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!state) return badRequest("Missing authorization code.");

  const stateRow = await env.DB.prepare(
    `SELECT provider, created_at, redirect_to, code_verifier, client, app_challenge FROM oauth_state WHERE state = ?`,
  )
    .bind(state)
    .first<{ provider: string; created_at: string; redirect_to: string | null; code_verifier?: string | null; client?: string | null; app_challenge?: string | null }>();
  // One-shot: consumed whether or not it turns out to be valid, so a replayed callback can never be honoured twice.
  await env.DB.prepare(`DELETE FROM oauth_state WHERE state = ?`).bind(state).run();

  const mobile = stateRow?.client === "mobile";
  // A failed or cancelled attempt goes back to wherever it began: the app for a phone, a page for the web.
  const fail = (message: string, reason: string): Response =>
    mobile && stateRow?.redirect_to
      ? new Response(null, { status: 302, headers: { Location: withParams(stateRow.redirect_to, { error: reason }), "Set-Cookie": stateCookie("", 0) } })
      : reason === "cancelled"
        ? new Response(null, { status: 302, headers: { Location: new URL("/plan?signin=cancelled", siteOrigin(request, env)).toString(), "Set-Cookie": stateCookie("", 0) } })
        : badRequest(message);

  if (url.searchParams.get("error")) return fail("Sign-in was cancelled.", "cancelled");
  if (!code) return badRequest("Missing authorization code.");
  // Login-CSRF guard: the browser finishing the flow must be the one that began it.
  if (readCookie(request, STATE_COOKIE) !== state) return badRequest("This sign-in link has expired. Please try again.");

  if (!stateRow || stateRow.provider !== provider) return badRequest("This sign-in link has expired. Please try again.");
  const age = (Date.now() - new Date(stateRow.created_at).getTime()) / 1000;
  if (age > STATE_TTL_SECONDS) return fail("This sign-in link has expired. Please try again.", "expired");

  const profile = await exchangeCode(provider, config, code, stateRow.code_verifier ?? null, request, env);
  if (!profile || (!profile.email && provider !== "x")) return fail("Could not complete sign-in with that provider.", "failed");

  const result = await signInWithProfile(env, provider, profile);
  if (!result.ok) return fail(result.message, "failed");

  if (mobile) {
    // The phone never receives a session in a URL. It receives a one-time code, good for 60 seconds, that only
    // the holder of the PKCE verifier can turn into a session (handleMobileExchange).
    const oneTime = toHexString(crypto.getRandomValues(new Uint8Array(32)));
    const now = new Date();
    await env.DB.prepare(`INSERT INTO auth_code (code_hash, user_id, challenge, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(await sha256Hex(oneTime), result.userId, stateRow.app_challenge ?? "", now.toISOString(), new Date(now.getTime() + 60_000).toISOString())
      .run();
    return new Response(null, {
      status: 302,
      headers: { Location: withParams(stateRow.redirect_to ?? "", { code: oneTime }), "Set-Cookie": stateCookie("", 0) },
    });
  }

  // Same hashed-at-rest session as email login (the previous inline insert stored the raw token).
  const email = (await env.DB.prepare(`SELECT email FROM user WHERE id = ?`).bind(result.userId).first<{ email: string }>())?.email ?? "";
  const ttl = sessionTtlFor(env, email);
  const token = await createSession(env, result.userId, ttl);

  const destination = new URL(safeRedirect(stateRow.redirect_to), siteOrigin(request, env));
  const headers = new Headers({ Location: destination.toString() });
  headers.append("Set-Cookie", sessionCookie(token, ttl));
  headers.append("Set-Cookie", stateCookie("", 0));
  return new Response(null, { status: 302, headers });
}

function toHexString(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  return toHexString(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/**
 * `POST /auth/mobile/exchange { code, code_verifier }` — the app trades the one-time code for a bearer token.
 *
 * Redeemable once, within 60 seconds, and only by whoever holds the verifier whose SHA-256 the app committed to
 * when it started sign-in. A different app that registered the same `retro://` scheme and intercepted the code
 * cannot produce the verifier, so the code is worthless to it (RFC 7636 / RFC 8252).
 */
export async function handleMobileExchange(request: Request, env: Env): Promise<Response> {
  const limited = await limitByIp(request, env, "mobile-exchange", 30, 600);
  if (limited) return limited;
  const body = await readJson<{ code?: unknown; code_verifier?: unknown }>(request, 4 * 1024);
  const code = typeof body?.code === "string" ? body.code : "";
  const verifier = typeof body?.code_verifier === "string" ? body.code_verifier : "";
  const invalid = () => badRequest("This sign-in code is invalid or has expired. Please try again.");
  if (!/^[0-9a-f]{64}$/.test(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return invalid();
  // Guessing a code is pointless (256 random bits) but a verifier-guessing loop on one code is still bounded.
  if (await overLimit(env, "mobile-exchange-code", code, 5, 120)) return tooManyRequests(120);

  const codeHash = await sha256Hex(code);
  const row = await env.DB.prepare(`SELECT user_id, challenge, expires_at, used_at FROM auth_code WHERE code_hash = ?`)
    .bind(codeHash)
    .first<{ user_id: string; challenge: string; expires_at: string; used_at: string | null }>();
  if (!row || row.used_at || row.expires_at < new Date().toISOString()) return invalid();

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const computed = base64Url(new Uint8Array(digest));
  if (!timingSafe(computed, row.challenge)) return invalid();

  // Claim it atomically: of two simultaneous redemptions only one gets a session.
  const claim = await env.DB.prepare(`UPDATE auth_code SET used_at = ? WHERE code_hash = ? AND used_at IS NULL`)
    .bind(new Date().toISOString(), codeHash)
    .run();
  if (!Number(claim.meta?.changes ?? 0)) return invalid();

  const user = await env.DB.prepare(`SELECT id, name, email, avatar_url FROM user WHERE id = ?`)
    .bind(row.user_id)
    .first<{ id: string; name: string; email: string; avatar_url: string | null }>();
  if (!user) return invalid();
  const token = await createSession(env, user.id, sessionTtlFor(env, user.email));
  return json({ user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url }, token });
}

function timingSafe(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Tells the frontend which social providers are actually usable, so it can
 *  hide a button that would otherwise send the traveller into a dead end. */
export function handleOAuthProviders(env: Env): Response {
  return json({
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    facebook: Boolean(FACEBOOK_ENABLED && env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET),
    x: Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET),
    apple: Boolean(env.APPLE_BUNDLE_ID),
  });
}
