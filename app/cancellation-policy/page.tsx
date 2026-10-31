import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/LegalPage";
import { PolicyFooter } from "@/components/legal/PolicyFooter";

export const metadata: Metadata = {
  title: "Cancellation Policy | Retro Holidays",
  description: "How to cancel a Retro Holidays booking, cancellation charges and no-show rules.",
  alternates: { canonical: "/cancellation-policy" },
};

const SLAB = [
  ["45 days or more", "10%"],
  ["30–44 days", "25%"],
  ["15–29 days", "50%"],
  ["7–14 days", "75%"],
  ["Less than 7 days / No Show", "100%"],
];

export default function CancellationPolicyPage() {
  return (
    <LegalPage title="Cancellation Policy" updated="31 October 2026">
      <h2>1. How to cancel</h2>
      <p>
        All cancellations or amendments must be sent in writing (email or WhatsApp to official Company contacts). The
        date and time the Company receives the request is the cancellation date. Verbal requests are not accepted.
      </p>

      <h2>2. Who it applies to</h2>
      <p>
        These charges apply whatever the reason for cancellation, including illness, accident, death in the family,
        personal emergencies, visa rejection, natural calamities, late arrival, or missed flights, trains, buses,
        ferries or any connecting transport.
      </p>

      <h2>3. Cancellation charges</h2>
      <p>
        Cancellation charges depend on the cancellation policies of hotels, airlines, railways, transporters and other
        suppliers booked for the Guest, plus the Company&apos;s service fee. The supplier charges usually range from
        10% to 100% of the booking value, depending on the season and how close the cancellation is to check-in. The
        exact charge is shown on the booking confirmation.
      </p>

      <h2>4. Standard slab</h2>
      <p>Applies where supplier terms are not stricter.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/15 text-[var(--text)]">
              <th className="py-2 pr-4 font-semibold">Days before departure</th>
              <th className="py-2 font-semibold">Cancellation charge (of land package cost)</th>
            </tr>
          </thead>
          <tbody>
            {SLAB.map(([days, pct]) => (
              <tr key={days} className="border-b border-white/10">
                <td className="py-2 pr-4">{days}</td>
                <td className="py-2">{pct}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        The higher of this slab and the actual supplier cancellation charges applies. Peak-season, festival,
        special-event, group and non-refundable bookings may carry stricter terms stated at the time of booking.
      </p>

      <h2>5. Flights, trains and cruises</h2>
      <p>
        Cancellation terms of the airline, railway or operator apply, plus the Company&apos;s service fee. Some tickets
        are non-refundable and non-changeable.
      </p>

      <h2>6. Amendments</h2>
      <p>
        A change of date, destination, hotel or passenger name is treated as a cancellation and a new booking unless
        the supplier allows a free change. Fare/rate differences and change fees are payable by the Guest.
      </p>

      <h2>7. No Show</h2>
      <p>
        If the Guest is not present at the start of the tour (day 1) or at any pre-booked service, it is a &ldquo;No
        Show&rdquo; and 100% of the amount for that Guest and service is forfeited. If one member of a group or family
        does not show up, the No Show rule applies to that member&apos;s share.
      </p>

      <h2>8. Delays and disruptions during travel</h2>
      <p>
        If a Guest&apos;s flight, train, bus, cab, ferry or any connecting transport is delayed, cancelled or
        disrupted, the Guest must immediately inform the Company and, where applicable, the driver or hotel. If the
        Company is not informed in time, the affected services are treated as cancelled and cancellation charges apply,
        and the Guest must make their own way to the destination. Where the Guest has informed the Company, the Company
        will help the Guest to reach the destination or a safe place. Cancellation requests are not accepted once travel
        has begun and the delay is the result of transport disruption.
      </p>

      <h2>9. Unused services</h2>
      <p>
        After the tour has started, unused services (hotel nights, meals, transfers, sightseeing, airport transfers)
        are not refundable, and no cash equivalent or price reduction is given.
      </p>

      <h2>10. Changes and substitutions by the Company</h2>
      <p>
        If a hotel, room or vehicle cannot be provided for any reason, the Company will provide a similar or better
        alternative, and no cancellation will be accepted. If the itinerary must be rescheduled because of weather,
        calamities, political situations or other conditions, a similar itinerary will be arranged, and additional
        costs are borne by the Guest.
      </p>

      <h2>11. Role in service quality</h2>
      <p>
        The Company is a booking agent for hotels and transport and is responsible up to the point the reserved room or
        vehicle is allotted to the Guest. Maintenance, upkeep, food quality and on-site services are the responsibility
        of the supplier. Dissatisfaction on these grounds is not a ground for cancellation, but the Company will assist
        the Guest in raising the matter with the supplier.
      </p>

      <h2>12. Jurisdiction</h2>
      <p>All disputes are subject to Kolkata jurisdiction.</p>

      <p>
        How refunds work after a cancellation is explained in the <Link href="/refund-policy">Claims &amp; Refund
        Policy</Link>. See also our <Link href="/terms">Terms &amp; Conditions</Link>.
      </p>

      <PolicyFooter current="/cancellation-policy" />
    </LegalPage>
  );
}
