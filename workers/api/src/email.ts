/**
 * Outgoing mail for a final-approval request.
 *
 * Sent via MailChannels' Workers integration, which needs no API key for
 * Workers sending through Cloudflare — only an SPF record on the sending
 * domain authorising MailChannels (see
 * https://developers.cloudflare.com/email-routing/mailchannels/). That DNS
 * record is an infrastructure step outside this codebase; until it is in
 * place, sends will fail and the caller falls back to recording the request
 * without one (see requests.ts) rather than losing it.
 */
import type { Env } from "./http";

const MAILCHANNELS_ENDPOINT = "https://api.mailchannels.net/tx/v1/send";
const DEFAULT_REVIEW_INBOX = "info@retroholidays.in";
const DEFAULT_FROM = "no-reply@retroholidays.in";

export type ReviewEmailInput = {
  requestId: string;
  userName: string;
  userEmail: string;
  destinationSummary: string;
  nights: number;
  startDate: string;
  totalInr: number;
  perPersonInr: number;
  /** The full immutable snapshot — request, quotation, and user — as pretty JSON. */
  snapshotJson: string;
};

function toBase64(text: string): string {
  // btoa is UTF-16-unsafe; route through a byte array so the JSON's ₹ signs
  // and traveller-entered names survive intact.
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function formatInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

/** Best-effort: returns whether the send succeeded. Never throws — a mail
 *  provider outage must never cost the traveller their submitted request. */
export async function sendReviewEmail(env: Env, input: ReviewEmailInput): Promise<boolean> {
  const to = env.REVIEW_INBOX || DEFAULT_REVIEW_INBOX;
  const from = env.MAIL_FROM || DEFAULT_FROM;

  const subject = `Final quotation request — ${input.destinationSummary} (${formatInr(input.totalInr)})`;
  const text = [
    `A traveller has asked for a final, human-checked quotation.`,
    ``,
    `Request ID: ${input.requestId}`,
    `Traveller: ${input.userName} <${input.userEmail}>`,
    `Destinations: ${input.destinationSummary}`,
    `Nights: ${input.nights}`,
    `Start date: ${input.startDate}`,
    `Quoted total: ${formatInr(input.totalInr)} (${formatInr(input.perPersonInr)} per person)`,
    ``,
    `The complete itinerary, every optional add-on, and the flight/visa/insurance`,
    `figures as shown to the traveller are attached as JSON — review it, then`,
    `reply directly to ${input.userEmail} with the confirmed, final quotation.`,
  ].join("\n");

  const html = text
    .split("\n")
    .map((line) => (line ? `<p style="margin:0 0 8px">${escapeHtml(line)}</p>` : "<br/>"))
    .join("\n");

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: "Retro Holidays — Website" },
    reply_to: { email: input.userEmail, name: input.userName },
    subject,
    content: [
      { type: "text/plain", value: text },
      { type: "text/html", value: html },
    ],
    attachments: [
      {
        content: toBase64(input.snapshotJson),
        filename: `quotation-request-${input.requestId}.json`,
        type: "application/json",
      },
    ],
  };

  return deliver(env, payload);
}

/** Posts one message to MailChannels; `MAILCHANNELS_API_KEY` is sent when set
 *  (the keyless Workers integration has been withdrawn for new accounts). */
async function deliver(env: Env, payload: unknown): Promise<boolean> {
  try {
    const res = await fetch(MAILCHANNELS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.MAILCHANNELS_API_KEY ? { "X-Api-Key": env.MAILCHANNELS_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("Mail send rejected", res.status);
    return res.ok;
  } catch (error) {
    console.error("Mail send failed", error);
    return false;
  }
}

export type PackageRequestEmailInput = {
  requestId: string;
  userName: string;
  userEmail: string;
  destinationName: string;
  packageName: string;
  tripType: string;
  adults: number;
  children: number;
  startDate: string | null;
  departureCity: string;
  hotelStar: string;
  food: string;
  includeFlights: boolean;
  notes: string | null;
};

/** Tells the agency inbox a package quote request has arrived. Best-effort. */
export async function sendPackageRequestEmail(env: Env, input: PackageRequestEmailInput): Promise<boolean> {
  const to = env.REVIEW_INBOX || DEFAULT_REVIEW_INBOX;
  const from = env.MAIL_FROM || DEFAULT_FROM;
  const site = env.PUBLIC_SITE_URL || "https://retroholidays.in";

  const text = [
    `New package quote request.`,
    ``,
    `Package: ${input.packageName} (${input.destinationName})`,
    `Traveller: ${input.userName} <${input.userEmail}>`,
    `Trip type: ${input.tripType}`,
    `Travellers: ${input.adults} adult(s), ${input.children} child(ren)`,
    `Travel date: ${input.startDate ?? "not decided"}`,
    `Departing from: ${input.departureCity}`,
    `Hotel: ${input.hotelStar} · Food: ${input.food} · Flights: ${input.includeFlights ? "yes" : "no"}`,
    `Notes: ${input.notes ?? "—"}`,
    ``,
    `Request ID: ${input.requestId}`,
    `Reply with a quote at ${site}/admin`,
  ].join("\n");

  const html = text
    .split("\n")
    .map((line) => (line ? `<p style="margin:0 0 8px">${escapeHtml(line)}</p>` : "<br/>"))
    .join("\n");

  return deliver(env, {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: "Retro Holidays — Website" },
    reply_to: { email: input.userEmail, name: input.userName },
    subject: `Quote request — ${input.packageName} (${input.adults + input.children} travellers)`,
    content: [
      { type: "text/plain", value: text },
      { type: "text/html", value: html },
    ],
  });
}

/** Sends the one-hour password-set/reset link. Best-effort, never throws. */
export async function sendPasswordResetEmail(env: Env, to: string, link: string): Promise<boolean> {
  const from = env.MAIL_FROM || DEFAULT_FROM;
  const text = [
    `Someone asked to set or reset the password for ${to} on Retro Holidays.`,
    ``,
    `Choose a new password (link valid for 1 hour, works once):`,
    link,
    ``,
    `If this wasn't you, ignore this email — your password stays as it is.`,
  ].join("\n");
  const html =
    `<p style="margin:0 0 12px">Someone asked to set or reset the password for ${escapeHtml(to)} on Retro Holidays.</p>` +
    `<p style="margin:0 0 12px"><a href="${escapeHtml(link)}">Choose a new password</a> (valid for 1 hour, works once).</p>` +
    `<p style="margin:0">If this wasn't you, ignore this email — your password stays as it is.</p>`;
  return deliver(env, {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: "Retro Holidays" },
    subject: "Reset your Retro Holidays password",
    content: [
      { type: "text/plain", value: text },
      { type: "text/html", value: html },
    ],
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
