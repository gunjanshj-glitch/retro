/**
 * Thin wrapper over gtag.js / the GTM dataLayer. Safe to call anywhere on the
 * client; it no-ops during SSR/prerender or if the tags are blocked.
 *
 * Google Ads conversions: in Google Ads → Goals → Conversions, create a
 * conversion action, then set its label in NEXT_PUBLIC_ADS_LABEL_QUOTE /
 * NEXT_PUBLIC_ADS_LABEL_PAYMENT (the part after the slash in
 * `AW-18370419970/<label>`). Without a label only the GA4 event is sent.
 */

export const GA_ID = "G-MCWS0T7TCG";
export const ADS_ID = "AW-18370419970";

type GtagWindow = Window & {
  gtag?: (...args: unknown[]) => void;
  dataLayer?: unknown[];
};

function gtag(...args: unknown[]) {
  if (typeof window === "undefined") return;
  const w = window as GtagWindow;
  w.dataLayer = w.dataLayer || [];
  // gtag.js requires the `arguments` object, not an array, in the dataLayer.
  (w.gtag ??= function () {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  })(...args);
}

export function trackPageview(path: string) {
  gtag("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}

function adsConversion(label: string | undefined, value?: number, txn?: string) {
  if (!label) return;
  gtag("event", "conversion", {
    send_to: `${ADS_ID}/${label}`,
    ...(value ? { value, currency: "INR" } : {}),
    ...(txn ? { transaction_id: txn } : {}),
  });
}

/** Traveller sent a trip for final quote approval (lead). */
export function trackQuoteRequested(requestId: string, valueInr?: number) {
  gtag("event", "generate_lead", { currency: "INR", value: valueInr ?? 0, transaction_id: requestId });
  // Event name configured in Google Ads for the quote-request conversion.
  gtag("event", "ads_conversion_request_quote", {
    currency: "INR",
    value: valueInr ?? 0,
    transaction_id: requestId,
  });
  adsConversion(process.env.NEXT_PUBLIC_ADS_LABEL_QUOTE, valueInr, requestId);
}

/** Razorpay payment verified for a request. */
export function trackPaymentCompleted(requestId: string, valueInr: number) {
  gtag("event", "purchase", { transaction_id: requestId, currency: "INR", value: valueInr });
  adsConversion(process.env.NEXT_PUBLIC_ADS_LABEL_PAYMENT, valueInr, requestId);
}
