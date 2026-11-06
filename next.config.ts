import type { NextConfig } from "next";
import { fetchGoogleReviews } from "./lib/google-reviews";

// The footer is a client component shared by every page, so the live Google
// rating/count is resolved once at build time and inlined as public env vars.
// When the key is missing or the request fails these stay unset and the footer
// falls back to its static copy.
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
