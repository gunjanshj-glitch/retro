import type { Metadata } from "next";
import { NavBar } from "@/components/ui/NavBar";
import { Footer } from "@/components/ui/Footer";
import { MyRequestsList } from "@/components/my-requests/MyRequestsList";

export const metadata: Metadata = {
  title: "My requests — Retro Holidays",
  description: "Track the quotes you've requested and the answers we've sent back.",
};

export default function MyRequestsPage() {
  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-4xl p-6 pt-28 md:p-12 md:pt-36">
        <p className="text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: "var(--accent)" }}>
          Your account
        </p>
        <h1 className="mt-3 font-display text-4xl md:text-5xl">My requests</h1>
        <p className="mt-3 max-w-xl text-base" style={{ color: "var(--muted)" }}>
          Every quote you&apos;ve requested from us, and the price we sent back once it&apos;s ready.
        </p>
        <div className="mt-10">
          <MyRequestsList />
        </div>
      </main>
      <Footer />
    </>
  );
}
