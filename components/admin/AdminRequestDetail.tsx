"use client";

/**
 * One trip request, from the agency's side: who the traveller is and how to
 * reach them, where the case stands, the quote editor, and everything that has
 * happened so far (including internal notes the traveller never sees).
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { ProgressTracker, StatusBadge, Timeline, formatDate } from "@/components/my-requests/status";
import { onAccent } from "@/components/plan/theme";
import { formatInr } from "@/lib/atlas/engine/text";
import {
  adminAddNote,
  adminCloseTripRequest,
  adminGetTripRequest,
  adminStartReview,
  type AdminRequestDetail as Detail,
} from "@/lib/auth-client";
import { canTransition, STATUS_COPY } from "@/lib/quote-workflow";
import { AdminQuoteEditor, isEditable, type EditorActions, type EditorSummary } from "./AdminQuoteEditor";

const primaryBtn = "inline-flex min-h-11 w-full items-center justify-center rounded-full px-6 py-2.5 text-sm font-semibold transition disabled:opacity-50";
const ghostBtn = "inline-flex min-h-11 w-full items-center justify-center rounded-full border px-5 py-2.5 text-sm transition hover:border-[var(--accent)] disabled:opacity-50";

const GUIDANCE: Record<string, (d: Detail) => string> = {
  pending: () => "New request. Nobody has picked it up yet — look over the trip, contact the traveller if anything is unclear, then build the quote.",
  in_review: () => "In progress. Save drafts as you go; the traveller sees nothing until you send.",
  quoted: (d) => `Quote sent${d.quoteValidUntil ? `, open until ${formatDate(d.quoteValidUntil)}` : ""}. Waiting for the traveller. Sending again creates a new version.`,
  changes_requested: () => "The traveller asked for changes — their message is in the activity below. Update the quote and send the revision.",
  accepted: (d) => `Accepted at ${formatInr(d.acceptance?.totalInr ?? 0)}. Waiting for payment. If you send a revision now, their acceptance is cleared.`,
  part_paid: (d) => `Part paid: ${formatInr(d.paidInr)} of ${formatInr(d.acceptance?.totalInr ?? 0)}. The traveller can pay the balance online.`,
  paid: (d) => `Paid in full: ${formatInr(d.paidInr)}. Time to confirm bookings with suppliers.`,
  declined: () => "The traveller declined. You can still send a new quote if you reach an agreement.",
  expired: () => "The quote lapsed. Send a refreshed quote with a new validity date.",
  cancelled: () => "The traveller withdrew this request.",
  closed: () => "This request is closed.",
};

export function AdminRequestDetail() {
  const params = useSearchParams();
  const id = params.get("id");
  const { user, loading, openLogin } = useAuth();
  const [result, setResult] = useState<{ id: string; detail: Detail | null } | null>(null);
  const [summary, setSummary] = useState<EditorSummary | null>(null);
  const actionsRef = useRef<EditorActions | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    setResult({ id, detail: await adminGetTripRequest(id) });
  }, [id]);

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;
    adminGetTripRequest(id).then((d) => {
      if (!cancelled) setResult({ id, detail: d });
    });
    return () => {
      cancelled = true;
    };
  }, [user, id]);

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!user) {
    return (
      <button type="button" onClick={openLogin} className="rounded-full px-6 py-2.5 text-sm font-semibold" style={{ background: "var(--accent)", color: onAccent }}>
        Sign in
      </button>
    );
  }
  if (!id) return <p style={{ color: "var(--muted)" }}>No request specified.</p>;
  if (!result || result.id !== id) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!result.detail) return <p style={{ color: "var(--muted)" }}>This page isn&apos;t available for your account, or the request doesn&apos;t exist.</p>;

  const detail = result.detail;
  const editable = isEditable(detail.status);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin" className="text-xs underline" style={{ color: "var(--muted)" }}>
          ← All requests
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl md:text-4xl">{detail.destinationSummary}</h1>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {detail.nights} nights from {formatDate(detail.startDate)} · received {formatDate(detail.createdAt)} · ID {detail.id}
            </p>
          </div>
          <StatusBadge status={detail.status} />
        </div>
      </div>

      <ProgressTracker status={detail.status} />
      <p className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--hairline)", color: "var(--muted)" }}>
        {(GUIDANCE[detail.status] ?? (() => STATUS_COPY[detail.status].traveller))(detail)}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="min-w-0">
          {editable ? (
            <AdminQuoteEditor detail={detail} onSent={reload} onSummary={setSummary} actionsRef={actionsRef} />
          ) : (
            <p className="rounded-2xl border p-5 text-sm" style={{ borderColor: "var(--hairline)", color: "var(--muted)" }}>
              This request is {detail.status === "paid" || detail.status === "part_paid" ? "already being paid" : "finished"}, so the quote is locked. The versions sent are listed on the right.
            </p>
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
          <ContactCard detail={detail} />
          {editable && <SummaryCard detail={detail} summary={summary} actionsRef={actionsRef} onReload={reload} />}
          <RevisionsCard detail={detail} />
          <PaymentsCard detail={detail} />
          <ActivityCard detail={detail} onReload={reload} />
        </aside>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border p-4" style={{ borderColor: "var(--hairline)" }}>
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--accent)" }}>
        {title}
      </h2>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

function ContactCard({ detail }: { detail: Detail }) {
  const { contact } = detail;
  const digits = contact.phone?.replace(/\D/g, "") ?? "";
  const chip = "rounded-full border px-3 py-1.5 text-xs hover:border-[var(--accent)]";
  return (
    <Card title="Traveller">
      <p className="text-base font-medium">{contact.name}</p>
      <p className="mt-1 break-all">
        <a className="underline" href={`mailto:${contact.email}`}>
          {contact.email}
        </a>
      </p>
      {contact.accountEmail !== contact.email && (
        <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
          Account: {contact.accountEmail}
        </p>
      )}
      <p className="mt-1">
        {contact.phone ? (
          <a className="underline" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>
            {contact.phone}
          </a>
        ) : (
          <span style={{ color: "var(--muted)" }}>No phone number given</span>
        )}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a className={chip} style={{ borderColor: "var(--hairline)" }} href={`mailto:${contact.email}?subject=${encodeURIComponent(`Your trip — ${detail.destinationSummary}`)}`}>
          Email
        </a>
        {contact.phone && (
          <>
            <a className={chip} style={{ borderColor: "var(--hairline)" }} href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>
              Call
            </a>
            <a className={chip} style={{ borderColor: "var(--hairline)" }} href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          </>
        )}
      </div>
      {contact.note && (
        <p className="mt-3 rounded-xl border p-3 text-xs" style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}>
          <span className="block uppercase tracking-wide" style={{ color: "var(--muted)" }}>Their note</span>
          {contact.note}
        </p>
      )}
    </Card>
  );
}

function SummaryCard({
  detail,
  summary,
  actionsRef,
  onReload,
}: {
  detail: Detail;
  summary: EditorSummary | null;
  actionsRef: React.MutableRefObject<EditorActions | null>;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const canStart = detail.status === "pending" || detail.status === "changes_requested";

  async function start() {
    setBusy(true);
    await adminStartReview(detail.id);
    await onReload();
    setBusy(false);
  }

  return (
    <Card title="Quote">
      <dl className="flex flex-col gap-1.5">
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--muted)" }}>Traveller saw</dt>
          <dd className="tabular-nums">{formatInr(detail.estimateInr)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt style={{ color: "var(--muted)" }}>Engine now</dt>
          <dd className="tabular-nums">{summary?.engineTotalInr != null ? formatInr(summary.engineTotalInr) : "…"}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t pt-1.5 text-base" style={{ borderColor: "var(--hairline)" }}>
          <dt>Final total</dt>
          <dd className="tabular-nums" style={{ color: "var(--accent)" }}>
            {summary?.totalInr != null ? formatInr(summary.totalInr) : "…"}
          </dd>
        </div>
        {summary?.dueNowInr != null && summary.totalInr != null && summary.dueNowInr < summary.totalInr && (
          <div className="flex justify-between gap-3">
            <dt style={{ color: "var(--muted)" }}>Due to confirm</dt>
            <dd className="tabular-nums">{formatInr(summary.dueNowInr)}</dd>
          </div>
        )}
      </dl>

      {summary?.problem && (
        <p className="mt-3 text-xs" style={{ color: "#ffb74d" }}>
          {summary.problem}
        </p>
      )}
      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        {summary?.dirty ? "Unsaved changes" : summary?.savedAt ? `Draft saved ${new Date(summary.savedAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}` : "No changes yet"}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {canStart && (
          <button type="button" onClick={start} disabled={busy} className={ghostBtn} style={{ borderColor: "var(--hairline)" }}>
            {busy ? "Starting…" : "Mark as being prepared"}
          </button>
        )}
        <button type="button" onClick={() => actionsRef.current?.saveDraft()} disabled={!summary || Boolean(summary.engineTotalInr == null) || !summary.dirty} className={ghostBtn} style={{ borderColor: "var(--hairline)" }}>
          Save draft
        </button>
        <button
          type="button"
          onClick={() => actionsRef.current?.requestSend()}
          disabled={!summary || Boolean(summary.problem)}
          className={primaryBtn}
          style={{ background: "var(--accent)", color: onAccent }}
        >
          {detail.revisions.some((r) => r.status === "sent") ? "Send revised quote…" : "Send final quote…"}
        </button>
      </div>
    </Card>
  );
}

function RevisionsCard({ detail }: { detail: Detail }) {
  if (!detail.revisions.length) return null;
  return (
    <Card title="Versions sent">
      <ul className="flex flex-col gap-2">
        {detail.revisions.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3">
            <span>
              v{r.version} <span style={{ color: "var(--muted)" }}>· {formatDate(r.sentAt)}{r.status === "sent" ? " · current" : ""}</span>
              {r.validUntil && (
                <span className="block text-xs" style={{ color: "var(--muted)" }}>
                  open until {formatDate(r.validUntil)}
                </span>
              )}
            </span>
            <span className="tabular-nums">{formatInr(r.totalInr)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PaymentsCard({ detail }: { detail: Detail }) {
  if (!detail.payments.length) return null;
  return (
    <Card title="Payments">
      <ul className="flex flex-col gap-2">
        {detail.payments.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-3">
            <span>
              <span className="capitalize">{p.kind}</span>{" "}
              <span style={{ color: p.status === "paid" ? "#7bd88f" : "var(--muted)" }}>· {p.status}</span>
              <span className="block break-all text-xs" style={{ color: "var(--muted)" }}>
                {p.status === "paid" ? `${formatDate(p.paidAt)}${p.method ? ` · ${p.method}` : ""} · ${p.reference ?? ""}` : p.failureReason ?? `opened ${formatDate(p.createdAt)}`}
              </span>
            </span>
            <span className="tabular-nums">{formatInr(p.amountInr)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex justify-between border-t pt-2" style={{ borderColor: "var(--hairline)" }}>
        <span style={{ color: "var(--muted)" }}>Received</span>
        <span className="tabular-nums" style={{ color: "var(--accent)" }}>
          {formatInr(detail.paidInr)}
        </span>
      </p>
    </Card>
  );
}

function ActivityCard({ detail, onReload }: { detail: Detail; onReload: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");

  async function addNote() {
    setBusy(true);
    setError(null);
    const res = await adminAddNote(detail.id, note);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setNote("");
    await onReload();
  }

  async function close() {
    setBusy(true);
    setError(null);
    const res = await adminCloseTripRequest(detail.id, reason);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setClosing(false);
    await onReload();
  }

  const input = "w-full rounded-lg border border-white/10 bg-[rgba(7,26,31,0.72)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]";

  return (
    <Card title="Activity & notes">
      <div className="flex flex-col gap-2">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="Internal note — e.g. called, wants a river cruise (traveller can't see this)" className={input} />
        <button type="button" onClick={addNote} disabled={busy || !note.trim()} className={ghostBtn} style={{ borderColor: "var(--hairline)" }}>
          Add internal note
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs" style={{ color: "#ff8a80" }}>
          {error}
        </p>
      )}
      <div className="mt-4">
        <Timeline events={detail.events} viewer="agency" />
      </div>
      {canTransition(detail.status, "closed") && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--hairline)" }}>
          {closing ? (
            <div className="flex flex-col gap-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (internal, optional)" maxLength={500} className={input} />
              <div className="flex gap-2">
                <button type="button" onClick={close} disabled={busy} className={ghostBtn} style={{ borderColor: "#ff8a80", color: "#ff8a80" }}>
                  Close request
                </button>
                <button type="button" onClick={() => setClosing(false)} className="text-xs underline" style={{ color: "var(--muted)" }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setClosing(true)} className="text-xs underline" style={{ color: "var(--muted)" }}>
              Close this request…
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
