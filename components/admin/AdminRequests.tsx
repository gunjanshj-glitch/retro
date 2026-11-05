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
import { formatInr } from "@retro/core/atlas/engine/text";
import { btnGhost, btnPrimary, cardClass, fieldClass, toneStyle } from "@/components/plan/theme";

export function AdminRequests() {
  const { user, loading, openLogin } = useAuth();
  const [rows, setRows] = useState<AdminPackageRequest[] | null | undefined>(undefined);

  const refresh = useCallback(() => {
    adminListPackageRequests().then(setRows);
  }, []);

  useEffect(() => {
    if (user) refresh();
  }, [user, refresh]);

  if (loading) return <p role="status" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!user) {
    return (
      <button
        type="button"
        onClick={openLogin}
        className={btnPrimary}
      >
        Sign in
      </button>
    );
  }
  if (rows === undefined) return <p role="status" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (rows === null) return <p role="status" style={{ color: "var(--muted)" }}>This page isn&apos;t available for your account.</p>;
  if (rows.length === 0) return <p role="status" style={{ color: "var(--muted)" }}>No requests yet.</p>;

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

  return (
    <li className={`${cardClass} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-xl">{r.packageName}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {r.destinationName} · {r.userName} · <a href={`mailto:${r.userEmail}`} className="break-all font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>{r.userEmail}</a>
          </p>
        </div>
        <p
          className="whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
          style={r.status === "pending" ? toneStyle.accent : r.status === "quoted" ? toneStyle.success : toneStyle.neutral}
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
        <p className="mt-3 rounded-xl px-4 py-3 text-sm" style={{ color: "var(--ink)", background: "var(--surface)" }}>
          “{r.notes}”
        </p>
      )}
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        Sent {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
        {r.quote ? ` · quoted ${formatInr(r.quote.amountInr)}` : ""}
      </p>

      {r.status !== "closed" && (
        <div className="mt-5 grid gap-3 border-t pt-5 sm:grid-cols-[10rem_1fr_auto] sm:items-end" style={{ borderColor: "var(--line)" }}>
          <label className="text-xs font-semibold" style={{ color: "var(--ink)" }}>
            Quote (₹)
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`mt-1.5 font-normal ${fieldClass}`}
            />
          </label>
          <label className="text-xs font-semibold" style={{ color: "var(--ink)" }}>
            Note to traveller
            <input
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              className={`mt-1.5 font-normal ${fieldClass}`}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={send}
              className={btnPrimary}
            >
              {r.quote ? "Update quote" : "Send quote"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className={btnGhost}
            >
              Close
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl border px-4 py-2.5 text-sm font-medium" style={toneStyle.danger}>
          {error}
        </p>
      )}
    </li>
  );
}
