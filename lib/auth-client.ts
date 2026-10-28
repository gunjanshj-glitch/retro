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
import type { PublicQuote, QuoteAdjustments } from "./quote-pricing";
import type { RequestEvent, RequestStatus } from "./quote-workflow";

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

export async function forgotPassword(email: string) {
  return postJson<{ ok: true; message: string }>("/auth/forgot", { email });
}

export async function resetPassword(input: { token: string; password: string }) {
  return postJson<{ user: AuthUser; admin: boolean }>("/auth/reset", input);
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

export type OAuthProviderAvailability = { google: boolean; facebook: boolean; x: boolean };

export async function fetchOAuthProviders(): Promise<OAuthProviderAvailability> {
  try {
    const res = await fetch("/api/auth/providers", { credentials: "include" });
    if (!res.ok) return { google: false, facebook: false, x: false };
    return (await res.json()) as OAuthProviderAvailability;
  } catch {
    return { google: false, facebook: false, x: false };
  }
}

/** Full-page navigation into the OAuth redirect flow — this cannot be a
 *  `fetch`, since the traveller has to actually land on the provider's own
 *  consent screen. `redirectTo` is where the backend sends them once signed
 *  in, so asking them to sign in never loses the page they were on. This is
 *  a real server route (the backend Worker), not a Next.js page, so a plain
 *  navigation is correct here rather than `useRouter().push()`. */
export function startOAuth(provider: "google" | "facebook" | "x", redirectTo: string): void {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/api/auth/${provider}/start?redirect=${encodeURIComponent(redirectTo)}`;
}

// ---------------------------------------------------------------------------
// Trip quote requests (planner → final quote → accept → pay)
// ---------------------------------------------------------------------------

export type RequestSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  /** True when the next move is the traveller's (review the quote, pay). */
  needsAction: boolean;
  destinationSummary: string;
  nights: number;
  startDate: string;
  /** The estimate the traveller saw when they sent the request. */
  totalInr: number;
  perPersonInr: number;
  /** The agency's final figure, once a quote has been sent. */
  quotedTotalInr: number | null;
  quoteValidUntil: string | null;
  acceptedTotalInr: number | null;
  paidInr: number;
};

export type SentQuote = {
  revisionId: string;
  version: number;
  sentAt: string | null;
  view: PublicQuote;
  /** Total with nothing optional ticked. */
  baseTotalInr: number;
  /** False once a newer revision has replaced this one. */
  current: boolean;
};

export type PaymentSummary = {
  /** Whether online payment is switched on. */
  configured: boolean;
  totalInr: number | null;
  paidInr: number;
  balanceInr: number;
  /** What the next payment will be (the deposit first, if one was set). */
  nextInr: number;
  payments: { id: string; amountInr: number; paidAt: string | null; method: string | null; kind: string }[];
};

export type RequestDetail = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  destinationSummary: string;
  nights: number;
  startDate: string;
  totalInr: number;
  perPersonInr: number;
  snapshot: unknown;
  contact: { name: string; email: string; phone: string | null; note: string | null };
  events: RequestEvent[];
  quote: SentQuote | null;
  acceptance: { acceptedAt: string; optionIds: string[]; totalInr: number | null } | null;
  payment: PaymentSummary;
};

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`/api${path}`, { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Submits the full quotation snapshot for the agency to finalise. Requires an
 *  active session — the caller is responsible for prompting sign-in first. */
export async function createFinalRequest(input: {
  request: unknown;
  quotation: unknown;
  destinationSummary: string;
  totals: { total: number; perPerson: number };
  /** Where the agency reaches the traveller. Phone is optional. */
  contact: { email: string; phone?: string };
  note?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const result = await postJson<{ id: string }>("/requests", input);
  if (!result.ok) return result;
  return { ok: true, id: result.data.id };
}

export async function listFinalRequests(): Promise<RequestSummary[]> {
  return (await getJson<{ requests: RequestSummary[] }>("/requests"))?.requests ?? [];
}

export async function getFinalRequest(id: string): Promise<RequestDetail | null> {
  return getJson<RequestDetail>(`/requests/${encodeURIComponent(id)}`);
}

const requestPath = (id: string, action: string) => `/requests/${encodeURIComponent(id)}/${action}`;

export function acceptQuote(id: string, input: { revisionId: string; optionIds: string[] }) {
  return postJson<{ ok: true; totalInr: number; dueNowInr: number }>(requestPath(id, "accept"), { ...input, agreed: true });
}
export function requestQuoteChanges(id: string, message: string) {
  return postJson<{ ok: true }>(requestPath(id, "changes"), { message });
}
export function declineQuote(id: string, reason: string) {
  return postJson<{ ok: true }>(requestPath(id, "decline"), { reason });
}
export function withdrawRequest(id: string) {
  return postJson<{ ok: true }>(requestPath(id, "cancel"), {});
}

export type CheckoutOrder = {
  keyId: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
};

export function createPaymentOrder(id: string) {
  return postJson<CheckoutOrder>(requestPath(id, "pay"), {});
}

export function verifyPayment(
  id: string,
  input: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string },
) {
  return postJson<{ ok: true; status: RequestStatus; paidInr: number; totalInr: number | null }>(requestPath(id, "pay/verify"), input);
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

// ---------------------------------------------------------------------------
// Admin: trip quote requests
// ---------------------------------------------------------------------------

export type AdminRequestRow = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  userName: string;
  contactEmail: string;
  contactPhone: string | null;
  destinationSummary: string;
  nights: number;
  startDate: string;
  estimateInr: number;
  quotedTotalInr: number | null;
  quoteValidUntil: string | null;
  acceptedTotalInr: number | null;
  paidInr: number;
};

export type AdminWorkingCopy = {
  kind: "draft" | "sent";
  version: number;
  request: unknown;
  adjustments: QuoteAdjustments | null;
  validUntil: string | null;
  note: string | null;
};

export type AdminRequestDetail = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  destinationSummary: string;
  nights: number;
  startDate: string;
  estimateInr: number;
  perPersonInr: number;
  contact: { name: string; accountEmail: string; email: string; phone: string | null; note: string | null };
  snapshot: unknown;
  events: RequestEvent[];
  revisions: { id: string; version: number; status: string; sentAt: string | null; totalInr: number; validUntil: string | null; note: string | null }[];
  workingCopy: AdminWorkingCopy | null;
  defaultValidUntil: string;
  quotedTotalInr: number | null;
  quoteValidUntil: string | null;
  acceptance: { acceptedAt: string; optionIds: string[]; totalInr: number | null } | null;
  paidInr: number;
  payments: { id: string; createdAt: string; amountInr: number; status: string; kind: string; reference: string | null; method: string | null; paidAt: string | null; failureReason: string | null }[];
};

export type AdminQuoteBody = {
  request: unknown;
  quotation: unknown;
  adjustments: QuoteAdjustments;
  validUntil: string;
  note: string;
};

/** `null` means "not an admin" (the API answers 404 to everyone else). */
export async function adminListTripRequests(): Promise<AdminRequestRow[] | null> {
  return (await getJson<{ requests: AdminRequestRow[] }>("/admin/requests"))?.requests ?? null;
}

export function adminGetTripRequest(id: string) {
  return getJson<AdminRequestDetail>(`/admin/requests/${encodeURIComponent(id)}`);
}

const adminPath = (id: string, action: string) => `/admin/requests/${encodeURIComponent(id)}/${action}`;

export const adminStartReview = (id: string) => postJson<{ ok: true; status: RequestStatus }>(adminPath(id, "review"), {});
export const adminSaveDraft = (id: string, body: AdminQuoteBody) => postJson<{ ok: true; savedAt: string }>(adminPath(id, "draft"), body);
export const adminSendTripQuote = (id: string, body: AdminQuoteBody) =>
  postJson<{ ok: true; version: number; totalInr: number; validUntil: string }>(adminPath(id, "send"), body);
export const adminAddNote = (id: string, text: string) => postJson<{ ok: true }>(adminPath(id, "note"), { text });
export const adminCloseTripRequest = (id: string, reason: string) => postJson<{ ok: true }>(adminPath(id, "close"), { reason });
