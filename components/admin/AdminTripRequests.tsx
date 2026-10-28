"use client";

/**
 * The agency's inbox for trip quote requests: who is waiting on us, who we are
 * waiting on, and what has been paid. Newest activity first within each state.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge, formatDate } from "@/components/my-requests/status";
import { adminListTripRequests, type AdminRequestRow } from "@/lib/auth-client";
import { formatInr } from "@/lib/atlas/engine/text";
import { AGENCY_TURN, TRAVELLER_TURN, type RequestStatus } from "@/lib/quote-workflow";

type FilterKey = "action" | "waiting" | "paid" | "closed" | "all";

const FILTERS: { key: FilterKey; label: string; match: (s: RequestStatus) => boolean }[] = [
  { key: "action", label: "Needs us", match: (s) => AGENCY_TURN.includes(s) },
  { key: "waiting", label: "Waiting on traveller", match: (s) => TRAVELLER_TURN.includes(s) },
  { key: "paid", label: "Paid", match: (s) => s === "paid" },
  { key: "closed", label: "Closed", match: (s) => ["declined", "cancelled", "closed"].includes(s) },
  { key: "all", label: "All", match: () => true },
];

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins || 1}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function AdminTripRequests() {
  const [rows, setRows] = useState<AdminRequestRow[] | null | undefined>(undefined);
  const [filter, setFilter] = useState<FilterKey>("action");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    adminListTripRequests().then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const out = {} as Record<FilterKey, number>;
    for (const f of FILTERS) out[f.key] = (rows ?? []).filter((r) => f.match(r.status)).length;
    return out;
  }, [rows]);

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        f.match(r.status) &&
        (!q || [r.userName, r.contactEmail, r.contactPhone ?? "", r.destinationSummary, r.id].some((v) => v.toLowerCase().includes(q))),
    );
  }, [rows, filter, query]);

  if (rows === undefined) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  if (rows === null) return <p style={{ color: "var(--muted)" }}>This page isn&apos;t available for your account.</p>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className="rounded-full border px-3.5 py-1.5 text-sm transition"
            style={{
              borderColor: filter === f.key ? "var(--accent)" : "var(--hairline)",
              color: filter === f.key ? "var(--accent)" : "var(--muted)",
              background: filter === f.key ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
            }}
          >
            {f.label} <span className="tabular-nums">{counts[f.key]}</span>
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, phone, destination…"
          aria-label="Search requests"
          className="ml-auto w-full rounded-full border border-white/10 bg-[rgba(7,26,31,0.72)] px-4 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] sm:w-72"
        />
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border p-8 text-center text-sm" style={{ borderColor: "var(--hairline)", color: "var(--muted)" }}>
          {rows.length === 0 ? "No trip requests yet." : "Nothing here."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/request?id=${encodeURIComponent(r.id)}`}
                className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border p-5 transition hover:border-[var(--accent)]"
                style={{ borderColor: AGENCY_TURN.includes(r.status) ? "var(--accent)" : "var(--hairline)" }}
              >
                <div className="min-w-0">
                  <p className="font-display text-xl">{r.destinationSummary}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                    {r.userName} · {r.contactEmail}
                    {r.contactPhone ? ` · ${r.contactPhone}` : ""}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {r.nights} nights from {formatDate(r.startDate)} · updated {ago(r.updatedAt)}
                    {r.status === "quoted" && r.quoteValidUntil ? ` · open until ${formatDate(r.quoteValidUntil)}` : ""}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 text-right">
                  <StatusBadge status={r.status} />
                  <p className="tabular-nums font-semibold" style={{ color: "var(--accent)" }}>
                    {formatInr(r.acceptedTotalInr ?? r.quotedTotalInr ?? r.estimateInr)}
                  </p>
                  <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    {r.paidInr > 0
                      ? `${formatInr(r.paidInr)} paid`
                      : r.acceptedTotalInr != null
                        ? "Agreed"
                        : r.quotedTotalInr != null
                          ? "Quoted"
                          : "Estimate"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
