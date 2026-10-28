"use client";

/**
 * "Send for final approval": the last step of the planner.
 *
 * Asks only for what the agency can't know — how to reach the traveller (email
 * is prefilled from the account, phone is optional) and anything they want us to
 * keep in mind — and says plainly what happens next, so sending a request is
 * never a leap into the dark.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Quotation, QuoteRequest } from "@/lib/atlas/engine/types";
import { formatInr } from "@/lib/atlas/engine/text";
import { createFinalRequest, type AuthUser } from "@/lib/auth-client";
import { isValidEmail, normalisePhone } from "@/lib/quote-workflow";
import { onAccent } from "./theme";

const inputClass =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-[rgba(7,26,31,0.72)] px-4 py-2.5 text-sm text-[var(--text)] outline-none transition placeholder:text-[rgba(155,179,180,0.55)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[rgba(253,191,0,0.12)]";

const NEXT_STEPS = [
  "Our travel expert reviews every rate and may call you to confirm details.",
  "We email you a final quote — you can ask for changes, or accept it.",
  "Accept, and pay securely online with UPI, card or net banking.",
];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm" style={{ color: "var(--muted)" }}>
      {label}
      {children}
      {hint && (
        <span className="mt-1 block text-xs" style={{ color: "var(--muted)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

type Props = {
  user: AuthUser;
  request: QuoteRequest;
  quote: Quotation;
  destinationSummary: string;
  onClose: () => void;
  /** Called once the request is saved, with its id. */
  onSent: (id: string) => void;
};

export function SendForApprovalModal({ user, request, quote, destinationSummary, onClose, onSent }: Props) {
  const [sentId, setSentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; phone?: string }>({});
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const phoneRaw = String(data.get("phone") ?? "").trim();
    const note = String(data.get("note") ?? "").trim();

    const errors: typeof fieldErrors = {};
    if (!isValidEmail(email)) errors.email = "Enter a valid email address.";
    if (phoneRaw && !normalisePhone(phoneRaw)) errors.phone = "Enter a valid phone number, or leave this blank.";
    setFieldErrors(errors);
    if (errors.email || errors.phone) return;

    setSubmitting(true);
    const result = await createFinalRequest({
      request,
      quotation: quote,
      destinationSummary,
      totals: { total: quote.totals.total, perPerson: quote.totals.perPerson },
      contact: { email, phone: phoneRaw || undefined },
      note: note || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSentId(result.id);
    onSent(result.id);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Send for final approval" className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 p-6 shadow-2xl md:p-7"
        style={{ background: "linear-gradient(160deg, rgba(14,36,42,0.98), rgba(9,24,28,0.96))" }}
      >
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-5 top-5 text-lg leading-none" style={{ color: "var(--muted)" }}>
          ×
        </button>

        {sentId ? (
          <div className="py-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--accent)" }}>
              Request received
            </p>
            <h2 className="mt-2 font-display text-2xl">We&apos;re on it</h2>
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              We have emailed you a confirmation. You can follow every step — from review to final quote to payment — on your request page.
            </p>
            <ol className="mx-auto mt-5 flex max-w-sm flex-col gap-2 text-left text-sm" style={{ color: "var(--muted)" }}>
              {NEXT_STEPS.map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: "var(--accent)", color: onAccent }}>
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href={`/my-requests/view?id=${encodeURIComponent(sentId)}`} className="rounded-full px-6 py-2.5 text-sm font-semibold" style={{ background: "var(--accent)", color: onAccent }}>
                Track this request
              </Link>
              <button type="button" onClick={onClose} className="rounded-full border px-6 py-2.5 text-sm" style={{ borderColor: "var(--hairline)" }}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--accent)" }}>
                Final approval
              </p>
              <h2 className="mt-2 pr-6 font-display text-2xl">Send this to our team</h2>
            </div>

            <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}>
              <p className="font-medium">{destinationSummary}</p>
              <p className="mt-1" style={{ color: "var(--muted)" }}>
                {request.nights} nights · from {request.startDate} · estimate{" "}
                <span className="tabular-nums" style={{ color: "var(--accent)" }}>
                  {formatInr(quote.totals.total)}
                </span>
              </p>
            </div>

            <div className="grid gap-3">
              <Field label="Your name">
                <input value={user.name} readOnly className={`${inputClass} opacity-70`} aria-readonly="true" />
              </Field>
              <Field label="Email for your quote" hint="We send the final quote and payment receipt here.">
                <input
                  ref={emailRef}
                  name="email"
                  type="email"
                  autoComplete="email"
                  defaultValue={user.email}
                  required
                  className={inputClass}
                  aria-invalid={Boolean(fieldErrors.email)}
                />
                {fieldErrors.email && <span role="alert" className="mt-1 block text-xs" style={{ color: "#ff8a80" }}>{fieldErrors.email}</span>}
              </Field>
              <Field label="Phone number (optional)" hint="Only used if our team needs to talk something through with you.">
                <input name="phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" className={inputClass} aria-invalid={Boolean(fieldErrors.phone)} />
                {fieldErrors.phone && <span role="alert" className="mt-1 block text-xs" style={{ color: "#ff8a80" }}>{fieldErrors.phone}</span>}
              </Field>
              <Field label="Anything we should know? (optional)">
                <textarea name="note" rows={3} maxLength={1000} className={inputClass} placeholder="Occasion, budget limit, must-have experiences, mobility needs…" />
              </Field>
            </div>

            <ol className="flex flex-col gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
              <li className="font-semibold uppercase tracking-wide">What happens next</li>
              {NEXT_STEPS.map((step, i) => (
                <li key={step}>
                  {i + 1}. {step}
                </li>
              ))}
            </ol>

            {error && (
              <p role="alert" className="text-sm" style={{ color: "#ff8a80" }}>
                {error}
              </p>
            )}

            <button type="submit" disabled={submitting} className="rounded-full px-6 py-3 font-medium transition disabled:opacity-60" style={{ background: "var(--accent)", color: onAccent }}>
              {submitting ? "Sending…" : "Send for final approval"}
            </button>
            <p className="text-center text-xs" style={{ color: "var(--muted)" }}>
              Sending is free and commits you to nothing — you decide after you see the final quote.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
