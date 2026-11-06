"use client";

/**
 * The planner flow: choose where, choose how, see the quote.
 *
 * All three steps run client-side against the compiled bundles, so the
 * quotation recomputes instantly as the traveller adjusts anything and the site
 * stays a pure static export.
 */
import { useCallback, useMemo, useState } from "react";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { WorldMapPicker } from "./WorldMapPicker";
import { DecisionMatrix } from "./DecisionMatrix";
import { QuotationView } from "./QuotationView";
import { ExplorePicker } from "./ExplorePicker";
import { PackageBrowseRail } from "./PackageBrowseRail";
import { btnGhost, btnPrimary, cardClass } from "./theme";
import { useQuotation } from "@/lib/atlas/use-quotation";
import { STYLE_FOR_TRAVELLER } from "@retro/core/atlas/engine";
import type { QuoteRequest } from "@retro/core/atlas/engine/types";

type Step = "mode" | "where" | "options" | "quote";
type Mode = "known" | "explore";

function defaultRequest(): QuoteRequest {
  const start = new Date();
  start.setDate(start.getDate() + 45);
  return {
    placeIds: [],
    nights: 6,
    startDate: start.toISOString().slice(0, 10),
    adults: 2,
    childAges: [],
    travellerType: "couple",
    tripStyle: STYLE_FOR_TRAVELLER.couple,
    nationality: "IND",
    departureCity: "DEL",
    hotelStar: "4 Star",
    hotelZone: "Central",
    carrier: "FSC",
    cabin: "Economy",
    mealPlan: "breakfast",
    food: "no-preference",
    pace: "balanced",
    includeVisa: true,
    includeInsurance: false,
    includeFlight: false,
    // No interests stated yet: the destinations' own decision rules that turn
    // on one stay undecided rather than being guessed at.
    interests: [],
    firstTimeVisitor: true,
    transportPreference: "balanced",
    legModes: {},
    excludedActivityCodes: [],
    excludedClusterIds: [],
    excludedLineKeys: [],
    lineOverrides: {},
    customLines: [],
    sightseeingMode: "auto",
    addedActivityCodes: [],
    pinnedClusterIds: [],
    nightOverrides: {},
  };
}

export function PlannerWizard() {
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<Mode>("known");
  const [request, setRequest] = useState<QuoteRequest>(defaultRequest);

  const { core, quote, error } = useQuotation(request, step === "quote");

  // Human-readable place list for a final-approval request's subject/summary
  // line only — the engine and the stored snapshot both deal exclusively in
  // place ids, so this is derived fresh rather than threaded through state.
  const destinationSummary = useMemo(() => {
    if (!core) return "";
    return request.placeIds
      .map((id) => core.places.find((p) => p.id === id)?.name)
      .filter((name): name is string => Boolean(name))
      .join(", ");
  }, [core, request.placeIds]);

  const setPlaces = useCallback((placeIds: string[] | ((current: string[]) => string[])) => {
    // Changing the destinations invalidates any per-place night override, and
    // any transport mode the traveller had pinned to a leg that may no longer
    // exist. Resolved against the live state rather than a captured array so a
    // fast burst of map clicks can't overwrite one another.
    setRequest((r) => ({
      ...r,
      placeIds: typeof placeIds === "function" ? placeIds(r.placeIds) : placeIds,
      nightOverrides: {},
      legModes: {},
    }));
  }, []);

  if (error) {
    return (
      <GlassPanel className="p-6">
        <p role="alert" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      </GlassPanel>
    );
  }

  if (!core) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3" role="status" style={{ color: "var(--muted)" }}>
        <Spinner />
        Loading the atlas…
      </div>
    );
  }

  const canContinue = request.placeIds.length > 0;

  return (
    <div className="flex flex-col gap-8">
      {step !== "mode" && <Progress step={step} />}

      {step === "mode" && (
        <section className="flex flex-col gap-10">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="eyebrow">Plan your trip</p>
              <h1 className="font-display text-4xl md:text-5xl">Where shall we take you?</h1>
              <p className="max-w-xl text-base" style={{ color: "var(--muted)" }}>
                Start from the map if you already have places in mind, or let us suggest destinations that suit
                the trip you are after.
              </p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <ModeCard
                icon={<MapPinIcon />}
                title="I know where I want to go"
                body="Pick your destinations on the map and we will build the itinerary and the price around them."
                onClick={() => {
                  setMode("known");
                  setStep("where");
                }}
              />
              <ModeCard
                icon={<CompassIcon />}
                title="I want to explore"
                body="Tell us the kind of trip you are after and we will suggest destinations that suit it."
                onClick={() => {
                  setMode("explore");
                  setStep("where");
                }}
              />
            </div>
          </div>

          <PackageBrowseRail />
        </section>
      )}

      {step === "where" && (
        <section className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <p className="eyebrow">{mode === "known" ? "Pick on the map" : "Tell us your style"}</p>
              <h1 className="font-display text-3xl md:text-4xl">
                {mode === "known" ? "Choose your destinations" : "Find your trip"}
              </h1>
            </div>
            <span
              className="rounded-full border px-3 py-1 text-sm font-semibold tabular-nums"
              style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink)" }}
              aria-live="polite"
            >
              {request.placeIds.length} selected
            </span>
          </div>

          {mode === "known" ? (
            <WorldMapPicker core={core} selected={request.placeIds} onChange={setPlaces} />
          ) : (
            <ExplorePicker core={core} selected={request.placeIds} onChange={setPlaces} />
          )}

          {request.placeIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {request.placeIds.map((id) => {
                const place = core.places.find((p) => p.id === id);
                if (!place) return null;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPlaces(request.placeIds.filter((x) => x !== id))}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-full border-[1.5px] pl-4 pr-3 text-sm font-semibold transition-colors hover:bg-[var(--sun-deep)]"
                    style={{ background: "var(--sun)", borderColor: "var(--sun-deep)", color: "var(--on-sun)" }}
                    aria-label={`Remove ${place.name}`}
                  >
                    {place.name}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep("mode")}
              className={btnGhost}
            >
              Back
            </button>
            <button
              type="button"
              disabled={!canContinue}
              onClick={() => setStep("options")}
              className={btnPrimary}
            >
              Continue
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      )}

      {step === "options" && (
        <section className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <p className="eyebrow">How you travel</p>
            <h1 className="font-display text-3xl md:text-4xl">Tell us about the trip</h1>
          </div>
          <div className={`${cardClass} p-5 sm:p-7 md:p-8`}>
            <DecisionMatrix core={core} value={request} onChange={setRequest} />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep("where")}
              className={btnGhost}
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep("quote")}
              className={btnPrimary}
            >
              Build my quotation
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      )}

      {step === "quote" &&
        (quote ? (
          <QuotationView
            quote={quote}
            request={request}
            onChange={setRequest}
            onBack={() => setStep("options")}
            destinationSummary={destinationSummary}
          />
        ) : (
          <div className="flex items-center gap-3 py-16" role="status" style={{ color: "var(--muted)" }}>
            <Spinner />
            Building your quotation…
          </div>
        ))}
    </div>
  );
}

