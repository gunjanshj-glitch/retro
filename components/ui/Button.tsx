"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode, MouseEventHandler } from "react";

type ButtonProps = {
  children: ReactNode;
  href?: string;
  onClick?: MouseEventHandler;
  variant?: "primary" | "ghost";
  size?: "md" | "sm";
};

export function Button({ children, href, onClick, variant = "primary", size = "md" }: ButtonProps) {
  const pathname = usePathname();
  // A button linking to the page you're already on (e.g. "Plan your trip"
  // while already inside /plan) has nothing to do, which reads as broken
  // rather than inert — disable it instead of letting it silently no-op.
  const isCurrentPage = !!href && pathname === href;

  const style =
    variant === "primary"
      ? { background: "var(--sun)", color: "var(--on-sun)" }
      : { background: "var(--card)", color: "var(--text)", border: "1.5px solid var(--line-strong)" };

  const className =
    "inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full font-bold transition-[transform,box-shadow,filter] hover:-translate-y-px hover:brightness-[0.97]" +
    (variant === "primary" ? " shadow-[0_6px_18px_rgba(242,169,0,0.32)]" : "") +
    (size === "sm" ? " min-h-10 px-4 py-2 text-sm" : " px-6 py-3");

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
