"use client";

import { useEffect, useState } from "react";

type Stats = { rating: number; total: number };

// One request per page load, shared by every component that shows the figures
// (homepage stats, reviews badge, footer).
let inflight: Promise<Stats | null> | null = null;

function loadStats(): Promise<Stats | null> {
  inflight ??= fetch("/api/google-reviews")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) =>
      d &&
      d.available &&
      typeof d.rating === "number" &&
      typeof d.total === "number"
        ? { rating: d.rating, total: d.total }
        : null,
    )
    .catch(() => null);
  return inflight;
}

/** Live Google rating/count from the Worker, starting from the build-time figures. */
export function useGoogleStats(initial: { rating: string; total: number }) {
  const [stats, setStats] = useState<{ rating: string; total: number }>(
    initial,
  );
  useEffect(() => {
    let live = true;
    loadStats().then((s) => {
      if (live && s) setStats({ rating: s.rating.toFixed(1), total: s.total });
    });
    return () => {
      live = false;
    };
  }, []);
  return stats;
}

export const BUILD_RATING = process.env.NEXT_PUBLIC_GOOGLE_RATING ?? "4.9";
export const BUILD_TOTAL = Number(
  process.env.NEXT_PUBLIC_GOOGLE_REVIEW_COUNT ?? "77",
);

type Stats2 = { rating: string; total: number };

// Plain strings, selected by name: a server component cannot hand a function to this client one.
const VARIANTS = {
  stars: (s: Stats2) => `${s.rating}★`,
  count: (s: Stats2) => `${s.total}`,
  sentence: (s: Stats2) => `${s.rating} stars, ${s.total} reviews`,
  badge: (s: Stats2) => `${s.rating} · ${s.total} reviews`,
  footer: (s: Stats2) => `${s.rating} ★ from ${s.total} Google reviews`,
} as const;

export type GoogleStatVariant = keyof typeof VARIANTS;

/** Shows the Google figures in the given form, starting from the build-time values and updating to live ones. */
export function LiveGoogleStats({
  variant,
  initial = { rating: BUILD_RATING, total: BUILD_TOTAL },
}: {
  variant: GoogleStatVariant;
  initial?: { rating: string; total: number };
}) {
  return <>{VARIANTS[variant](useGoogleStats(initial))}</>;
}
