/**
 * `POST /auth/apple { identityToken, name? }` — Sign in with Apple for the app.
 *
 * App Store guideline 4.8 asks for an equivalent privacy-preserving sign-in wherever a third-party one
 * (Google) is offered. The app gets an identity token (a JWT signed by Apple) from the OS sheet; we verify it
 * against Apple's published keys here, then merge or create the user exactly as Google does.
 *
 * Off until `APPLE_BUNDLE_ID` is set (it is the token's required audience), which cannot happen before the Apple
 * Developer account exists (docs/mobile/08). Everything below is tested against a locally generated key pair.
 */
import type { Env } from "./http";
import { badRequest, field, json, readJson } from "./http";
import { createSession, sessionTtlFor } from "./auth";
import { signInWithProfile } from "./identity";
import { limitByIp } from "./rate-limit";

const ISSUER = "https://appleid.apple.com";
const KEYS_URL = `${ISSUER}/auth/keys`;
const KEYS_TTL_MS = 60 * 60 * 1000;

type Jwk = { kty: string; kid: string; alg?: string; n: string; e: string };
let keyCache: { at: number; keys: Jwk[] } | null = null;

/** Test hook: forget cached keys. */
export function resetAppleKeyCache(): void {
  keyCache = null;
}

function b64urlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function appleKeys(force = false): Promise<Jwk[]> {
  if (!force && keyCache && Date.now() - keyCache.at < KEYS_TTL_MS) return keyCache.keys;
  const res = await fetch(KEYS_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Apple keys ${res.status}`);
  const keys = ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
  keyCache = { at: Date.now(), keys };
  return keys;
}

export type AppleClaims = { sub: string; email?: string; email_verified?: boolean | string; is_private_email?: boolean | string };

/** Verifies signature, issuer, audience and expiry. Returns the claims or null. Never throws. */
export async function verifyAppleToken(token: string, audience: string): Promise<AppleClaims | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as { alg?: string; kid?: string };
    if (header.alg !== "RS256" || !header.kid) return null;

    let jwk = (await appleKeys()).find((k) => k.kid === header.kid);
    // Apple rotates keys; an unknown kid earns one refresh before the token is rejected.
    if (!jwk) jwk = (await appleKeys(true)).find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;

    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as AppleClaims & { iss?: string; aud?: string; exp?: number };
    if (claims.iss !== ISSUER || claims.aud !== audience) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
    if (!claims.sub) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function handleAppleSignIn(request: Request, env: Env): Promise<Response> {
  if (!env.APPLE_BUNDLE_ID) return json({ error: "Sign in with Apple is not switched on yet.", code: "UNAVAILABLE" }, { status: 503 });
  const limited = await limitByIp(request, env, "apple-signin", 30, 600);
  if (limited) return limited;

  const body = await readJson<{ identityToken?: unknown; name?: unknown }>(request, 16 * 1024);
  const idToken = typeof body?.identityToken === "string" ? body.identityToken : "";
  if (!idToken) return badRequest("An identity token is required.");

  const claims = await verifyAppleToken(idToken, env.APPLE_BUNDLE_ID);
  if (!claims) return json({ error: "That Apple sign-in could not be verified." }, { status: 401 });

  // Apple only sends the name on the very first authorisation, and only to the app, so the app passes it along.
  const result = await signInWithProfile(env, "apple", {
    email: claims.email ?? null,
    // Apple reports this as a boolean or the string "true".
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: field(body?.name, 120),
    providerId: claims.sub,
    avatarUrl: null,
  });
  if (!result.ok) return badRequest(result.message);

  const user = await env.DB.prepare(`SELECT id, name, email, avatar_url FROM user WHERE id = ?`)
    .bind(result.userId)
    .first<{ id: string; name: string; email: string; avatar_url: string | null }>();
  if (!user) return badRequest("Could not complete sign-in. Please try again.");
  const token = await createSession(env, user.id, sessionTtlFor(env, user.email));
  return json({ user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url }, token });
}
