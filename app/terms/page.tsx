import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { PolicyFooter } from "@/components/legal/PolicyFooter";

export const metadata: Metadata = {
  title: "Terms & Conditions | Retro Holidays",
  description: "The terms that apply when you book a trip with Retro Holidays.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms & Conditions" updated="31 October 2026">
      <h2>1. Definitions</h2>
      <p>
        &ldquo;Company&rdquo; means Retro Holidays, a travel and tourism organisation offering domestic and
        international tours. &ldquo;Guest&rdquo; means the person(s) booking and/or travelling. &ldquo;Third-Party
        Providers&rdquo; means hotels, airlines, railways, cruise and ferry operators, transporters, guides, activity
        operators and other independent suppliers.
      </p>

      <h2>2. Acceptance</h2>
      <p>
        By paying the booking advance, the Guest confirms that they have read and accepted these terms and the{" "}
        <Link href="/payment-policy">Payment</Link>, <Link href="/cancellation-policy">Cancellation</Link> and{" "}
        <Link href="/refund-policy">Refund</Link> policies. The person making the booking accepts them on behalf of
        all travellers named in the booking.
      </p>

      <h2>3. When the contract becomes effective</h2>
      <p>
        The booking is confirmed only when the advance payment under the Payment Policy is received and a written
        confirmation or voucher is issued by the Company. Until the full payment is received, the Company may hold or
        release inventory at its discretion.
      </p>

      <h2>4. Role of the Company</h2>
      <p>
        For hotels, transport and other services, the Company acts as a booking agent and is responsible for
        arranging and confirming the services purchased. The Company is not the owner or operator of Third-Party
        Providers. Their services are governed by their own terms.
      </p>

      <h2>5. Services and itinerary changes</h2>
      <p>
        The Company may amend the itinerary, route, timing, hotel or vehicle where this is unavoidable (for example
        weather, road conditions, strikes, government orders, or supplier unavailability). In that case the Company
        will arrange comparable services of similar standard, and will inform the Guest as early as practicable. Any
        additional cost is borne by the Guest, and any proven saving is refunded.
      </p>

      <h2>6. Accommodation</h2>
      <p>
        Hotel rooms are subject to availability. If the booked hotel or room is unavailable, the Company will provide
        accommodation of similar or better standard. Room category, bedding, meal arrangements and amenities are as per
        the confirmed voucher. Check-in and check-out times are set by the hotel.
      </p>

      <h2>7. Rate changes</h2>
      <p>
        Quoted prices are based on costs (fuel, taxes, surcharges, exchange rates, supplier rates) prevailing on the
        date of the quotation. If these costs change beyond the Company&apos;s control, the Company may revise the
        price. The Guest will be informed in writing, and any additional amount must be paid before the service begins.
      </p>

      <h2>8. Force majeure</h2>
      <p>
        The Company is not liable for delay, change or cancellation caused by events beyond its reasonable control,
        including natural calamities (landslide, flood, earthquake, cyclone), epidemic, war, civil or political
        disturbance, strike, bandh, government or regulatory action, closure of roads or attractions, and airline or
        railway disruption. Extra costs arising from such events (extended stay, re-routing, alternate transport) are
        borne by the Guest. The Company will use reasonable efforts to assist and to recover refunds from suppliers
        where available.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the extent permitted by law, the Company is not liable for death, injury, illness, accident, loss or damage
        to luggage or valuables, or any penalty or consequence arising from the Guest&apos;s own acts, negligence,
        illegal or unsafe conduct, or from the acts or defaults of Third-Party Providers. Nothing in these terms
        excludes liability that cannot be excluded under applicable law, including the Consumer Protection Act, 2019.
        The Company&apos;s total liability for any claim is limited to the amount paid to the Company for the affected
        service.
      </p>

      <h2>10. Guest responsibilities</h2>
      <p>The Guest must:</p>
      <ul>
        <li>Carry valid photo ID.</li>
        <li>Carry a valid passport, visa and permits for international travel (and for restricted-area domestic travel).</li>
        <li>Comply with health, immigration and customs rules.</li>
        <li>Reach reporting points on time.</li>
        <li>Follow local laws, hotel rules and the guidance of guides and drivers.</li>
        <li>Disclose any medical condition, mobility limitation or dietary need at the time of booking.</li>
      </ul>
      <p>Guests are responsible for damage they cause to hotel or vehicle property.</p>

      <h2>11. Travel insurance</h2>
      <p>
        The Company strongly recommends comprehensive travel insurance covering medical emergencies, evacuation, trip
        cancellation/interruption, baggage and personal accident. Insurance is mandatory for international tours and
        for high-altitude and adventure activities.
      </p>

      <h2>12. Adventure and high-risk activities</h2>
      <p>
        Activities such as trekking, water sports, safaris and high-altitude travel carry inherent risk. Participation
        is voluntary and at the Guest&apos;s own risk, and may require a signed indemnity/waiver.
      </p>

      <h2>13. Conduct</h2>
      <p>
        The Company may remove a Guest from a tour without refund for conduct that endangers others, breaks the law, or
        causes serious nuisance.
      </p>

      <h2>14. Cancellation by the Company</h2>
      <p>
        The Company may cancel a tour before departure for reasons such as insufficient group size, safety concerns or
        force majeure. In that case the Guest may choose an alternative tour or date, or receive a refund of the amount
        paid to the Company, after deduction of non-recoverable supplier charges already incurred.
      </p>

      <h2>15. Complaints</h2>
      <p>
        Any complaint must be reported in writing to the Company during the tour (so it can be fixed on the spot) and,
        in any case, within 7 days of tour completion. Complaints raised later may not be considered. See the{" "}
        <Link href="/refund-policy">Claims &amp; Refund Policy</Link> for how to make a claim.
      </p>

      <h2>16. Photography and marketing</h2>
      <p>
        The Company may use photographs and videos taken during tours for promotion, unless the Guest informs the tour
        manager in writing that they do not consent.
      </p>

      <h2>17. Privacy</h2>
      <p>
        Guest information is used only for bookings, legal compliance and service communication, and is shared with
        suppliers only as needed to deliver the services. See our <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>18. Governing law and jurisdiction</h2>
      <p>
        These terms are governed by the laws of India. The parties will first try to resolve any dispute amicably
        through discussion. Failing that, all disputes are subject to the exclusive jurisdiction of the courts at
        Kolkata, West Bengal.
      </p>

      <PolicyFooter current="/terms" />
    </LegalPage>
  );
}
