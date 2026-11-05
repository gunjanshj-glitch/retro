import type { ReactNode } from "react";
import { Footer } from "@/components/ui/Footer";
import { NavBar } from "@/components/ui/NavBar";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <NavBar />
      <main>
        <header
          className="px-5 pb-12 pt-[120px] md:px-8 md:pb-16 md:pt-[152px]"
          style={{ background: "var(--surface)" }}
        >
          <div className="mx-auto max-w-3xl">
            <p className="eyebrow">Policies</p>
            <h1 className="mt-3 font-display text-4xl leading-[1.05] sm:text-5xl md:text-6xl">{title}</h1>
            <p className="mt-4 text-sm font-medium" style={{ color: "var(--ink-2)" }}>
              Last updated: {updated}
            </p>
          </div>
        </header>
        <div className="px-5 pb-24 pt-12 md:px-8 md:pt-16">
          <div className="mx-auto max-w-3xl space-y-5 text-base leading-[1.75] text-[var(--ink-2)] [&_a]:font-semibold [&_a]:text-[var(--accent)] [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-[var(--ink)] [&_h2]:mt-12 [&_h2]:font-[family-name:var(--font-display)] [&_h2]:tracking-[-0.01em] [&_h2:first-child]:mt-0 [&_h2]:text-2xl [&_h2]:text-[var(--ink)] md:[&_h2]:text-[1.75rem] [&_h3]:mt-8 [&_h3]:font-semibold [&_h3]:text-[var(--ink)] [&_li]:ml-5 [&_li]:pl-1 [&_ol]:space-y-2 [&_ul>li]:list-disc [&_ul]:space-y-2 [&_li::marker]:text-[var(--accent)] [&_strong]:text-[var(--ink)] [&_td]:align-top [&_th]:text-[var(--ink)]">
            {children}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
