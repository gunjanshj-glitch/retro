import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NavBar } from "@/components/ui/NavBar";
import { AuthProvider } from "@/components/auth/AuthProvider";

describe("NavBar", () => {
  it("renders a Plan your trip call-to-action linking to /plan", () => {
    render(
      <AuthProvider>
        <NavBar />
      </AuthProvider>,
    );
    const cta = screen.getByRole("link", { name: /plan your trip/i });
    expect(cta).toHaveAttribute("href", "/plan");
  });
});
