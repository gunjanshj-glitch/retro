/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies and DB rows are untyped JSON in these tests */
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "@/workers/api/src/index";
import type { Env } from "@/workers/api/src/http";
import { hmacSha256Hex } from "@/workers/api/src/razorpay";
import { createTestDb } from "../helpers/d1";
import { fakeQuotation } from "../helpers/quotation";

const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} };

type Sent = { url: string; body: any; headers: Record<string, string> };
let sent: Sent[];
let orderSeq: number;

function stubFetch(razorpayOk = true) {
  sent = [];
  orderSeq = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      sent.push({ url: String(url), body, headers: (init?.headers ?? {}) as Record<string, string> });
      if (String(url).includes("api.razorpay.com/v1/orders")) {
        if (!razorpayOk) return new Response("boom", { status: 500 });
        return new Response(JSON.stringify({ id: `order_${++orderSeq}`, amount: body.amount, currency: "INR", status: "created" }), { status: 200 });
      }
      return new Response(null, { status: 202 }); // mail
    }),
  );
}

const mails = () => sent.filter((s) => s.url.includes("mailchannels"));
const mailTo = (to: string) => mails().filter((m) => m.body.personalizations[0].to[0].email === to);

const RZP = { RAZORPAY_KEY_ID: "rzp_test_key", RAZORPAY_KEY_SECRET: "secret123", RAZORPAY_WEBHOOK_SECRET: "whsec" };

function setup(env: Partial<Env> = {}) {
  const { db, database } = createTestDb();
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 86400_000).toISOString();
  db.prepare(`INSERT INTO user (id, created_at, name, email) VALUES ('u1', ?, 'Asha Rao', 'asha@example.com')`).run(now);
  db.prepare(`INSERT INTO user (id, created_at, name, email) VALUES ('u2', ?, 'Other Person', 'other@example.com')`).run(now);
  db.prepare(`INSERT INTO user (id, created_at, name, email, auth_provider, provider_id) VALUES ('a1', ?, 'Admin', 'info@retroholidays.in', 'google', 'g-1')`).run(now);
  for (const [tok, uid] of [["asha", "u1"], ["other", "u2"], ["admin", "a1"]]) {
    db.prepare(`INSERT INTO session (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(tok, uid, now, later);
  }
  const fullEnv: Env = { DB: database, ENVIRONMENT: "test", PUBLIC_SITE_URL: "https://retroholidays.in", ...env };

  async function call(as: "asha" | "other" | "admin" | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await worker.fetch(
      new Request(`https://example.com/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(as ? { Cookie: `atlas_session=${as}` } : {}), ...headers },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      }),
      fullEnv,
      ctx,
    );
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }
  return { db, call, env: fullEnv };
}

const planRequest = { placeIds: ["paris", "rome"], nights: 5, startDate: "2030-01-10", adults: 2 };
const submitBody = (extra: Record<string, unknown> = {}) => ({
  request: planRequest,
  quotation: fakeQuotation(),
  destinationSummary: "Paris, Rome",
  totals: { total: 100_000, perPerson: 50_000 },
  contact: { email: "asha.work@example.com", phone: "+91 98765 43210" },
  note: "Anniversary trip",
  ...extra,
});

const sendBody = (over: Record<string, unknown> = {}) => ({
  request: planRequest,
  quotation: fakeQuotation(),
  adjustments: {
    fixedPackageInr: null,
    lines: [
      { id: "disc", label: "Early-bird discount", amountInr: -5000, optional: false },
      { id: "spa", label: "Spa day", amountInr: 4000, optional: true },
    ],
    depositInr: null,
  },
  validUntil: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10),
  note: "Thanks for your patience.",
  ...over,
});

async function toQuoted(s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) {
  const created = await s.call("asha", "POST", "/requests", submitBody());
  const id = created.json.id as string;
  const sentRes = await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody(over));
  expect(sentRes.status).toBe(200);
  const detail = await s.call("asha", "GET", `/requests/${id}`);
  return { id, revisionId: detail.json.quote.revisionId as string, detail: detail.json };
}

beforeEach(() => stubFetch());

