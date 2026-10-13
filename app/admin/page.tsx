import type { Metadata } from "next";
import { NavBar } from "@/components/ui/NavBar";
import { Footer } from "@/components/ui/Footer";
import { AdminRequests } from "@/components/admin/AdminRequests";

export const metadata: Metadata = {
  title: "Admin — Retro Holidays",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-5xl p-6 pt-28 md:p-12 md:pt-36">
        <p className="text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: "var(--accent)" }}>
          Admin
        </p>
        <h1 className="mt-3 font-display text-4xl md:text-5xl">Package requests</h1>
        <div className="mt-10">
          <AdminRequests />
        </div>
      </main>
      <Footer />
    </>
  );
}
