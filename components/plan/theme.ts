/**
 * Shared presentation tokens for the planner, my-requests and admin screens.
 *
 * Everything here reads from the "Sunlit Atlas" variables in
 * `app/globals.css` (--bg, --surface, --card, --ink, --ink-2, --line,
 * --line-strong, --sun, --on-sun, --accent, status tokens), so the public
 * planner and the admin tools share one look: white cards on a white page,
 * sunshine-yellow filled CTAs and selected chips, coral for accent text and
 * active borders.
 *
 * `colorScheme: "light"` is applied wherever a native control is rendered
 * (`<select>`, `<input type="date">`) because some browsers draw the popup
 * (the options list, the date picker) from `color-scheme` rather than the
 * page's CSS.
 */
import type React from "react";

/** Inline style for a native `<select>` / date input. Pair with `fieldClass`. */
export const selectStyle: React.CSSProperties = {
  borderColor: "var(--line-strong)",
  background: "var(--card)",
  color: "var(--ink)",
  colorScheme: "light",
};

/** Text colour for a chip/button filled with the sunshine CTA colour. */
export const onAccent = "var(--on-sun)";

/** Text inputs, selects and textareas: white, 1.5px strong border, ink focus. */
export const fieldClass =
  "min-h-11 w-full rounded-xl border-[1.5px] border-[var(--line-strong)] bg-[var(--card)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-2)] placeholder:opacity-70 hover:border-[var(--ink-2)] focus:border-[var(--ink)] focus-visible:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--sun)_35%,transparent)] disabled:opacity-60 read-only:bg-[var(--surface)] aria-[invalid=true]:border-[var(--danger)]";

const btnBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold transition-[transform,box-shadow,background-color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0";

/** Filled sunshine CTA — the one primary action on a screen. */
export const btnPrimary = `${btnBase} bg-[var(--sun)] text-[var(--on-sun)] shadow-[0_6px_18px_rgba(242,169,0,0.32)] hover:-translate-y-px hover:bg-[var(--sun-deep)]`;

/** White outlined secondary action. */
export const btnGhost = `${btnBase} border-[1.5px] border-[var(--line-strong)] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--ink)]`;

/** Navy filled action, for a strong secondary next to a yellow primary. */
export const btnInk = `${btnBase} bg-[var(--ink)] text-white hover:-translate-y-px hover:bg-[#13324f]`;

/** Small outlined button used inside dense rows (tables, line items). */
export const btnSmall =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border-[1.5px] border-[var(--line-strong)] bg-[var(--card)] px-3.5 text-xs font-semibold text-[var(--ink)] transition-colors hover:border-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-45";

/** Selectable pill (radio/toggle). Pair with `chipStyle(selected)`. */
export const chipClass =
  "inline-flex min-h-11 items-center rounded-full border-[1.5px] px-4 text-sm font-semibold transition-[background-color,border-color,color] duration-150";

export function chipStyle(selected: boolean): React.CSSProperties {
  return selected
    ? { background: "var(--sun)", borderColor: "var(--sun-deep)", color: "var(--on-sun)" }
    : { background: "var(--card)", borderColor: "var(--line-strong)", color: "var(--ink)" };
}

/** Selectable card (an option tile with more than one line of text). */
export function optionCardStyle(selected: boolean): React.CSSProperties {
  return selected
    ? {
        background: "color-mix(in srgb, var(--sun) 16%, var(--card))",
        borderColor: "var(--sun-deep)",
        boxShadow: "inset 0 0 0 1px var(--sun-deep)",
        color: "var(--ink)",
      }
    : { background: "var(--card)", borderColor: "var(--line)", color: "var(--ink)" };
}

/** White card with hairline border and soft shadow. */
export const cardClass = "rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow-sm)]";

/** Status pill palette, keyed by tone. */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";
export const toneStyle: Record<Tone, React.CSSProperties> = {
  neutral: { background: "var(--surface)", color: "var(--ink-2)", borderColor: "var(--line)" },
  info: { background: "var(--sea-2)", color: "#1d5a85", borderColor: "#cfe3f1" },
  success: { background: "var(--success-soft)", color: "var(--success)", borderColor: "color-mix(in srgb, var(--success) 22%, transparent)" },
  warning: { background: "var(--warning-soft)", color: "var(--warning)", borderColor: "color-mix(in srgb, var(--warning) 22%, transparent)" },
  danger: { background: "var(--danger-soft)", color: "var(--danger)", borderColor: "color-mix(in srgb, var(--danger) 22%, transparent)" },
  accent: { background: "var(--coral-soft)", color: "var(--accent)", borderColor: "color-mix(in srgb, var(--accent) 22%, transparent)" },
};
