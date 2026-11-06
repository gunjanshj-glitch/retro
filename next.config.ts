import type { NextConfig } from "next";
import { fetchGoogleReviews } from "./lib/google-reviews";

// Build-time Google rating/count, inlined as public env vars. They are only the
// first paint: the browser replaces them with live figures from /api/google-reviews
// (lib/live-google-reviews.tsx). Unset when the key is missing or Google fails.
export default async function config(): Promise<NextConfig> {
  const live = await fetchGoogleReviews();
  return {
    output: "export",
    // Workspace packages ship TypeScript source (no build step), so Next compiles them like app code.
    transpilePackages: ["@retro/core"],
    images: { unoptimized: true },
    trailingSlash: false,
    env: live
      ? {
          NEXT_PUBLIC_GOOGLE_RATING: live.rating.toFixed(1),
          NEXT_PUBLIC_GOOGLE_REVIEW_COUNT: String(live.total),
        }
      : {},
  };
}
