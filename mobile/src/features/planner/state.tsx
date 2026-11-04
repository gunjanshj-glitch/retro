/** The planner's draft: one request shared by every step and by the map screen, saved so killing the app loses nothing. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { QuoteRequest } from "@retro/core/atlas/engine/types";

export type Step = "where" | "trip" | "style" | "quote";
const KEY = "plan-draft-v1";

export function defaultRequest(): QuoteRequest {
  const start = new Date();
  start.setDate(start.getDate() + 45);
  return {
    placeIds: [], nights: 6, startDate: start.toISOString().slice(0, 10),
    adults: 2, childAges: [], travellerType: "couple", tripStyle: "romantic",
    nationality: "IND", departureCity: "DEL", hotelStar: "4 Star", hotelZone: "Central",
    carrier: "FSC", cabin: "Economy", mealPlan: "breakfast", food: "no-preference", pace: "balanced",
    includeVisa: true, includeInsurance: false, includeFlight: false,
    interests: [], firstTimeVisitor: true, transportPreference: "balanced",
    legModes: {}, excludedActivityCodes: [], excludedClusterIds: [], excludedLineKeys: [],
    addedActivityCodes: [], pinnedClusterIds: [], nightOverrides: {},
  } as QuoteRequest;
}

type Value = {
  request: QuoteRequest;
  step: Step;
  setStep: (s: Step) => void;
  patch: (p: Partial<QuoteRequest>) => void;
  setPlaces: (ids: string[] | ((cur: string[]) => string[])) => void;
  reset: () => void;
  restored: boolean;
};
const Ctx = createContext<Value | null>(null);

export function PlannerProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<QuoteRequest>(defaultRequest);
  const [step, setStep] = useState<Step>("where");
  const [restored, setRestored] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    void AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { request?: QuoteRequest; step?: Step };
        // A saved start date in the past would silently price a trip that cannot happen.
        if (saved.request && saved.request.startDate >= new Date().toISOString().slice(0, 10)) setRequest({ ...defaultRequest(), ...saved.request });
        if (saved.step) setStep(saved.step);
      })
      .catch(() => {})
      .finally(() => { loaded.current = true; setRestored(true); });
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => { void AsyncStorage.setItem(KEY, JSON.stringify({ request, step })).catch(() => {}); }, 400);
    return () => clearTimeout(t);
  }, [request, step]);

  const patch = useCallback((p: Partial<QuoteRequest>) => setRequest((r) => ({ ...r, ...p })), []);
  // Changing destinations invalidates per-place night overrides and pinned leg modes (same rule as the web planner).
  const setPlaces = useCallback((ids: string[] | ((cur: string[]) => string[])) => {
    setRequest((r) => ({ ...r, placeIds: typeof ids === "function" ? ids(r.placeIds) : ids, nightOverrides: {}, legModes: {} }));
  }, []);
  const reset = useCallback(() => { setRequest(defaultRequest()); setStep("where"); void AsyncStorage.removeItem(KEY).catch(() => {}); }, []);

  const value = useMemo(() => ({ request, step, setStep, patch, setPlaces, reset, restored }), [request, step, patch, setPlaces, reset, restored]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlanner outside PlannerProvider");
  return v;
}
