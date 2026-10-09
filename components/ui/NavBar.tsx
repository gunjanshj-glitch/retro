"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { useAuth } from "@/components/auth/AuthProvider";

const LINKS = [
  { href: "/destinations", label: "Destinations" },
  { href: "/contact", label: "Contact" },
];

export function NavBar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-5 md:px-12 transition-all duration-300"
      style={
        scrolled
          ? {
              background: "rgba(7, 26, 31, 0.94)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
            }
          : {}
      }
    >
      {!scrolled && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-28"
          style={{ background: "linear-gradient(to bottom, rgba(4,14,17,0.72) 0%, rgba(4,14,17,0.32) 45%, rgba(4,14,17,0) 100%)" }}
        />
      )}
      <Link
        href="/"
        aria-label="Retro Holidays — home"
        className="logo-float flex items-center"
      >
        <img
          src="/brand/logo-full.png"
          alt="Retro Holidays"
          width={1000}
          height={258}
          className="logo-glow h-9 w-auto object-contain sm:h-10"
        />
      </Link>

      <nav className="flex items-center gap-3 text-sm" style={{ color: "var(--muted)" }}>
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="hidden rounded-full border-2 border-[var(--accent)] px-4 py-2 text-[var(--accent)] transition-all duration-200 hover:bg-[var(--accent)] hover:text-black sm:block"
          >
            {l.label}
          </Link>
        ))}
        <Button href="/plan">
          Plan your trip
          <span aria-hidden="true">→</span>
        </Button>
        <AccountControl />
      </nav>
    </header>
  );
}

function AccountControl() {
  const { user, loading, openLogin, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuOpen]);

  if (loading) return null;

  if (!user) {
    return (
      <button
        type="button"
        onClick={openLogin}
        className="hidden rounded-full border-2 border-[var(--accent)] px-4 py-2 text-[var(--accent)] transition-all duration-200 hover:bg-[var(--accent)] hover:text-black sm:block"
      >
        Log in
      </button>
    );
  }

  const initial = user.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--accent)] text-sm font-semibold sm:h-10 sm:w-10"
        style={{ color: "var(--accent)" }}
      >
        {initial}
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-48 rounded-2xl border p-2 text-sm shadow-xl"
          style={{ borderColor: "var(--hairline)", background: "rgba(9, 24, 28, 0.97)" }}
        >
          <p className="truncate px-3 py-2 text-xs" style={{ color: "var(--muted)" }}>
            Signed in as <span style={{ color: "var(--text)" }}>{user.name}</span>
          </p>
          <Link
            href="/my-requests"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className="block rounded-xl px-3 py-2 transition hover:bg-white/5"
          >
            My requests
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              void logout();
            }}
            className="block w-full rounded-xl px-3 py-2 text-left transition hover:bg-white/5"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
