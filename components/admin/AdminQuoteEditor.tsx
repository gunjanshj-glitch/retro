"use client";

/**
 * The quote editor: where a person at the agency turns a traveller's request
 * into the final quote.
 *
 * It opens the traveller's own trip in the same engine they used, so changing
 * anything — destinations, dates, party, hotel class, transport, which
 * sightseeing is in, which optional components are on — re-prices it live.
 * Commercial adjustments (a fixed price, charges, discounts, optional extras, a
 * deposit) sit on top. Drafts are saved server-side as the agency works; sending
 * creates a new numbered revision and emails the traveller.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { DecisionMatrix } from "@/components/plan/DecisionMatrix";
import { QuotationView } from "@/components/plan/QuotationView";
import { WorldMapPicker } from "@/components/plan/WorldMapPicker";
import { QuoteOffer } from "@/components/my-requests/QuoteOffer";
import { onAccent } from "@/components/plan/theme";
import { useQuotation } from "@/lib/atlas/use-quotation";
import { formatInr } from "@/lib/atlas/engine/text";
import { QuoteRequest } from "@/lib/atlas/engine/types";
import type { Quotation } from "@/lib/atlas/engine/types";
import { adminSaveDraft, adminSendTripQuote, type AdminRequestDetail } from "@/lib/auth-client";
import { buildPublicQuote, emptyAdjustments, priceQuote, type QuoteAdjustments } from "@/lib/quote-pricing";
import type { RequestStatus } from "@/lib/quote-workflow";
import { PricingPanel } from "./PricingPanel";

const primaryBtn = "inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2.5 text-sm font-semibold transition disabled:opacity-50";
const ghostBtn = "inline-flex min-h-11 items-center justify-center rounded-full border px-5 py-2.5 text-sm transition hover:border-[var(--accent)] disabled:opacity-50";

/** Requests stored before newer optional fields existed get the engine's defaults filled in. */
function readRequest(raw: unknown): QuoteRequest | null {
  const parsed = QuoteRequest.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Drops the heaviest parts the traveller's page and the Worker never use. */
function slimQuotation(q: Quotation): Quotation {
  return { ...q, planningNotes: [], appliedRules: [], suggestions: [] };
}

function Section({ title, hint, open = false, children }: { title: string; hint?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-2xl border" style={{ borderColor: "var(--hairline)" }}>
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 p-5">
        <span className="font-display text-xl">{title}</span>
        {hint && (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {hint}
          </span>
        )}
      </summary>
      <div className="border-t p-5" style={{ borderColor: "var(--hairline)" }}>
        {children}
      </div>
    </details>
  );
}

type Props = {
  detail: AdminRequestDetail;
  /** Reloads the request after a send, so status, revisions and timeline refresh. */
  onSent: () => void;
  /** Reports what the editor currently holds, for the side summary. */
  onSummary: (s: EditorSummary) => void;
  /** Lets the page register the editor's actions for its own buttons. */
  actionsRef: React.MutableRefObject<EditorActions | null>;
};

export type EditorSummary = {
  engineTotalInr: number | null;
  totalInr: number | null;
  dueNowInr: number | null;
  dirty: boolean;
  savedAt: string | null;
  problem: string | null;
};

export type EditorActions = {
  saveDraft: () => Promise<void>;
  requestSend: () => void;
  busy: boolean;
};

export function AdminQuoteEditor({ detail, onSent, onSummary, actionsRef }: Props) {
  const initialRequest = useMemo(() => {
    const snapshot = detail.snapshot as { request?: unknown } | null;
    return readRequest(detail.workingCopy?.request) ?? readRequest(snapshot?.request);
  }, [detail]);

  const [request, setRequest] = useState<QuoteRequest | null>(initialRequest);
  const [adjustments, setAdjustments] = useState<QuoteAdjustments>(detail.workingCopy?.adjustments ?? emptyAdjustments());
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const initialValid = detail.workingCopy?.validUntil && detail.workingCopy.validUntil >= today ? detail.workingCopy.validUntil : detail.defaultValidUntil;
  const [validUntil, setValidUntil] = useState(initialValid);
  const [note, setNote] = useState(detail.workingCopy?.note ?? "");

  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  // Every edit funnels through these so "unsaved changes" is tracked in one place.
  const editRequest = useCallback((next: QuoteRequest | ((r: QuoteRequest) => QuoteRequest)) => {
    setRequest((r) => (r ? (typeof next === "function" ? next(r) : next) : r));
    setDirty(true);
  }, []);
  const editAdjustments = (next: QuoteAdjustments) => {
    setAdjustments(next);
    setDirty(true);
  };

  const { core, quote, error } = useQuotation(request ?? ({ placeIds: [] } as unknown as QuoteRequest), request != null);

  const setPlaces = useCallback(
    (placeIds: string[] | ((current: string[]) => string[])) => {
      // Same reset the planner does: a new destination list invalidates any
      // per-place night override and any pinned transport mode.
      editRequest((r) => ({ ...r, placeIds: typeof placeIds === "function" ? placeIds(r.placeIds) : placeIds, nightOverrides: {}, legModes: {} }));
    },
    [editRequest],
  );

  const destinationSummary = useMemo(() => {
    if (!core || !request) return detail.destinationSummary;
    return request.placeIds.map((id) => core.places.find((p) => p.id === id)?.name).filter(Boolean).join(", ") || detail.destinationSummary;
  }, [core, request, detail.destinationSummary]);

  const priced = quote ? priceQuote(quote.totals.total, adjustments) : null;
  const problem = !request
    ? "The stored trip could not be read."
    : !quote
      ? "Waiting for the itinerary to price…"
      : !validUntil || validUntil < today
        ? "Choose a quote validity date that is today or later."
        : priced!.totalInr <= 0
          ? "The total must be more than zero."
          : adjustments.depositInr != null && adjustments.depositInr >= priced!.totalInr
            ? "The deposit must be less than the total."
            : adjustments.lines.some((l) => !l.label.trim())
              ? "Give every extra line a description."
              : null;

  const body = useCallback(() => {
    if (!request || !quote) return null;
    return { request, quotation: slimQuotation(quote), adjustments, validUntil, note };
  }, [request, quote, adjustments, validUntil, note]);

  const saveDraft = useCallback(async () => {
    const payload = body();
    if (!payload) return;
    setBusy(true);
    setMessage(null);
    const res = await adminSaveDraft(detail.id, payload);
    setBusy(false);
    if (res.ok) {
      setDirty(false);
      setSavedAt(res.data.savedAt);
      setMessage({ tone: "ok", text: "Draft saved. The traveller can't see it yet." });
    } else {
      setMessage({ tone: "error", text: res.error });
    }
  }, [body, detail.id]);

  const send = async () => {
    const payload = body();
    if (!payload) return;
    setBusy(true);
    setMessage(null);
    const res = await adminSendTripQuote(detail.id, payload);
    setBusy(false);
    setConfirmSend(false);
    if (res.ok) {
      setDirty(false);
      setMessage({ tone: "ok", text: `Quote v${res.data.version} sent to ${detail.contact.email}.` });
      onSent();
    } else {
      setMessage({ tone: "error", text: res.error });
    }
  };

  // Keep the page's summary and buttons in step with the editor.
  useEffect(() => {
    onSummary({
      engineTotalInr: quote?.totals.total ?? null,
      totalInr: priced?.totalInr ?? null,
      dueNowInr: priced?.dueNowInr ?? null,
      dirty,
      savedAt,
      problem,
    });
  }, [quote, priced?.totalInr, priced?.dueNowInr, dirty, savedAt, problem, onSummary]);

  useEffect(() => {
    actionsRef.current = { saveDraft, requestSend: () => setConfirmSend(true), busy };
  });

  // Browsers show their own generic prompt; the text is ignored but the flag is required.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!request) {
    return <p className="rounded-xl border p-4 text-sm" style={{ borderColor: "#ff8a80" }}>The stored trip couldn&apos;t be read, so it can&apos;t be edited here. The original is in the request snapshot.</p>;
  }
  if (error) return <p style={{ color: "var(--muted)" }}>{error}</p>;
  if (!core) return <p style={{ color: "var(--muted)" }}>Loading the atlas…</p>;

  const originalEstimate = detail.estimateInr;
  const moved = quote ? quote.totals.total - originalEstimate : 0;
  const publicPreview = quote
    ? buildPublicQuote(quote, adjustments, { validUntil: new Date(`${validUntil}T23:59:59+05:30`).toISOString(), note: note.trim() || null })
    : null;

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className="rounded-xl border p-3 text-sm" style={{ borderColor: message.tone === "error" ? "#ff8a80" : "#7bd88f" }}>
          {message.text}
        </p>
      )}

      {quote && Math.abs(moved) > 1 && (
        <p className="rounded-xl border p-3 text-sm" style={{ borderColor: "var(--hairline)", color: "var(--muted)" }}>
          The traveller saw <span className="tabular-nums" style={{ color: "var(--text)" }}>{formatInr(originalEstimate)}</span>; the engine now prices this trip at{" "}
          <span className="tabular-nums" style={{ color: "var(--text)" }}>{formatInr(quote.totals.total)}</span> ({moved > 0 ? "+" : "−"}
          {formatInr(Math.abs(moved))}) — rates or your edits have moved it.
        </p>
      )}

      <Section title="1 · Trip details" hint="Party, dates, hotel class, transport, meals — anything the traveller chose">
        <DecisionMatrix core={core} value={request} onChange={editRequest} adopt />
      </Section>

      <Section title="2 · Destinations" hint="Add or remove places">
        <WorldMapPicker core={core} selected={request.placeIds} onChange={setPlaces} />
      </Section>

      <Section title="3 · Itinerary, inclusions & optional items" hint="Switch flights/visa/insurance, choose sightseeing, adjust nights and transport" open>
        {quote ? (
          <QuotationView quote={quote} request={request} onChange={editRequest} destinationSummary={destinationSummary} mode="admin" />
        ) : (
          <p style={{ color: "var(--muted)" }}>Pricing the itinerary…</p>
        )}
      </Section>

      <Section title="4 · Pricing & terms" hint="Fixed price, discounts, optional extras, deposit, validity" open>
        <PricingPanel
          engineTotalInr={quote?.totals.total ?? 0}
          adjustments={adjustments}
          onChange={editAdjustments}
          validUntil={validUntil}
          onValidUntilChange={(v) => {
            setValidUntil(v);
            setDirty(true);
          }}
          note={note}
          onNoteChange={(v) => {
            setNote(v);
            setDirty(true);
          }}
        />
      </Section>

      <Section title="5 · Preview as the traveller will see it" hint="Exactly what the quote page will show">
        {publicPreview ? <QuoteOffer quote={publicPreview} selected={[]} version={undefined} /> : <p style={{ color: "var(--muted)" }}>Nothing to preview yet.</p>}
      </Section>

      {confirmSend && priced && (
        <div role="dialog" aria-modal="true" aria-label="Send quote" className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <button type="button" aria-label="Cancel" onClick={() => setConfirmSend(false)} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-md rounded-3xl border border-white/10 p-6 shadow-2xl" style={{ background: "linear-gradient(160deg, rgba(14,36,42,0.98), rgba(9,24,28,0.96))" }}>
            <h2 className="font-display text-2xl">Send this quote?</h2>
            <dl className="mt-4 flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--muted)" }}>To</dt>
                <dd>{detail.contact.email}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--muted)" }}>Total</dt>
                <dd className="tabular-nums" style={{ color: "var(--accent)" }}>{formatInr(priced.totalInr)}</dd>
              </div>
              {priced.dueNowInr < priced.totalInr && (
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Due to confirm</dt>
                  <dd className="tabular-nums">{formatInr(priced.dueNowInr)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--muted)" }}>Open until</dt>
                <dd>{validUntil}</dd>
              </div>
            </dl>
            {detail.status === "accepted" && (
              <p className="mt-4 rounded-xl border p-3 text-xs" style={{ borderColor: "#ffb74d", color: "#ffb74d" }}>
                The traveller has already accepted the previous quote. Sending this clears that acceptance and they will need to accept again.
              </p>
            )}
            <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
              They get an email with a link to review and accept. Earlier versions stay on record.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={send} disabled={busy} className={primaryBtn} style={{ background: "var(--accent)", color: onAccent }}>
                {busy ? "Sending…" : "Send to traveller"}
              </button>
              <button type="button" onClick={() => setConfirmSend(false)} className={ghostBtn} style={{ borderColor: "var(--hairline)" }}>
                Not yet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function isEditable(status: RequestStatus): boolean {
  return !["part_paid", "paid", "cancelled", "closed"].includes(status);
}
