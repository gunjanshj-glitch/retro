"use client";

/**
 * The /admin landing: trip quote requests (the planner → final quote → payment
 * flow) and package quote requests (priced by hand from a package page).
 * The APIs only answer admins, so anyone else sees "not available".
 */
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { btnPrimary } from "@/components/plan/theme";
import { AdminRequests } from "./AdminRequests";
import { AdminTripRequests } from "./AdminTripRequests";

type Tab = "trips" | "packages";

export function AdminDashboard() {
  const { user, loading, openLogin } = useAuth();
  const [tab, setTab] = useState<Tab>("trips");

  if (loading) return <p role="status" style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!user) {
    return (
      <button type="button" onClick={openLogin} className={btnPrimary}>
        Sign in
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div role="tablist" aria-label="Request type" className="no-scrollbar flex gap-6 overflow-x-auto border-b" style={{ borderColor: "var(--line)" }}>
        {(
          [
            ["trips", "Trip requests"],
            ["packages", "Package requests"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            type="button"
            onClick={() => setTab(key)}
            className="-mb-px min-h-11 shrink-0 whitespace-nowrap border-b-[3px] pb-2.5 pt-2 text-sm font-bold transition-colors hover:text-[var(--ink)]"
            style={{ borderColor: tab === key ? "var(--sun)" : "transparent", color: tab === key ? "var(--ink)" : "var(--muted)" }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "trips" ? <AdminTripRequests /> : <AdminRequests />}
    </div>
  );
}