function Progress({ step }: { step: Step }) {
  const steps: [Step, string][] = [
    ["where", "Destinations"],
    ["options", "Your trip"],
    ["quote", "Quotation"],
  ];
  const activeIndex = steps.findIndex(([s]) => s === step);
  return (
    <nav aria-label="Planner progress">
      <ol className="flex items-center gap-2 sm:gap-3">
        {steps.map(([s, label], i) => {
          const done = i < activeIndex;
          const current = i === activeIndex;
          return (
            <li
              key={s}
              className="flex min-w-0 items-center gap-2 sm:gap-3"
              aria-current={s === step ? "step" : undefined}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-[1.5px] text-sm font-bold tabular-nums"
                style={
                  current
                    ? { background: "var(--sun)", borderColor: "var(--sun-deep)", color: "var(--on-sun)" }
                    : done
                      ? { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }
                      : { background: "var(--card)", borderColor: "var(--line-strong)", color: "var(--muted)" }
                }
                aria-hidden="true"
              >
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`truncate text-sm font-semibold ${current ? "" : "hidden sm:inline"}`}
                style={{ color: current ? "var(--ink)" : done ? "var(--ink)" : "var(--muted)" }}
              >
                <span className="sr-only">Step {i + 1}: </span>
                {label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
              {i < steps.length - 1 && (
                <span
                  className="h-[2px] w-6 shrink-0 rounded-full sm:w-12"
                  style={{ background: done ? "var(--ink)" : "var(--line-strong)" }}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Spinner() {
  return (
    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="var(--line-strong)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ModeCard({
  icon, title, body, onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="lift group relative flex min-h-56 flex-col justify-end overflow-hidden rounded-3xl border p-6 text-left shadow-[var(--shadow-sm)] hover:border-[var(--sun-deep)] sm:p-8"
      style={{ borderColor: "var(--line)", background: "var(--card)" }}
    >
      {/* Ambient accent glow behind the icon, on hover — purely decorative,
          gives the large empty card body somewhere for the eye to land. */}
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: "color-mix(in srgb, var(--sun) 45%, transparent)" }}
        aria-hidden="true"
      />
      <div
        className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-105"
        style={{ background: "var(--coral-soft)", color: "var(--accent)" }}
        aria-hidden="true"
      >
        {icon}
      </div>
      <h2 className="font-display relative text-2xl sm:text-3xl">{title}</h2>
      <p className="relative mt-2 max-w-sm text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        {body}
      </p>
      <span
        className="relative mt-5 inline-flex w-fit items-center gap-1.5 text-sm font-bold transition-transform duration-300 group-hover:translate-x-1"
        style={{ color: "var(--accent)" }}
      >
        Get started
        <span aria-hidden="true">→</span>
      </span>
    </button>
  );
}

/** A pin dropping onto a map — "I know where I want to go". */
function MapPinIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 21s-6.5-6.19-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.81-6.5 11-6.5 11Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

/** A compass — "I want to explore". */
function CompassIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M15.5 8.5 13 13l-4.5 2.5L11 11l4.5-2.5Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
