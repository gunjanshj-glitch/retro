"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { useAuth } from "@/components/auth/AuthProvider";

const LINKS = [
  { href: "/destinations", label: "Destinations" },
  { href: "/contact", label: "Contact" },
];

/** Height of the fixed bar; pages offset their first section by this. */
export const NAV_HEIGHT = 72;

export function NavBar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the phone menu when the route changes (adjusting state during
  // render, as React recommends over an effect) or when Escape is pressed.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) => !!pathname && (pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 transition-shadow duration-300"
      style={{
        background: "rgba(255,255,255,0.88)",
        backdropFilter: "saturate(180%) blur(14px)",
        WebkitBackdropFilter: "saturate(180%) blur(14px)",
        borderBottom: "1px solid var(--line)",
        boxShadow: scrolled ? "var(--shadow-sm)" : "none",
      }}
    >
      <div className="mx-auto flex h-[72px] max-w-[1320px] items-center gap-6 px-5 md:px-8">
        <Link href="/" aria-label="Retro Holidays — home" className="flex shrink-0 items-center">
          <img
            src="/brand/logo-ink.png"
            alt="Retro Holidays"
            width={640}
            height={209}
            loading="eager"
            className="h-10 w-auto sm:h-11"
          />
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-1 text-[15px] font-semibold md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className="rounded-full px-4 py-2.5 transition-colors hover:bg-[var(--surface)]"
              style={{ color: isActive(l.href) ? "var(--accent)" : "var(--ink)" }}
            >
              {l.label}
            </Link>
          ))}
          <AccountControl />
          <span className="ml-2">
            <Button href="/plan">
              Plan your trip
              <span aria-hidden="true">→</span>
            </Button>
          </span>
        </nav>

        <div className="ml-auto flex items-center gap-2 md:hidden">
          <AccountControl compact />
          <Button href="/plan" size="sm">
            Plan trip
          </Button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface)]"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="mobile-menu"
          aria-label="Main"
          className="border-t px-5 pb-6 pt-3 md:hidden"
          style={{ borderColor: "var(--line)", background: "var(--bg)" }}
        >
          <ul className="grid gap-1 text-lg font-semibold">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={isActive(l.href) ? "page" : undefined}
                  className="block rounded-xl px-3 py-3 hover:bg-[var(--surface)]"
                  style={{ color: isActive(l.href) ? "var(--accent)" : "var(--ink)" }}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Button href="/plan">
              Plan your trip
              <span aria-hidden="true">→</span>
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}

function AccountControl({ compact = false }: { compact?: boolean }) {
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
        className={`rounded-full font-semibold transition-colors hover:bg-[var(--surface)] ${compact ? "whitespace-nowrap px-2.5 py-2.5 text-[15px]" : "px-4 py-2.5"}`}
        style={{ color: "var(--ink)" }}
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
        aria-label={`Account menu for ${user.name}`}
        className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
        style={{ background: "var(--sun)", color: "var(--on-sun)" }}
      >
        {initial}
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-52 rounded-2xl border p-2 text-sm"
          style={{ borderColor: "var(--line)", background: "var(--card)", boxShadow: "var(--shadow-lg)" }}
        >
          <p className="truncate px-3 py-2 text-xs" style={{ color: "var(--muted)" }}>
            Signed in as <span style={{ color: "var(--text)" }}>{user.name}</span>
          </p>
          <Link
            href="/my-requests"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            className="block rounded-xl px-3 py-2 transition hover:bg-[var(--surface)]"
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
            className="block w-full rounded-xl px-3 py-2 text-left transition hover:bg-[var(--surface)]"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