describe("submitting a request", () => {
  it("records contact details, a timeline entry and emails both sides", async () => {
    const s = setup();
    const res = await s.call("asha", "POST", "/requests", submitBody());
    expect(res.status).toBe(201);

    const row = s.db.prepare(`SELECT status, contact_email, contact_phone, traveller_note FROM quotation_request WHERE id = ?`).get(res.json.id) as any;
    expect(row).toEqual({ status: "pending", contact_email: "asha.work@example.com", contact_phone: "+91 98765 43210", traveller_note: "Anniversary trip" });

    const admin = mailTo("info@retroholidays.in");
    expect(admin).toHaveLength(1);
    expect(admin[0].body.content[0].value).toContain("+91 98765 43210");
    expect(admin[0].body.content[0].value).toContain("asha.work@example.com");
    expect(admin[0].body.content[0].value).toContain(`/admin/request?id=${res.json.id}`);
    expect(mailTo("asha.work@example.com")).toHaveLength(1);

    const detail = await s.call("asha", "GET", `/requests/${res.json.id}`);
    expect(detail.json.events.map((e: any) => e.type)).toEqual(["submitted"]);
  });

  it("treats the phone number as optional but rejects nonsense", async () => {
    const s = setup();
    const none = await s.call("asha", "POST", "/requests", submitBody({ contact: { email: "asha@example.com" } }));
    expect(none.status).toBe(201);
    const bad = await s.call("asha", "POST", "/requests", submitBody({ contact: { email: "asha@example.com", phone: "call me" } }));
    expect(bad.status).toBe(400);
    const badMail = await s.call("asha", "POST", "/requests", submitBody({ contact: { email: "nope" } }));
    expect(badMail.status).toBe(400);
  });

  it("requires sign-in", async () => {
    const s = setup();
    expect((await s.call(null, "POST", "/requests", submitBody())).status).toBe(401);
  });
});

describe("agency side", () => {
  it("is invisible to non-admins", async () => {
    const s = setup();
    const { id } = await toQuoted(s);
    for (const as of ["asha", "other", null] as const) {
      expect((await s.call(as, "GET", "/admin/requests")).status).toBe(404);
      expect((await s.call(as, "GET", `/admin/requests/${id}`)).status).toBe(404);
      expect((await s.call(as, "POST", `/admin/requests/${id}/send`, sendBody())).status).toBe(404);
    }
  });

  it("lists requests, moves to review once, and keeps internal notes private", async () => {
    const s = setup();
    const created = await s.call("asha", "POST", "/requests", submitBody());
    const id = created.json.id;

    const list = await s.call("admin", "GET", "/admin/requests");
    expect(list.json.requests[0]).toMatchObject({ id, status: "pending", contactPhone: "+91 98765 43210", contactEmail: "asha.work@example.com" });

    expect((await s.call("admin", "POST", `/admin/requests/${id}/review`)).json.status).toBe("in_review");
    expect((await s.call("admin", "POST", `/admin/requests/${id}/review`)).json.status).toBe("in_review");
    await s.call("admin", "POST", `/admin/requests/${id}/note`, { text: "Called, wants a river cruise" });

    const adminView = await s.call("admin", "GET", `/admin/requests/${id}`);
    expect(adminView.json.events.map((e: any) => e.type)).toEqual(["submitted", "review_started", "note"]);
    const travellerView = await s.call("asha", "GET", `/requests/${id}`);
    expect(travellerView.json.events.map((e: any) => e.type)).toEqual(["submitted", "review_started"]);
    expect(JSON.stringify(travellerView.json)).not.toContain("river cruise");
  });

  it("saves a draft and reopens it as the working copy", async () => {
    const s = setup();
    const id = (await s.call("asha", "POST", "/requests", submitBody())).json.id;
    expect((await s.call("admin", "POST", `/admin/requests/${id}/draft`, sendBody())).status).toBe(200);
    expect((await s.call("admin", "POST", `/admin/requests/${id}/draft`, sendBody({ note: "v2 wording" }))).status).toBe(200);

    const detail = await s.call("admin", "GET", `/admin/requests/${id}`);
    expect(detail.json.status).toBe("in_review");
    expect(detail.json.workingCopy).toMatchObject({ kind: "draft", note: "v2 wording" });
    expect(detail.json.workingCopy.adjustments.lines).toHaveLength(2);
    expect(s.db.prepare(`SELECT COUNT(*) AS n FROM quote_revision WHERE request_id = ?`).get(id)).toEqual({ n: 1 });
    // A draft is invisible to the traveller.
    expect((await s.call("asha", "GET", `/requests/${id}`)).json.quote).toBeNull();
  });

  it("rejects a send with a past validity date, a zero total, or a deposit above the total", async () => {
    const s = setup();
    const id = (await s.call("asha", "POST", "/requests", submitBody())).json.id;
    const past = await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody({ validUntil: "2020-01-01" }));
    expect(past.status).toBe(400);
    const zero = await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody({ adjustments: { lines: [], depositInr: null, fixedPackageInr: null }, quotation: fakeQuotation(0) }));
    expect(zero.status).toBe(400);
    const deposit = await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody({ adjustments: { lines: [], fixedPackageInr: null, depositInr: 100_000 } }));
    expect(deposit.status).toBe(400);
    expect(s.db.prepare(`SELECT status FROM quotation_request WHERE id = ?`).get(id)).toEqual({ status: "pending" });
  });

  it("sends the quote: status, revision, public view only, email to the traveller", async () => {
    const s = setup();
    const { id, detail } = await toQuoted(s);

    expect(detail.status).toBe("quoted");
    expect(detail.quote.version).toBe(1);
    expect(detail.quote.baseTotalInr).toBe(95_000);
    expect(detail.quote.view.lines.map((l: any) => l.id)).toEqual(["disc", "spa"]);
    // No engine internals reach the traveller in the quote.
    const quoteJson = JSON.stringify(detail.quote);
    expect(quoteJson).not.toContain("internal margin note");
    expect(quoteJson).not.toContain("agentMarkup");

    const mail = mailTo("asha.work@example.com").at(-1)!;
    expect(mail.body.subject).toContain("final quote is ready");
    expect(mail.body.content[0].value).toContain(`/my-requests/view?id=${id}`);

    const row = s.db.prepare(`SELECT quoted_total_inr FROM quotation_request WHERE id = ?`).get(id) as any;
    expect(row.quoted_total_inr).toBe(95_000);
  });
});

