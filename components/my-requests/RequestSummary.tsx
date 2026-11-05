"use client";

/**
 * One trip request, end to end, from the traveller's side.
 *
 * The page answers three questions at a glance — where is this, what happens
 * next, and what do I need to do — and then lets them act: review the agency's
 * final quote, tick optional extras, accept (and pay), ask for changes, or
 * decline. Everything below the action area is the record: the quote itself,
 * the payments, the timeline, and what they originally sent.
 *
 * The original request is shown from its stored snapshot, never replayed
 * through the live engine, so it always reflects exactly what was sent.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  acceptQuote,
  declineQuote,
  getFinalRequest,
  requestQuoteChanges,
  withdrawRequest,
  type RequestDetail,
} from "@/lib/auth-client";
import { payForRequest } from "@/lib/razorpay-checkout";
import { formatInr } from "@retro/core/atlas/engine/text";
import type { Quotation } from "@retro/core/atlas/engine/types";
import { priceQuote } from "@retro/core/quote-pricing";
import { STATUS_COPY } from "@retro/core/quote-workflow";
import { btnGhost, btnPrimary, cardClass, fieldClass, toneStyle } from "@/components/plan/theme";
import { QuoteOffer } from "./QuoteOffer";
import { daysLeft, daysLeftLabel, formatDate, ProgressTracker, StatusBadge, Timeline } from "./status";

const AGENCY_EMAIL = "info@retroholidays.in";

type Banner = { tone: "success" | "info" | "error"; text: string } | null;

const primaryBtn = btnPrimary;
const ghostBtn = btnGhost;
/** Quiet text action (Decline, Back, Keep it): underlined, 44px tall target. */
const textBtn = "inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2 hover:text-[var(--ink)]";

