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
import { badRequest, json, readCookie, sessionCookie } from "./http";
import { createSession, SESSION_TTL_SECONDS } from "./auth";
import { limitByIp } from "./rate-limit";

const STATE_TTL_SECONDS = 60 * 10;

export type Provider = "google" | "facebook" | "x";

/** Facebook sign-in is switched off. Flip to true (and keep the secrets set) to restore it. */
const FACEBOOK_ENABLED = false;

const PROVIDER_LABEL: Record<Provider, string> = { google: "Google", facebook: "Facebook", x: "X" };

/** X does not always return an email. Such accounts get this stand-in address
 *  (the column is NOT NULL UNIQUE); it is never matched against real accounts. */
const X_PLACEHOLDER_DOMAIN = "x.users.noreply.retroholidays.in";

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
  // Where to send the traveller back to once signed in — the planner page
  // they were on, so asking them to sign in never loses their place.
  const redirectTo = safeRedirect(url.searchParams.get("redirect"));

  const state = crypto.randomUUID() + crypto.randomUUID();
  const pkce = provider === "x" ? await pkcePair() : null;
  if (pkce) {
    await env.DB.prepare(
      `INSERT INTO oauth_state (state, provider, created_at, redirect_to, code_verifier) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(state, provider, new Date().toISOString(), redirectTo, pkce.verifier)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO oauth_state (state, provider, created_at, redirect_to) VALUES (?, ?, ?, ?)`,
    )
      .bind(state, provider, new Date().toISOString(), redirectTo)
      .run();
  }

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
): Promise<{ email: string | null; emailVerified: boolean; name: string | null; providerId: string; avatarUrl: string | null } | null> {
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
  if (url.searchParams.get("error") && state) {
    // The traveller pressed Cancel on the provider's screen. Send them back to the site, not to a JSON error.
    await env.DB.prepare(`DELETE FROM oauth_state WHERE state = ?`).bind(state).run();
    return new Response(null, { status: 302, headers: { Location: new URL("/plan?signin=cancelled", siteOrigin(request, env)).toString(), "Set-Cookie": stateCookie("", 0) } });
  }
  if (!code || !state) return badRequest("Missing authorization code.");
  // Login-CSRF guard: the browser finishing the flow must be the one that began it.
  if (readCookie(request, STATE_COOKIE) !== state) return badRequest("This sign-in link has expired. Please try again.");

  const stateRow = await env.DB.prepare(
    `SELECT provider, created_at, redirect_to, code_verifier FROM oauth_state WHERE state = ?`,
  )
    .bind(state)
    .first<{ provider: string; created_at: string; redirect_to: string | null; code_verifier?: string | null }>();
  // One-shot: consumed whether or not it turns out to be valid, so a replayed
  // callback can never be honoured twice.
  await env.DB.prepare(`DELETE FROM oauth_state WHERE state = ?`).bind(state).run();

  if (!stateRow || stateRow.provider !== provider) return badRequest("This sign-in link has expired. Please try again.");
  const age = (Date.now() - new Date(stateRow.created_at).getTime()) / 1000;
  if (age > STATE_TTL_SECONDS) return badRequest("This sign-in link has expired. Please try again.");

  const profile = await exchangeCode(provider, config, code, stateRow.code_verifier ?? null, request, env);
  if (!profile || (!profile.email && provider !== "x")) {
    return badRequest("Could not complete sign-in with that provider.");
  }

  // An X account with no shared email gets a stand-in address keyed on its id,
  // so it is never merged into someone else's account by email.
  const hasRealEmail = Boolean(profile.email);
  const email = hasRealEmail ? profile.email!.trim().toLowerCase() : `${profile.providerId}@${X_PLACEHOLDER_DOMAIN}`;
  const name = profile.name || email.split("@")[0];

  // Match an existing account by provider identity first, then by email.
  let user = await env.DB.prepare(`SELECT id FROM user WHERE auth_provider = ? AND provider_id = ?`)
    .bind(provider, profile.providerId)
    .first<{ id: string }>();

  if (!user) {
    const byEmail = hasRealEmail
      ? await env.DB.prepare(`SELECT id, password_hash, password_verified_at FROM user WHERE email = ?`)
          .bind(email)
          .first<{ id: string; password_hash: string | null; password_verified_at: string | null }>()
      : null;
    if (byEmail) {
      // Merging hands this account to whoever the provider says owns the address, so the provider must
      // vouch for that address. An unverified claim could otherwise take over someone else's account.
      if (!profile.emailVerified) {
        return badRequest(`An account with ${email} already exists. Sign in with your password, or use Google.`);
      }
      // Sign-up never verified this address, so a password on it may have been set by someone else
      // (pre-registration takeover). Now that the provider has proved ownership, drop that password and
      // any session made with it; the owner can set a new one by email.
      if (byEmail.password_hash && !byEmail.password_verified_at) {
        await env.DB.batch([
          env.DB.prepare(`UPDATE user SET password_hash = NULL, password_salt = NULL WHERE id = ?`).bind(byEmail.id),
          env.DB.prepare(`DELETE FROM session WHERE user_id = ?`).bind(byEmail.id),
        ]);
      }
      await env.DB.prepare(
        `UPDATE user SET auth_provider = ?, provider_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?`,
      )
        .bind(provider, profile.providerId, profile.avatarUrl, byEmail.id)
        .run();
      user = byEmail;
    } else {
      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(
          `INSERT INTO user (id, created_at, name, email, auth_provider, provider_id, avatar_url)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(id, new Date().toISOString(), name, email, provider, profile.providerId, profile.avatarUrl)
          .run();
      } catch {
        // Lost a race with another sign-in for the same address; ask for a retry rather than a 500.
        return badRequest("Could not complete sign-in. Please try again.");
      }
      user = { id };
    }
  }

  // Same hashed-at-rest session as email login (the previous inline insert stored the raw token).
  const token = await createSession(env, user.id);

  const destination = new URL(safeRedirect(stateRow.redirect_to), siteOrigin(request, env));
  const headers = new Headers({ Location: destination.toString() });
  headers.append("Set-Cookie", sessionCookie(token, SESSION_TTL_SECONDS));
  headers.append("Set-Cookie", stateCookie("", 0));
  return new Response(null, { status: 302, headers });
}

/** Tells the frontend which social providers are actually usable, so it can
 *  hide a button that would otherwise send the traveller into a dead end. */
export function handleOAuthProviders(env: Env): Response {
  return json({
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    facebook: Boolean(FACEBOOK_ENABLED && env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET),
    x: Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET),
  });
}
