import type { Metadata } from "next";
import { NavBar } from "@/components/ui/NavBar";
import { Footer } from "@/components/ui/Footer";
import { PlannerWizard } from "@/components/plan/PlannerWizard";

export const metadata: Metadata = {
  title: "Plan your trip",
  description:
    "Choose your destinations, tell us how you travel, and get a costed day-by-day itinerary you can adjust.",
};

export default function PlanPage() {
  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-[104px] sm:px-6 md:px-10 md:pb-24 md:pt-[124px]">
        <PlannerWizard />
      </main>
      <Footer />
    </>
  );
}
