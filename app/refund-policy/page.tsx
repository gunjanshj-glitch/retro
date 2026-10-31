import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { PolicyFooter } from "@/components/legal/PolicyFooter";

export const metadata: Metadata = {
  title: "Claims & Refund Policy | Retro Holidays",
  description: "When refunds are payable, how long they take and how to make a claim with Retro Holidays.",
  alternates: { canonical: "/refund-policy" },
};

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Claims & Refund Policy" updated="31 October 2026">
      <h2>1. Eligibility</h2>
      <p>
        A refund is payable only where it arises from a cancellation or change that qualifies under the{" "}
        <Link href="/cancellation-policy">Cancellation Policy</Link>, a cancellation by the Company, or a supplier
        refund actually received by the Company. The refund amount is the amount paid less cancellation charges,
        supplier charges, non-refundable items, bank/payment gateway fees and the Company&apos;s service fee.
      </p>

      <h2>2. Mode of refund</h2>
      <p>
        Refunds are made by bank transfer to the account of the person who made the payment, or by A/C payee cheque in
        the name of the Guest. Refunds are paid in Indian Rupees. For payments received in foreign currency, the amount
        is converted at the prevailing rate on the date of refund as per Reserve Bank of India rules.
      </p>

      <h2>3. Timeline</h2>
      <p>
        Approved refunds are processed within 15–30 working days after the Company receives written cancellation and
        the supplier refund (if any). Refunds for flights and trains depend on the airline or railway timelines.
      </p>

      <h2>4. No refund</h2>
      <p>No refund is given for:</p>
      <ul>
        <li>Unused services, transport, accommodation, sightseeing or transfers.</li>
        <li>Unconsumed meals included in the package (breakfast, lunch, dinner, tea).</li>
        <li>Voluntary changes or early departure by the Guest.</li>
        <li>No Show or late arrival.</li>
        <li>Non-refundable bookings, tickets and tokens.</li>
        <li>Services lost due to Guest&apos;s delay, illness, visa/immigration refusal or document issues.</li>
      </ul>

      <h2>5. Service-quality complaints</h2>
      <p>
        Complaints about room quality, food, vehicle condition, complimentary services or other on-site services should
        be raised immediately with the hotel or transport operator and the Company&apos;s representative so it can be
        fixed on the spot. Refunds on such grounds are given only where the supplier agrees to a refund, in which case
        the Company will pass on the amount received, less applicable charges. The Company will assist the Guest in
        pursuing the claim.
      </p>

      <h2>6. Extra charges</h2>
      <p>
        Charges billed directly by the hotel or supplier (laundry, telephone, minibar, alcohol, extra food and
        beverages, room heater, fireplace, air-conditioning where charged separately, damage or loss of property, local
        taxes and similar) must be paid by the Guest directly.
      </p>

      <h2>7. Changes after departure</h2>
      <p>
        After departure, services included in the package cannot be changed. If a change is required for reasons beyond
        the Company&apos;s control, comparable services will be arranged. Additional costs are borne by the Guest, and
        any proven saving is refunded to the Guest.
      </p>

      <h2>8. How to make a claim</h2>
      <p>
        Send a written claim to <a href="mailto:info@retroholidays.in">info@retroholidays.in</a> with the booking
        reference, details of the issue, and supporting documents (photos, bills, supplier correspondence), within 7
        days of the end of the tour. The Company will acknowledge the claim within 3 working days and respond with a
        decision within 15 working days.
      </p>

      <h2>9. Disputes</h2>
      <p>
        The Company aims to resolve complaints amicably. Unresolved disputes are governed by Indian law and are subject
        to the exclusive jurisdiction of the courts at Kolkata. See our{" "}
        <Link href="/terms">Terms &amp; Conditions</Link>.
      </p>

      <PolicyFooter current="/refund-policy" />
    </LegalPage>
  );
}
