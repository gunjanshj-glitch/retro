import { useEffect, useRef, useState } from "react";
import type { DestinationBundle } from "@retro/core/atlas/schema";
import type { Quotation, QuoteRequest } from "@retro/core/atlas/engine/types";
import { useCatalogueState } from "@/features/catalogue/CatalogueProvider";
import { getEngine, openCatalogue, type Catalogue } from "@/features/catalogue/data";

export type QuoteState = { quote: Quotation | null; pending: boolean; error: string | null; catalogue: Catalogue | null; ms: number | null };

/** Prices the draft on the phone, debounced so dragging a stepper never blocks the UI. The last good quote stays on screen (dimmed by `pending`) until the new one lands. */
export function useQuote(request: QuoteRequest, enabled = true): QuoteState {
  const { local } = useCatalogueState();
  const [state, setState] = useState<QuoteState>({ quote: null, pending: false, error: null, catalogue: null, ms: null });
  const seq = useRef(0);
  const key = JSON.stringify(request);

  useEffect(() => {
    if (!local) return;
    let catalogue: Catalogue;
    try { catalogue = openCatalogue(local); } catch { setState((s) => ({ ...s, error: "The saved destinations look damaged. Reopen the app to refresh them." })); return; }
    if (!enabled || !request.placeIds.length) { setState((s) => ({ ...s, catalogue, quote: null, pending: false, error: null })); return; }
    const id = ++seq.current;
    setState((s) => ({ ...s, catalogue, pending: true, error: null }));
    const t = setTimeout(() => {
      try {
        const t0 = Date.now();
        const engine = getEngine(local);
        const slugs = request.placeIds.map((p) => catalogue.core.places.find((x) => x.id === p)?.slug).filter((s): s is string => !!s);
        const bundles = new Map<string, DestinationBundle>();
        for (const slug of slugs) {
          const b = catalogue.destination(slug);
          if (b) bundles.set(b.place.id, b);
        }
        const quote = engine.generateQuotation(request, { core: catalogue.core, routes: catalogue.routes, visaRules: catalogue.visaRules, bundles });
        if (id === seq.current) setState({ quote, pending: false, error: null, catalogue, ms: Date.now() - t0 });
      } catch (e) {
        if (id === seq.current) setState((s) => ({ ...s, pending: false, error: e instanceof Error ? e.message : "Could not price this trip" }));
      }
    }, 250);
    return () => clearTimeout(t);
    // The request is compared by value (key), not identity, so unrelated re-renders do not re-price.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, key, enabled]);

  return state;
}
