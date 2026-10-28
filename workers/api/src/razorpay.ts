/**
 * Razorpay Standard Checkout, server side.
 *
 * The flow, and why each step is on the server:
 *
 *   1. The Worker creates an **order** for an amount it computed itself from
 *      the stored quote — the browser is never asked what to charge.
 *   2. The browser opens Checkout with that order id and the public key id.
 *   3. On success Checkout returns `razorpay_payment_id` and a signature,
 *      which the browser posts back; the Worker recomputes
 *      HMAC-SHA256(order_id|payment_id, key_secret) and only then records the
 *      payment. A webhook (`payment.captured` / `order.paid`) does the same
 *      independently, so a payment still settles if the tab was closed.
 *
 * Needs three secrets (see docs/quote-workflow.md): RAZORPAY_KEY_ID,
 * RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET.
 */
import type { Env } from "./http";

const API = "https://api.razorpay.com/v1";

export function razorpayConfigured(env: Env): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

export type RazorpayOrder = { id: string; amount: number; currency: string; status: string };

/** Creates an order. Throws with a short message on any non-2xx, so the caller
 *  can log it and tell the traveller to try again. */
export async function createOrder(
  env: Env,
  input: { amountPaise: number; receipt: string; notes: Record<string, string> },
): Promise<RazorpayOrder> {
  const res = await fetch(`${API}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`,
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: "INR",
      // Razorpay caps receipts at 40 characters.
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Razorpay order failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as RazorpayOrder;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/** Constant-time string comparison, so a signature cannot be guessed byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies the signature Checkout hands the browser after a successful payment. */
export async function verifyCheckoutSignature(
  env: Env,
  input: { orderId: string; paymentId: string; signature: string },
): Promise<boolean> {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const expected = await hmacSha256Hex(env.RAZORPAY_KEY_SECRET, `${input.orderId}|${input.paymentId}`);
  return safeEqual(expected, input.signature.toLowerCase());
}

/** Verifies a webhook delivery against its raw body. */
export async function verifyWebhookSignature(env: Env, rawBody: string, signature: string | null): Promise<boolean> {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
  return safeEqual(expected, signature.toLowerCase());
}