describe("accepting a quote", () => {
  it("prices the chosen extras on the server and moves to accepted", async () => {
    const s = setup();
    const { id, revisionId } = await toQuoted(s);

    const res = await s.call("asha", "POST", `/requests/${id}/accept`, { revisionId, optionIds: ["spa"], agreed: true });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "accepted", totalInr: 99_000, dueNowInr: 99_000 });
    expect(mailTo("info@retroholidays.in").at(-1)!.body.subject).toContain("Quote accepted");

    // A second accept loses the race.
    expect((await s.call("asha", "POST", `/requests/${id}/accept`, { revisionId, optionIds: [], agreed: true })).status).toBe(409);
  });

  it("requires explicit agreement and rejects extras that are not on the quote", async () => {
    const s = setup();
    const { id, revisionId } = await toQuoted(s);
    expect((await s.call("asha", "POST", `/requests/${id}/accept`, { revisionId, optionIds: [], agreed: false })).status).toBe(400);
    expect((await s.call("asha", "POST", `/requests/${id}/accept`, { revisionId, optionIds: ["free-flight"], agreed: true })).status).toBe(400);
    // `disc` exists but is not optional, so it cannot be "selected" either.
    expect((await s.call("asha", "POST", `/requests/${id}/accept`, { revisionId, optionIds: ["disc"], agreed: true })).status).toBe(400);
  });

  it("refuses to accept a superseded revision after the agency re-sends", async () => {
    const s = setup();
    const { id, revisionId } = await toQuoted(s);
    expect((await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody({ note: "Revised" }))).json.version).toBe(2);
    const stale = await s.call("asha", "POST", `/requests/${id}/accept`, { revisionId, optionIds: [], agreed: true });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toContain("newer version");
  });

  it("does not let another traveller act on or read the request", async () => {
    const s = setup();
    const { id, revisionId } = await toQuoted(s);
    expect((await s.call("other", "GET", `/requests/${id}`)).status).toBe(404);
    expect((await s.call("other", "POST", `/requests/${id}/accept`, { revisionId, optionIds: [], agreed: true })).status).toBe(404);
    expect((await s.call("other", "POST", `/requests/${id}/pay`)).status).toBe(404);
  });

  it("expires a quote past its validity date", async () => {
    const s = setup();
    const { id, revisionId } = await toQuoted(s);
    s.db.prepare(`UPDATE quotation_request SET quote_valid_until = ? WHERE id = ?`).run(new Date(Date.now() - 1000).toISOString(), id);

    const detail = await s.call("asha", "GET", `/requests/${id}`);
    expect(detail.json.status).toBe("expired");
    expect(detail.json.events.at(-1).type).toBe("expired");
    expect((await s.call("asha", "POST", `/requests/${id}/accept`, { revisionId, optionIds: [], agreed: true })).status).toBe(409);

    // The agency can bring it back with a fresh quote.
    expect((await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody())).status).toBe(200);
    expect((await s.call("asha", "GET", `/requests/${id}`)).json.status).toBe("quoted");
  });
});

