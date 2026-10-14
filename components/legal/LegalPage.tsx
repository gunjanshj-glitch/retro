import type { ReactNode } from "react";
import { Footer } from "@/components/ui/Footer";
import { NavBar } from "@/components/ui/NavBar";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-3xl px-6 pt-32 pb-20 sm:pt-36">
        <h1 className="font-display text-4xl sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">Last updated: {updated}</p>
        <div className="mt-10 space-y-5 text-base leading-relaxed text-[var(--muted)] [&_a]:text-[var(--accent)] [&_a]:underline [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-[var(--text)] [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-[var(--text)]">
          {children}
        </div>
      </main>
      <Footer />
    </>
  );
}
