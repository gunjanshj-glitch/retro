/**
 * Razorpay payments for an accepted quote.
 *
 *   POST /requests/:id/pay          create (or reuse) an order, return what Checkout needs
 *   POST /requests/:id/pay/verify   check Checkout's signature and settle the payment
 *   POST /webhooks/razorpay         the same settlement, driven by Razorpay itself
 *
 * The amount is always computed here from the accepted quote (the deposit on
 * the first payment when the agency set one, otherwise whatever is still
 * owing). `settlePayment` is idempotent, so the browser callback and the
 * webhook can both land — in either order, or repeatedly — and the request
 * still settles exactly once.
 */
import type { Env } from "./http";
import { badRequest, json, notFound, readJson } from "./http";
import { getSessionUser, requireAuth } from "./auth";
import { agencyInbox, formatInr, sendNotice, siteUrl } from "./email";
import { addEvent, loadRequest, loadRevision, refreshExpiry, statusOf } from "./request-core";
import { createOrder, razorpayConfigured, verifyCheckoutSignature, verifyWebhookSignature } from "./razorpay";
import { nextPaymentInr } from "../../../lib/quote-pricing";

type PaymentRow = {
  id: string;
  request_id: string;
  revision_id: string;
  amount_paise: number;
  status: string;
  kind: string;
  razorpay_order_id: string;
  created_at: string;
};

/** An unpaid order for the same amount is reused for this long, so a refresh or a second click never piles up orders. */
const ORDER_REUSE_MS = 60 * 60 * 1000;

