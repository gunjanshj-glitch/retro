/**
 * The hosted payment page (mobile plan B4).
 *
 * The app does not embed Razorpay's React Native SDK (a native module: no Expo Go, forced dev client). It opens
 * `GET /pay/:id?t=<token>` in the system browser instead; this page loads Checkout.js, takes the payment, calls
 * the verify route below, and hands control back to the app with `retro://pay-result?status=...`.
 *
 * Security shape:
 *  - The `t` token is NOT the session. URLs get logged and cached, so the link carries a purpose-built token:
 *    HMAC-SHA256, bound to one request, one user and one Razorpay order, valid ten minutes to open the page.
 *    It can open this page and verify this order and nothing else.
 *  - The redirect back is a HINT. The page reports "success" when verify accepted the signature, but the app must
 *    still confirm by reading the request (the webhook is the source of truth). Nothing here marks anything paid
 *    except the same signature-checked settle the website uses.
 *
 * Needs Razorpay configured (the token key is derived from its secret unless PAY_TOKEN_SECRET is set).
 */
import type { Env } from "./http";
import { notFound, readJson } from "./http";
import { allowedAppRedirect, withParams } from "./app-links";
import { loadRequest, refreshExpiry, statusOf } from "./request-core";
import { razorpayConfigured } from "./razorpay";
import { verifyCheckoutPayload } from "./payments";

const OPEN_TTL_SECONDS = 10 * 60;
/** A payment can take a while (UPI app switch); verifying is allowed this long after the page was due to open. */
const VERIFY_GRACE_SECONDS = 60 * 60;

type PayTokenPayload = { r: string; u: string; o: string; b: string };
type Signed = PayTokenPayload & { e: number };

