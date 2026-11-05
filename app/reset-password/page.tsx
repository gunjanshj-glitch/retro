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
      <main className="px-5 pb-24 pt-[120px] md:pt-[152px]" style={{ background: "var(--bg)" }}>
        <div
          className="mx-auto w-full max-w-md rounded-3xl border p-7 md:p-9"
          style={{
            background: "var(--card)",
            borderColor: "var(--line)",
            boxShadow: "var(--shadow)",
          }}
        >
          <p className="eyebrow">Account</p>
          <h1 className="mt-3 font-display text-4xl">Choose a password</h1>
          <div className="mt-8">
            <ResetPasswordForm />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
