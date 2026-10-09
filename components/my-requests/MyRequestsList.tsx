"use client";

/**
 * My requests: one page, one list. Every final-approval request the
 * signed-in traveller has sent us, newest first — nothing else. Clicking one
 * opens its fixed summary (`RequestSummary`), which is a read-only record,
 * never the planner reopened with these choices pre-filled.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { listFinalRequests, type RequestSummary as RequestSummaryRow } from "@/lib/auth-client";
import { formatInr } from "@/lib/atlas/engine/text";

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting review",
  approved: "Confirmed",
  rejected: "Needs a new quote",
};

export function MyRequestsList() {
  const { user, loading } = useAuth();
  const [requests, setRequests] = useState<RequestSummaryRow[] | null>(null);

  useEffect(() => {
    if (!user) return;
    listFinalRequests().then(setRequests);
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

  if (requests === null) {
    return <p style={{ color: "var(--muted)" }}>Loading your requests…</p>;
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--hairline)" }}>
        <p style={{ color: "var(--muted)" }}>
          You haven&apos;t sent any quotations for final approval yet.
        </p>
        <Link
          href="/plan"
          className="mt-4 inline-flex rounded-full px-6 py-2.5 text-sm font-semibold"
          style={{ background: "var(--accent)", color: "var(--deep)" }}
        >
          Build a quotation
        </Link>
      </div>
    );
  }

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