export async function handleCreatePayment(id: string, request: Request, env: Env): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;

  const found = await loadRequest(env, id);
  if (!found || found.user_id !== user!.id) return notFound("No request with that id.");
  const row = await refreshExpiry(env, found);
  const status = statusOf(row);

  if (status !== "accepted" && status !== "part_paid") {
    return json({ error: "There is nothing to pay on this request right now." }, { status: 409 });
  }
  if (!razorpayConfigured(env)) {
    return json(
      { error: "Online payment is not switched on yet. Our team will send you payment details directly.", code: "payments_unavailable" },
      { status: 503 },
    );
  }
  if (row.accepted_total_inr == null || !row.accepted_revision_id) {
    return json({ error: "This request has no accepted quote." }, { status: 409 });
  }
  const revision = await loadRevision(env, row.accepted_revision_id);
  const amountInr = nextPaymentInr(row.accepted_total_inr, row.paid_inr, revision?.deposit_inr ?? null);
  if (amountInr <= 0) return json({ error: "This booking is already paid in full." }, { status: 409 });

  const amountPaise = Math.round(amountInr * 100);
  const kind = row.paid_inr > 0 ? "balance" : amountInr < row.accepted_total_inr ? "deposit" : "full";

  let order = await env.DB.prepare(
    `SELECT id, request_id, revision_id, amount_paise, status, kind, razorpay_order_id, created_at
       FROM payment WHERE request_id = ? AND status = 'created' AND amount_paise = ? ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(row.id, amountPaise)
    .first<PaymentRow>();
  if (order && Date.now() - new Date(order.created_at).getTime() > ORDER_REUSE_MS) order = null;

  let orderId = order?.razorpay_order_id;
  if (!orderId) {
    const paymentId = crypto.randomUUID();
    try {
      const created = await createOrder(env, {
        amountPaise,
        receipt: `RH-${row.id.slice(0, 8)}-${paymentId.slice(0, 6)}`,
        notes: { request_id: row.id, payment_id: paymentId, kind },
      });
      orderId = created.id;
    } catch (error) {
      console.error("Razorpay order creation failed", error);
      return json({ error: "We could not start the payment. Please try again in a moment." }, { status: 502 });
    }
    await env.DB.prepare(
      `INSERT INTO payment (id, request_id, revision_id, created_at, amount_paise, currency, status, kind, razorpay_order_id)
       VALUES (?, ?, ?, ?, ?, 'INR', 'created', ?, ?)`,
    )
      .bind(paymentId, row.id, row.accepted_revision_id, new Date().toISOString(), amountPaise, kind, orderId)
      .run();
  }

  return json({
    keyId: env.RAZORPAY_KEY_ID,
    orderId,
    amountPaise,
    currency: "INR",
    description: `${row.destination_summary} — ${kind === "deposit" ? "booking deposit" : kind === "balance" ? "balance payment" : "full payment"}`,
    prefill: { name: row.user_name, email: row.contact_email ?? row.user_email, contact: row.contact_phone ?? "" },
  });
}

export async function handleVerifyPayment(id: string, request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const user = await getSessionUser(request, env);
  const unauthorised = requireAuth(user);
  if (unauthorised) return unauthorised;

  const row = await loadRequest(env, id);
  if (!row || row.user_id !== user!.id) return notFound("No request with that id.");

  const body = await readJson<{ razorpay_order_id?: unknown; razorpay_payment_id?: unknown; razorpay_signature?: unknown }>(request, 4 * 1024);
  const orderId = typeof body?.razorpay_order_id === "string" ? body.razorpay_order_id : "";
  const paymentId = typeof body?.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const signature = typeof body?.razorpay_signature === "string" ? body.razorpay_signature : "";
  if (!orderId || !paymentId || !signature) return badRequest("Payment details are missing.");

  const order = await env.DB.prepare(`SELECT id, request_id FROM payment WHERE razorpay_order_id = ?`).bind(orderId).first<{ id: string; request_id: string }>();
  if (!order || order.request_id !== row.id) return notFound("No such payment.");

  if (!(await verifyCheckoutSignature(env, { orderId, paymentId, signature }))) {
    console.error("Razorpay checkout signature mismatch", { requestId: row.id, orderId });
    return badRequest("We could not verify that payment. If money left your account, contact us with your request ID and we will sort it out.");
  }

  const settled = await settlePayment(env, ctx, { orderId, paymentId });
  if (!settled) return json({ error: "Payment could not be matched to this request." }, { status: 409 });
  return json({ ok: true, status: settled.status, paidInr: settled.paidInr, totalInr: settled.totalInr });
}

export type Settled = { status: string; paidInr: number; totalInr: number | null };

/**
 * Marks an order paid and rolls the request's totals forward. Safe to call any
 * number of times for the same order: only the call that actually flips the row
 * from unpaid writes the timeline entry and sends the receipts, but the
 * request's paid total is always recomputed from the payment rows, so a
 * previous attempt that died half-way is repaired by the next one.
 */
export async function settlePayment(
  env: Env,
  ctx: ExecutionContext | undefined,
  input: { orderId: string; paymentId: string; amountPaise?: number; method?: string | null },
): Promise<Settled | null> {
  const payment = await env.DB.prepare(
    `SELECT id, request_id, revision_id, amount_paise, status, kind, razorpay_order_id, created_at
       FROM payment WHERE razorpay_order_id = ?`,
  )
    .bind(input.orderId)
    .first<PaymentRow>();
  if (!payment) return null;

  // A webhook states the amount Razorpay actually took; if it is not what we
  // asked for, do not credit it — someone should look.
  if (input.amountPaise != null && input.amountPaise !== payment.amount_paise) {
    console.error("Razorpay amount mismatch", { orderId: input.orderId, expected: payment.amount_paise, got: input.amountPaise });
    return null;
  }

  const flipped = await env.DB.prepare(
    `UPDATE payment SET status = 'paid', razorpay_payment_id = ?, method = COALESCE(?, method), paid_at = ?, failure_reason = NULL
      WHERE razorpay_order_id = ? AND status != 'paid'`,
  )
    .bind(input.paymentId, input.method ?? null, new Date().toISOString(), input.orderId)
    .run();
  const firstTime = Number(flipped.meta?.changes ?? 0) > 0;

  const sum = await env.DB.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS paise FROM payment WHERE request_id = ? AND status = 'paid'`)
    .bind(payment.request_id)
    .first<{ paise: number }>();
  const paidInr = (sum?.paise ?? 0) / 100;

  const row = await loadRequest(env, payment.request_id);
  if (!row) return null;
  const total = row.accepted_total_inr;
  const status = total != null && paidInr >= total ? "paid" : "part_paid";

  // Only an accepted/part-paid/paid request moves; money arriving on one the
  // agency has since closed is still recorded on the payment, and flagged.
  await env.DB.prepare(
    `UPDATE quotation_request SET paid_inr = ?, status = ?, updated_at = ?
      WHERE id = ? AND status IN ('accepted', 'part_paid', 'paid')`,
  )
    .bind(paidInr, status, new Date().toISOString(), row.id)
    .run();

  if (firstTime) {
    const amountInr = payment.amount_paise / 100;
    await addEvent(env, row.id, {
      actor: "system",
      type: "payment_received",
      summary:
        status === "paid"
          ? `Payment of ${formatInr(amountInr)} received — your booking is confirmed.`
          : `Payment of ${formatInr(amountInr)} received. Balance ${formatInr(Math.max(0, (total ?? 0) - paidInr))} due.`,
    });

    const link = `${siteUrl(env)}/my-requests/view?id=${encodeURIComponent(row.id)}`;
    const receipts = Promise.all([
      sendNotice(env, {
        to: row.contact_email ?? row.user_email,
        subject: status === "paid" ? `Booking confirmed — ${row.destination_summary}` : `Payment received — ${row.destination_summary}`,
        intro:
          status === "paid"
            ? "Thank you — your payment has been received and your booking is confirmed. Our team will be in touch with the next steps."
            : "Thank you — we have received your payment. The balance is due to complete your booking.",
        lines: [
          `Paid now: ${formatInr(amountInr)}`,
          `Total paid: ${formatInr(paidInr)} of ${formatInr(total ?? paidInr)}`,
          `Payment reference: ${input.paymentId}`,
          `Request ID: ${row.id}`,
        ],
        cta: { label: "View your booking", url: link },
        replyTo: { email: agencyInbox(env) },
      }),
      sendNotice(env, {
        to: agencyInbox(env),
        subject: `Payment received ${formatInr(amountInr)} — ${row.destination_summary}`,
        intro: status === "paid" ? "A booking is now paid in full." : "A part payment has been received.",
        lines: [
          `Traveller: ${row.user_name} <${row.contact_email ?? row.user_email}>${row.contact_phone ? ` · ${row.contact_phone}` : ""}`,
          `Paid now: ${formatInr(amountInr)} (${payment.kind})`,
          `Total paid: ${formatInr(paidInr)} of ${formatInr(total ?? paidInr)}`,
          `Razorpay payment: ${input.paymentId}`,
        ],
        cta: { label: "Open request", url: `${siteUrl(env)}/admin/request?id=${encodeURIComponent(row.id)}` },
        fromName: "Retro Holidays — Website",
      }),
    ]);
    if (ctx) ctx.waitUntil(receipts);
    else await receipts;
  }

  return { status, paidInr, totalInr: total };
}

