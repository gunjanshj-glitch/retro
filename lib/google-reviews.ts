export type GoogleReview = {
  name: string;
  date: string;
  stars: number;
  text: string;
  initial: string;
};

export type GoogleReviewData = {
  rating: number;
  total: number;
  reviews: GoogleReview[];
};

type PlacesResponse = {
  rating?: number;
  userRatingCount?: number;
  reviews?: {
    rating?: number;
    relativePublishTimeDescription?: string;
    text?: { text?: string };
    originalText?: { text?: string };
    authorAttribution?: { displayName?: string };
  }[];
};

// Server-only. Returns null when the key/place id are not configured or the
// request fails, so callers can fall back to their static content.
export async function fetchGoogleReviews(): Promise<GoogleReviewData | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID ?? "ChIJizsp6p9xAjoRZfxE0TsOFfk";
  if (!key) {
    console.warn("GOOGLE_PLACES_API_KEY is not set; using static reviews");
    return null;
  }

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "rating,userRatingCount,reviews",
      },
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) {
      console.warn(`Google Places request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const data = (await res.json()) as PlacesResponse;
    if (typeof data.rating !== "number") {
      console.warn("Google Places response had no rating:", JSON.stringify(data).slice(0, 300));
      return null;
    }

    const reviews = (data.reviews ?? [])
      .map((r) => {
        const name = r.authorAttribution?.displayName?.trim() ?? "";
        return {
          name,
          date: r.relativePublishTimeDescription ?? "",
          stars: Math.round(r.rating ?? 0),
          text: (r.text?.text ?? r.originalText?.text ?? "").trim(),
          initial: name.charAt(0).toUpperCase() || "G",
        };
      })
      .filter((r) => r.name && r.text);

    return { rating: data.rating, total: data.userRatingCount ?? reviews.length, reviews };
  } catch (err) {
    console.warn("Google Places request errored:", err);
    return null;
  }
}
