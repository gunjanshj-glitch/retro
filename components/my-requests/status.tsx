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
} from "@retro/core/quote-workflow";
import { onAccent } from "@/components/plan/theme";

const TONE_STYLE: Record<StatusCopy["tone"], { color: string; border: string; background: string }> = {
  neutral: { color: "var(--ink-2)", border: "var(--line)", background: "var(--surface)" },
  progress: { color: "#1d5a85", border: "#cfe3f1", background: "var(--sea-2)" },
  action: { color: "var(--accent)", border: "color-mix(in srgb, var(--accent) 28%, transparent)", background: "var(--coral-soft)" },
  success: { color: "var(--success)", border: "color-mix(in srgb, var(--success) 25%, transparent)", background: "var(--success-soft)" },
  danger: { color: "var(--danger)", border: "color-mix(in srgb, var(--danger) 25%, transparent)", background: "var(--danger-soft)" },
};

export function StatusBadge({ status }: { status: string }) {
  const copy = isRequestStatus(status) ? STATUS_COPY[status] : { label: status, tone: "neutral" as const };
  const tone = TONE_STYLE[copy.tone];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide"
      style={{ color: tone.color, borderColor: tone.border, background: tone.background }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
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
      <div className="rounded-2xl border p-4 text-sm" style={{ ...borderOf(copy.tone), color: "var(--ink)" }}>
        <p className="font-bold" style={{ color: TONE_STYLE[copy.tone].color }}>{copy.label}</p>
        <p className="mt-1" style={{ color: "var(--ink-2)" }}>
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
              style={{ background: done ? "var(--ink)" : active ? "var(--sun)" : "var(--line)" }}
            />
            <span
              className="flex items-center gap-1.5 text-[11px] leading-tight sm:text-xs"
              style={{ color: active || done ? "var(--ink)" : "var(--muted)", fontWeight: active ? 700 : done ? 600 : 500 }}
            >
              <span
                aria-hidden="true"
                className="hidden h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold sm:flex"
                style={
                  done
                    ? { background: "var(--ink)", color: "#fff" }
                    : active
                      ? { background: "var(--sun)", color: onAccent }
                      : { border: "1.5px solid var(--line-strong)" }
                }
              >
                {done ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                    <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
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
          {i < all.length - 1 && <span aria-hidden="true" className="absolute left-[5px] top-4 h-full w-px" style={{ background: "var(--line)" }} />}
          <span
            aria-hidden="true"
            className="relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full"
            style={{
              background: e.internal ? "var(--card)" : "var(--sun)",
              border: e.internal ? "1.5px dashed var(--ink-2)" : "2px solid var(--sun-deep)",
            }}
          />
          <div className="min-w-0 text-sm">
            <p style={{ color: e.internal ? "var(--ink-2)" : "var(--ink)" }}>
              {e.internal && (
                <span
                  className="mr-1.5 rounded border px-1 py-px text-[10px] font-bold uppercase tracking-wide"
                  style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink-2)" }}
                >
                  Internal
                </span>
              )}
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
