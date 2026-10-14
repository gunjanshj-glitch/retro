import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Data Deletion | Retro Holidays",
  description: "How to ask Retro Holidays to delete your account and personal data.",
};

export default function DataDeletionPage() {
  return (
    <LegalPage title="User Data Deletion" updated="14 October 2026">
      <p>
        You can ask us to delete your Retro Holidays account and the personal data linked to it at any time. This
        applies to accounts created with email and password and to accounts created with Google or Facebook sign-in.
      </p>

      <h2>How to request deletion</h2>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Email <a href="mailto:info@retroholidays.in?subject=Delete%20my%20data">info@retroholidays.in</a> with the
          subject &ldquo;Delete my data&rdquo;, from the email address registered on your account. If you signed in
          with Facebook or Google, use the email on that profile and tell us which provider you used.
        </li>
        <li>We may ask you to confirm it is you before we proceed.</li>
        <li>We will delete your data within 30 days and confirm by email.</li>
      </ol>

      <h2>What is deleted</h2>
      <ul>
        <li>Your account profile (name, email, profile picture) and sign-in sessions.</li>
        <li>Quotes, enquiries and requests linked to your account.</li>
      </ul>
      <p>
        We may keep limited records where the law requires it, for example for tax or accounting. If you used
        Facebook Login you can also remove Retro Holidays under Facebook Settings &rarr; Security and Login &rarr;
        Apps and Websites, and for Google under your Google Account &rarr; Security &rarr; Third-party access.
      </p>
      <p>
        See our <a href="/privacy">Privacy Policy</a> for how we handle your data. Questions: +91 98047 86498.
      </p>
    </LegalPage>
  );
}
