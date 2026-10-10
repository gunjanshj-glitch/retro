"use client";

/**
 * Browser-side client for accounts, sessions, and final-approval requests.
 *
 * The site itself is a static export with no server of its own — every call
 * here goes to the backend Worker at `/api/*` (same-origin in production, via
 * the frontend Worker's service binding). Session state lives in an httpOnly
 * cookie the backend sets; this module never touches it directly, only reacts
 * to what `/auth/me` reports.
 */

export type AuthUser = { id: string; name: string; email: string; avatarUrl: string | null };

async function postJson<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) return { ok: false, error: data?.error ?? "Something went wrong. Please try again." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

export async function registerAccount(input: { name: string; email: string; password: string }) {
  return postJson<{ user: AuthUser }>("/auth/register", input);
}

export async function login(input: { email: string; password: string }) {
  return postJson<{ user: AuthUser }>("/auth/login", input);
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    // The cookie is httpOnly and short-lived either way; nothing else to do
    // client-side if the request itself fails.
  }
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (!res.ok) return null;
    const body = (await res.json()) as { user: AuthUser | null };
    return body.user;
  } catch {
    return null;
  }
}

export type OAuthProviderAvailability = { google: boolean; facebook: boolean };

export async function fetchOAuthProviders(): Promise<OAuthProviderAvailability> {
  try {
    const res = await fetch("/api/auth/providers", { credentials: "include" });
    if (!res.ok) return { google: false, facebook: false };
    return (await res.json()) as OAuthProviderAvailability;
  } catch {
    return { google: false, facebook: false };
  }
}

/** Full-page navigation into the OAuth redirect flow — this cannot be a
 *  `fetch`, since the traveller has to actually land on the provider's own
 *  consent screen. `redirectTo` is where the backend sends them once signed
 *  in, so asking them to sign in never loses the page they were on. This is
 *  a real server route (the backend Worker), not a Next.js page, so a plain
 *  navigation is correct here rather than `useRouter().push()`. */
export function startOAuth(provider: "google" | "facebook", redirectTo: string): void {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/api/auth/${provider}/start?redirect=${encodeURIComponent(redirectTo)}`;
}

// ---------------------------------------------------------------------------
// Final-approval requests
// ---------------------------------------------------------------------------

export type RequestSummary = {
  id: string;
  createdAt: string;
  status: string;
  destinationSummary: string;
  nights: number;
  startDate: string;
  totalInr: number;
  perPersonInr: number;
};

export type RequestDetail = RequestSummary & { snapshot: unknown };

/** Submits the full quotation snapshot for human review. Requires an active
 *  session — the caller is responsible for prompting sign-in first. */
export async function createFinalRequest(input: {
  request: unknown;
  quotation: unknown;
  destinationSummary: string;
  totals: { total: number; perPerson: number };
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const result = await postJson<{ id: string }>("/requests", input);
  if (!result.ok) return result;
  return { ok: true, id: result.data.id };
}

export async function listFinalRequests(): Promise<RequestSummary[]> {
  try {
    const res = await fetch("/api/requests", { credentials: "include" });
    if (!res.ok) return [];
    const body = (await res.json()) as { requests: RequestSummary[] };
    return body.requests;
  } catch {
    return [];
  }
}

export async function getFinalRequest(id: string): Promise<RequestDetail | null> {
  try {
    const res = await fetch(`/api/requests/${encodeURIComponent(id)}`, { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as RequestDetail;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Package quote requests
// ---------------------------------------------------------------------------

export type PackageRequestInput = {
  destinationSlug: string;
  destinationName: string;
  packageSlug: string;
  packageName: string;
  package: { places: string[]; days: number | null; priceFromInr: number | null };
  tripType: string;
  adults: number;
  children: number;
  startDate: string | null;
  departureCity: string;
  hotelStar: string;
  includeFlights: boolean;
  food: string;
  notes: string;
};

export type PackageRequestRow = {
  id: string;
  createdAt: string;
  status: "pending" | "quoted" | "closed" | string;
  destinationName: string;
  destinationSlug: string;
  packageName: string;
  packageSlug: string;
  tripType: string;
  adults: number;
  children: number;
  startDate: string | null;
  departureCity: string;
  hotelStar: string;
  includeFlights: boolean;
  quote: { amountInr: number; note: string | null; quotedAt: string | null } | null;
};

/** Requires an active session — the caller prompts sign-in first. */
export async function createPackageRequest(
  input: PackageRequestInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const result = await postJson<{ id: string }>("/package-requests", input);
  if (!result.ok) return result;
  return { ok: true, id: result.data.id };
}

export async function listPackageRequests(): Promise<PackageRequestRow[]> {
  try {
    const res = await fetch("/api/package-requests", { credentials: "include" });
    if (!res.ok) return [];
    const body = (await res.json()) as { requests: PackageRequestRow[] };
    return body.requests;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Admin: answering package quote requests
// ---------------------------------------------------------------------------

export type AdminPackageRequest = PackageRequestRow & {
  userName: string;
  userEmail: string;
  food: string;
  notes: string | null;
};

/** `null` means "not an admin" (the API answers 404 to everyone else). */
export async function adminListPackageRequests(): Promise<AdminPackageRequest[] | null> {
  try {
    const res = await fetch("/api/admin/package-requests", { credentials: "include" });
    if (!res.ok) return null;
    return ((await res.json()) as { requests: AdminPackageRequest[] }).requests;
  } catch {
    return null;
  }
}

export async function adminSendQuote(id: string, amountInr: number, note: string) {
  return postJson<{ ok: true }>(`/admin/package-requests/${encodeURIComponent(id)}/quote`, { amountInr, note });
}

export async function adminCloseRequest(id: string) {
  return postJson<{ ok: true }>(`/admin/package-requests/${encodeURIComponent(id)}/close`, {});
}
