"use client";

/**
 * The "Request a quote" form for one package.
 *
 * The package itself is fixed and read-only at the top — the traveller is
 * only asked for what we can't know: who is going, what kind of trip it is,
 * and a few preferences borrowed from the trip planner. Submitting records a
 * row in D1 for the agency to price by hand; the answer shows up on the
 * traveller's My requests page.
 */
import { fixSpelling } from "@/lib/display-names";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DEPARTURE_CITIES } from "@retro/core/atlas/departure-cities";
import { createPackageRequest } from "@/lib/auth-client";
import { formatPrice } from "@/lib/trips";

export type PackageRequestPackage = {
  destinationSlug: string;
  destinationName: string;
  packageSlug: string;
  packageName: string;
  places: string[];
  days: number | null;
  priceFromInr: number | null;
  includesFlight: boolean;
};

const TRIP_TYPES = [
  { value: "family", label: "Family" },
  { value: "couple", label: "Couple / honeymoon" },
  { value: "friends", label: "Friends" },
  { value: "stags", label: "Group / stag" },
  { value: "business", label: "Business" },
  { value: "pilgrimage", label: "Pilgrimage" },
  { value: "solo", label: "Solo" },
];

const HOTEL_STARS = ["3 Star", "4 Star", "5 Star", "Luxury 5 Star"];

const FOOD = [
  { value: "no-preference", label: "No preference" },
  { value: "veg", label: "Vegetarian" },
  { value: "non-veg", label: "Non-vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "jain", label: "Jain" },
  { value: "halal", label: "Halal" },
];

const inputClass =
  "mt-1.5 w-full min-h-11 rounded-xl border border-[var(--line-strong)] bg-[var(--card)] px-4 py-2.5 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[#6b7c8d] focus:border-[var(--accent)] focus:ring-4 focus:ring-[rgba(198,61,23,0.12)]";

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-sm font-semibold ${className}`} style={{ color: "var(--ink)" }}>
      {label}
      {children}
    </label>
  );
}

export function PackageRequestModal({
  pkg,
  open,
  onClose,
}: {
  pkg: PackageRequestPackage;
  open: boolean;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const firstField = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open) return;
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const data = new FormData(event.currentTarget);
    const result = await createPackageRequest({
      destinationSlug: pkg.destinationSlug,
      destinationName: pkg.destinationName,
      packageSlug: pkg.packageSlug,
      packageName: pkg.packageName,
      package: {
        places: pkg.places,
        days: pkg.days,
        priceFromInr: pkg.priceFromInr,
      },
      tripType: String(data.get("tripType")),
      adults: Number(data.get("adults")),
      children: Number(data.get("children") || 0),
      startDate: String(data.get("startDate") || "") || null,
      departureCity: String(data.get("departureCity")),
      hotelStar: String(data.get("hotelStar")),
      includeFlights: data.get("includeFlights") === "on",
      food: String(data.get("food")),
      notes: String(data.get("notes") ?? ""),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDone(true);
  }

  const today = new Date().toISOString().slice(0, 10);

  // Portalled to <body> so no ancestor stacking context (e.g. the sticky
  // price card that renders the trigger) can trap the dialog under the nav.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Request a quote"
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 backdrop-blur-[2px]"
        style={{ background: "var(--scrim)" }}
      />
      <div
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl border p-6 md:p-8"
        style={{
          background: "var(--card)",
          borderColor: "var(--line)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface)]"
          style={{ color: "var(--ink-2)" }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {done ? (
          <div className="py-6 text-center">
            <p className="eyebrow">Request received</p>
            <h2 className="mt-2 font-display text-2xl">We&apos;re on it</h2>
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Our team will put together a quote for {pkg.packageName} and it will appear on your My requests page.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/my-requests"
                className="inline-flex min-h-11 items-center rounded-full px-6 py-2.5 text-sm font-bold"
                style={{ background: "var(--sun)", color: "var(--on-sun)" }}
              >
                View my requests
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 items-center rounded-full border px-6 py-2.5 text-sm font-semibold transition-colors hover:border-[var(--ink)]"
                style={{
                  borderColor: "var(--line-strong)",
                  color: "var(--ink)",
                  background: "var(--card)",
                }}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <p className="eyebrow">Request a quote</p>
              <h2 className="mt-2 pr-6 font-display text-2xl">{pkg.packageName}</h2>
            </div>

            <div
              className="rounded-2xl border p-4 text-sm"
              style={{
                borderColor: "var(--hairline)",
                background: "var(--surface)",
              }}
            >
              <p className="font-semibold" style={{ color: "var(--ink)" }}>
                {pkg.destinationName}
                {pkg.days ? ` · ${pkg.days} days` : ""}
                {pkg.priceFromInr ? ` · from ${formatPrice(pkg.priceFromInr)} per person` : ""}
              </p>
              <p className="mt-1.5 text-xs" style={{ color: "var(--ink-2)" }}>
                {fixSpelling(pkg.places.join(" · "))}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Type of trip" className="col-span-2">
                <select ref={firstField} name="tripType" defaultValue="family" className={inputClass}>
                  {TRIP_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Adults">
                <input name="adults" type="number" min={1} max={40} defaultValue={2} required className={inputClass} />
              </Field>
              <Field label="Children (under 18)">
                <input name="children" type="number" min={0} max={20} defaultValue={0} className={inputClass} />
              </Field>
              <Field label="Preferred travel date (optional)">
                <input name="startDate" type="date" min={today} className={inputClass} />
              </Field>
              <Field label="Departing from">
                <select name="departureCity" defaultValue="DEL" className={inputClass}>
                  {DEPARTURE_CITIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Hotel category">
                <select name="hotelStar" defaultValue="4 Star" className={inputClass}>
                  {HOTEL_STARS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Food preference">
                <select name="food" defaultValue="no-preference" className={inputClass}>
                  {FOOD.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              <label
                className="col-span-2 flex min-h-11 items-center gap-3 text-sm font-semibold"
                style={{ color: "var(--ink)" }}
              >
                <input
                  name="includeFlights"
                  type="checkbox"
                  defaultChecked={pkg.includesFlight}
                  className="h-5 w-5 accent-[var(--accent)]"
                />
                Include flights in the quote
              </label>
              <Field label="Anything else we should know? (optional)" className="col-span-2">
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={1000}
                  className={inputClass}
                  placeholder="Special occasions, mobility needs, must-see places…"
                />
              </Field>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  color: "var(--danger)",
                  background: "var(--danger-soft)",
                }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="min-h-12 rounded-full px-6 py-3 font-bold shadow-[0_6px_18px_rgba(242,169,0,0.32)] transition hover:brightness-[0.97] disabled:opacity-60"
              style={{ background: "var(--sun)", color: "var(--on-sun)" }}
            >
              {submitting ? "Sending…" : "Send request"}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
