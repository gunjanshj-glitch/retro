/**
 * The lifecycle of a trip quotation request, shared by the backend Worker
 * (which enforces it) and the UI (which explains it).
 *
 *   pending ──► in_review ──► quoted ──► accepted ──► part_paid ──► paid
 *                  ▲             │  ▲         │
 *                  │             ▼  │         └─ admin may re-open to revise
 *                  └── changes_requested
 *
 * plus the exits: declined (traveller), expired (validity lapsed),
 * cancelled (traveller withdrew) and closed (agency closed it).
 *
 * Keep this file free of imports so it can be bundled into the Worker as well
 * as the browser.
 */

export const REQUEST_STATUSES = [
  "pending",
  "in_review",
  "quoted",
  "changes_requested",
  "accepted",
  "part_paid",
  "paid",
  "declined",
  "expired",
  "cancelled",
  "closed",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export function isRequestStatus(value: string): value is RequestStatus {
  return (REQUEST_STATUSES as readonly string[]).includes(value);
}

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  pending: ["in_review", "quoted", "cancelled", "closed"],
  in_review: ["quoted", "cancelled", "closed"],
  quoted: ["quoted", "accepted", "changes_requested", "declined", "expired", "cancelled", "closed"],
  changes_requested: ["in_review", "quoted", "cancelled", "closed"],
  // An accepted quote can still be revised by the agency until money moves.
  accepted: ["quoted", "part_paid", "paid", "cancelled", "closed"],
  part_paid: ["paid", "closed"],
  paid: [],
  declined: ["quoted"],
  expired: ["quoted", "closed"],
  cancelled: [],
  closed: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses in which the agency can still edit and send a (new) quote. */
export function isQuotable(status: RequestStatus): boolean {
  return canTransition(status, "quoted");
}

/** Terminal states — nothing further happens on the request. */
export function isFinished(status: RequestStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Statuses in which the agency owes the next move. */
export const AGENCY_TURN: readonly RequestStatus[] = ["pending", "in_review", "changes_requested", "expired"];
/** Statuses in which the traveller owes the next move. */
export const TRAVELLER_TURN: readonly RequestStatus[] = ["quoted", "accepted", "part_paid"];

export type StatusCopy = {
  /** Short badge text. */
  label: string;
  /** One sentence, addressed to the traveller, saying what is happening and what is next. */
  traveller: string;
  /** Badge tone. */
  tone: "neutral" | "progress" | "action" | "success" | "danger";
};

export const STATUS_COPY: Record<RequestStatus, StatusCopy> = {
  pending: {
    label: "Request received",
    traveller: "We have your request. A travel expert will pick it up shortly and may contact you to confirm details.",
    tone: "progress",
  },
  in_review: {
    label: "Being prepared",
    traveller: "A travel expert is checking every rate and preparing your final quote. We will email you the moment it is ready.",
    tone: "progress",
  },
  quoted: {
    label: "Final quote ready",
    traveller: "Your final quote is ready. Review it, choose any optional extras, then accept it to pay — or ask us for changes.",
    tone: "action",
  },
  changes_requested: {
    label: "Revision requested",
    traveller: "You asked for changes. We are updating your quote and will email you the revised version.",
    tone: "progress",
  },
  accepted: {
    label: "Awaiting payment",
    traveller: "You have accepted the quote. Complete the payment to confirm your booking.",
    tone: "action",
  },
  part_paid: {
    label: "Balance due",
    traveller: "We have received your first payment. Pay the balance to complete your booking.",
    tone: "action",
  },
  paid: {
    label: "Booking confirmed",
    traveller: "Payment received — your booking is confirmed. Our team will be in touch with the next steps.",
    tone: "success",
  },
  declined: {
    label: "Declined",
    traveller: "You declined this quote. You can start a new plan any time.",
    tone: "neutral",
  },
  expired: {
    label: "Quote expired",
    traveller: "This quote passed its validity date. Message us and we will refresh it for you.",
    tone: "danger",
  },
  cancelled: {
    label: "Withdrawn",
    traveller: "You withdrew this request.",
    tone: "neutral",
  },
  closed: {
    label: "Closed",
    traveller: "This request has been closed by our team.",
    tone: "neutral",
  },
};

export function statusLabel(status: string): string {
  return isRequestStatus(status) ? STATUS_COPY[status].label : status;
}

/** The five visible stages of the happy path, in order. */
export const PROGRESS_STEPS = [
  { key: "sent", label: "Request sent" },
  { key: "review", label: "Being prepared" },
  { key: "quote", label: "Final quote" },
  { key: "pay", label: "Payment" },
  { key: "confirmed", label: "Confirmed" },
] as const;

/**
 * Which of `PROGRESS_STEPS` is current for a status (0-based), or -1 for an
 * exit state that is not on the happy path.
 */
export function progressIndex(status: RequestStatus): number {
  switch (status) {
    case "pending":
      return 0;
    case "in_review":
    case "changes_requested":
      return 1;
    case "quoted":
      return 2;
    case "accepted":
    case "part_paid":
      return 3;
    case "paid":
      return 4;
    default:
      return -1;
  }
}

/** How long a sent quote stays valid when the agency does not choose a date. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 7;

export const EVENT_TYPES = [
  "submitted",
  "review_started",
  "quote_sent",
  "changes_requested",
  "accepted",
  "declined",
  "withdrawn",
  "payment_started",
  "payment_received",
  "payment_failed",
  "expired",
  "closed",
  "note",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type RequestEvent = {
  id: string;
  createdAt: string;
  actor: "traveller" | "agency" | "system";
  type: EventType;
  /** One public-safe sentence. Internal notes are never sent to travellers. */
  summary: string;
  /** Only present in admin responses. */
  internal?: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

/** Phone is optional; when given it must look like a real number. */
export function normalisePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\+?[\d\s\-().]{7,22}$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return trimmed.replace(/\s+/g, " ");
}
