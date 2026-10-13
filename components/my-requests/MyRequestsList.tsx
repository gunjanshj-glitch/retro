"use client";

/**
 * My requests: one page, plain lists. Every package quote request and every
 * final-approval request the signed-in traveller has sent us, newest first,
 * with the quote we replied with — nothing else. Clicking one
 * opens its fixed summary (`RequestSummary`), which is a read-only record,
 * never the planner reopened with these choices pre-filled.
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
import { formatInr } from "@/lib/atlas/engine/text";

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting review",
  approved: "Confirmed",
  rejected: "Needs a new quote",
};

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
    return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  }

  if (!user) {
    return (
      <div className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--hairline)" }}>
        <p style={{ color: "var(--muted)" }}>Sign in to see the requests you&apos;ve sent us.</p>
        <Link
          href="/plan"
          className="mt-4 inline-flex rounded-full px-6 py-2.5 text-sm font-semibold"
          style={{ background: "var(--accent)", color: "var(--deep)" }}
        >
          Start planning a trip
        </Link>
      </div>
    );
  }

  if (requests === null || packageRequests === null) {
    return <p style={{ color: "var(--muted)" }}>Loading your requests…</p>;
  }

  if (requests.length === 0 && packageRequests.length === 0) {
    return (
      <div className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--hairline)" }}>
        <p style={{ color: "var(--muted)" }}>You haven&apos;t requested any quotes yet.</p>
        <Link
          href="/destinations"
          className="mt-4 inline-flex rounded-full px-6 py-2.5 text-sm font-semibold"
          style={{ background: "var(--accent)", color: "var(--deep)" }}
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
          <li key={r.id} className="rounded-2xl border p-5" style={{ borderColor: "var(--hairline)" }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  href={`/destinations/${r.destinationSlug}/packages/${r.packageSlug}`}
                  className="font-display text-xl hover:underline"
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
                className="rounded-full border px-2.5 py-0.5 text-[11px] uppercase tracking-wide"
                style={{ borderColor: "var(--hairline)", color: r.quote ? "var(--accent)" : "var(--muted)" }}
              >
                {PACKAGE_STATUS_LABEL[r.status] ?? r.status}
              </p>
            </div>
            {r.quote && (
              <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--surface)" }}>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  Your quote
                </p>
                <p className="mt-1 font-display text-2xl tabular-nums" style={{ color: "var(--accent)" }}>
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
  return (
    <ul className="flex flex-col gap-3">
      {requests.map((r) => (
        <li key={r.id}>
          <Link
            href={`/my-requests/view?id=${encodeURIComponent(r.id)}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5 transition hover:border-[var(--accent)]"
            style={{ borderColor: "var(--hairline)" }}
          >
            <div>
              <p className="font-display text-xl">{r.destinationSummary}</p>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                {r.nights} nights · from {r.startDate} · sent {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular-nums font-semibold" style={{ color: "var(--accent)" }}>
                {formatInr(r.totalInr)}
              </p>
              <p
                className="mt-1 rounded-full border px-2.5 py-0.5 text-[11px] uppercase tracking-wide"
                style={{ borderColor: "var(--hairline)", color: "var(--muted)" }}
              >
                {STATUS_LABEL[r.status] ?? r.status}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
