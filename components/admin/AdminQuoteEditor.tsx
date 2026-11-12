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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DecisionMatrix } from "@/components/plan/DecisionMatrix";
import { QuotationView } from "@/components/plan/QuotationView";
import { WorldMapPicker } from "@/components/plan/WorldMapPicker";
import { QuoteOffer } from "@/components/my-requests/QuoteOffer";
import { btnGhost, btnPrimary, cardClass, toneStyle } from "@/components/plan/theme";
import { useQuotation } from "@/lib/atlas/use-quotation";
import { formatInr } from "@retro/core/atlas/engine/text";
import { QuoteRequest } from "@retro/core/atlas/engine/types";
import type { Quotation } from "@retro/core/atlas/engine/types";
import { adminSaveDraft, adminSendTripQuote, type AdminRequestDetail } from "@/lib/auth-client";
import { buildPublicQuote, emptyAdjustments, priceQuote, summariseMargin, type QuoteAdjustments } from "@retro/core/quote-pricing";
import type { RequestStatus } from "@retro/core/quote-workflow";
import { PricingPanel } from "./PricingPanel";
import { MarginPanel } from "./MarginPanel";
import { PriceSplitPanel } from "./PriceSplitPanel";
import { SightseeingPanel } from "./SightseeingPanel";
import { AdminRouteEditor } from "./AdminRouteEditor";

