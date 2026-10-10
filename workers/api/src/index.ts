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
import { corsHeaders, json, notFound } from "./http";
import { handleLiveRates } from "./live-rates";
import { handleEnquiry } from "./enquiries";
import { handleGetQuote, handleSaveQuote } from "./quotes";
import { handleLogin, handleLogout, handleMe, handleRegister } from "./auth";
import { handleOAuthCallback, handleOAuthProviders, handleOAuthStart, type Provider } from "./oauth";
import { handleCreatePackageRequest, handleListPackageRequests } from "./package-requests";
import { handleAdminList, handleAdminQuote } from "./admin";
import { handleCreateRequest, handleGetRequest, handleListRequests } from "./requests";

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  // Tolerate being mounted with or without the `/api` prefix, so the same
  // Worker works behind the frontend's service binding and on its own
  // `workers.dev` URL during development.
  const path = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  const method = request.method.toUpperCase();

  if (path === "/health") {
    return json({
      ok: true,
      environment: env.ENVIRONMENT ?? "unknown",
      time: new Date().toISOString(),
    });
  }

  if (path === "/live-rates" && method === "GET") {
    return handleLiveRates(request, env, ctx);
  }

  if (path === "/enquiries" && method === "POST") {
    return handleEnquiry(request, env);
  }

  if (path === "/quotes" && method === "POST") {
    return handleSaveQuote(request, env);
  }

  const quoteMatch = /^\/quotes\/([A-Za-z0-9-]{1,64})$/.exec(path);
  if (quoteMatch && method === "GET") {
    return handleGetQuote(quoteMatch[1], env);
  }

  // ---- auth ----
  if (path === "/auth/register" && method === "POST") return handleRegister(request, env);
  if (path === "/auth/login" && method === "POST") return handleLogin(request, env);
  if (path === "/auth/logout" && method === "POST") return handleLogout(request, env);
  if (path === "/auth/me" && method === "GET") return handleMe(request, env);
  if (path === "/auth/providers" && method === "GET") return handleOAuthProviders(env);

  const oauthStart = /^\/auth\/(google|facebook)\/start$/.exec(path);
  if (oauthStart && method === "GET") {
    return handleOAuthStart(oauthStart[1] as Provider, request, env);
  }
  const oauthCallback = /^\/auth\/(google|facebook)\/callback$/.exec(path);
  if (oauthCallback && method === "GET") {
    return handleOAuthCallback(oauthCallback[1] as Provider, request, env);
  }

  // ---- final-approval requests ----
  if (path === "/requests" && method === "POST") return handleCreateRequest(request, env);
  if (path === "/requests" && method === "GET") return handleListRequests(request, env);
  // ---- package quote requests ----
  if (path === "/package-requests" && method === "POST") return handleCreatePackageRequest(request, env, ctx);
  if (path === "/package-requests" && method === "GET") return handleListPackageRequests(request, env);

  // ---- admin (quotes for package requests) ----
  if (path === "/admin/package-requests" && method === "GET") return handleAdminList(request, env);
  const adminQuote = /^\/admin\/package-requests\/([A-Za-z0-9-]{1,64})\/(quote|close)$/.exec(path);
  if (adminQuote && method === "POST") return handleAdminQuote(adminQuote[1], adminQuote[2] as "quote" | "close", request, env);

  const requestMatch = /^\/requests\/([A-Za-z0-9-]{1,64})$/.exec(path);
  if (requestMatch && method === "GET") return handleGetRequest(requestMatch[1], request, env);

  return notFound(`No route for ${method} ${path}`);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    let response: Response;
    try {
      response = await route(request, env, ctx);
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
};

export default worker;
