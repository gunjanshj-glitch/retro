/**
 * Atlas backend Worker.
 *
 * Handles the small part of the product that genuinely cannot run in the
 * browser: calls that must keep an API key secret, and state that has to
 * outlive the page.
 *
 * It deliberately does **not** serve the catalogue or run the quotation
 * engine. Those stay compiled into static assets and execute client-side —
 * that is what makes re-pricing instant as the traveller adjusts anything, and
 * what keeps the whole thing inside Cloudflare's free tier. Putting them
 * behind a database round trip would be slower, costlier and no more correct,
 * because the engine is pure.
 *
 * In production the frontend Worker forwards `/api/*` here over a service
 * binding, so these routes are same-origin to the browser and CORS never
 * applies. `ALLOWED_ORIGINS` exists only for local development against
 * `next dev`.
 */
import type { Env } from "./http";
import { corsHeaders, json, normalisePath, notFound, withErrorCode } from "./http";
import { withIdempotency } from "./idempotency";
import { handleAppConfig } from "./app-config";
import { runScheduled } from "./cron";
import { handleLiveRates } from "./live-rates";
import { handleEnquiry } from "./enquiries";
import { handleGetQuote, handleSaveQuote } from "./quotes";
import { handleForgotPassword, handleLogin, handleLogout, handleMe, handleRegister, handleResetPassword } from "./auth";
import { handleOAuthCallback, handleOAuthProviders, handleOAuthStart, type Provider } from "./oauth";
import { handleCreatePackageRequest, handleListPackageRequests } from "./package-requests";
import { handleAdminList, handleAdminQuote } from "./admin";
import {
  handleAcceptQuote,
  handleCancelRequest,
  handleCreateRequest,
  handleDeclineQuote,
  handleGetRequest,
  handleListRequests,
  handleRequestChanges,
  handleTravellerMessage,
} from "./requests";
import { handleCreatePayment, handleRazorpayWebhook, handleVerifyPayment } from "./payments";
import {
  handleAdminClose,
  handleAdminGetRequest,
  handleAdminListEnquiries,
  handleAdminMessage,
  handleAdminListRequests,
  handleAdminNote,
  handleAdminSaveDraft,
  handleAdminSendQuote,
  handleAdminStartReview,
} from "./request-admin";

type Params = string[];
type Handler = (request: Request, env: Env, ctx: ExecutionContext, params: Params) => Response | Promise<Response>;
type Route = { method: string; pattern: RegExp; handle: Handler };

const ID = "([A-Za-z0-9-]{1,64})";

/**
 * Every endpoint, in one place. A route is a method, an anchored pattern and a handler;
 * capture groups become `params`. Adding an endpoint is one line here plus its handler, and
 * the list doubles as the API's table of contents.
 */
