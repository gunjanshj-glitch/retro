"use client";

/**
 * Loads the compiled catalogue and prices a `QuoteRequest` with the engine,
 * entirely in the browser — the planner and the admin quote editor share it so
 * both see exactly the same numbers for the same request.
 *
 * Pricing happens in two passes: the compiled rate card prices the trip (which
 * fixes stays, nights and rooms), those are searched for live hotel rates, and
 * the trip is priced again with whatever came back.
 */
import { useEffect, useMemo, useState } from "react";
import { loadCore, loadDestinations, loadHotelLiveRates, loadRoutes, loadVisaRules } from "./client";
import { generateQuotation } from "./engine";
import type { LiveRate } from "./engine/pricing";
import type { CoreBundle, DestinationBundle, Route, VisaRule } from "./schema";
import type { Quotation, QuoteRequest } from "./engine/types";

export type QuotationEngine = {
  core: CoreBundle | null;
  quote: Quotation | null;
  /** Set when the catalogue itself could not be loaded. */
  error: string | null;
};

/** `enabled` lets a caller (the planner) defer pricing until it is needed. */
export function useQuotation(request: QuoteRequest, enabled = true): QuotationEngine {
  const [core, setCore] = useState<CoreBundle | null>(null);
  const [routes, setRoutes] = useState<Route[] | null>(null);
  const [visaRules, setVisaRules] = useState<VisaRule[] | null>(null);
  // Bundles accumulate as places are added, and `slugs` records which have
  // arrived. Pricing before they do would silently price the trip without its
  // sightseeing, hotels and transfers — a plausible-looking but low number — so
  // `quote` stays null until every requested place is loaded. Removing a place
  // needs nothing new, so it re-prices at once.
  const [loaded, setLoaded] = useState<{ slugs: ReadonlySet<string>; bundles: Map<string, DestinationBundle> }>({
    slugs: new Set(),
    bundles: new Map(),
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadCore(), loadRoutes(), loadVisaRules()])
      .then(([c, r, v]) => {
        setCore(c);
        setRoutes(r);
        setVisaRules(v);
      })
      .catch(() => setError("Could not load the destination catalogue. Please refresh."));
  }, []);

  // Fetch content only for the places actually chosen.
  const slugs = useMemo(
    () =>
      core
        ? request.placeIds.map((id) => core.places.find((p) => p.id === id)?.slug).filter((slug): slug is string => Boolean(slug))
        : [],
    [core, request.placeIds],
  );
  const slugsKey = slugs.join(",");

  useEffect(() => {
    if (!slugs.length) return;
    let cancelled = false;
    loadDestinations(slugs).then((bundles) => {
      if (cancelled) return;
      setLoaded((prev) => ({ slugs: new Set([...prev.slugs, ...slugs]), bundles: new Map([...prev.bundles, ...bundles]) }));
    });
    return () => {
      cancelled = true;
    };
    // slugsKey stands for slugs: reload only when the set of places changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugsKey]);

  const bundles = loaded.bundles;
  const bundlesReady = slugs.every((slug) => loaded.slugs.has(slug));

  const [live, setLive] = useState<{ key: string; rates: Map<string, LiveRate> } | null>(null);

  const baseQuote: Quotation | null = useMemo(() => {
    if (!enabled || !core || !routes || !visaRules || !request.placeIds.length || !bundlesReady) return null;
    try {
      return generateQuotation(request, { core, routes, visaRules, bundles });
    } catch {
      return null;
    }
  }, [core, routes, visaRules, bundles, bundlesReady, request, enabled]);

  // Everything the hotel search depends on. Live prices never feed back into it
  // (stays and rooms do not move with price), so the second pass cannot loop.
  const hotelSearchKey = baseQuote
    ? JSON.stringify([
        baseQuote.stays.map((s) => [s.placeId, s.nights, s.position]),
        request.startDate, request.hotelStar, request.adults, request.childAges, baseQuote.pax.rooms,
      ])
    : null;

  useEffect(() => {
    if (!core || !baseQuote || !hotelSearchKey) return;
    let cancelled = false;
    loadHotelLiveRates(core, baseQuote).then((rates) => {
      if (!cancelled) setLive({ key: hotelSearchKey, rates });
    });
    return () => {
      cancelled = true;
    };
    // baseQuote is represented by hotelSearchKey: only a change to what is
    // searched should trigger a new search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, hotelSearchKey]);

  // Rates found for a different search are ignored rather than cleared.
  const liveRates = live && live.key === hotelSearchKey ? live.rates : null;

  const quote: Quotation | null = useMemo(() => {
    if (!baseQuote || !core || !routes || !visaRules) return baseQuote;
    if (!liveRates?.size) return baseQuote;
    try {
      return generateQuotation(request, { core, routes, visaRules, bundles, liveRates });
    } catch {
      return baseQuote;
    }
  }, [baseQuote, liveRates, core, routes, visaRules, bundles, request]);

  return { core, quote, error };
}
