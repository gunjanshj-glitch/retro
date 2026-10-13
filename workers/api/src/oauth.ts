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
import { badRequest, json, sessionCookie } from "./http";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const STATE_TTL_SECONDS = 60 * 10;

export type Provider = "google" | "facebook" | "x";

const PROVIDER_LABEL: Record<Provider, string> = { google: "Google", facebook: "Facebook", x: "X" };

/** X does not always return an email. Such accounts get this stand-in address
 *  (the column is NOT NULL UNIQUE); it is never matched against real accounts. */
const X_PLACEHOLDER_DOMAIN = "x.users.noreply.retroholidays.in";

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
  if (!env.FACEBOOK_CLIENT_ID || !env.FACEBOOK_CLIENT_SECRET) return null;
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
  const config = configFor(provider, env);
  if (!config) {
    return badRequest(
      `Sign-in with ${PROVIDER_LABEL[provider]} is not configured on this deployment.`,
    );
  }

  const url = new URL(request.url);
  // Where to send the traveller back to once signed in — the planner page
  // they were on, so asking them to sign in never loses their place.
  const redirectTo = url.searchParams.get("redirect") || "/plan";

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

  return Response.redirect(authorize.toString(), 302);
}

type GoogleUserInfo = { sub: string; email?: string; name?: string; picture?: string };
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
): Promise<{ email: string | null; name: string | null; providerId: string; avatarUrl: string | null } | null> {
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

  const tokenRes = await fetch(config.tokenUrl, { method: "POST", headers, body: tokenBody });
  if (!tokenRes.ok) return null;
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) return null;

  const infoRes = await fetch(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!infoRes.ok) return null;

  if (provider === "google") {
    const info = (await infoRes.json()) as GoogleUserInfo;
    return {
      email: info.email ?? null,
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
      name: info.name ?? info.username ?? null,
      providerId: info.id,
      avatarUrl: info.profile_image_url ?? null,
    };
  }
  const info = (await infoRes.json()) as FacebookUserInfo;
  return {
    email: info.email ?? null,
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
  if (!code || !state) return badRequest("Missing authorization code.");

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

  // Match an existing account by provider identity first, then by email —
  // the latter is what lets a password account and a social login converge
  // on one user rather than silently forking into two.
  let user = await env.DB.prepare(
    `SELECT id FROM user WHERE auth_provider = ? AND provider_id = ?`,
  )
    .bind(provider, profile.providerId)
    .first<{ id: string }>();

  if (!user) {
    const byEmail = hasRealEmail
      ? await env.DB.prepare(`SELECT id FROM user WHERE email = ?`).bind(email).first<{ id: string }>()
      : null;
    if (byEmail) {
      await env.DB.prepare(
        `UPDATE user SET auth_provider = ?, provider_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?`,
      )
        .bind(provider, profile.providerId, profile.avatarUrl, byEmail.id)
        .run();
      user = byEmail;
    } else {
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO user (id, created_at, name, email, auth_provider, provider_id, avatar_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, new Date().toISOString(), name, email, provider, profile.providerId, profile.avatarUrl)
        .run();
      user = { id };
    }
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await env.DB.prepare(`INSERT INTO session (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(token, user.id, now.toISOString(), expires.toISOString())
    .run();

  const redirectTo = stateRow.redirect_to || "/plan";
  const destination = new URL(redirectTo, siteOrigin(request, env));
  return new Response(null, {
    status: 302,
    headers: {
      Location: destination.toString(),
      "Set-Cookie": sessionCookie(token, SESSION_TTL_SECONDS),
    },
  });
}

/** Tells the frontend which social providers are actually usable, so it can
 *  hide a button that would otherwise send the traveller into a dead end. */
export function handleOAuthProviders(env: Env): Response {
  return json({
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    facebook: Boolean(env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET),
    x: Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET),
  });
}
