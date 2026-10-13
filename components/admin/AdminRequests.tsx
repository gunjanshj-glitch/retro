"use client";

/**
 * Admin view of package quote requests: every request with the traveller's
 * details, and a form to write the quote back. The API only answers admins,
 * so a non-admin just sees the "not available" message.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  adminCloseRequest,
  adminListPackageRequests,
  adminSendQuote,
  type AdminPackageRequest,
} from "@/lib/auth-client";
import { formatInr } from "@/lib/atlas/engine/text";

export function AdminRequests() {
  const { user, loading, openLogin } = useAuth();
  const [rows, setRows] = useState<AdminPackageRequest[] | null | undefined>(undefined);

  const refresh = useCallback(() => {
    adminListPackageRequests().then(setRows);
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!user) {
    return (
      <button
        type="button"
        onClick={openLogin}
        className="rounded-full px-6 py-2.5 text-sm font-semibold"
        style={{ background: "var(--accent)", color: "var(--deep)" }}
      >
        Sign in
      </button>
    );
  }
  if (rows === undefined) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  if (rows === null) return <p style={{ color: "var(--muted)" }}>This page isn&apos;t available for your account.</p>;
  if (rows.length === 0) return <p style={{ color: "var(--muted)" }}>No requests yet.</p>;

  return (
    <ul className="flex flex-col gap-4">
      {rows.map((r) => (
        <RequestCard key={r.id} row={r} onChanged={refresh} />
      ))}
    </ul>
  );
}

function RequestCard({ row: r, onChanged }: { row: AdminPackageRequest; onChanged: () => void }) {
  const [amount, setAmount] = useState(r.quote ? String(r.quote.amountInr) : "");
  const [note, setNote] = useState(r.quote?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const n = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter the quote amount in rupees.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await adminSendQuote(r.id, n, note);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onChanged();
  }

  async function close() {
    setBusy(true);
    const res = await adminCloseRequest(r.id);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onChanged();
  }

  const inputStyle = { borderColor: "var(--hairline)", background: "var(--surface)", color: "var(--text)" };

  return (
    <li className="rounded-2xl border p-5" style={{ borderColor: "var(--hairline)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-xl">{r.packageName}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {r.destinationName} · {r.userName} · <a href={`mailto:${r.userEmail}`} className="underline">{r.userEmail}</a>
          </p>
        </div>
        <p
          className="rounded-full border px-2.5 py-0.5 text-[11px] uppercase tracking-wide"
          style={{ borderColor: "var(--hairline)", color: r.status === "pending" ? "var(--accent)" : "var(--muted)" }}
        >
          {r.status}
        </p>
      </div>
      <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
        {r.tripType} · {r.adults} adult{r.adults === 1 ? "" : "s"}
        {r.children ? `, ${r.children} child${r.children === 1 ? "" : "ren"}` : ""} · {r.startDate ?? "date open"} · from{" "}
        {r.departureCity} · {r.hotelStar} · food: {r.food} · flights {r.includeFlights ? "included" : "not included"}
      </p>
      {r.notes && (
        <p className="mt-2 text-sm" style={{ color: "var(--text)" }}>
          “{r.notes}”
        </p>
      )}
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        Sent {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
        {r.quote ? ` · quoted ${formatInr(r.quote.amountInr)}` : ""}
      </p>

      {r.status !== "closed" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
          <label className="text-xs" style={{ color: "var(--muted)" }}>
            Quote (₹)
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              style={inputStyle}
            />
          </label>
          <label className="text-xs" style={{ color: "var(--muted)" }}>
            Note to traveller
            <input
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              style={inputStyle}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={send}
              className="rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
              style={{ background: "var(--accent)", color: "var(--deep)" }}
            >
              {r.quote ? "Update quote" : "Send quote"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className="rounded-full border px-4 py-2 text-sm disabled:opacity-60"
              style={{ borderColor: "var(--hairline)", color: "var(--muted)" }}
            >
              Close
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm" style={{ color: "#ff8a8a" }}>
          {error}
        </p>
      )}
    </li>
  );
}
