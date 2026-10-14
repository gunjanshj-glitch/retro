import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy | Retro Holidays",
  description: "How Retro Holidays collects, uses and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="14 October 2026">
      <p>
        Retro Holidays (&ldquo;we&rdquo;, &ldquo;us&rdquo;), based at 16 Raipur Road, Lotus Park, Sree Colony,
        Regent Estate, Kolkata, West Bengal 700047, India, operates retroholidays.in. This policy explains what
        personal data we collect, why, and the choices you have, in line with India&apos;s Digital Personal Data
        Protection Act, 2023 and the Information Technology Act, 2000.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your name, email address and a securely hashed password, or, if you sign in with Google or Facebook, your name, email address and profile picture from that provider. We never see your Google or Facebook password.</li>
        <li><strong>Trip enquiries and requests:</strong> the details you submit, such as destinations, travel dates, number of travellers, quotes you save and messages to us, including phone number if you give it.</li>
        <li><strong>Technical data:</strong> a session cookie that keeps you signed in, and basic server logs (IP address, browser, pages requested) used for security and troubleshooting.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To create and secure your account and keep you signed in.</li>
        <li>To prepare quotes and itineraries and reply to your enquiries.</li>
        <li>To run, protect and improve the website.</li>
        <li>To meet legal obligations.</li>
      </ul>
      <p>We do not sell your personal data and we do not use it for advertising.</p>

      <h2>Who processes it for us</h2>
      <p>
        We use trusted service providers to operate the site: Cloudflare (hosting and database), Google and
        Meta/Facebook (only if you choose to sign in with them) and an email delivery service for messages we send
        you. They process data on our behalf and may store it on servers outside India. We may also disclose data
        where required by law.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep account and enquiry data while your account is active and for as long as needed for the purposes
        above or to comply with law. When you ask us to delete your data we remove it, except records we are legally
        required to retain.
      </p>

      <h2>Your rights</h2>
      <p>
        You may ask to access, correct or erase your personal data, withdraw consent, or nominate someone to act for
        you. To delete your data, see our <a href="/data-deletion">data deletion page</a>. For anything else, write
        to <a href="mailto:info@retroholidays.in">info@retroholidays.in</a>. We aim to reply within 30 days. If you
        are not satisfied, you can complain to the Data Protection Board of India.
      </p>

      <h2>Security and children</h2>
      <p>
        Passwords are hashed, sessions use secure cookies and traffic is encrypted over HTTPS. No system is perfectly
        secure, so please use a strong, unique password. The site is not intended for children under 18 and we do not
        knowingly collect their data.
      </p>

      <h2>Grievance contact</h2>
      <p>
        Grievance Officer, Retro Holidays, 16 Raipur Road, Lotus Park, Sree Colony, Regent Estate, Kolkata 700047.
        Email: <a href="mailto:info@retroholidays.in">info@retroholidays.in</a>. Phone: +91 98047 86498.
      </p>

      <h2>Changes</h2>
      <p>We may update this policy; the date above shows the latest version.</p>
    </LegalPage>
  );
}
