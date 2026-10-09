"use client";

/**
 * A fixed, read-only summary of one final-approval request.
 *
 * Deliberately not the planner reopened with these choices pre-filled: the
 * whole point of "send for final approval" is that what was asked for is
 * locked the moment it's sent, so this renders the stored snapshot's own
 * numbers directly rather than replaying anything through the (possibly
 * since-changed) live engine.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { getFinalRequest, type RequestDetail } from "@/lib/auth-client";
import { formatInr } from "@/lib/atlas/engine/text";
import type { Quotation, QuoteRequest } from "@/lib/atlas/engine/types";

type Snapshot = {
  submittedAt: string;
  user: { id: string; name: string; email: string };
  request: QuoteRequest;
  quotation: Quotation;
};

function isSnapshot(v: unknown): v is Snapshot {
  return (
    typeof v === "object" &&
    v !== null &&
    "request" in v &&
    "quotation" in v &&
    "user" in v
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting review — we'll email you the confirmed figure.",
  approved: "Confirmed by our team.",
  rejected: "This one needs a fresh quote — get in touch.",
};

export function RequestSummary() {
  const params = useSearchParams();
  const id = params.get("id");
  const { user, loading: authLoading } = useAuth();
  // Keyed by the id it was fetched for, so "loading" is derived from the id
  // not yet matching rather than set synchronously at the top of the effect.
  const [result, setResult] = useState<{ id: string; detail: RequestDetail | null } | null>(null);

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

  const detail: RequestDetail | null | "loading" =
    id && result?.id === id ? result.detail : "loading";

  if (authLoading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  if (!user) {
    return <p style={{ color: "var(--muted)" }}>Sign in to view this request.</p>;
  }

  if (!id) {
    return <p style={{ color: "var(--muted)" }}>No request specified.</p>;
  }

  if (detail === "loading") {
    return <p style={{ color: "var(--muted)" }}>Loading your request…</p>;
  }

  if (!detail) {
    return <p style={{ color: "var(--muted)" }}>We couldn&apos;t find that request.</p>;
  }

  const snapshot = isSnapshot(detail.snapshot) ? detail.snapshot : null;
  const quotation = snapshot?.quotation;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: "var(--accent)" }}>
          Final quotation request
        </p>
        <h1 className="mt-3 font-display text-3xl md:text-4xl">{detail.destinationSummary}</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Sent {new Date(detail.createdAt).toLocaleString("en-IN")} · Request ID {detail.id}
        </p>
        <p className="mt-3 inline-flex rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--hairline)", color: "var(--muted)" }}>
          {STATUS_LABEL[detail.status] ?? detail.status}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-2xl border p-5 text-sm sm:grid-cols-4" style={{ borderColor: "var(--hairline)" }}>
        <div>
          <dt style={{ color: "var(--muted)" }}>Nights</dt>
          <dd className="mt-1 text-lg">{detail.nights}</dd>
        </div>
        <div>
          <dt style={{ color: "var(--muted)" }}>Starts</dt>
          <dd className="mt-1 text-lg">{detail.startDate}</dd>
        </div>
        <div>
          <dt style={{ color: "var(--muted)" }}>Total</dt>
          <dd className="mt-1 text-lg tabular-nums" style={{ color: "var(--accent)" }}>
            {formatInr(detail.totalInr)}
          </dd>
        </div>
        <div>
          <dt style={{ color: "var(--muted)" }}>Per person</dt>
          <dd className="mt-1 text-lg tabular-nums">{formatInr(detail.perPersonInr)}</dd>
        </div>
      </dl>

      {quotation && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl">What was quoted</h2>
          <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--hairline)" }}>
            {Object.entries(groupByComponent(quotation)).map(([component, total]) => (
              <div
                key={component}
                className="flex items-center justify-between gap-3 border-b p-4 last:border-b-0"
                style={{ borderColor: "var(--hairline)" }}
              >
                <span className="capitalize">{component.replace(/-/g, " ")}</span>
                <span className="tabular-nums">{formatInr(total)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {snapshot && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Submitted by {snapshot.user.name} ({snapshot.user.email}). This record is fixed — it
          cannot be edited or regenerated, so it always reflects exactly what was sent for review.
        </p>
      )}
    </div>
  );
}

function groupByComponent(quotation: Quotation): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const item of quotation.lineItems) {
    totals[item.component] = (totals[item.component] ?? 0) + item.totalInr;
  }
  return totals;
}
