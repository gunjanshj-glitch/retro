/**
 * Step 1 of every launch: ask the backend "what revision is current?" and compare with the phone's copy.
 * Same revision: carry on instantly. Different: download only what changed, behind a waiting screen.
 * No connection: use the copy the phone already has. First launch with no connection: say so and retry.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { planSync } from "@retro/core/catalogue";
import { fetchRemoteManifest, readLocal, syncTo, type Local, type Progress } from "./storage";

type State =
  | { phase: "checking" }
  | { phase: "syncing"; progress: Progress; firstTime: boolean }
  | { phase: "ready"; local: Local; stale: boolean }
  | { phase: "failed"; reason: string };

type Value = { state: State; retry: () => void; local: Local | null };
const Ctx = createContext<Value | null>(null);

export function CatalogueProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: "checking" });
  const run = useRef(0);

  const start = useCallback(async () => {
    const id = ++run.current;
    const alive = () => id === run.current;
    const local = readLocal();
    setState({ phase: "checking" });
    try {
      const remote = await fetchRemoteManifest();
      const plan = planSync(remote, local?.manifest ?? null);
      if (plan.upToDate && local) {
        if (alive()) setState({ phase: "ready", local, stale: false });
        return;
      }
      if (alive()) setState({ phase: "syncing", firstTime: !local, progress: { files: 0, filesTotal: plan.download.length, bytes: 0, bytesTotal: plan.downloadBytes } });
      const next = await syncTo(remote, local, (progress) => {
        if (alive()) setState((s) => (s.phase === "syncing" ? { ...s, progress } : s));
      });
      if (alive()) setState({ phase: "ready", local: next, stale: false });
    } catch (error) {
      if (!alive()) return;
      // Whatever the phone already holds beats a blocked app.
      if (local) setState({ phase: "ready", local, stale: true });
      else setState({ phase: "failed", reason: error instanceof Error ? error.message : "Could not reach the server" });
    }
  }, []);

  useEffect(() => { void start(); }, [start]);
  const value = useMemo<Value>(() => ({ state, retry: () => void start(), local: state.phase === "ready" ? state.local : null }), [state, start]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCatalogueState(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCatalogueState outside CatalogueProvider");
  return v;
}