type WebhookPayment = { id?: string; order_id?: string; amount?: number; method?: string; error_description?: string };
type WebhookBody = { event?: string; payload?: { payment?: { entity?: WebhookPayment } } };

export async function handleRazorpayWebhook(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  // Signature is over the raw bytes, so read the text once and parse from it.
  const raw = await request.text();
  if (raw.length > 256 * 1024) return badRequest("Body too large.");
  if (!(await verifyWebhookSignature(env, raw, request.headers.get("X-Razorpay-Signature")))) {
    return json({ error: "Bad signature." }, { status: 400 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(raw) as WebhookBody;
  } catch {
    return badRequest("Malformed body.");
  }
  const payment = body.payload?.payment?.entity;
  if (!payment?.id || !payment.order_id) return json({ ok: true, ignored: true });

  if (body.event === "payment.captured" || body.event === "order.paid") {
    await settlePayment(env, ctx, { orderId: payment.order_id, paymentId: payment.id, amountPaise: payment.amount, method: payment.method ?? null });
  } else if (body.event === "payment.failed") {
    const failed = await env.DB.prepare(
      `UPDATE payment SET failure_reason = ? WHERE razorpay_order_id = ? AND status != 'paid'`,
    )
      .bind((payment.error_description ?? "Payment failed").slice(0, 300), payment.order_id)
      .run();
    if (Number(failed.meta?.changes ?? 0) > 0) {
      const row = await env.DB.prepare(`SELECT request_id FROM payment WHERE razorpay_order_id = ?`).bind(payment.order_id).first<{ request_id: string }>();
      if (row) await addEvent(env, row.request_id, { actor: "system", type: "payment_failed", summary: "A payment attempt did not go through. You can try again." });
    }
  }
  // Always 200 for a verified delivery, so Razorpay does not retry what we have already handled.
  return json({ ok: true });
}
