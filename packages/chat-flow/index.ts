/**
 * The scripted enquiry chat (docs/mobile/04). A flow is plain data; the runner
 * is a pure function over (flow, answers), so web and app render the same
 * conversation and tests need no UI.
 */
export type Step =
  | { id: string; kind: "choice"; ask: string; options: string[]; skippable: boolean }
  | { id: string; kind: "text"; ask: string; placeholder?: string; skippable: boolean; validate?: "name" | "phone" | "email" };

export type Answers = Record<string, string>;

export const FLOW: Step[] = [
  { id: "destination", kind: "choice", ask: "Hi, I'm the Retro Holidays assistant. Where would you like to go?", options: ["India", "Europe", "South-East Asia", "Middle East", "Not sure yet"], skippable: true },
  { id: "when", kind: "choice", ask: "When are you thinking of travelling?", options: ["Next 3 months", "3 to 6 months", "Later", "Just exploring"], skippable: true },
  { id: "who", kind: "choice", ask: "Who's travelling?", options: ["Couple", "Family", "Friends", "Solo", "Pilgrimage"], skippable: true },
  { id: "days", kind: "choice", ask: "How many days?", options: ["3 to 5", "6 to 8", "9 to 12", "13 or more"], skippable: true },
  { id: "budget", kind: "choice", ask: "Rough budget per person?", options: ["Under ₹50k", "₹50k to ₹1.5L", "₹1.5L to ₹3L", "Over ₹3L", "Not sure"], skippable: true },
  { id: "name", kind: "text", ask: "What's your name?", placeholder: "Your name", skippable: false, validate: "name" },
  { id: "phone", kind: "text", ask: "Your mobile number? Retro will contact you on it and we never share it.", placeholder: "10-digit mobile", skippable: false, validate: "phone" },
];

/** Normalises an Indian mobile number to +91XXXXXXXXXX, or an international one to +digits. Null if it is not plausible. */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  const bare = digits.replace(/^\+/, "");
  if (digits.startsWith("+")) return /^\d{8,15}$/.test(bare) ? `+${bare}` : null;
  if (/^[6-9]\d{9}$/.test(bare)) return `+91${bare}`;
  if (/^0[6-9]\d{9}$/.test(bare)) return `+91${bare.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(bare)) return `+${bare}`;
  return null;
}

export function validate(step: Step, value: string): { ok: true; value: string } | { ok: false; error: string } {
  const v = value.trim();
  if (step.kind === "choice") return step.options.includes(v) ? { ok: true, value: v } : { ok: false, error: "Please pick one of the options." };
  if (step.validate === "name") return v.length >= 2 && v.length <= 120 ? { ok: true, value: v } : { ok: false, error: "Please enter your name." };
  if (step.validate === "phone") {
    const p = normalisePhone(v);
    return p ? { ok: true, value: p } : { ok: false, error: "Please enter a valid mobile number." };
  }
  return v ? { ok: true, value: v } : { ok: false, error: "Required." };
}

/** The next unanswered step, or null when the conversation is complete. `skipped` ids are passed over. */
export function nextStep(answers: Answers, skipped: ReadonlySet<string> = new Set()): Step | null {
  return FLOW.find((s) => !(s.id in answers) && !skipped.has(s.id)) ?? null;
}

export function progress(answers: Answers, skipped: ReadonlySet<string> = new Set()): { done: number; total: number } {
  return { done: FLOW.filter((s) => s.id in answers || skipped.has(s.id)).length, total: FLOW.length };
}

export type Enquiry = {
  source: "app-chat" | "web-chat";
  name: string;
  phone: string;
  destination?: string;
  travelWindow?: string;
  travellers?: string;
  notes?: string;
};

/** The lead the Worker stores. Name and phone are mandatory because staff need one way to call back. */
export function toEnquiry(answers: Answers, source: Enquiry["source"]): Enquiry | null {
  const name = answers.name?.trim();
  const phone = answers.phone ? normalisePhone(answers.phone) : null;
  if (!name || !phone) return null;
  const notes = [answers.days && `Days: ${answers.days}`, answers.budget && `Budget per person: ${answers.budget}`].filter(Boolean).join(" · ");
  return { source, name, phone, destination: answers.destination, travelWindow: answers.when, travellers: answers.who, notes: notes || undefined };
}

/** Prefilled WhatsApp text so the agency sees the context without re-asking. */
export function whatsappText(answers: Answers): string {
  const parts = [
    "Hi Retro Holidays, I'd like help planning a trip.",
    answers.destination && `Destination: ${answers.destination}`,
    answers.when && `When: ${answers.when}`,
    answers.who && `Travelling: ${answers.who}`,
    answers.days && `Days: ${answers.days}`,
    answers.budget && `Budget: ${answers.budget}`,
    answers.name && `Name: ${answers.name}`,
  ].filter(Boolean);
  return parts.join("\n");
}

export function whatsappUrl(number: string, answers: Answers): string {
  return `https://wa.me/${number.replace(/\D/g, "")}?text=${encodeURIComponent(whatsappText(answers))}`;
}
