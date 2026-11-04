/**
 * Typed client for the Retro Holidays API.
 *
 * Auth transport is the only thing that differs from the website: the app
 * sends `X-Client: mobile` (so login returns a bearer token in the body) and an
 * `Authorization: Bearer` header; the site keeps using its cookie.
 *
 * Every create/send carries an `Idempotency-Key`, generated once per user action
 * and reused on retry, so a flaky connection can never make a duplicate
 * request, message or quote revision.
 */
import type { PackageRequestSummary, PackageRequestPayload, AdminRequestSummary, AppConfig, Enquiry, RequestDetail, RequestSummary, User } from "./types";

export type { PackageRequestPayload, PaymentState, AdminRequestSummary, AppConfig, Enquiry, RequestDetail, RequestEvent, RequestSummary, User } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Machine-readable (`NOT_FOUND`, `RATE_LIMITED`, …); `NETWORK` when no response arrived. */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isNetwork() { return this.code === "NETWORK"; }
  get isUnauthorised() { return this.status === 401; }
}

export type ClientOptions = {
  /** e.g. `https://retroholidays.in/api/v1` */
  baseUrl: string;
  getToken: () => Promise<string | null> | string | null;
  /** Called on any 401 for a request that sent a token, so the app can sign out. */
  onUnauthorised?: () => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
  newKey?: () => string;
};

type Opts = { method?: string; body?: unknown; idempotencyKey?: string; auth?: boolean; query?: Record<string, string | number | undefined> };

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? fetch;
  const newKey = options.newKey ?? (() => globalThis.crypto.randomUUID());

  async function call<T>(path: string, o: Opts = {}): Promise<T> {
    const token = o.auth === false ? null : await options.getToken();
    const qs = o.query
      ? "?" + Object.entries(o.query).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")
      : "";
    const headers: Record<string, string> = { "X-Client": "mobile", Accept: "application/json" };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (o.idempotencyKey) headers["Idempotency-Key"] = o.idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await doFetch(`${options.baseUrl}${path}${qs}`, {
        method: o.method ?? (o.body !== undefined ? "POST" : "GET"),
        headers,
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(0, "NETWORK", "Could not reach Retro Holidays. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
    }

    const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
    if (!res.ok) {
      if (res.status === 401 && token) options.onUnauthorised?.();
      throw new ApiError(res.status, data?.code ?? "ERROR", data?.error ?? `Request failed (${res.status}).`);
    }
    return data as T;
  }

  /** A retry of one user action must reuse its key; call `key()` once when the action starts. */
  const key = newKey;

  return {
    key,
    ApiError,

    config: (platform: "ios" | "android", version: string) => call<AppConfig>("/app-config", { auth: false, query: { platform, version } }),

    auth: {
      login: (email: string, password: string) => call<{ user: User; token: string }>("/auth/login", { body: { email, password }, auth: false }),
      register: (name: string, email: string, password: string) => call<{ user: User; token: string }>("/auth/register", { body: { name, email, password }, auth: false }),
      forgot: (email: string) => call<{ ok: true }>("/auth/forgot", { body: { email }, auth: false }),
      me: () => call<{ user: User | null; isStaff?: boolean }>("/auth/me"),
      logout: () => call<{ ok: true }>("/auth/logout", { method: "POST", body: {} }),
      exchange: (code: string, verifier: string) => call<{ user: User; token: string }>("/auth/mobile/exchange", { body: { code, code_verifier: verifier }, auth: false }),
      apple: (identityToken: string, name?: string) => call<{ user: User; token: string }>("/auth/apple", { body: { identityToken, name }, auth: false }),
      providers: () => call<Record<string, boolean>>("/auth/providers", { auth: false }),
      deleteAccount: (password?: string) => call<{ ok: true }>("/auth/account", { method: "DELETE", body: password ? { password } : {} }),
    },

    requests: {
      list: () => call<{ requests: RequestSummary[] }>("/requests").then((r) => r.requests),
      get: (id: string) => call<RequestDetail>(`/requests/${id}`),
      create: (payload: unknown, idempotencyKey: string) => call<{ ok: true; id: string; emailSent: boolean }>("/requests", { body: payload, idempotencyKey }),
      accept: (id: string, revisionId: string, optionIds: string[], idempotencyKey: string) => call<{ ok: true; totalInr: number; dueNowInr: number }>(`/requests/${id}/accept`, { body: { revisionId, optionIds, agreed: true }, idempotencyKey }),
      requestChanges: (id: string, message: string, idempotencyKey: string) => call<{ ok: true }>(`/requests/${id}/changes`, { body: { message }, idempotencyKey }),
      decline: (id: string, reason: string | undefined, idempotencyKey: string) => call<{ ok: true }>(`/requests/${id}/decline`, { body: { reason }, idempotencyKey }),
      cancel: (id: string, idempotencyKey: string) => call<{ ok: true }>(`/requests/${id}/cancel`, { body: {}, idempotencyKey }),
      message: (id: string, text: string, idempotencyKey: string) => call<{ ok: true }>(`/requests/${id}/messages`, { body: { text }, idempotencyKey }),
      /** Returns a hosted `payUrl` for the in-app browser. The result of paying is read back with `get`, never trusted from the redirect. */
      pay: (id: string, returnUrl?: string) => call<{ payUrl: string }>(`/requests/${id}/pay`, { body: { returnUrl } }),
    },

    packageRequests: {
      list: () => call<{ requests: PackageRequestSummary[] }>("/package-requests").then((r) => r.requests),
      create: (payload: PackageRequestPayload, idempotencyKey: string) => call<{ ok: true; id: string }>("/package-requests", { body: payload, idempotencyKey }),
    },

    enquiries: {
      create: (payload: Record<string, unknown>, idempotencyKey: string) => call<{ ok: true; id: string | null }>("/enquiries", { body: payload, auth: false, idempotencyKey }),
    },

    devices: {
      register: (expoPushToken: string, platform: "ios" | "android", appVersion?: string) => call<{ ok: true; id: string }>("/devices", { body: { expoPushToken, platform, appVersion } }),
      remove: (id: string) => call<{ ok: true }>(`/devices/${id}`, { method: "DELETE" }),
    },

    staff: {
      requests: () => call<{ requests: AdminRequestSummary[] }>("/admin/requests").then((r) => r.requests),
      request: (id: string) => call<RequestDetail>(`/admin/requests/${id}`),
      startReview: (id: string) => call<{ ok: true }>(`/admin/requests/${id}/review`, { body: {} }),
      reply: (id: string, text: string, idempotencyKey: string) => call<{ ok: true }>(`/admin/requests/${id}/messages`, { body: { text }, idempotencyKey }),
      note: (id: string, text: string) => call<{ ok: true }>(`/admin/requests/${id}/note`, { body: { text } }),
      close: (id: string, reason: string | undefined, idempotencyKey: string) => call<{ ok: true }>(`/admin/requests/${id}/close`, { body: { reason }, idempotencyKey }),
      enquiries: () => call<{ enquiries: Enquiry[] }>("/admin/enquiries").then((r) => r.enquiries),
    },
  };
}

export type ApiClient = ReturnType<typeof createClient>;
