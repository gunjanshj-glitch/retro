"use client";

/**
 * The visual language of the quote workflow, shared by the traveller pages and
 * the admin screens: a status badge, the five-stage progress tracker, and the
 * activity timeline. All copy lives in lib/quote-workflow.ts.
 */
import {
  PROGRESS_STEPS,
  progressIndex,
  isRequestStatus,
  STATUS_COPY,
  type RequestEvent,
  type RequestStatus,
  type StatusCopy,
} from "@/lib/quote-workflow";
import { onAccent } from "@/components/plan/theme";

const TONE_STYLE: Record<StatusCopy["tone"], { color: string; border: string; background: string }> = {
  neutral: { color: "var(--muted)", border: "var(--hairline)", background: "transparent" },
  progress: { color: "var(--text)", border: "var(--hairline)", background: "color-mix(in srgb, var(--text) 6%, transparent)" },
  action: { color: "var(--accent)", border: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)" },
  success: { color: "#7bd88f", border: "#7bd88f", background: "color-mix(in srgb, #7bd88f 12%, transparent)" },
  danger: { color: "#ff8a80", border: "#ff8a80", background: "color-mix(in srgb, #ff8a80 10%, transparent)" },
};

export function StatusBadge({ status }: { status: string }) {
  const copy = isRequestStatus(status) ? STATUS_COPY[status] : { label: status, tone: "neutral" as const };
  const tone = TONE_STYLE[copy.tone];
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide"
      style={{ color: tone.color, borderColor: tone.border, background: tone.background }}
    >
      {copy.label}
    </span>
  );
}

/** The happy path as five stages. Exit states (declined, expired, …) are not on
 *  it, so they render a single labelled notice instead of a misleading bar. */
export function ProgressTracker({ status }: { status: RequestStatus }) {
  const current = progressIndex(status);

  if (current === -1) {
    const copy = STATUS_COPY[status];
    return (
      <div className="rounded-2xl border p-4 text-sm" style={{ ...borderOf(copy.tone), color: "var(--text)" }}>
        <p className="font-medium">{copy.label}</p>
        <p className="mt-1" style={{ color: "var(--muted)" }}>
          {copy.traveller}
        </p>
      </div>
    );
  }

  return (
    <ol className="grid grid-cols-5 gap-1.5" aria-label="Progress">
      {PROGRESS_STEPS.map((step, i) => {
        const done = i < current || (status === "paid" && i === current);
        const active = i === current && status !== "paid";
        return (
          <li key={step.key} className="flex flex-col gap-2" aria-current={active ? "step" : undefined}>
            <span
              className="h-1.5 rounded-full"
              style={{ background: done || active ? "var(--accent)" : "var(--hairline)", opacity: active ? 1 : done ? 0.85 : 1 }}
            />
            <span
              className="flex items-center gap-1.5 text-[11px] leading-tight sm:text-xs"
              style={{ color: active ? "var(--text)" : done ? "var(--accent)" : "var(--muted)", fontWeight: active ? 600 : 400 }}
            >
              <span
                aria-hidden="true"
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
                style={done ? { background: "var(--accent)", color: onAccent } : { border: "1px solid currentColor" }}
              >
                {done ? "✓" : i + 1}
              </span>
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function borderOf(tone: StatusCopy["tone"]) {
  const t = TONE_STYLE[tone];
  return { borderColor: t.border, background: t.background };
}

const ACTOR_LABEL: Record<RequestEvent["actor"], string> = { traveller: "You", agency: "Retro Holidays", system: "Update" };

export function Timeline({ events, viewer = "traveller" }: { events: RequestEvent[]; viewer?: "traveller" | "agency" }) {
  if (!events.length) return null;
  const label = (e: RequestEvent) => {
    if (viewer === "agency") return e.actor === "traveller" ? "Traveller" : e.actor === "agency" ? "Agency" : "System";
    return ACTOR_LABEL[e.actor];
  };
  return (
    <ol className="flex flex-col">
      {[...events].reverse().map((e, i, all) => (
        <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
          {i < all.length - 1 && <span aria-hidden="true" className="absolute left-[5px] top-4 h-full w-px" style={{ background: "var(--hairline)" }} />}
          <span
            aria-hidden="true"
            className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full"
            style={{ background: e.internal ? "transparent" : "var(--accent)", border: e.internal ? "1px dashed var(--muted)" : "none" }}
          />
          <div className="min-w-0 text-sm">
            <p style={{ color: e.internal ? "var(--muted)" : "var(--text)" }}>
              {e.internal && <span className="mr-1.5 rounded border px-1 text-[10px] uppercase tracking-wide" style={{ borderColor: "var(--hairline)" }}>Internal</span>}
              {e.summary}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
              {label(e)} · {new Date(e.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" });
}

const IST_OFFSET_MS = 5.5 * 3600_000;
const istDay = (ms: number) => Math.floor((ms + IST_OFFSET_MS) / 86_400_000);

/**
 * Whole calendar days (India time) left on a quote after today: 0 means today
 * is the last day it can be accepted. Null once it has lapsed. A quote is open
 * through the end of its last day, so "valid until the 4th" seen on the 28th
 * has 7 days left, not 8.
 */
export function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (end <= Date.now()) return null;
  return istDay(end) - istDay(Date.now());
}

export function daysLeftLabel(days: number): string {
  return days === 0 ? "last day" : days === 1 ? "1 day left" : `${days} days left`;
}
