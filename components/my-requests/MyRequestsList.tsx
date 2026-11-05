"use client";

/**
 * My requests: one page, plain lists. Every package quote request and every
 * trip request the signed-in traveller has sent us, most recently active
 * first, with where each one stands and a prompt on any that wait for them.
 * Clicking a trip request opens its tracker (`RequestSummary`), where they
 * review the final quote, accept, pay or ask for changes.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  listFinalRequests,
  listPackageRequests,
  type PackageRequestRow,
  type RequestSummary as RequestSummaryRow,
} from "@/lib/auth-client";
import { formatInr } from "@retro/core/atlas/engine/text";
import { StatusBadge, daysLeft, daysLeftLabel, formatDate } from "./status";
import { btnPrimary, cardClass, toneStyle } from "@/components/plan/theme";

export function MyRequestsList() {
  const { user, loading } = useAuth();
  const [requests, setRequests] = useState<RequestSummaryRow[] | null>(null);
  const [packageRequests, setPackageRequests] = useState<PackageRequestRow[] | null>(null);

  useEffect(() => {
    if (!user) return;
    listFinalRequests().then(setRequests);
    listPackageRequests().then(setPackageRequests);
  }, [user]);

  if (loading) {
    return <p role="status" style={{ color: "var(--muted)" }}>Loading…</p>;
  }

  if (!user) {
    return (
      <div className={`${cardClass} px-6 py-12 text-center`} style={{ background: "var(--surface)" }}>
        <p style={{ color: "var(--muted)" }}>Sign in to see the requests you&apos;ve sent us.</p>
        <Link
          href="/plan"
          className={`${btnPrimary} mt-5`}
        >
          Start planning a trip
        </Link>
      </div>
    );
  }

  if (requests === null || packageRequests === null) {
    return <p role="status" style={{ color: "var(--muted)" }}>Loading your requests…</p>;
  }

  if (requests.length === 0 && packageRequests.length === 0) {
    return (
      <div className={`${cardClass} px-6 py-12 text-center`} style={{ background: "var(--surface)" }}>
        <p style={{ color: "var(--muted)" }}>You haven&apos;t requested any quotes yet.</p>
        <Link
          href="/destinations"
          className={`${btnPrimary} mt-5`}
        >
          Browse packages
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {packageRequests.length > 0 && <PackageRequestSection rows={packageRequests} />}
      {requests.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-2xl">Custom trip quotations</h2>
          <FinalRequestList requests={requests} />
        </section>
      )}
    </div>
  );
}

const PACKAGE_STATUS_LABEL: Record<string, string> = {
  pending: "Quote on its way",
  quoted: "Quote received",
  closed: "Closed",
};

function PackageRequestSection({ rows }: { rows: PackageRequestRow[] }) {
  return (
    <section>
      <h2 className="mb-4 font-display text-2xl">Package requests</h2>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.id} className={`${cardClass} p-5 sm:p-6`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  href={`/destinations/${r.destinationSlug}/packages/${r.packageSlug}`}
                  className="font-display text-xl underline-offset-4 hover:text-[var(--accent)] hover:underline"
                >
                  {r.packageName}
                </Link>
                <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                  {r.destinationName} · {r.adults} adult{r.adults === 1 ? "" : "s"}
                  {r.children ? `, ${r.children} child${r.children === 1 ? "" : "ren"}` : ""} · {r.tripType}
                  {r.startDate ? ` · ${r.startDate}` : ""}
                </p>
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  Sent {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </div>
              <p
                className="whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
                style={r.quote ? toneStyle.accent : toneStyle.neutral}
              >
                {PACKAGE_STATUS_LABEL[r.status] ?? r.status}
              </p>
            </div>
            {r.quote && (
              <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                <p className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: "var(--ink-2)" }}>
                  Your quote
                </p>
                <p className="mt-1 font-display text-2xl tabular-nums" style={{ color: "var(--ink)" }}>
                  {formatInr(r.quote.amountInr)}
                </p>
                {r.quote.note && (
                  <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                    {r.quote.note}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FinalRequestList({ requests }: { requests: RequestSummaryRow[] }) {
  const waiting = requests.filter((r) => r.needsAction).length;
  return (
    <div className="flex flex-col gap-3">
      {waiting > 0 && (
        <p
          className="rounded-xl border px-4 py-3 text-sm font-semibold"
          style={toneStyle.warning}
          role="status"
        >
          {waiting === 1 ? "1 request needs" : `${waiting} requests need`} your attention.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {requests.map((r) => {
          const hasQuote = r.quotedTotalInr != null;
          const left = r.status === "quoted" ? daysLeft(r.quoteValidUntil) : null;
          return (
            <li key={r.id}>
              <Link
                href={`/my-requests/view?id=${encodeURIComponent(r.id)}`}
                className="lift flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-[var(--card)] p-5 shadow-[var(--shadow-sm)] hover:border-[var(--line-strong)] sm:p-6"
                style={{
                  borderColor: r.needsAction ? "var(--sun-deep)" : "var(--line)",
                  boxShadow: r.needsAction ? "inset 4px 0 0 var(--sun), var(--shadow-sm)" : undefined,
                }}
              >
                <div className="min-w-0">
                  <p className="font-display text-xl">{r.destinationSummary}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                    {r.nights} nights · from {formatDate(r.startDate)} · updated{" "}
                    {new Date(r.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                  {r.needsAction && (
                    <p className="mt-2 text-sm font-bold" style={{ color: "var(--accent)" }}>
                      {r.status === "quoted"
                        ? `Review your final quote${left != null ? ` — ${daysLeftLabel(left)}` : ""} →`
                        : r.status === "part_paid"
                          ? "Pay the balance →"
                          : "Complete your payment →"}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-start gap-1.5 sm:items-end">
                  <p className="font-display text-xl tabular-nums" style={{ color: "var(--ink)" }}>
                    {formatInr(r.acceptedTotalInr ?? r.quotedTotalInr ?? r.totalInr)}
                  </p>
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    {r.acceptedTotalInr != null ? "Agreed total" : hasQuote ? "Final quote" : "Estimate"}
                  </p>
                  <StatusBadge status={r.status} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