describe("changes, decline and withdraw", () => {
  it("lets the traveller ask for changes, and the agency answer with a revision", async () => {
    const s = setup();
    const { id } = await toQuoted(s);
    expect((await s.call("asha", "POST", `/requests/${id}/changes`, { message: "hi" })).status).toBe(400);
    const res = await s.call("asha", "POST", `/requests/${id}/changes`, { message: "Can we drop the spa and add a day in Rome?" });
    expect(res.json.status).toBe("changes_requested");
    expect(mailTo("info@retroholidays.in").at(-1)!.body.content[0].value).toContain("add a day in Rome");

    expect((await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody())).json.version).toBe(2);
    const detail = await s.call("asha", "GET", `/requests/${id}`);
    expect(detail.json.status).toBe("quoted");
    expect(detail.json.quote.version).toBe(2);
  });

  it("declines and withdraws, and neither can be undone by the traveller", async () => {
    const s = setup();
    const a = await toQuoted(s);
    expect((await s.call("asha", "POST", `/requests/${a.id}/decline`, { reason: "Too expensive" })).json.status).toBe("declined");
    expect((await s.call("asha", "POST", `/requests/${a.id}/accept`, { revisionId: a.revisionId, optionIds: [], agreed: true })).status).toBe(409);

    const b = (await s.call("asha", "POST", "/requests", submitBody())).json.id;
    expect((await s.call("asha", "POST", `/requests/${b}/cancel`)).json.status).toBe("cancelled");
    expect((await s.call("asha", "POST", `/requests/${b}/cancel`)).status).toBe(409);
  });
});

