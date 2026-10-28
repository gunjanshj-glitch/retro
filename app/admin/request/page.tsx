import type { Metadata } from "next";
import { Suspense } from "react";
import { NavBar } from "@/components/ui/NavBar";
import { Footer } from "@/components/ui/Footer";
import { AdminRequestDetail } from "@/components/admin/AdminRequestDetail";

export const metadata: Metadata = {
  title: "Quote editor — Retro Holidays",
  robots: { index: false, follow: false },
};

export default function AdminRequestPage() {
  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-7xl p-6 pt-28 md:p-10 md:pt-36">
        <Suspense fallback={<p style={{ color: "var(--muted)" }}>Loading…</p>}>
          <AdminRequestDetail />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
