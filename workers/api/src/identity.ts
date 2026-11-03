/**
 * Turns a verified identity from a provider (Google, X, Facebook, Apple) into one of our users.
 *
 * Shared by the web redirect flow, the mobile code exchange and Sign in with Apple, so the account-merge
 * rules, which are security rules, exist exactly once.
 */
import type { Env } from "./http";

export type ProviderProfile = {
  email: string | null;
  /** True only when the provider itself vouches that the address belongs to this person. */
  emailVerified: boolean;
  name: string | null;
  providerId: string;
  avatarUrl: string | null;
};

/** X does not always return an email. Such accounts get this stand-in address (never matched against real accounts). */
export const X_PLACEHOLDER_DOMAIN = "x.users.noreply.retroholidays.in";

export type SignInResult = { ok: true; userId: string } | { ok: false; message: string };

export async function signInWithProfile(env: Env, provider: string, profile: ProviderProfile): Promise<SignInResult> {
  // An account with no shared email gets a stand-in address keyed on its id, so it is never merged by email.
  const hasRealEmail = Boolean(profile.email);
  const email = hasRealEmail ? profile.email!.trim().toLowerCase() : `${profile.providerId}@${X_PLACEHOLDER_DOMAIN}`;
  const name = profile.name || email.split("@")[0];

  // Match an existing account by provider identity first, then by email.
  const known = await env.DB.prepare(`SELECT id FROM user WHERE auth_provider = ? AND provider_id = ?`)
    .bind(provider, profile.providerId)
    .first<{ id: string }>();
  if (known) return { ok: true, userId: known.id };

  const byEmail = hasRealEmail
    ? await env.DB.prepare(`SELECT id, password_hash, password_verified_at FROM user WHERE email = ?`)
        .bind(email)
        .first<{ id: string; password_hash: string | null; password_verified_at: string | null }>()
    : null;

  if (byEmail) {
    // Merging hands this account to whoever the provider says owns the address, so the provider must
    // vouch for that address. An unverified claim could otherwise take over someone else's account.
    if (!profile.emailVerified) {
      return { ok: false, message: `An account with ${email} already exists. Sign in with your password, or use Google.` };
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
    await env.DB.prepare(`UPDATE user SET auth_provider = ?, provider_id = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?`)
      .bind(provider, profile.providerId, profile.avatarUrl, byEmail.id)
      .run();
    return { ok: true, userId: byEmail.id };
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO user (id, created_at, name, email, auth_provider, provider_id, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, new Date().toISOString(), name, email, provider, profile.providerId, profile.avatarUrl)
      .run();
  } catch {
    // Lost a race with another sign-in for the same address; ask for a retry rather than a 500.
    return { ok: false, message: "Could not complete sign-in. Please try again." };
  }
  return { ok: true, userId: id };
}