describe("payment", () => {
  async function toAccepted(s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) {
    const q = await toQuoted(s, over);
    const acc = await s.call("asha", "POST", `/requests/${q.id}/accept`, { revisionId: q.revisionId, optionIds: [], agreed: true });
    expect(acc.status).toBe(200);
    return q;
  }
  const sign = (orderId: string, paymentId: string) => hmacSha256Hex(RZP.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);

  it("is unavailable until Razorpay keys are configured", async () => {
    const s = setup();
    const { id } = await toAccepted(s);
    const res = await s.call("asha", "POST", `/requests/${id}/pay`);
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("payments_unavailable");
    expect((await s.call("asha", "GET", `/requests/${id}`)).json.payment.configured).toBe(false);
  });

  it("refuses payment before the quote is accepted", async () => {
    const s = setup(RZP);
    const { id } = await toQuoted(s);
    expect((await s.call("asha", "POST", `/requests/${id}/pay`)).status).toBe(409);
  });

  it("creates an order for the server-computed amount and reuses it on retry", async () => {
    const s = setup(RZP);
    const { id } = await toAccepted(s);

    const res = await s.call("asha", "POST", `/requests/${id}/pay`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ keyId: "rzp_test_key", orderId: "order_1", amountPaise: 9_500_000, currency: "INR" });
    expect(res.json.prefill).toMatchObject({ email: "asha.work@example.com", contact: "+91 98765 43210" });

    const order = sent.find((x) => x.url.includes("/orders"))!;
    expect(order.body.amount).toBe(9_500_000);
    expect(order.headers.Authorization).toBe(`Basic ${btoa("rzp_test_key:secret123")}`);

    const again = await s.call("asha", "POST", `/requests/${id}/pay`);
    expect(again.json.orderId).toBe("order_1");
    expect(sent.filter((x) => x.url.includes("/orders"))).toHaveLength(1);
  });

  it("reports a gateway failure without creating a payment", async () => {
    stubFetch(false);
    const s = setup(RZP);
    const { id } = await toAccepted(s);
    expect((await s.call("asha", "POST", `/requests/${id}/pay`)).status).toBe(502);
    expect(s.db.prepare(`SELECT COUNT(*) AS n FROM payment`).get()).toEqual({ n: 0 });
  });

  it("settles on a valid signature exactly once and confirms the booking", async () => {
    const s = setup(RZP);
    const { id } = await toAccepted(s);
    const order = (await s.call("asha", "POST", `/requests/${id}/pay`)).json.orderId;

    const bad = await s.call("asha", "POST", `/requests/${id}/pay/verify`, { razorpay_order_id: order, razorpay_payment_id: "pay_1", razorpay_signature: "deadbeef" });
    expect(bad.status).toBe(400);
    expect(s.db.prepare(`SELECT status FROM quotation_request WHERE id = ?`).get(id)).toEqual({ status: "accepted" });

    const body = { razorpay_order_id: order, razorpay_payment_id: "pay_1", razorpay_signature: await sign(order, "pay_1") };
    const ok = await s.call("asha", "POST", `/requests/${id}/pay/verify`, body);
    expect(ok.json).toMatchObject({ ok: true, status: "paid", paidInr: 95_000 });
    const mailsAfterFirst = mails().length;

    // Replaying the same callback (double click, retry) changes nothing and sends nothing.
    const replay = await s.call("asha", "POST", `/requests/${id}/pay/verify`, body);
    expect(replay.json).toMatchObject({ status: "paid", paidInr: 95_000 });
    expect(mails()).toHaveLength(mailsAfterFirst);
    expect(s.db.prepare(`SELECT COUNT(*) AS n FROM request_event WHERE type = 'payment_received'`).get()).toEqual({ n: 1 });

    expect(mailTo("asha.work@example.com").at(-1)!.body.subject).toContain("Booking confirmed");
    expect((await s.call("asha", "POST", `/requests/${id}/pay`)).status).toBe(409);
  });

  it("will not verify a signature made for a different order", async () => {
    const s = setup(RZP);
    const { id } = await toAccepted(s);
    const order = (await s.call("asha", "POST", `/requests/${id}/pay`)).json.orderId;
    const res = await s.call("asha", "POST", `/requests/${id}/pay/verify`, { razorpay_order_id: order, razorpay_payment_id: "pay_9", razorpay_signature: await sign("order_other", "pay_9") });
    expect(res.status).toBe(400);
  });

  it("takes a deposit first and the balance second", async () => {
    const s = setup(RZP);
    const { id } = await toAccepted(s, { adjustments: { fixedPackageInr: null, lines: [], depositInr: 25_000 } });

    const first = (await s.call("asha", "POST", `/requests/${id}/pay`)).json;
    expect(first.amountPaise).toBe(2_500_000);
    await s.call("asha", "POST", `/requests/${id}/pay/verify`, { razorpay_order_id: first.orderId, razorpay_payment_id: "pay_a", razorpay_signature: await sign(first.orderId, "pay_a") });

    let detail = (await s.call("asha", "GET", `/requests/${id}`)).json;
    expect(detail.status).toBe("part_paid");
    expect(detail.payment).toMatchObject({ paidInr: 25_000, balanceInr: 75_000, nextInr: 75_000 });

    const second = (await s.call("asha", "POST", `/requests/${id}/pay`)).json;
    expect(second.amountPaise).toBe(7_500_000);
    expect(second.orderId).not.toBe(first.orderId);
    await s.call("asha", "POST", `/requests/${id}/pay/verify`, { razorpay_order_id: second.orderId, razorpay_payment_id: "pay_b", razorpay_signature: await sign(second.orderId, "pay_b") });

    detail = (await s.call("asha", "GET", `/requests/${id}`)).json;
    expect(detail.status).toBe("paid");
    expect(detail.payment.payments.map((p: any) => p.kind)).toEqual(["deposit", "balance"]);
  });

  describe("webhook", () => {
    const hook = async (s: ReturnType<typeof setup>, payload: unknown, signature?: string) => {
      const raw = JSON.stringify(payload);
      return s.call(null, "POST", "/webhooks/razorpay", raw, { "X-Razorpay-Signature": signature ?? (await hmacSha256Hex(RZP.RAZORPAY_WEBHOOK_SECRET, raw)) });
    };
    const captured = (orderId: string, amount: number, id = "pay_w") => ({
      event: "payment.captured",
      payload: { payment: { entity: { id, order_id: orderId, amount, method: "upi" } } },
    });

    it("rejects a bad signature", async () => {
      const s = setup(RZP);
      expect((await hook(s, captured("order_1", 1), "00")).status).toBe(400);
    });

    it("settles a payment even when the browser never called back", async () => {
      const s = setup(RZP);
      const { id } = await toAccepted(s);
      const order = (await s.call("asha", "POST", `/requests/${id}/pay`)).json.orderId;

      expect((await hook(s, captured(order, 9_500_000))).status).toBe(200);
      expect(s.db.prepare(`SELECT status, paid_inr FROM quotation_request WHERE id = ?`).get(id)).toEqual({ status: "paid", paid_inr: 95_000 });
      expect(s.db.prepare(`SELECT method FROM payment WHERE razorpay_order_id = ?`).get(order)).toEqual({ method: "upi" });

      // Redelivery, and then the browser callback arriving late: still one payment event.
      await hook(s, captured(order, 9_500_000));
      await s.call("asha", "POST", `/requests/${id}/pay/verify`, { razorpay_order_id: order, razorpay_payment_id: "pay_w", razorpay_signature: await sign(order, "pay_w") });
      expect(s.db.prepare(`SELECT COUNT(*) AS n FROM request_event WHERE type = 'payment_received'`).get()).toEqual({ n: 1 });
    });

    it("does not credit a payment whose amount differs from the order", async () => {
      const s = setup(RZP);
      const { id } = await toAccepted(s);
      const order = (await s.call("asha", "POST", `/requests/${id}/pay`)).json.orderId;
      await hook(s, captured(order, 100));
      expect(s.db.prepare(`SELECT status FROM quotation_request WHERE id = ?`).get(id)).toEqual({ status: "accepted" });
    });

    it("records a failed attempt on the timeline", async () => {
      const s = setup(RZP);
      const { id } = await toAccepted(s);
      const order = (await s.call("asha", "POST", `/requests/${id}/pay`)).json.orderId;
      await hook(s, { event: "payment.failed", payload: { payment: { entity: { id: "pay_f", order_id: order, error_description: "Card declined" } } } });
      const events = (await s.call("asha", "GET", `/requests/${id}`)).json.events;
      expect(events.at(-1).type).toBe("payment_failed");
      expect(s.db.prepare(`SELECT status FROM quotation_request WHERE id = ?`).get(id)).toEqual({ status: "accepted" });
    });
  });

  it("clears an acceptance when the agency re-opens the quote before any payment", async () => {
    const s = setup(RZP);
    const { id } = await toAccepted(s);
    const res = await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody({ note: "Price corrected" }));
    expect(res.status).toBe(200);
    const detail = (await s.call("asha", "GET", `/requests/${id}`)).json;
    expect(detail.status).toBe("quoted");
    expect(detail.acceptance).toBeNull();
    expect(detail.quote.version).toBe(2);
  });

  it("will not reopen a request once money has been received", async () => {
    const s = setup(RZP);
    const { id } = await toAccepted(s, { adjustments: { fixedPackageInr: null, lines: [], depositInr: 25_000 } });
    const order = (await s.call("asha", "POST", `/requests/${id}/pay`)).json;
    await s.call("asha", "POST", `/requests/${id}/pay/verify`, { razorpay_order_id: order.orderId, razorpay_payment_id: "pay_x", razorpay_signature: await sign(order.orderId, "pay_x") });
    expect((await s.call("admin", "POST", `/admin/requests/${id}/send`, sendBody())).status).toBe(409);
    expect((await s.call("asha", "POST", `/requests/${id}/cancel`)).status).toBe(409);
  });
});