export function RequestSummary() {
  const params = useSearchParams();
  const id = params.get("id");
  const { user, loading: authLoading } = useAuth();
  // Keyed by the id it was fetched for, so "loading" is derived from the id
  // not yet matching rather than set synchronously at the top of the effect.
  const [result, setResult] = useState<{ id: string; detail: RequestDetail | null } | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [paying, setPaying] = useState(false);

  const reload = useCallback(async (): Promise<RequestDetail | null> => {
    if (!id) return null;
    const d = await getFinalRequest(id);
    setResult({ id, detail: d });
    return d;
  }, [id]);

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;
    getFinalRequest(id).then((d) => {
      if (!cancelled) setResult({ id, detail: d });
    });
    return () => {
      cancelled = true;
    };
  }, [user, id]);

  const pay = useCallback(async () => {
    if (!id) return;
    setPaying(true);
    setBanner(null);
    const outcome = await payForRequest(id);
    setPaying(false);
    if (outcome.kind === "paid") {
      setBanner({ tone: "success", text: "Payment received — thank you! We have emailed you a receipt." });
    } else if (outcome.kind === "failed") {
      setBanner({ tone: "error", text: outcome.message });
    } else {
      setBanner({ tone: "info", text: "Payment window closed — nothing was charged. You can pay whenever you are ready." });
    }
    await reload();
  }, [id, reload]);

  const handleAccepted = useCallback(async () => {
    const fresh = await reload();
    if (fresh?.payment.configured) await pay();
  }, [reload, pay]);

  const detail: RequestDetail | null | "loading" = id && result?.id === id ? result.detail : "loading";

  if (authLoading) return <p role="status" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!user) return <p role="status" style={{ color: "var(--muted)" }}>Sign in to view this request.</p>;
  if (!id) return <p role="status" style={{ color: "var(--muted)" }}>No request specified.</p>;
  if (detail === "loading") return <p role="status" style={{ color: "var(--muted)" }}>Loading your request…</p>;
  if (!detail) {
    return (
      <div className={`${cardClass} px-6 py-12 text-center`} style={{ background: "var(--surface)" }}>
        <p style={{ color: "var(--muted)" }}>We couldn&apos;t find that request.</p>
        <Link href="/my-requests" className={`${ghostBtn} mt-5`}>
          Back to my requests
        </Link>
      </div>
    );
  }

  const { status, quote, payment } = detail;
  const copy = STATUS_COPY[status];
  const snapshot = isSnapshot(detail.snapshot) ? detail.snapshot : null;
  const acceptedOptions = detail.acceptance?.optionIds ?? [];
  const showQuote = quote && !["pending", "in_review"].includes(status);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/my-requests"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold hover:text-[var(--accent)]"
          style={{ color: "var(--ink-2)" }}
        >
          <span aria-hidden="true">←</span> My requests
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Trip request</p>
            <h1 className="mt-3 font-display text-3xl md:text-4xl">{detail.destinationSummary}</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {detail.nights} nights from {formatDate(detail.startDate)} · sent {formatDate(detail.createdAt)} · ID {detail.id.slice(0, 8)}
            </p>
          </div>
          <StatusBadge status={status} />
        </div>
      </div>

      <ProgressTracker status={status} />

      {banner && (
        <p
          role={banner.tone === "error" ? "alert" : "status"}
          className="rounded-xl border px-4 py-3 text-sm font-medium"
          style={banner.tone === "success" ? toneStyle.success : banner.tone === "error" ? toneStyle.danger : toneStyle.info}
        >
          {banner.text}
        </p>
      )}

      <section
        className={`${cardClass} p-5 sm:p-6`}
        style={
          STATUS_COPY[status].tone === "action"
            ? { borderColor: "var(--sun-deep)", boxShadow: "inset 4px 0 0 var(--sun), var(--shadow-sm)" }
            : undefined
        }
      >
        <h2 className="font-display text-2xl">{copy.label}</h2>
        <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          {copy.traveller}
        </p>
        <ActionArea detail={detail} onChanged={reload} onAccepted={handleAccepted} onPay={pay} paying={paying} setBanner={setBanner} />
      </section>

      {showQuote && (
        <section className="flex flex-col gap-4">
          {status === "quoted" ? (
            <QuoteDecision detail={detail} onChanged={reload} onAccepted={handleAccepted} setBanner={setBanner} />
          ) : (
            <QuoteOffer quote={quote.view} version={quote.version} selected={acceptedOptions} />
          )}
        </section>
      )}

      {payment.payments.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-2xl">Payments</h2>
          <div className={`${cardClass} overflow-hidden`}>
            {payment.payments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-sm last:border-b-0" style={{ borderColor: "var(--line)" }}>
                <span className="capitalize">
                  {p.kind === "full" ? "Full payment" : p.kind} · {formatDate(p.paidAt)}
                  {p.method ? ` · ${p.method.toUpperCase()}` : ""}
                </span>
                <span className="tabular-nums">{formatInr(p.amountInr)}</span>
              </div>
            ))}
            <div className="flex justify-between px-4 py-3 text-sm" style={{ background: "var(--surface)" }}>
              <span className="font-semibold">Paid of {formatInr(payment.totalInr ?? payment.paidInr)}</span>
              <span className="font-bold tabular-nums" style={{ color: "var(--success)" }}>
                {formatInr(payment.paidInr)}
              </span>
            </div>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl">Activity</h2>
        <div className={`${cardClass} p-5 sm:p-6`}>
          <Timeline events={detail.events} />
        </div>
      </section>

      <details className={`${cardClass} group p-5 sm:p-6`}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-display text-xl [&::-webkit-details-marker]:hidden">
          What you originally sent
          <svg className="shrink-0 transition-transform group-open:rotate-180" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ color: "var(--ink-2)" }}>
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt style={{ color: "var(--muted)" }}>Nights</dt>
              <dd className="mt-1 text-lg font-semibold">{detail.nights}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted)" }}>Starts</dt>
              <dd className="mt-1 text-lg font-semibold">{formatDate(detail.startDate)}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted)" }}>Estimate</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{formatInr(detail.totalInr)}</dd>
            </div>
            <div>
              <dt style={{ color: "var(--muted)" }}>Per person</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{formatInr(detail.perPersonInr)}</dd>
            </div>
          </dl>
          {snapshot && (
            <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--line)" }}>
              {Object.entries(groupByComponent(snapshot.quotation)).map(([component, total]) => (
                <div key={component} className="flex items-center justify-between gap-3 border-b px-4 py-3 text-sm last:border-b-0" style={{ borderColor: "var(--line)" }}>
                  <span className="capitalize">{component.replace(/-/g, " ")}</span>
                  <span className="tabular-nums">{formatInr(total)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            This is the estimate you saw when you sent the request. The final quote above is what counts.
          </p>
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            <p className="text-xs font-bold uppercase tracking-[0.12em]">We&apos;ll reach you at</p>
            <p className="mt-1" style={{ color: "var(--ink)" }}>
              {detail.contact.email}
              {detail.contact.phone ? ` · ${detail.contact.phone}` : ""}
            </p>
            {detail.contact.note && <p className="mt-2">Your note: “{detail.contact.note}”</p>}
          </div>
        </div>
      </details>

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Questions? Write to{" "}
        <a className="font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }} href={`mailto:${AGENCY_EMAIL}?subject=${encodeURIComponent(`Trip request ${detail.id}`)}`}>
          {AGENCY_EMAIL}
        </a>{" "}
        and quote the ID {detail.id}.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The "what do I do now" area, per status
// ---------------------------------------------------------------------------

type ActionProps = {
  detail: RequestDetail;
  onChanged: () => Promise<RequestDetail | null>;
  onAccepted: () => Promise<void>;
  onPay: () => Promise<void>;
  paying: boolean;
  setBanner: (b: Banner) => void;
};

function ActionArea({ detail, onChanged, onPay, paying, setBanner }: ActionProps) {
  const { status, payment } = detail;
  const [busy, setBusy] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  async function withdraw() {
    setBusy(true);
    const res = await withdrawRequest(detail.id);
    setBusy(false);
    if (!res.ok) setBanner({ tone: "error", text: res.error });
    await onChanged();
  }

  if (status === "accepted" || status === "part_paid") {
    const label = status === "part_paid" ? "Pay the balance" : payment.nextInr < (payment.totalInr ?? 0) ? "Pay the booking deposit" : "Pay now";
    return (
      <div className="mt-4 flex flex-col gap-3">
        <dl className="grid grid-cols-3 gap-3 rounded-xl p-4 text-sm" style={{ background: "var(--surface)" }}>
          <div>
            <dt style={{ color: "var(--muted)" }}>Agreed total</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{formatInr(payment.totalInr ?? 0)}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Paid so far</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{formatInr(payment.paidInr)}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Due now</dt>
            <dd className="mt-0.5 font-bold tabular-nums" style={{ color: "var(--ink)" }}>
              {formatInr(payment.nextInr)}
            </dd>
          </div>
        </dl>
        {payment.configured ? (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onPay} disabled={paying} className={primaryBtn}>
              {paying ? "Opening payment…" : `${label} · ${formatInr(payment.nextInr)}`}
            </button>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              Secure payment by Razorpay — UPI, cards, net banking and wallets. We never see your card details.
            </span>
          </div>
        ) : (
          <p className="rounded-xl border px-4 py-3 text-sm" style={toneStyle.info}>
            Online payment isn&apos;t switched on yet. We have been told you accepted — our team will email you payment details shortly.
          </p>
        )}
        {status === "accepted" && <WithdrawLink confirm={confirmWithdraw} setConfirm={setConfirmWithdraw} busy={busy} onWithdraw={withdraw} />}
      </div>
    );
  }

  if (status === "pending" || status === "in_review" || status === "changes_requested") {
    return (
      <div className="mt-3">
        <WithdrawLink confirm={confirmWithdraw} setConfirm={setConfirmWithdraw} busy={busy} onWithdraw={withdraw} />
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className="mt-4 flex flex-wrap gap-3">
        <a
          className={primaryBtn}
          href={`mailto:${AGENCY_EMAIL}?subject=${encodeURIComponent(`Please refresh my quote — ${detail.id}`)}`}
        >
          Ask us to refresh it
        </a>
      </div>
    );
  }

  if (status === "declined" || status === "cancelled" || status === "closed") {
    return (
      <div className="mt-4">
        <Link href="/plan" className={primaryBtn}>
          Plan another trip
        </Link>
      </div>
    );
  }

  return null;
}

function WithdrawLink({ confirm, setConfirm, busy, onWithdraw }: { confirm: boolean; setConfirm: (v: boolean) => void; busy: boolean; onWithdraw: () => void }) {
  if (!confirm) {
    return (
      <button type="button" onClick={() => setConfirm(true)} className={`${textBtn} self-start`} style={{ color: "var(--ink-2)" }}>
        Withdraw this request
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span style={{ color: "var(--muted)" }}>Withdraw this request?</span>
      <button type="button" onClick={onWithdraw} disabled={busy} className={ghostBtn}>
        {busy ? "Withdrawing…" : "Yes, withdraw"}
      </button>
      <button type="button" onClick={() => setConfirm(false)} className={textBtn} style={{ color: "var(--ink-2)" }}>
        Keep it
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviewing a quote: tick extras, then accept / ask for changes / decline
// ---------------------------------------------------------------------------

function QuoteDecision({
  detail,
  onChanged,
  onAccepted,
  setBanner,
}: {
  detail: RequestDetail;
  onChanged: () => Promise<RequestDetail | null>;
  onAccepted: () => Promise<void>;
  setBanner: (b: Banner) => void;
}) {
  const quote = detail.quote!;
  const [selected, setSelected] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [mode, setMode] = useState<"idle" | "changes" | "decline">("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priced = priceQuote(quote.view.packageInr, { fixedPackageInr: null, lines: quote.view.lines, depositInr: quote.view.depositInr }, selected);
  const left = daysLeft(quote.view.validUntil);

  async function accept() {
    setBusy(true);
    setError(null);
    const res = await acceptQuote(detail.id, { revisionId: quote.revisionId, optionIds: selected });
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      await onChanged();
      return;
    }
    await onAccepted();
    setBusy(false);
  }

  async function submitChanges() {
    setBusy(true);
    setError(null);
    const res = mode === "changes" ? await requestQuoteChanges(detail.id, text) : await declineQuote(detail.id, text);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBanner({
      tone: "info",
      text: mode === "changes" ? "Thanks — we have your message and will send a revised quote." : "We have recorded your decision. Thank you for considering us.",
    });
    await onChanged();
  }

  return (
    <>
      <QuoteOffer quote={quote.view} version={quote.version} selected={selected} onSelectedChange={setSelected} />

      <div
        className="flex flex-col gap-4 rounded-2xl border p-5 sm:p-6"
        style={{ borderColor: "var(--sun-deep)", background: "color-mix(in srgb, var(--sun) 10%, var(--card))", boxShadow: "var(--shadow-sm)" }}
      >
        {mode === "idle" ? (
          <>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" />
              <span>
                I have reviewed the itinerary, inclusions and price, and I accept this quote for{" "}
                <strong className="tabular-nums">{formatInr(priced.totalInr)}</strong>
                {left != null && <span style={{ color: "var(--muted)" }}> ({daysLeftLabel(left)} to accept)</span>}. I agree to the{" "}
                <Link href="/terms" target="_blank" className="underline">Terms &amp; Conditions</Link>,{" "}
                <Link href="/payment-policy" target="_blank" className="underline">Payment</Link>,{" "}
                <Link href="/cancellation-policy" target="_blank" className="underline">Cancellation</Link> and{" "}
                <Link href="/refund-policy" target="_blank" className="underline">Refund</Link> policies.
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={accept} disabled={!agreed || busy} className={primaryBtn}>
                {busy ? "Working…" : `Accept & continue to payment`}
              </button>
              <button type="button" onClick={() => setMode("changes")} disabled={busy} className={ghostBtn}>
                Request changes
              </button>
              <button type="button" onClick={() => setMode("decline")} disabled={busy} className={textBtn} style={{ color: "var(--ink-2)" }}>
                Decline
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {priced.dueNowInr < priced.totalInr
                ? `You'll pay ${formatInr(priced.dueNowInr)} now to confirm, and the balance later.`
                : "You'll be taken to a secure payment window next."}
            </p>
          </>
        ) : (
          <>
            <label className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
              {mode === "changes" ? "What would you like changed?" : "Anything you'd like to tell us? (optional)"}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                maxLength={1000}
                autoFocus
                placeholder={mode === "changes" ? "e.g. Drop the spa day, add one more night in Rome, upgrade to 5-star…" : "e.g. Found a better price, plans changed…"}
                className={`mt-1.5 font-normal ${fieldClass}`}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={submitChanges}
                disabled={busy || (mode === "changes" && text.trim().length < 5)}
                className={primaryBtn}
              >
                {busy ? "Sending…" : mode === "changes" ? "Send to our team" : "Decline this quote"}
              </button>
              <button type="button" onClick={() => { setMode("idle"); setError(null); }} className={textBtn} style={{ color: "var(--ink-2)" }}>
                Back
              </button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="rounded-xl border px-4 py-3 text-sm font-medium" style={toneStyle.danger}>
            {error}
          </p>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

type Snapshot = {
  submittedAt: string;
  user: { id: string; name: string; email: string };
  request: unknown;
  quotation: Quotation;
};

function isSnapshot(v: unknown): v is Snapshot {
  return typeof v === "object" && v !== null && "request" in v && "quotation" in v && "user" in v;
}

function groupByComponent(quotation: Quotation): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const item of quotation.lineItems) {
    totals[item.component] = (totals[item.component] ?? 0) + item.totalInr;
  }
  return totals;
}