const primaryBtn = btnPrimary;
const ghostBtn = btnGhost;

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
    <details open={open} className={`${cardClass} group overflow-hidden`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-5 transition-colors hover:bg-[var(--surface)] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-display text-xl">{title}</span>
          {hint && (
            <span className="mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>
              {hint}
            </span>
          )}
        </span>
        <svg className="shrink-0 transition-transform group-open:rotate-180" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ color: "var(--ink-2)" }}>
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t p-4 sm:p-6" style={{ borderColor: "var(--line)" }}>
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
  /** What the suppliers charge: the sum of every ticked line, before margin and tax. */
  directCostInr: number | null;
  /** What the agency keeps: total less cost less tax. Negative means a loss. */
  cutInr: number | null;
  /** The cut as a share of cost. */
  cutPct: number | null;
  totalInr: number | null;
  dueNowInr: number | null;
  /** Hand edits in this quote: replaced rates, added charges, switched-off lines. */
  edits: { rates: number; added: number; off: number };
  /** Worth a look but not a reason to stop the send. */
  warning: string | null;
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

  // The request and its undo history live in one state so a change and the step it can be
  // undone to are always recorded together (a bare list of earlier requests: small, plain data).
  const [trip, setTrip] = useState<{ request: QuoteRequest | null; past: QuoteRequest[]; future: QuoteRequest[] }>({ request: initialRequest, past: [], future: [] });
  const request = trip.request;
  const [adjustments, setAdjustments] = useState<QuoteAdjustments>(detail.workingCopy?.adjustments ?? emptyAdjustments());
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const initialValid = detail.workingCopy?.validUntil && detail.workingCopy.validUntil >= today ? detail.workingCopy.validUntil : detail.defaultValidUntil;
  const [validUntil, setValidUntil] = useState(initialValid);
  const [note, setNote] = useState(detail.workingCopy?.note ?? "");

  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // The draft stamp this editor last saw. A colleague saving or sending changes
  // it on the server, which then refuses our write instead of overwriting theirs.
  const baseRef = useRef<string | null>(detail.workingCopy?.updatedAt ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  // Every edit funnels through these so "unsaved changes" is tracked in one place,
  // and so every change to the trip can be undone.
  const editRequest = useCallback((next: QuoteRequest | ((r: QuoteRequest) => QuoteRequest)) => {
    setTrip((t) => {
      if (!t.request) return t;
      const updated = typeof next === "function" ? next(t.request) : next;
      return updated === t.request ? t : { request: updated, past: [...t.past.slice(-49), t.request], future: [] };
    });
    setDirty(true);
  }, []);
  const undo = useCallback(() => {
    setTrip((t) => (t.request && t.past.length ? { request: t.past[t.past.length - 1], past: t.past.slice(0, -1), future: [...t.future, t.request] } : t));
    setDirty(true);
  }, []);
  const redo = useCallback(() => {
    setTrip((t) => (t.request && t.future.length ? { request: t.future[t.future.length - 1], past: [...t.past, t.request], future: t.future.slice(0, -1) } : t));
    setDirty(true);
  }, []);
  const editAdjustments = (next: QuoteAdjustments) => {
    setAdjustments(next);
    setDirty(true);
  };

  const { core, quote, error } = useQuotation(request ?? ({ placeIds: [] } as unknown as QuoteRequest), request != null);

  // Re-pricing after a change (a new destination needs its content first) briefly has no quote.
  // The route editor keeps the last good one on screen rather than unmounting, so what the admin
  // was doing (the message, an open "add a site" list) is not lost mid-edit.
  const [lastQuote, setLastQuote] = useState<Quotation | null>(null);
  if (quote && quote !== lastQuote) setLastQuote(quote);
  const routeQuote = quote ?? lastQuote;

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

  const edits = useMemo(() => {
    if (!quote) return { rates: 0, added: 0, off: 0 };
    return {
      rates: quote.lineItems.concat(quote.excludedLineItems ?? []).filter((i) => i.override).length,
      added: request?.customLines.length ?? 0,
      off: quote.excludedLineItems?.length ?? 0,
    };
  }, [quote, request?.customLines.length]);

  const directCostInr = quote?.totals.directCost ?? null;
  const margin = useMemo(() => (quote ? summariseMargin(quote, adjustments) : null), [quote, adjustments]);
  const cutInr = margin?.cutInr ?? null;
  const cutPct = margin?.cutPct ?? null;
  // Judged after GST: tax is collected for the taxman, so a total that clears the
  // cost but not cost plus tax still loses money.
  const warning =
    priced && directCostInr != null && priced.totalInr > 0 && cutInr != null && cutInr < 0
      ? `After GST this quote is ${formatInr(-cutInr)} below your direct cost of ${formatInr(directCostInr)}. The agency would lose money on it.`
      : null;

  const body = useCallback(() => {
    if (!request || !quote) return null;
    return { request, quotation: slimQuotation(quote), adjustments, validUntil, note, baseUpdatedAt: baseRef.current };
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
      baseRef.current = res.data.savedAt;
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
      directCostInr,
      cutInr,
      cutPct,
      totalInr: priced?.totalInr ?? null,
      dueNowInr: priced?.dueNowInr ?? null,
      edits,
      warning,
      dirty,
      savedAt,
      problem,
    });
  }, [quote, directCostInr, cutInr, cutPct, priced?.totalInr, priced?.dueNowInr, edits, warning, dirty, savedAt, problem, onSummary]);

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
    return <p role="alert" className="rounded-xl border px-4 py-3 text-sm" style={toneStyle.danger}>The stored trip couldn&apos;t be read, so it can&apos;t be edited here. The original is in the request snapshot.</p>;
  }
  if (error) return <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>;
  if (!core) return <p style={{ color: "var(--muted)" }}>Loading the atlas…</p>;

  const originalEstimate = detail.estimateInr;
  const moved = quote ? quote.totals.total - originalEstimate : 0;
  const previousSent = detail.revisions.find((r) => r.status === "sent") ?? null;
  const publicPreview = quote
    ? buildPublicQuote(quote, adjustments, { validUntil: new Date(`${validUntil}T23:59:59+05:30`).toISOString(), note: note.trim() || null })
    : null;

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className="rounded-xl border px-4 py-3 text-sm font-medium" style={message.tone === "error" ? toneStyle.danger : toneStyle.success}>
          {message.text}
        </p>
      )}

      {quote && Math.abs(moved) > 1 && (
        <p className="rounded-xl border px-4 py-3 text-sm" style={toneStyle.warning}>
          The traveller saw <span className="font-bold tabular-nums">{formatInr(originalEstimate)}</span>; the engine now prices this trip at{" "}
          <span className="font-bold tabular-nums">{formatInr(quote.totals.total)}</span> ({moved > 0 ? "+" : "−"}
          {formatInr(Math.abs(moved))}) — rates or your edits have moved it.
        </p>
      )}

      <Section title="1 · Trip details" hint="Party, dates, hotel class, transport, meals — anything the traveller chose">
        <DecisionMatrix core={core} value={request} onChange={editRequest} adopt />
      </Section>

      <Section title="2 · Route & day plan" hint="Reorder stops, set nights, move outings between days, add sites, pick each transfer" open>
        {routeQuote ? (
          <AdminRouteEditor core={core} quote={routeQuote} request={request} onChange={editRequest} history={{ canUndo: trip.past.length > 0, canRedo: trip.future.length > 0, undo, redo }} />
        ) : (
          <p style={{ color: "var(--muted)" }}>Pricing the itinerary…</p>
        )}
      </Section>

      <Section title="3 · Destinations on the map" hint="Pick places on the map (this resets the night split and transport picks)">
        <WorldMapPicker core={core} selected={request.placeIds} onChange={setPlaces} />
      </Section>

      <Section title="4 · Itinerary, inclusions & optional items" hint="Switch flights/visa/insurance, adjust nights and transport" open>
        {quote ? (
          <QuotationView quote={quote} request={request} onChange={editRequest} destinationSummary={destinationSummary} mode="admin" />
        ) : (
          <p style={{ color: "var(--muted)" }}>Pricing the itinerary…</p>
        )}
      </Section>

      <Section title="5 · Sightseeing" hint="Every place at every destination, ticked or not; choose exactly which are in" open>
        {quote ? <SightseeingPanel quote={quote} request={request} onChange={editRequest} /> : <p style={{ color: "var(--muted)" }}>Pricing the itinerary…</p>}
      </Section>

      <Section title="6 · Cost, agency cut & rates" hint="What it costs, what the agency keeps, and every charge behind each category (admin only)" open>
        {quote ? (
          <div className="flex flex-col gap-6">
            <MarginPanel quote={quote} adjustments={adjustments} request={request ?? undefined} onChange={editRequest} />
            <PriceSplitPanel quote={quote} adjustments={adjustments} onChange={editRequest} />
          </div>
        ) : (
          <p style={{ color: "var(--muted)" }}>Pricing the itinerary…</p>
        )}
      </Section>

      <Section title="7 · Pricing & terms" hint="Fixed price, discounts, optional extras, deposit, validity" open>
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

      <Section title="8 · Preview as the traveller will see it" hint="Exactly what the quote page will show">
        {publicPreview ? <QuoteOffer quote={publicPreview} selected={[]} version={undefined} /> : <p style={{ color: "var(--muted)" }}>Nothing to preview yet.</p>}
      </Section>

      {confirmSend && priced && (
        <div role="dialog" aria-modal="true" aria-label="Send quote" className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <button type="button" aria-label="Cancel" onClick={() => setConfirmSend(false)} className="absolute inset-0 backdrop-blur-[2px]" style={{ background: "var(--scrim)" }} />
          <div className="relative w-full max-w-md rounded-3xl border p-6 md:p-7" style={{ background: "var(--card)", borderColor: "var(--line)", boxShadow: "var(--shadow-lg)" }}>
            <h2 className="font-display text-2xl">Send this quote?</h2>
            <dl className="mt-4 flex flex-col gap-2 rounded-2xl p-4 text-sm" style={{ background: "var(--surface)" }}>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--muted)" }}>To</dt>
                <dd className="break-all text-right font-semibold">{detail.contact.email}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt style={{ color: "var(--muted)" }}>Total</dt>
                <dd className="font-display text-xl tabular-nums" style={{ color: "var(--ink)" }}>{formatInr(priced.totalInr)}</dd>
              </div>
              {previousSent && (
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Replaces v{previousSent.version}</dt>
                  <dd className="tabular-nums">
                    {formatInr(previousSent.totalInr)}
                    {priced.totalInr !== previousSent.totalInr && (
                      <span className="ml-1.5 font-semibold" style={{ color: priced.totalInr > previousSent.totalInr ? "var(--warning)" : "var(--success)" }}>
                        ({priced.totalInr > previousSent.totalInr ? "+" : "−"}
                        {formatInr(Math.abs(priced.totalInr - previousSent.totalInr))})
                      </span>
                    )}
                  </dd>
                </div>
              )}
              {margin && (
                <div className="flex justify-between gap-3">
                  <dt style={{ color: "var(--muted)" }}>Cost / agency cut</dt>
                  <dd className="tabular-nums">
                    {formatInr(margin.costInr)} / <span className="font-semibold" style={{ color: margin.cutInr < 0 ? "var(--danger)" : undefined }}>{margin.cutInr < 0 ? "−" : ""}{formatInr(Math.abs(margin.cutInr))}</span>
                    {margin.cutPct != null && <span style={{ color: "var(--muted)" }}> ({(margin.cutPct * 100).toFixed(1)}%)</span>}
                  </dd>
                </div>
              )}
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
            {publicPreview && publicPreview.breakdown.length > 0 && (
              <details className="mt-3 rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: "var(--line)" }}>
                <summary className="cursor-pointer font-semibold">What the traveller will see, by category</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {publicPreview.breakdown.map((row) => (
                    <li key={row.key} className="flex justify-between gap-3">
                      <span style={{ color: "var(--muted)" }}>{row.label}</span>
                      <span className="tabular-nums">{formatInr(row.amountInr)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {(edits.rates > 0 || edits.added > 0 || edits.off > 0 || request.sightseeingMode === "manual") && (
              <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                Hand-edited (internal, the traveller doesn&apos;t see this):{" "}
                {[
                  edits.rates > 0 && `${edits.rates} rate${edits.rates === 1 ? "" : "s"} changed`,
                  edits.added > 0 && `${edits.added} charge${edits.added === 1 ? "" : "s"} added`,
                  edits.off > 0 && `${edits.off} line${edits.off === 1 ? "" : "s"} switched off`,
                  request.sightseeingMode === "manual" && "sightseeing chosen by hand",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                .
              </p>
            )}
            {warning && (
              <p role="alert" className="mt-3 rounded-xl border px-3.5 py-3 text-xs font-semibold" style={toneStyle.danger}>
                {warning}
              </p>
            )}
            {detail.status === "accepted" && (
              <p className="mt-4 rounded-xl border px-3.5 py-3 text-xs font-semibold" style={toneStyle.warning}>
                The traveller has already accepted the previous quote. Sending this clears that acceptance and they will need to accept again.
              </p>
            )}
            <p className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
              They get an email with a link to review and accept. Earlier versions stay on record.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={send} disabled={busy} className={primaryBtn}>
                {busy ? "Sending…" : "Send to traveller"}
              </button>
              <button type="button" onClick={() => setConfirmSend(false)} className={ghostBtn}>
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
