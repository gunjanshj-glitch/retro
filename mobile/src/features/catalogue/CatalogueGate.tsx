import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Empty, Loading, Screen } from "@/ui";
import { useCatalogueState } from "./CatalogueProvider";
import { SyncScreen } from "./SyncScreen";

/** Short updates finish before this and are never shown; longer ones get the waiting screen. */
const SHOW_AFTER_MS = 700;

export function CatalogueGate({ children }: { children: ReactNode }) {
  const { state, retry } = useCatalogueState();
  const [visible, setVisible] = useState(false);
  const [acknowledged, setAcknowledged] = useState(true);
  const sawSync = useRef(false);

  useEffect(() => {
    if (state.phase !== "syncing") return;
    sawSync.current = true;
    setAcknowledged(false);
    const t = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [state.phase]);

  if (state.phase === "failed")
    return (
      <Screen>
        <Empty title="Can't set up yet" body="The first launch needs a connection to download the destinations. Connect to the internet and try again." action={<Button label="Try again" onPress={retry} />} />
      </Screen>
    );

  if (state.phase === "syncing") {
    return visible ? <SyncScreen progress={state.progress} firstTime={state.firstTime} done={false} onContinue={() => {}} /> : <Screen scroll={false}><Loading /></Screen>;
  }

  if (state.phase === "ready" && visible && !acknowledged) {
    return <SyncScreen progress={{ files: 0, filesTotal: 0, bytes: 1, bytesTotal: 1 }} firstTime={false} done onContinue={() => setAcknowledged(true)} />;
  }

  if (state.phase === "checking") return <Screen scroll={false}><Loading /></Screen>;
  return <>{children}</>;
}
