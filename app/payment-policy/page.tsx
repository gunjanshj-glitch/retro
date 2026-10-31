import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { PolicyFooter } from "@/components/legal/PolicyFooter";

export const metadata: Metadata = {
  title: "Payment Policy | Retro Holidays",
  description: "Booking advance, balance payment, payment modes and receipts at Retro Holidays.",
  alternates: { canonical: "/payment-policy" },
};

export default function PaymentPolicyPage() {
  return (
    <LegalPage title="Payment Policy" updated="31 October 2026">
      <h2>1. Booking advance</h2>
      <p>
        40% of the land package cost, together with the full cost of flight tickets (if booked through the Company), is
        payable at the time of booking to confirm it.
      </p>

      <h2>2. Balance payment</h2>
      <p>The remaining 60% of the land package cost must be received:</p>
      <ul>
        <li>At least 15 days before departure for international tours; and</li>
        <li>At least 7 days before departure for domestic tours.</li>
      </ul>

      <h2>3. Late bookings</h2>
      <p>
        If a booking is made within the balance-payment window, 100% of the package cost is payable at the time of
        booking.
      </p>

      <h2>4. Non-payment</h2>
      <p>
        If the balance is not received by the due date, the Company may treat the booking as cancelled by the Guest and
        apply the <Link href="/cancellation-policy">Cancellation Policy</Link>.
      </p>

      <h2>5. Services start only after payment</h2>
      <p>
        The Company&apos;s obligations begin only after the required payment has been received in full for that stage.
        Vouchers and tickets are issued after full payment.
      </p>

      <h2>6. Modes of payment</h2>
      <p>
        Bank transfer (NEFT/RTGS/IMPS), UPI, cheque, or card/payment link, as notified by the Company. Payments should
        be made only to the Company&apos;s official accounts shown on the invoice. Bank/gateway charges, if any, are
        borne by the Guest.
      </p>

      <h2>7. Taxes</h2>
      <p>
        Prices are inclusive or exclusive of GST and other applicable taxes as stated on the quotation. TCS and other
        statutory levies will be collected as per law.
      </p>

      <h2>8. Foreign currency</h2>
      <p>
        For international components, the Company may require payment in INR at the exchange rate on the date of
        payment, or may request an additional amount if the rate changes materially before the final payment.
      </p>

      <h2>9. Receipts</h2>
      <p>A payment receipt or invoice is issued for every payment received.</p>

      <p>
        Refunds are covered in the <Link href="/refund-policy">Claims &amp; Refund Policy</Link>. These payment terms
        form part of our <Link href="/terms">Terms &amp; Conditions</Link>.
      </p>

      <PolicyFooter current="/payment-policy" />
    </LegalPage>
  );
}
