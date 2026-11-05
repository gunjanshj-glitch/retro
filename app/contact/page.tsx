import type { Metadata } from "next";
import Image from "next/image";
import { ContactForm } from "@/components/contact/ContactForm";
import { Footer } from "@/components/ui/Footer";
import { NavBar } from "@/components/ui/NavBar";
import { PHONE_DISPLAY, PHONE_E164, WHATSAPP_DISPLAY, whatsappLink } from "@retro/core/contact";

export const metadata: Metadata = {
  title: "Contact | Retro Holidays",
  description: "Speak with Retro Holidays about a thoughtful, tailor-made journey built around how you want to travel.",
};

const CONTACT_DETAILS = [
  {
    label: "Call us",
    value: PHONE_DISPLAY,
    href: `tel:${PHONE_E164}`,
  },
  {
    label: "WhatsApp",
    value: WHATSAPP_DISPLAY,
    href: whatsappLink(),
  },
  {
    label: "Write to us",
    value: "info@retroholidays.in",
    href: "mailto:info@retroholidays.in",
  },
];

export default function ContactPage() {
  return (
    <>
      <NavBar />
      <main className="relative overflow-hidden pt-[112px] sm:pt-[136px]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[40rem]"
          style={{
            background: "linear-gradient(180deg, var(--surface) 0%, var(--surface) 55%, var(--bg) 100%)",
          }}
        />

        <section className="relative mx-auto grid max-w-[1320px] gap-10 px-5 pb-20 md:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:pb-28">
          <div className="flex flex-col">
            <p className="eyebrow">Start a conversation</p>
            <h1 className="mt-4 max-w-xl font-display text-[2.6rem] leading-[1.02] sm:text-6xl lg:text-[4.25rem]">
              A thoughtful trip starts with a good conversation.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-[var(--ink-2)] sm:text-lg">
              Tell us what you have in mind—even if it is only a place, a season, or a feeling. We will help shape the
              details into a journey that feels distinctly yours.
            </p>

            <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 sm:[&>a:last-child]:col-span-2 lg:[&>a:last-child]:col-span-1 xl:[&>a:last-child]:col-span-2">
              {CONTACT_DETAILS.map((detail) => (
                <a
                  key={detail.label}
                  href={detail.href}
                  target={detail.href.startsWith("https") ? "_blank" : undefined}
                  rel={detail.href.startsWith("https") ? "noreferrer" : undefined}
                  className="lift group rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 shadow-[var(--shadow-sm)] hover:border-[var(--accent)]"
                >
                  <span className="block text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-2)]">
                    {detail.label}
                  </span>
                  <span className="mt-2 flex items-center justify-between gap-3 break-all text-[15px] font-semibold text-[var(--ink)] sm:text-base">
                    {detail.value}
                    <span
                      aria-hidden="true"
                      className="text-[var(--accent)] transition-transform group-hover:translate-x-1"
                    >
                      ↗
                    </span>
                  </span>
                </a>
              ))}
            </div>

            <figure className="relative mt-8 min-h-72 overflow-hidden rounded-[28px] shadow-[var(--shadow-lg)] sm:min-h-80">
              <Image
                src="/media/agra/poster.webp"
                alt="Aerial view of the Taj Mahal and its gardens in Agra"
                fill
                sizes="(max-width: 1024px) 100vw, 42vw"
                className="object-cover"
              />
              <div aria-hidden="true" className="card-overlay absolute inset-0" />
              <figcaption className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
                <blockquote className="max-w-md font-display text-2xl leading-tight text-white sm:text-3xl">
                  “The best itineraries leave room for stories you did not plan.”
                </blockquote>
                <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-white/85">
                  Tailor-made by Retro Holidays
                </p>
              </figcaption>
            </figure>
          </div>

          <div className="lg:pt-4">
            <ContactForm />
          </div>
        </section>

        <section className="border-y border-[var(--line)] bg-[var(--surface)]">
          <div className="mx-auto grid max-w-[1320px] gap-px px-5 py-10 sm:grid-cols-3 md:px-8 md:py-14">
            {[
              ["01", "Share the brief", "Your pace, interests, dates and non-negotiables."],
              ["02", "Shape it together", "We refine the route, stays and experiences with you."],
              ["03", "Travel with confidence", "Clear planning and thoughtful support throughout."],
            ].map(([number, title, copy]) => (
              <div key={number} className="border-[var(--line-strong)] py-5 sm:px-6 sm:first:pl-0 sm:not-last:border-r">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--card)] text-xs font-bold text-[var(--accent)] shadow-[var(--shadow-sm)] tabular-nums">
                  {number}
                </span>
                <h2 className="mt-3 font-display text-2xl">{title}</h2>
                <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--ink-2)]">{copy}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
