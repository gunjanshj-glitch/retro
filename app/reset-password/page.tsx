import type { Metadata } from "next";
import { NavBar } from "@/components/ui/NavBar";
import { Footer } from "@/components/ui/Footer";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Set your password — Retro Holidays",
  robots: { index: false, follow: false },
  // The link carries a secret token; never hand it on in a Referer header.
  referrer: "no-referrer",
};

export default function ResetPasswordPage() {
  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-md p-6 pt-28 md:pt-36">
        <p className="text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: "var(--accent)" }}>
          Account
        </p>
        <h1 className="mt-3 font-display text-4xl">Choose a password</h1>
        <div className="mt-8">
          <ResetPasswordForm />
        </div>
      </main>
      <Footer />
    </>
  );
}