function secretFor(env: Env): string | null {
  if (env.PAY_TOKEN_SECRET) return env.PAY_TOKEN_SECRET;
  return env.RAZORPAY_KEY_SECRET ? `retro-pay-token:${env.RAZORPAY_KEY_SECRET}` : null;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signPayToken(env: Env, payload: PayTokenPayload, now = Date.now()): Promise<string | null> {
  const secret = secretFor(env);
  if (!secret) return null;
  const body = b64url(new TextEncoder().encode(JSON.stringify({ ...payload, e: Math.floor(now / 1000) + OPEN_TTL_SECONDS } satisfies Signed)));
  return `${body}.${await hmac(secret, body)}`;
}

/** The token's payload if the signature holds and it has not expired (plus `graceSeconds`). */
export async function verifyPayToken(env: Env, token: string, graceSeconds = 0, now = Date.now()): Promise<Signed | null> {
  const secret = secretFor(env);
  const [body, sig] = token.split(".");
  if (!secret || !body || !sig || token.length > 1000) return null;
  if (!same(await hmac(secret, body), sig)) return null;
  try {
    const bytes = Uint8Array.from(atob(body.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Signed;
    if (typeof payload.e !== "number" || payload.e + graceSeconds < now / 1000) return null;
    if (!payload.r || !payload.u || !payload.o || !payload.b) return null;
    return payload;
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function page(body: string, nonce: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Secure payment — Retro Holidays</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#f3efe6;font:16px/1.5 -apple-system,system-ui,sans-serif;padding:24px;box-sizing:border-box}
main{max-width:360px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;opacity:.8}button{background:#c9a24a;color:#111;border:0;border-radius:999px;padding:12px 28px;font:600 16px inherit;cursor:pointer}</style></head>
<body>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // The URL carries a token; never leak it in a Referer to Razorpay's scripts.
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}' https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; connect-src 'self' https://*.razorpay.com; img-src https: data:; style-src 'unsafe-inline' https://*.razorpay.com; font-src https://*.razorpay.com; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

const problem = (title: string, text: string, nonce: string, status: number) =>
  page(`<main><h1>${esc(title)}</h1><p>${esc(text)}</p></main>`, nonce, status);

export async function handlePayPage(id: string, request: Request, env: Env): Promise<Response> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = new URL(request.url);
  const claims = await verifyPayToken(env, url.searchParams.get("t") ?? "");
  if (!claims || claims.r !== id) return problem("This payment link has expired", "Go back to the app and tap Pay again.", nonce, 403);
  if (!razorpayConfigured(env)) return problem("Online payment isn't available", "Our team will send you payment details directly.", nonce, 503);

  const found = await loadRequest(env, id);
  if (!found || found.user_id !== claims.u) return problem("This payment link is not valid", "Go back to the app and tap Pay again.", nonce, 403);
  const row = await refreshExpiry(env, found);
  const status = statusOf(row);
  if (status !== "accepted" && status !== "part_paid") return problem("Nothing to pay right now", "Return to the app to see the latest status.", nonce, 409);

  const payment = await env.DB.prepare(`SELECT amount_paise, status, kind FROM payment WHERE razorpay_order_id = ? AND request_id = ?`)
    .bind(claims.o, row.id)
    .first<{ amount_paise: number; status: string; kind: string }>();
  if (!payment) return problem("This payment link is not valid", "Go back to the app and tap Pay again.", nonce, 403);
  if (payment.status === "paid") return problem("Already paid", "This payment has been received. Return to the app.", nonce, 409);

  const back = allowedAppRedirect(claims.b, env, "pay");
  if (!back) return problem("This payment link is not valid", "Go back to the app and tap Pay again.", nonce, 403);

  // Embedded as inert JSON so no value is ever interpreted as script; "<" is escaped to defeat "</script>".
  const config = JSON.stringify({
    key: env.RAZORPAY_KEY_ID,
    order: claims.o,
    amount: payment.amount_paise,
    desc: `${row.destination_summary} — ${payment.kind === "deposit" ? "booking deposit" : payment.kind === "balance" ? "balance payment" : "full payment"}`,
    prefill: { name: row.user_name, email: row.contact_email ?? row.user_email, contact: row.contact_phone ?? "" },
    request: row.id,
    back,
    verifyUrl: `${url.pathname}/verify${url.search}`,
  }).replace(/</g, "\\u003c");

  return page(
    `<main><h1>Secure payment</h1><p id="msg">Opening Razorpay…</p><button id="pay" type="button">Pay now</button></main>
<script type="application/json" id="cfg">${config}</script>
<script src="https://checkout.razorpay.com/v1/checkout.js" nonce="${nonce}"></script>
<script nonce="${nonce}">
(function(){
  var cfg = JSON.parse(document.getElementById('cfg').textContent);
  var msg = document.getElementById('msg');
  function done(status){
    var sep = cfg.back.indexOf('?') === -1 ? '?' : '&';
    location.href = cfg.back + sep + 'status=' + status + '&request=' + encodeURIComponent(cfg.request);
  }
  function open(){
    var rzp = new Razorpay({
      key: cfg.key, order_id: cfg.order, amount: cfg.amount, currency: 'INR', name: 'Retro Holidays',
      description: cfg.desc, prefill: cfg.prefill, theme: { color: '#c9a24a' },
      handler: function(resp){
        msg.textContent = 'Confirming your payment…';
        fetch(cfg.verifyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resp) })
          .then(function(r){ done(r.ok ? 'success' : 'pending'); }, function(){ done('pending'); });
      },
      modal: { ondismiss: function(){ done('cancelled'); } }
    });
    rzp.open();
  }
  document.getElementById('pay').addEventListener('click', open);
  window.addEventListener('load', function(){ try { open(); } catch (e) { msg.textContent = 'Tap Pay now to continue.'; } });
})();
</script>`,
    nonce,
  );
}

/** The page's callback: same signature check and settle as the website, authenticated by the pay token. */
export async function handlePayPageVerify(id: string, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const claims = await verifyPayToken(env, new URL(request.url).searchParams.get("t") ?? "", VERIFY_GRACE_SECONDS);
  if (!claims || claims.r !== id) return notFound("This payment link has expired.");
  const row = await loadRequest(env, id);
  if (!row || row.user_id !== claims.u) return notFound("No request with that id.");
  return verifyCheckoutPayload(env, ctx, row.id, await readJson(request, 4 * 1024), claims.o);
}

