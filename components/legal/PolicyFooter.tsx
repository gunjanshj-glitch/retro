import Link from "next/link";

export const POLICY_LINKS = [
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/payment-policy", label: "Payment Policy" },
  { href: "/cancellation-policy", label: "Cancellation Policy" },
  { href: "/refund-policy", label: "Claims & Refund Policy" },
  { href: "/privacy", label: "Privacy Policy" },
];

/** Company contact block plus cross-links to the other booking policies. */
export function PolicyFooter({ current }: { current: string }) {
  return (
    <>
      <h2>Related policies</h2>
      <ul>
        {POLICY_LINKS.filter((l) => l.href !== current).map((l) => (
          <li key={l.href}>
            <Link href={l.href}>{l.label}</Link>
          </li>
        ))}
      </ul>
      <h2>Company contact details</h2>
      <p>
        Retro Holidays, 16 Raipur Road, Lotus Park, Sree Colony, Regent Estate, Kolkata, West Bengal 700047
        <br />
        Tel: <a href="tel:+919804786498">+91 98047 86498</a>
        <br />
        WhatsApp: <a href="https://wa.me/916290855027">+91 62908 55027</a>
        <br />
        Email: <a href="mailto:info@retroholidays.in">info@retroholidays.in</a>
        <br />
        Website: <a href="https://www.retroholidays.in">www.retroholidays.in</a>
      </p>
    </>
  );
}
