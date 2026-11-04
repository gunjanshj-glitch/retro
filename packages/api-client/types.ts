import type { RequestStatus } from "@retro/core/quote-workflow";
import type { PublicQuote } from "@retro/core/quote-pricing";

export type User = { id: string; name: string; email: string; avatarUrl: string | null };

export type RequestSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: RequestStatus;
  /** True when the next move is the traveller's. */
  needsAction: boolean;
  destinationSummary: string;
  nights: number;
  startDate: string;
  totalInr: number;
  perPersonInr: number;
  quotedTotalInr: number | null;
  quoteValidUntil: string | null;
  acceptedTotalInr: number | null;
  paidInr: number | null;
};

export type { RequestEvent } from "@retro/core/quote-workflow";
import type { RequestEvent } from "@retro/core/quote-workflow";

/** Detail responses carry more than the app renders today; the rest stays `unknown` until the contracts package types it. */
export type RequestDetail = {
  id: string;
  status: RequestStatus;
  destinationSummary: string;
  nights: number;
  startDate: string;
  totalInr: number;
  perPersonInr: number;
  contact: { name: string; email: string; phone: string | null; note: string | null };
  events: RequestEvent[];
  quote: { revisionId: string; version: number; sentAt: string; baseTotalInr: number; current: boolean; view: PublicQuote } | null;
  acceptance: { acceptedAt: string; optionIds: string[]; totalInr: number | null } | null;
  payment: PaymentState;
  snapshot?: unknown;
};

export type AppConfig = {
  platform: "ios" | "android";
  minVersion: string;
  latestVersion: string;
  updateRequired: boolean;
  updateAvailable: boolean;
  maintenance: boolean;
  maintenanceMessage: string | null;
  whatsapp: string;
  phone: string;
  flags: Record<string, boolean>;
  catalogueVersion: string | null;
};

export type AdminRequestSummary = RequestSummary & { travellerName?: string; travellerEmail?: string };

export type Enquiry = {
  id: string;
  createdAt: string;
  name: string;
  email: string | null;
  phone: string | null;
  destination: string | null;
  travelWindow: string | null;
  travellers: string | null;
  notes: string | null;
  source: string | null;
};

export type PaymentState = {
  configured: boolean;
  totalInr: number | null;
  paidInr: number;
  balanceInr: number;
  /** What the next payment should be (the deposit first, when one is set). Zero when nothing is due. */
  nextInr: number;
  payments: { id: string; amountInr: number; paidAt: string | null; method: string | null; kind: string }[];
};

export type PackageRequestPayload = {
  destinationSlug: string;
  packageSlug: string;
  destinationName: string;
  packageName: string;
  tripType: "family" | "couple" | "friends" | "stags" | "business" | "pilgrimage" | "solo";
  adults: number;
  children?: number;
  startDate?: string | null;
  departureCity?: string | null;
  hotelStar: "3 Star" | "4 Star" | "5 Star" | "Luxury 5 Star";
  food: "no-preference" | "veg" | "non-veg" | "vegan" | "jain" | "halal";
  includeFlights?: boolean;
  notes?: string | null;
};

export type PackageRequestSummary = {
  id: string;
  createdAt: string;
  status: string;
  destinationName: string;
  destinationSlug: string;
  packageName: string;
  packageSlug: string;
  tripType: string;
  adults: number;
  children: number;
  startDate: string | null;
  quote: { amountInr: number; note: string | null; quotedAt: string } | null;
};
