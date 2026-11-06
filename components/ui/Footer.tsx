"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { whatsappLink } from "@retro/core/contact";

const POLICY_LINKS = [
  { href: "/terms", short: "Terms" },
  { href: "/payment-policy", short: "Payments" },
  { href: "/cancellation-policy", short: "Cancellation" },
  { href: "/refund-policy", short: "Refunds" },
  { href: "/privacy", short: "Privacy" },
];

const FOOTER_LINKS = [
  { href: "/destinations", label: "Destinations" },
  { href: "/plan", label: "Plan your trip" },
  { href: "/contact", label: "Contact" },
];

export function Footer() {
  const pathname = usePathname();
  const isPlanPage = pathname === "/plan";

  return (
    <footer className="border-t border-[var(--hairline)] bg-[var(--surface)]">
      <div className="mx-auto max-w-[1320px] px-5 py-12 md:px-8 md:py-16">
        <div
          className="flex flex-col gap-7 rounded-[28px] p-8 sm:p-12 lg:flex-row lg:items-center lg:justify-between"
          style={{ background: "radial-gradient(120% 140% at 0% 0%, #fff3c4 0%, var(--sun) 45%, #ff9a3c 100%)", color: "var(--on-sun)" }}
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em]">Your next story starts here</p>
            <h2 className="mt-3 max-w-2xl font-display text-4xl leading-[1.05] sm:text-5xl">
              Have a place in mind? Let&apos;s make it unforgettable.
            </h2>
          </div>
          {isPlanPage ? (
            <span
              aria-disabled="true"
              className="inline-flex min-h-12 w-fit shrink-0 cursor-not-allowed items-center gap-3 rounded-full px-7 py-3 font-bold opacity-50"
              style={{ background: "var(--ink)", color: "#fff" }}
            >
              Plan your trip
              <span aria-hidden="true">→</span>
            </span>
          ) : (
            <Link
              href="/plan"
              className="inline-flex min-h-12 w-fit shrink-0 items-center gap-3 rounded-full px-7 py-3 font-bold transition hover:-translate-y-0.5"
              style={{ background: "var(--ink)", color: "#fff", boxShadow: "var(--shadow-lg)" }}
            >
              Plan your trip
              <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>

        <div className="grid gap-10 py-10 sm:grid-cols-2 lg:grid-cols-[1.35fr_0.65fr_1fr_1fr] lg:gap-8">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" aria-label="Retro Holidays — home" className="inline-flex">
              <Image
                src="/brand/logo-ink.png"
                alt="Retro Holidays"
                width={640}
                height={209}
                className="h-12 w-auto object-contain"
              />
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-6 text-[var(--muted)]">
              Thoughtful, tailor-made holidays shaped around your pace, your interests, and the
              stories you want to bring home.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)]">
              Explore
            </h3>
            <nav className="mt-5 flex flex-col items-start gap-3 text-sm text-[var(--muted)]">
              {FOOTER_LINKS.map((link) =>
                link.href === "/plan" && isPlanPage ? (
                  <span key={link.href} aria-disabled="true" className="cursor-not-allowed opacity-50">
                    {link.label}
                  </span>
                ) : (
                  <Link key={link.href} href={link.href} className="transition hover:text-[var(--accent)]">
                    {link.label}
                  </Link>
                ),
              )}
            </nav>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)]">
              Talk to us
            </h3>
            <div className="mt-5 flex flex-col items-start gap-3 text-sm text-[var(--muted)]">
              <a href="tel:+919804786498" className="transition hover:text-[var(--accent)]">
                +91 98047 86498
              </a>
              <a
                href="mailto:info@retroholidays.in"
                className="break-all transition hover:text-[var(--accent)]"
              >
                info@retroholidays.in
              </a>
              <a
                href={whatsappLink()}
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-[var(--accent)]"
              >
                WhatsApp us ↗
              </a>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)]">
              Visit
            </h3>
            <address className="mt-5 max-w-xs text-sm not-italic leading-6 text-[var(--muted)]">
              16 Raipur Road, Lotus Park,
              <br />
              Sree Colony, Regent Estate,
              <br />
              Kolkata, West Bengal 700047
            </address>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--hairline)] pt-6 text-xs text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} Retro Holidays. All rights reserved.
            <span aria-hidden="true" className="mx-2 text-[var(--line-strong)]">•</span>
            <Link href="/privacy" className="transition hover:text-[var(--accent)]">Privacy</Link>
            <span aria-hidden="true" className="mx-2 text-[var(--line-strong)]">•</span>
            <Link href="/data-deletion" className="transition hover:text-[var(--accent)]">Data deletion</Link>
            {POLICY_LINKS.filter((l) => l.href !== "/privacy").map((l) => (
              <span key={l.href}>
                <span aria-hidden="true" className="mx-2 text-[var(--line-strong)]">•</span>
                <Link href={l.href} className="transition hover:text-[var(--accent)]">{l.short}</Link>
              </span>
            ))}
          </p>
          <p>
            Kolkata, India <span aria-hidden="true" className="mx-2 text-[var(--line-strong)]">•</span> {process.env.NEXT_PUBLIC_GOOGLE_RATING ?? "4.9"} ★ from{" "}
            {process.env.NEXT_PUBLIC_GOOGLE_REVIEW_COUNT ?? "77"} Google reviews
          </p>
        </div>
      </div>
    </footer>
  );
}