const ROUTES: Route[] = [
  // ---- platform ----
  { method: "GET", pattern: /^\/health$/, handle: (_r, env) => json({ ok: true, environment: env.ENVIRONMENT ?? "unknown", time: new Date().toISOString() }) },
  { method: "GET", pattern: /^\/app-config$/, handle: (r, env) => handleAppConfig(r, env) },
  { method: "GET", pattern: /^\/live-rates$/, handle: (r, env, ctx) => handleLiveRates(r, env, ctx) },

  // ---- public capture ----
  { method: "POST", pattern: /^\/enquiries$/, handle: (r, env) => handleEnquiry(r, env) },
  { method: "POST", pattern: /^\/quotes$/, handle: (r, env) => handleSaveQuote(r, env) },
  { method: "GET", pattern: new RegExp(`^/quotes/${ID}$`), handle: (_r, env, _c, [id]) => handleGetQuote(id, env) },

  // ---- auth ----
  { method: "POST", pattern: /^\/auth\/register$/, handle: (r, env) => handleRegister(r, env) },
  { method: "POST", pattern: /^\/auth\/login$/, handle: (r, env) => handleLogin(r, env) },
  { method: "POST", pattern: /^\/auth\/forgot$/, handle: (r, env, ctx) => handleForgotPassword(r, env, ctx) },
  { method: "POST", pattern: /^\/auth\/reset$/, handle: (r, env) => handleResetPassword(r, env) },
  { method: "POST", pattern: /^\/auth\/logout$/, handle: (r, env) => handleLogout(r, env) },
  { method: "GET", pattern: /^\/auth\/me$/, handle: (r, env) => handleMe(r, env) },
  { method: "GET", pattern: /^\/auth\/providers$/, handle: (_r, env) => handleOAuthProviders(env) },
  { method: "GET", pattern: /^\/auth\/(google|facebook|x)\/start$/, handle: (r, env, _c, [p]) => handleOAuthStart(p as Provider, r, env) },
  { method: "GET", pattern: /^\/auth\/(google|facebook|x)\/callback$/, handle: (r, env, _c, [p]) => handleOAuthCallback(p as Provider, r, env) },

  // ---- traveller: requests and package requests ----
  { method: "POST", pattern: /^\/requests$/, handle: (r, env, ctx) => handleCreateRequest(r, env, ctx) },
  { method: "GET", pattern: /^\/requests$/, handle: (r, env) => handleListRequests(r, env) },
  { method: "GET", pattern: new RegExp(`^/requests/${ID}$`), handle: (r, env, _c, [id]) => handleGetRequest(id, r, env) },
  { method: "POST", pattern: new RegExp(`^/requests/${ID}/accept$`), handle: (r, env, ctx, [id]) => handleAcceptQuote(id, r, env, ctx) },
  { method: "POST", pattern: new RegExp(`^/requests/${ID}/changes$`), handle: (r, env, ctx, [id]) => handleRequestChanges(id, r, env, ctx) },
  { method: "POST", pattern: new RegExp(`^/requests/${ID}/decline$`), handle: (r, env, ctx, [id]) => handleDeclineQuote(id, r, env, ctx) },
  { method: "POST", pattern: new RegExp(`^/requests/${ID}/cancel$`), handle: (r, env, ctx, [id]) => handleCancelRequest(id, r, env, ctx) },
  { method: "POST", pattern: new RegExp(`^/requests/${ID}/messages$`), handle: (r, env, ctx, [id]) => handleTravellerMessage(id, r, env, ctx) },
  { method: "POST", pattern: new RegExp(`^/requests/${ID}/pay$`), handle: (r, env, _c, [id]) => handleCreatePayment(id, r, env) },
  { method: "POST", pattern: new RegExp(`^/requests/${ID}/pay/verify$`), handle: (r, env, ctx, [id]) => handleVerifyPayment(id, r, env, ctx) },
  { method: "POST", pattern: /^\/package-requests$/, handle: (r, env, ctx) => handleCreatePackageRequest(r, env, ctx) },
  { method: "GET", pattern: /^\/package-requests$/, handle: (r, env) => handleListPackageRequests(r, env) },

  // ---- staff ----
  { method: "GET", pattern: /^\/admin\/package-requests$/, handle: (r, env) => handleAdminList(r, env) },
  { method: "POST", pattern: new RegExp(`^/admin/package-requests/${ID}/(quote|close)$`), handle: (r, env, _c, [id, a]) => handleAdminQuote(id, a as "quote" | "close", r, env) },
  { method: "GET", pattern: /^\/admin\/enquiries$/, handle: (r, env) => handleAdminListEnquiries(r, env) },
  { method: "GET", pattern: /^\/admin\/requests$/, handle: (r, env) => handleAdminListRequests(r, env) },
  { method: "GET", pattern: new RegExp(`^/admin/requests/${ID}$`), handle: (r, env, _c, [id]) => handleAdminGetRequest(id, r, env) },
  { method: "POST", pattern: new RegExp(`^/admin/requests/${ID}/review$`), handle: (r, env, _c, [id]) => handleAdminStartReview(id, r, env) },
  { method: "POST", pattern: new RegExp(`^/admin/requests/${ID}/draft$`), handle: (r, env, _c, [id]) => handleAdminSaveDraft(id, r, env) },
  { method: "POST", pattern: new RegExp(`^/admin/requests/${ID}/send$`), handle: (r, env, ctx, [id]) => handleAdminSendQuote(id, r, env, ctx) },
  { method: "POST", pattern: new RegExp(`^/admin/requests/${ID}/note$`), handle: (r, env, _c, [id]) => handleAdminNote(id, r, env) },
  { method: "POST", pattern: new RegExp(`^/admin/requests/${ID}/close$`), handle: (r, env, ctx, [id]) => handleAdminClose(id, r, env, ctx) },
  { method: "POST", pattern: new RegExp(`^/admin/requests/${ID}/messages$`), handle: (r, env, ctx, [id]) => handleAdminMessage(id, r, env, ctx) },

  // Razorpay calls this directly (server to server), not through a browser.
  { method: "POST", pattern: /^\/webhooks\/razorpay$/, handle: (r, env, ctx) => handleRazorpayWebhook(r, env, ctx) },
];

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Tolerate being mounted with or without `/api`, and with or without a `/v1` segment, so the same
  // Worker works behind the frontend's service binding, on its own `workers.dev` URL, and for apps
  // pinned to a version.
  const path = normalisePath(request.url);
  const method = request.method.toUpperCase();

  let pathMatched = false;
  for (const r of ROUTES) {
    const m = r.pattern.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method === method) return r.handle(request, env, ctx, m.slice(1));
  }
  // Staff routes keep answering 404, so a probe cannot learn which admin paths exist.
  return pathMatched && !path.startsWith("/admin")
    ? json({ error: `${method} is not allowed on ${path}`, code: "METHOD_NOT_ALLOWED" }, { status: 405 })
    : notFound(`No route for ${method} ${path}`);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    let response: Response;
    try {
      response = await withErrorCode(await withIdempotency(request, env, () => route(request, env, ctx)));
    } catch (error) {
      // Never leak an internal message to the caller; the detail goes to the
      // Worker's own logs, which `[observability]` keeps.
      console.error("Unhandled error", error);
      response = json({ error: "Internal error" }, { status: 500 });
    }

    if (!Object.keys(cors).length) return response;

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },

  /** Cron Trigger: purge dead rows and apply quote expiry (cron.ts). */
  async scheduled(_controller: { scheduledTime: number; cron: string }, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runScheduled(env).then(
        (result) => console.log("scheduled run", JSON.stringify(result)),
        (error) => console.error("scheduled run failed", error),
      ),
    );
  },
};

export default worker;
