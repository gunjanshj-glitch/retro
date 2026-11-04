import { describe, expect, it } from "vitest";
import { FLOW, nextStep, normalisePhone, progress, toEnquiry, validate, whatsappUrl } from "@retro/chat-flow";

describe("chat-flow", () => {
  it("walks the steps in order and ends with null", () => {
    const a: Record<string, string> = {};
    const seen: string[] = [];
    for (let s = nextStep(a); s; s = nextStep(a)) { seen.push(s.id); a[s.id] = "x"; }
    expect(seen).toEqual(FLOW.map((s) => s.id));
    expect(nextStep(a)).toBeNull();
  });

  it("lets optional steps be skipped but never name and phone", () => {
    expect(FLOW.filter((s) => !s.skippable).map((s) => s.id)).toEqual(["name", "phone"]);
    const skipped = new Set(["destination", "when", "who", "days", "budget"]);
    expect(nextStep({}, skipped)?.id).toBe("name");
    expect(progress({}, skipped)).toEqual({ done: 5, total: 7 });
  });

  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["+44 7700 900123", "+447700900123"],
  ])("accepts phone %s", (raw, want) => expect(normalisePhone(raw)).toBe(want));

  it.each(["12345", "5876543210", "abcdefghij", "", "+12"])("rejects phone %j", (raw) => expect(normalisePhone(raw)).toBeNull());

  it("validates choices against the options and text by kind", () => {
    const choice = FLOW[0];
    expect(validate(choice, "India").ok).toBe(true);
    expect(validate(choice, "Mars").ok).toBe(false);
    expect(validate(FLOW.find((s) => s.id === "name")!, "A").ok).toBe(false);
    expect(validate(FLOW.find((s) => s.id === "phone")!, "98765 43210")).toEqual({ ok: true, value: "+919876543210" });
  });

  it("builds a lead only when name and a valid phone exist", () => {
    expect(toEnquiry({ name: "Asha" }, "app-chat")).toBeNull();
    expect(toEnquiry({ name: "Asha", phone: "bad" }, "app-chat")).toBeNull();
    const lead = toEnquiry({ name: "Asha", phone: "9876543210", destination: "India", days: "6 to 8", budget: "Under ₹50k" }, "app-chat")!;
    expect(lead).toMatchObject({ source: "app-chat", phone: "+919876543210", destination: "India" });
    expect(lead.notes).toBe("Days: 6 to 8 · Budget per person: Under ₹50k");
  });

  it("builds a WhatsApp link with the context URL-encoded", () => {
    const url = whatsappUrl("+91 62908 55027", { destination: "India", name: "Asha" });
    expect(url.startsWith("https://wa.me/916290855027?text=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("Destination: India");
  });
});
