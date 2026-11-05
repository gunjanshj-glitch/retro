"use client";

type Props = {
  dir: "left" | "right";
  onClick: () => void;
  disabled: boolean;
  label: string;
};

// Round prev/next button for a horizontally scrolling rail. Always rendered
// (not hidden on small screens) so touch users get swipe AND everyone else
// — mouse/trackpad-only desktop users especially — has a discoverable,
// always-visible way to scroll the rail regardless of viewport size.
export function ScrollArrowButton({ dir, onClick, disabled, label }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all duration-200 hover:border-[var(--ink)]"
      style={{
        background: "var(--card)",
        borderColor: "var(--hairline)",
        color: "var(--text)",
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "default" : "pointer",
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {dir === "left" ? <path d="M15 6l-6 6 6 6" /> : <path d="M9 6l6 6-6 6" />}
      </svg>
    </button>
  );
}
