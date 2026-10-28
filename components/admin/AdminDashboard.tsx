"use client";

/**
 * The /admin landing: trip quote requests (the planner → final quote → payment
 * flow) and package quote requests (priced by hand from a package page).
 * The APIs only answer admins, so anyone else sees "not available".
 */
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { onAccent } from "@/components/plan/theme";
import { AdminRequests } from "./AdminRequests";
import { AdminTripRequests } from "./AdminTripRequests";

type Tab = "trips" | "packages";

export function AdminDashboard() {
  const { user, loading, openLogin } = useAuth();
  const [tab, setTab] = useState<Tab>("trips");

  if (loading) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  if (!user) {
    return (
      <button type="button" onClick={openLogin} className="rounded-full px-6 py-2.5 text-sm font-semibold" style={{ background: "var(--accent)", color: onAccent }}>
        Sign in
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div role="tablist" aria-label="Request type" className="flex gap-6 border-b" style={{ borderColor: "var(--hairline)" }}>
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
            className="-mb-px border-b-2 pb-3 text-sm font-medium transition"
            style={{ borderColor: tab === key ? "var(--accent)" : "transparent", color: tab === key ? "var(--text)" : "var(--muted)" }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "trips" ? <AdminTripRequests /> : <AdminRequests />}
    </div>
  );
}
