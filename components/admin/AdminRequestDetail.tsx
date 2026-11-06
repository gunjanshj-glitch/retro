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
import { btnGhost, btnPrimary, cardClass, fieldClass, toneStyle } from "@/components/plan/theme";
import { formatInr } from "@retro/core/atlas/engine/text";
import {
  adminAddNote,
  adminCloseTripRequest,
  adminGetTripRequest,
  adminStartReview,
  type AdminRequestDetail as Detail,
} from "@/lib/auth-client";
import { canTransition, STATUS_COPY } from "@retro/core/quote-workflow";
import { AdminQuoteEditor, isEditable, type EditorActions, type EditorSummary } from "./AdminQuoteEditor";

const primaryBtn = `${btnPrimary} w-full`;
const ghostBtn = `${btnGhost} w-full`;
const textBtn = "inline-flex min-h-11 items-center text-xs font-semibold underline underline-offset-2 hover:text-[var(--ink)]";

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

  if (loading) return <p role="status" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!user) {
    return (
      <button type="button" onClick={openLogin} className={btnPrimary}>
        Sign in
      </button>
    );
  }
  if (!id) return <p role="status" style={{ color: "var(--muted)" }}>No request specified.</p>;
  if (!result || result.id !== id) return <p role="status" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!result.detail) return <p role="status" style={{ color: "var(--muted)" }}>This page isn&apos;t available for your account, or the request doesn&apos;t exist.</p>;

  const detail = result.detail;
  const editable = isEditable(detail.status);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold hover:text-[var(--accent)]"
          style={{ color: "var(--ink-2)" }}
        >
          <span aria-hidden="true">←</span> All requests
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Trip request</p>
            <h1 className="mt-2 font-display text-3xl md:text-4xl">{detail.destinationSummary}</h1>
            <p className="mt-2 break-words text-sm" style={{ color: "var(--muted)" }}>
              {detail.nights} nights from {formatDate(detail.startDate)} · received {formatDate(detail.createdAt)} · ID {detail.id}
            </p>
          </div>
          <StatusBadge status={detail.status} />
        </div>
      </div>

      <ProgressTracker status={detail.status} />
      <p className="rounded-xl border px-4 py-3 text-sm" style={toneStyle.info}>
        {(GUIDANCE[detail.status] ?? (() => STATUS_COPY[detail.status].traveller))(detail)}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="min-w-0">
          {editable ? (
            <AdminQuoteEditor detail={detail} onSent={reload} onSummary={setSummary} actionsRef={actionsRef} />
          ) : (
            <p className={`${cardClass} p-5 text-sm`} style={{ color: "var(--ink-2)", background: "var(--surface)" }}>
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
    <section className={`${cardClass} p-4 sm:p-5`}>
      <h2 className="eyebrow">{title}</h2>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

function ContactCard({ detail }: { detail: Detail }) {
  const { contact } = detail;
  const digits = contact.phone?.replace(/\D/g, "") ?? "";
  const chip = "inline-flex min-h-10 items-center gap-1.5 rounded-full border-[1.5px] border-[var(--line-strong)] bg-[var(--card)] px-4 text-xs font-bold text-[var(--ink)] transition-colors hover:border-[var(--ink)]";
  return (
    <Card title="Traveller">
      <p className="text-base font-bold">{contact.name}</p>
      <p className="mt-1 break-all">
        <a className="font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }} href={`mailto:${contact.email}`}>
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
          <a className="font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }} href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>
            {contact.phone}
          </a>
        ) : (
          <span style={{ color: "var(--muted)" }}>No phone number given</span>
        )}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a className={chip} href={`mailto:${contact.email}?subject=${encodeURIComponent(`Your trip — ${detail.destinationSummary}`)}`}>
          Email
        </a>
        {contact.phone && (
          <>
            <a className={chip} href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>
              Call
            </a>
            <a className={chip} href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          </>
        )}
      </div>
      {contact.note && (
        <p className="mt-3 rounded-xl border p-3 text-xs" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          <span className="mb-1 block font-bold uppercase tracking-wide" style={{ color: "var(--ink-2)" }}>Their note</span>
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
        {summary?.directCostInr != null && (
          <div className="flex justify-between gap-3">
            <dt style={{ color: "var(--muted)" }}>Your direct cost</dt>
            <dd className="tabular-nums">{formatInr(summary.directCostInr)}</dd>
          </div>
        )}
        {summary?.cutInr != null && (
          <div className="flex justify-between gap-3">
            <dt style={{ color: "var(--muted)" }}>Agency cut</dt>
            <dd className="tabular-nums font-semibold" style={{ color: summary.cutInr < 0 ? "var(--danger)" : undefined }}>
              {summary.cutInr < 0 ? "−" : ""}
              {formatInr(Math.abs(summary.cutInr))}
              {summary.cutPct != null && <span className="font-normal" style={{ color: "var(--muted)" }}> ({(summary.cutPct * 100).toFixed(1)}%)</span>}
            </dd>
          </div>
        )}
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-2" style={{ borderColor: "var(--line-strong)" }}>
          <dt className="font-bold">Final total</dt>
          <dd className="font-display text-xl tabular-nums" style={{ color: "var(--ink)" }}>
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
        <p role="status" className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
          {summary.problem}
        </p>
      )}
      {!summary?.problem && summary?.warning && (
        <p role="status" className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
          {summary.warning}
        </p>
      )}
      {summary && (summary.edits.rates > 0 || summary.edits.added > 0 || summary.edits.off > 0) && (
        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
          Hand-edited: {[summary.edits.rates > 0 && `${summary.edits.rates} rate${summary.edits.rates === 1 ? "" : "s"}`, summary.edits.added > 0 && `${summary.edits.added} added`, summary.edits.off > 0 && `${summary.edits.off} off`].filter(Boolean).join(" · ")}
        </p>
      )}
      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        {summary?.dirty ? "Unsaved changes" : summary?.savedAt ? `Draft saved ${new Date(summary.savedAt).toLocaleTimeString("en-IN", { timeStyle: "short" })}` : "No changes yet"}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {canStart && (
          <button type="button" onClick={start} disabled={busy} className={ghostBtn}>
            {busy ? "Starting…" : "Mark as being prepared"}
          </button>
        )}
        <button type="button" onClick={() => actionsRef.current?.saveDraft()} disabled={!summary || Boolean(summary.engineTotalInr == null) || !summary.dirty} className={ghostBtn}>
          Save draft
        </button>
        <button
          type="button"
          onClick={() => actionsRef.current?.requestSend()}
          disabled={!summary || Boolean(summary.problem)}
          className={primaryBtn}
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
              <span style={{ color: p.status === "paid" ? "var(--success)" : p.status === "failed" ? "var(--danger)" : "var(--muted)", fontWeight: 600 }}>· {p.status}</span>
              <span className="block break-all text-xs" style={{ color: "var(--muted)" }}>
                {p.status === "paid" ? `${formatDate(p.paidAt)}${p.method ? ` · ${p.method}` : ""} · ${p.reference ?? ""}` : p.failureReason ?? `opened ${formatDate(p.createdAt)}`}
              </span>
            </span>
            <span className="tabular-nums">{formatInr(p.amountInr)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex justify-between border-t pt-2" style={{ borderColor: "var(--line)" }}>
        <span style={{ color: "var(--muted)" }}>Received</span>
        <span className="font-bold tabular-nums" style={{ color: "var(--success)" }}>
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

  const input = fieldClass;

  return (
    <Card title="Activity & notes">
      <div className="flex flex-col gap-2">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="Internal note — e.g. called, wants a river cruise (traveller can't see this)" aria-label="Internal note" className={input} />
        <button type="button" onClick={addNote} disabled={busy || !note.trim()} className={ghostBtn}>
          Add internal note
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
          {error}
        </p>
      )}
      <div className="mt-4">
        <Timeline events={detail.events} viewer="agency" />
      </div>
      {canTransition(detail.status, "closed") && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--line)" }}>
          {closing ? (
            <div className="flex flex-col gap-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (internal, optional)" aria-label="Reason for closing (internal, optional)" maxLength={500} className={input} />
              <div className="flex items-center gap-3">
                <button type="button" onClick={close} disabled={busy} className={`${ghostBtn} hover:bg-[var(--danger-soft)]`} style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                  Close request
                </button>
                <button type="button" onClick={() => setClosing(false)} className={textBtn} style={{ color: "var(--ink-2)" }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setClosing(true)} className={textBtn} style={{ color: "var(--ink-2)" }}>
              Close this request…
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
