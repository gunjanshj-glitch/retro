import type { Metadata } from "next";
import { Suspense } from "react";
import { NavBar } from "@/components/ui/NavBar";
import { Footer } from "@/components/ui/Footer";
import { RequestSummary } from "@/components/my-requests/RequestSummary";

export const metadata: Metadata = {
  title: "Request summary — Retro Holidays",
  description: "A fixed, read-only summary of a quotation request you sent us for review.",
};

export default function MyRequestViewPage() {
  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-3xl p-6 pt-28 md:p-12 md:pt-36">
        <Suspense fallback={<p style={{ color: "var(--muted)" }}>Loading…</p>}>
          <RequestSummary />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
