"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode, MouseEventHandler } from "react";

type ButtonProps = {
  children: ReactNode;
  href?: string;
  onClick?: MouseEventHandler;
  variant?: "primary" | "ghost";
};

export function Button({ children, href, onClick, variant = "primary" }: ButtonProps) {
  const pathname = usePathname();
  // A button linking to the page you're already on (e.g. "Plan your trip"
  // while already inside /plan) has nothing to do, which reads as broken
  // rather than inert — disable it instead of letting it silently no-op.
  const isCurrentPage = !!href && pathname === href;

  const style =
    variant === "primary"
      ? { background: "var(--accent)", color: "var(--deep)" }
      : { background: "transparent", color: "var(--text)", border: "1px solid var(--hairline)" };

  const className = "inline-flex items-center gap-2 rounded-full px-6 py-3 font-medium transition-transform hover:scale-[1.02]";

  if (isCurrentPage) {
    return (
      <span
        aria-disabled="true"
        className={`${className} cursor-not-allowed opacity-50 hover:scale-100`}
        style={style}
      >
        {children}
      </span>
    );
  }

  if (href) {
    return (
      <Link href={href} className={className} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <button onClick={onClick} className={className} style={style}>
      {children}
    </button>
  );
}
