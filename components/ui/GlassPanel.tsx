import type { ReactNode } from "react";

export function GlassPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border ${className}`}
      style={{
        background: "var(--card)",
        borderColor: "var(--hairline)",
        boxShadow: "var(--shadow)",
      }}
    >
      {children}
    </div>
  );
}
