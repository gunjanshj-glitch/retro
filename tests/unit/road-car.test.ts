import { describe, expect, it } from "vitest";
import { estimateCarTrip, roadKmFor, driveMinutesFor } from "@/lib/atlas/engine/roadcar";

describe("estimateCarTrip", () => {
  it("scales with distance", () => {
    const near = estimateCarTrip(60, 2, "india");
    const far = estimateCarTrip(400, 2, "india");
    expect(far.totalInr).toBeGreaterThan(near.totalInr * 3);
    expect(far.roadKm).toBe(roadKmFor(400));
  });

  it("shares one vehicle across the group, so the per-person fare falls as the group grows", () => {
    const solo = estimateCarTrip(300, 1, "india");
    const four = estimateCarTrip(300, 4, "india");
    expect(four.vehicles).toBe(1);
    expect(four.totalInr).toBeLessThanOrEqual(solo.totalInr * 1.4);
    expect(four.perPersonInr).toBeLessThan(solo.perPersonInr);
  });

  it("adds vehicles once seats run out", () => {
    const one = estimateCarTrip(200, 6, "india");
    const two = estimateCarTrip(200, 9, "india");
    expect(one.vehicles * one.seatsPerVehicle).toBeGreaterThanOrEqual(6);
    expect(two.vehicles * two.seatsPerVehicle).toBeGreaterThanOrEqual(9);
  });

  it("adds a driver night halt on multi-day drives", () => {
    const day = estimateCarTrip(150, 2, "india");
    const multi = estimateCarTrip(700, 2, "india");
    expect(day.drivingDays).toBe(1);
    expect(multi.drivingDays).toBeGreaterThan(1);
    expect(multi.breakdown.driverInr).toBeGreaterThan(day.breakdown.driverInr * 2);
  });

  it("breaks the total into fuel, vehicle, tolls and driver", () => {
    const c = estimateCarTrip(250, 3, "india");
    const sum = c.breakdown.fuelInr + c.breakdown.vehicleInr + c.breakdown.tollsInr + c.breakdown.driverInr;
    expect(Math.abs(sum - c.totalInr)).toBeLessThanOrEqual(4);
    expect(c.breakdown.fuelInr).toBeGreaterThan(0);
  });

  it("is dearer in Europe than India for the same trip", () => {
    expect(estimateCarTrip(300, 2, "europe").totalInr).toBeGreaterThan(estimateCarTrip(300, 2, "india").totalInr * 2);
  });

  it("matches the shared drive-time profile", () => {
    expect(driveMinutesFor(300)).toBeGreaterThan(300);
  });
});
